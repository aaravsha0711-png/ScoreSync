"""composer.py

Local music composition endpoints for ScoreSync.
All generation uses music21 or pure-Python fallback — no paid API required.
PostgreSQL (Render) + SQLite (local) dual-mode, consistent with database.py.

Upgrades (v2):
  • ~100 rich named styles with per-style generation parameters
  • Multi-section song structure: intro / verse / chorus / bridge / outro
  • Longer compositions: up to 128 measures with section-aware generation
  • Sample layering: user-uploaded audio + public sample URL references stored in DB
  • Style taxonomy with categories (genre, era, mood, world, etc.)
"""
from __future__ import annotations

import json
import math
import os
import random
import re
import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from pydantic import BaseModel

from deps import get_current_user
from database import get_conn, DATABASE_URL

router = APIRouter(prefix="/composer", tags=["composer"])

# ─────────────────────────────────────────────────────────────────────────────
# DB initialisation — dual-mode (PostgreSQL on Render, SQLite locally)
# ─────────────────────────────────────────────────────────────────────────────

def init_composer_tables() -> None:
    if DATABASE_URL:
        _init_pg()
    else:
        _init_sqlite()


def _init_pg() -> None:
    with get_conn() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS compositions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL DEFAULT 'Untitled',
            key TEXT NOT NULL DEFAULT 'C',
            mode TEXT NOT NULL DEFAULT 'major',
            tempo INTEGER NOT NULL DEFAULT 120,
            time_signature TEXT NOT NULL DEFAULT '4/4',
            measures INTEGER NOT NULL DEFAULT 8,
            style TEXT NOT NULL DEFAULT 'neutral',
            sections_json TEXT NOT NULL DEFAULT '[]',
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS composition_parts (
            id SERIAL PRIMARY KEY,
            composition_id INTEGER NOT NULL,
            role TEXT NOT NULL,
            instrument TEXT NOT NULL DEFAULT 'Piano',
            notes_json TEXT NOT NULL DEFAULT '[]',
            updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(composition_id, role)
        );
        CREATE TABLE IF NOT EXISTS drum_patterns (
            id SERIAL PRIMARY KEY,
            composition_id INTEGER NOT NULL UNIQUE,
            pattern_json TEXT NOT NULL DEFAULT '{}',
            steps INTEGER NOT NULL DEFAULT 16,
            swing REAL NOT NULL DEFAULT 0.0,
            updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS piano_rolls (
            id SERIAL PRIMARY KEY,
            composition_id INTEGER NOT NULL,
            part_role TEXT NOT NULL DEFAULT 'melody',
            cells_json TEXT NOT NULL DEFAULT '[]',
            updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(composition_id, part_role)
        );
        CREATE TABLE IF NOT EXISTS samples (
            id SERIAL PRIMARY KEY,
            composition_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            source_type TEXT NOT NULL DEFAULT 'upload',
            source_url TEXT,
            file_path TEXT,
            layer_role TEXT NOT NULL DEFAULT 'sample',
            start_measure INTEGER NOT NULL DEFAULT 1,
            end_measure INTEGER,
            volume REAL NOT NULL DEFAULT 1.0,
            loop INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
        """)


def _init_sqlite() -> None:
    with get_conn() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS compositions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL DEFAULT 'Untitled',
            key TEXT NOT NULL DEFAULT 'C',
            mode TEXT NOT NULL DEFAULT 'major',
            tempo INTEGER NOT NULL DEFAULT 120,
            time_signature TEXT NOT NULL DEFAULT '4/4',
            measures INTEGER NOT NULL DEFAULT 8,
            style TEXT NOT NULL DEFAULT 'neutral',
            sections_json TEXT NOT NULL DEFAULT '[]',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS composition_parts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            composition_id INTEGER NOT NULL,
            role TEXT NOT NULL,
            instrument TEXT NOT NULL DEFAULT 'Piano',
            notes_json TEXT NOT NULL DEFAULT '[]',
            updated_at TEXT DEFAULT (datetime('now')),
            UNIQUE(composition_id, role)
        );
        CREATE TABLE IF NOT EXISTS drum_patterns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            composition_id INTEGER NOT NULL UNIQUE,
            pattern_json TEXT NOT NULL DEFAULT '{}',
            steps INTEGER NOT NULL DEFAULT 16,
            swing REAL NOT NULL DEFAULT 0.0,
            updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS piano_rolls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            composition_id INTEGER NOT NULL,
            part_role TEXT NOT NULL DEFAULT 'melody',
            cells_json TEXT NOT NULL DEFAULT '[]',
            updated_at TEXT DEFAULT (datetime('now')),
            UNIQUE(composition_id, part_role)
        );
        CREATE TABLE IF NOT EXISTS samples (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            composition_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            source_type TEXT NOT NULL DEFAULT 'upload',
            source_url TEXT,
            file_path TEXT,
            layer_role TEXT NOT NULL DEFAULT 'sample',
            start_measure INTEGER NOT NULL DEFAULT 1,
            end_measure INTEGER,
            volume REAL NOT NULL DEFAULT 1.0,
            loop INTEGER NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );
        """)

# ─────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ─────────────────────────────────────────────────────────────────────────────

class CompositionCreate(BaseModel):
    title: str = "Untitled"
    key: str = "C"
    mode: str = "major"
    tempo: int = 120
    time_signature: str = "4/4"
    measures: int = 8
    style: str = "neutral"
    sections: list[dict] = []   # [{type, measures, label}]

class PartData(BaseModel):
    role: str
    instrument: str = "Piano"
    notes: list[dict[str, Any]] = []

class DrumPatternData(BaseModel):
    pattern: dict[str, list[int]]
    steps: int = 16
    swing: float = 0.0

class PianoRollData(BaseModel):
    part_role: str = "melody"
    cells: list[dict[str, Any]] = []

class SampleData(BaseModel):
    name: str
    source_type: str = "url"   # "upload" | "url"
    source_url: Optional[str] = None
    layer_role: str = "sample"
    start_measure: int = 1
    end_measure: Optional[int] = None
    volume: float = 1.0
    loop: bool = False

class GenerateRequest(BaseModel):
    key: str = "C"
    mode: str = "major"
    measures: int = 8
    tempo: int = 120
    time_signature: str = "4/4"
    seed_notes: list[str] = []
    existing_melody: list[dict] = []
    existing_harmony: list[dict] = []
    existing_bass: list[dict] = []
    style: str = "neutral"
    section_type: str = "verse"   # intro|verse|chorus|bridge|outro
    measure_offset: int = 0       # where in the global timeline this section starts

# ─────────────────────────────────────────────────────────────────────────────
# Style taxonomy — 100+ rich named styles
# ─────────────────────────────────────────────────────────────────────────────

STYLE_CATALOG: dict[str, dict] = {
  # ── Classical ──────────────────────────────────────────────────────────────
  "baroque_counterpoint":  {"category":"Classical","tempo_range":(70,100),"mode":"minor","rhythm":"rhythmic","dur_pool":[0.5,0.5,1.0],"bass_style":"walking","density":0.9,"description":"Baroque Counterpoint"},
  "classical_sonata":      {"category":"Classical","tempo_range":(100,140),"mode":"major","rhythm":"neutral","dur_pool":[0.5,1.0,1.0,2.0],"bass_style":"root_fifth","density":0.7,"description":"Classical Sonata"},
  "romantic_nocturne":     {"category":"Classical","tempo_range":(50,72),"mode":"minor","rhythm":"lyrical","dur_pool":[1.0,2.0,2.0,4.0],"bass_style":"arpeggiated","density":0.5,"description":"Romantic Nocturne"},
  "romantic_symphony":     {"category":"Classical","tempo_range":(80,130),"mode":"major","rhythm":"driving","dur_pool":[0.5,1.0,1.0],"bass_style":"root_fifth","density":1.0,"description":"Romantic Symphony"},
  "impressionist":         {"category":"Classical","tempo_range":(60,90),"mode":"dorian","rhythm":"lyrical","dur_pool":[1.0,1.5,2.0],"bass_style":"pedal","density":0.4,"description":"Impressionist (Debussy)"},
  "minimalist":            {"category":"Classical","tempo_range":(80,120),"mode":"major","rhythm":"rhythmic","dur_pool":[0.5,0.5,0.5,1.0],"bass_style":"pedal","density":0.3,"description":"Minimalist (Reich/Glass)"},
  "neoclassical":          {"category":"Classical","tempo_range":(90,120),"mode":"major","rhythm":"neutral","dur_pool":[0.5,1.0,2.0],"bass_style":"walking","density":0.6,"description":"Neoclassical"},
  "contemporary_classical":{"category":"Classical","tempo_range":(60,100),"mode":"harmonic_minor","rhythm":"sparse","dur_pool":[1.0,2.0,4.0],"bass_style":"pedal","density":0.35,"description":"Contemporary Classical"},
  "renaissance_polyphony": {"category":"Classical","tempo_range":(60,90),"mode":"dorian","rhythm":"neutral","dur_pool":[0.5,1.0,2.0],"bass_style":"walking","density":0.65,"description":"Renaissance Polyphony"},

  # ── Jazz ───────────────────────────────────────────────────────────────────
  "bebop":                 {"category":"Jazz","tempo_range":(180,280),"mode":"dorian","rhythm":"rhythmic","dur_pool":[0.25,0.5,0.5],"bass_style":"walking","density":0.95,"description":"Bebop"},
  "cool_jazz":             {"category":"Jazz","tempo_range":(100,140),"mode":"dorian","rhythm":"lyrical","dur_pool":[0.5,1.0,1.5],"bass_style":"walking","density":0.55,"description":"Cool Jazz"},
  "modal_jazz":            {"category":"Jazz","tempo_range":(120,160),"mode":"dorian","rhythm":"neutral","dur_pool":[1.0,1.0,2.0],"bass_style":"pedal","density":0.6,"description":"Modal Jazz (Miles)"},
  "jazz_fusion":           {"category":"Jazz","tempo_range":(120,180),"mode":"mixolydian","rhythm":"driving","dur_pool":[0.25,0.5,1.0],"bass_style":"arpeggiated","density":0.85,"description":"Jazz Fusion"},
  "bossa_nova":            {"category":"Jazz","tempo_range":(100,140),"mode":"major","rhythm":"lyrical","dur_pool":[0.5,1.0,1.5],"bass_style":"root_fifth","density":0.5,"description":"Bossa Nova"},
  "swing":                 {"category":"Jazz","tempo_range":(120,200),"mode":"blues","rhythm":"rhythmic","dur_pool":[0.5,0.5,1.0],"bass_style":"walking","density":0.75,"description":"Swing"},
  "latin_jazz":            {"category":"Jazz","tempo_range":(130,180),"mode":"dorian","rhythm":"driving","dur_pool":[0.25,0.5,0.5,1.0],"bass_style":"root_fifth","density":0.8,"description":"Latin Jazz"},
  "gypsy_jazz":            {"category":"Jazz","tempo_range":(160,220),"mode":"harmonic_minor","rhythm":"driving","dur_pool":[0.25,0.5,0.5],"bass_style":"walking","density":0.85,"description":"Gypsy Jazz (Manouche)"},
  "jazz_ballad":           {"category":"Jazz","tempo_range":(50,80),"mode":"major","rhythm":"lyrical","dur_pool":[1.0,2.0,2.0,4.0],"bass_style":"walking","density":0.4,"description":"Jazz Ballad"},
  "free_jazz":             {"category":"Jazz","tempo_range":(100,200),"mode":"pentatonic","rhythm":"rhythmic","dur_pool":[0.25,0.5,1.0,2.0],"bass_style":"walking","density":0.8,"description":"Free Jazz / Avant-Garde"},

  # ── Blues ──────────────────────────────────────────────────────────────────
  "delta_blues":           {"category":"Blues","tempo_range":(60,90),"mode":"blues","rhythm":"sparse","dur_pool":[1.0,1.0,2.0],"bass_style":"pedal","density":0.4,"description":"Delta Blues"},
  "chicago_blues":         {"category":"Blues","tempo_range":(90,130),"mode":"blues","rhythm":"rhythmic","dur_pool":[0.5,1.0,1.0],"bass_style":"root_fifth","density":0.65,"description":"Chicago Blues"},
  "electric_blues":        {"category":"Blues","tempo_range":(100,140),"mode":"blues","rhythm":"driving","dur_pool":[0.5,0.5,1.0],"bass_style":"walking","density":0.7,"description":"Electric Blues"},
  "boogie_woogie":         {"category":"Blues","tempo_range":(140,180),"mode":"blues","rhythm":"driving","dur_pool":[0.25,0.5,0.5],"bass_style":"arpeggiated","density":0.9,"description":"Boogie-Woogie"},

  # ── Rock ───────────────────────────────────────────────────────────────────
  "classic_rock":          {"category":"Rock","tempo_range":(110,145),"mode":"mixolydian","rhythm":"driving","dur_pool":[0.5,1.0,1.0],"bass_style":"root_fifth","density":0.75,"description":"Classic Rock"},
  "hard_rock":             {"category":"Rock","tempo_range":(130,160),"mode":"minor","rhythm":"driving","dur_pool":[0.25,0.5,1.0],"bass_style":"pedal","density":0.9,"description":"Hard Rock"},
  "punk_rock":             {"category":"Rock","tempo_range":(160,220),"mode":"major","rhythm":"driving","dur_pool":[0.25,0.5,0.5],"bass_style":"root_fifth","density":0.95,"description":"Punk Rock"},
  "indie_rock":            {"category":"Rock","tempo_range":(100,140),"mode":"major","rhythm":"neutral","dur_pool":[0.5,1.0,1.5],"bass_style":"root_fifth","density":0.6,"description":"Indie Rock"},
  "post_rock":             {"category":"Rock","tempo_range":(70,110),"mode":"major","rhythm":"lyrical","dur_pool":[1.0,2.0,2.0,4.0],"bass_style":"pedal","density":0.45,"description":"Post-Rock"},
  "grunge":                {"category":"Rock","tempo_range":(100,140),"mode":"minor","rhythm":"driving","dur_pool":[0.5,1.0,1.0],"bass_style":"pedal","density":0.8,"description":"Grunge"},
  "shoegaze":              {"category":"Rock","tempo_range":(90,130),"mode":"major","rhythm":"lyrical","dur_pool":[1.0,2.0,4.0],"bass_style":"pedal","density":0.35,"description":"Shoegaze"},
  "alternative_rock":      {"category":"Rock","tempo_range":(100,145),"mode":"minor","rhythm":"neutral","dur_pool":[0.5,1.0,1.5],"bass_style":"root_fifth","density":0.7,"description":"Alternative Rock"},
  "progressive_rock":      {"category":"Rock","tempo_range":(90,160),"mode":"dorian","rhythm":"driving","dur_pool":[0.25,0.5,1.0,2.0],"bass_style":"walking","density":0.85,"description":"Progressive Rock"},

  # ── Pop ────────────────────────────────────────────────────────────────────
  "pop_anthem":            {"category":"Pop","tempo_range":(120,140),"mode":"major","rhythm":"driving","dur_pool":[0.5,1.0,1.0],"bass_style":"root_fifth","density":0.8,"description":"Pop Anthem"},
  "synth_pop":             {"category":"Pop","tempo_range":(110,135),"mode":"minor","rhythm":"rhythmic","dur_pool":[0.5,0.5,1.0],"bass_style":"arpeggiated","density":0.7,"description":"Synth-Pop"},
  "bedroom_pop":           {"category":"Pop","tempo_range":(80,110),"mode":"major","rhythm":"lyrical","dur_pool":[0.5,1.0,2.0],"bass_style":"root_fifth","density":0.45,"description":"Bedroom Pop"},
  "power_pop":             {"category":"Pop","tempo_range":(130,160),"mode":"major","rhythm":"driving","dur_pool":[0.5,0.5,1.0],"bass_style":"root_fifth","density":0.85,"description":"Power Pop"},
  "art_pop":               {"category":"Pop","tempo_range":(90,130),"mode":"dorian","rhythm":"neutral","dur_pool":[0.5,1.0,1.5,2.0],"bass_style":"arpeggiated","density":0.6,"description":"Art Pop"},
  "dream_pop":             {"category":"Pop","tempo_range":(80,120),"mode":"major","rhythm":"lyrical","dur_pool":[1.0,2.0,4.0],"bass_style":"pedal","density":0.4,"description":"Dream Pop"},
  "k_pop":                 {"category":"Pop","tempo_range":(120,150),"mode":"major","rhythm":"driving","dur_pool":[0.25,0.5,1.0],"bass_style":"arpeggiated","density":0.9,"description":"K-Pop"},

  # ── Electronic ─────────────────────────────────────────────────────────────
  "house":                 {"category":"Electronic","tempo_range":(120,130),"mode":"minor","rhythm":"driving","dur_pool":[0.25,0.5,0.5,1.0],"bass_style":"arpeggiated","density":0.85,"description":"House"},
  "techno":                {"category":"Electronic","tempo_range":(130,155),"mode":"minor","rhythm":"driving","dur_pool":[0.25,0.25,0.5],"bass_style":"pedal","density":0.95,"description":"Techno"},
  "trance":                {"category":"Electronic","tempo_range":(128,145),"mode":"minor","rhythm":"driving","dur_pool":[0.5,1.0,2.0],"bass_style":"arpeggiated","density":0.8,"description":"Trance"},
  "ambient":               {"category":"Electronic","tempo_range":(60,90),"mode":"major","rhythm":"sparse","dur_pool":[2.0,4.0,4.0,8.0],"bass_style":"pedal","density":0.2,"description":"Ambient"},
  "drum_and_bass":         {"category":"Electronic","tempo_range":(160,180),"mode":"minor","rhythm":"driving","dur_pool":[0.25,0.5,0.5],"bass_style":"arpeggiated","density":0.9,"description":"Drum & Bass"},
  "dubstep":               {"category":"Electronic","tempo_range":(138,145),"mode":"minor","rhythm":"driving","dur_pool":[0.5,1.0,1.0,2.0],"bass_style":"pedal","density":0.75,"description":"Dubstep"},
  "lo_fi_hiphop":          {"category":"Electronic","tempo_range":(70,90),"mode":"dorian","rhythm":"lyrical","dur_pool":[0.5,1.0,1.5],"bass_style":"walking","density":0.45,"description":"Lo-Fi Hip-Hop"},
  "chillout":              {"category":"Electronic","tempo_range":(90,110),"mode":"major","rhythm":"lyrical","dur_pool":[1.0,2.0,2.0],"bass_style":"root_fifth","density":0.35,"description":"Chillout / Downtempo"},
  "idm":                   {"category":"Electronic","tempo_range":(100,160),"mode":"minor","rhythm":"rhythmic","dur_pool":[0.25,0.5,0.5,1.0],"bass_style":"arpeggiated","density":0.7,"description":"IDM (Aphex Twin)"},
  "vaporwave":             {"category":"Electronic","tempo_range":(70,90),"mode":"major","rhythm":"sparse","dur_pool":[1.0,2.0,4.0],"bass_style":"arpeggiated","density":0.3,"description":"Vaporwave"},
  "synthwave":             {"category":"Electronic","tempo_range":(90,120),"mode":"minor","rhythm":"driving","dur_pool":[0.5,1.0,1.0],"bass_style":"arpeggiated","density":0.7,"description":"Synthwave / Retrowave"},
  "dark_ambient":          {"category":"Electronic","tempo_range":(50,80),"mode":"harmonic_minor","rhythm":"sparse","dur_pool":[2.0,4.0,8.0],"bass_style":"pedal","density":0.15,"description":"Dark Ambient"},
  "future_bass":           {"category":"Electronic","tempo_range":(140,160),"mode":"major","rhythm":"driving","dur_pool":[0.25,0.5,1.0],"bass_style":"arpeggiated","density":0.85,"description":"Future Bass"},
  "garage":                {"category":"Electronic","tempo_range":(130,140),"mode":"minor","rhythm":"rhythmic","dur_pool":[0.25,0.5,0.5,1.0],"bass_style":"arpeggiated","density":0.8,"description":"UK Garage"},

  # ── Hip-Hop / R&B ──────────────────────────────────────────────────────────
  "boom_bap":              {"category":"Hip-Hop","tempo_range":(85,100),"mode":"minor","rhythm":"rhythmic","dur_pool":[0.5,1.0,1.0],"bass_style":"root_fifth","density":0.65,"description":"Boom Bap"},
  "trap":                  {"category":"Hip-Hop","tempo_range":(130,145),"mode":"minor","rhythm":"driving","dur_pool":[0.5,1.0,2.0],"bass_style":"pedal","density":0.6,"description":"Trap"},
  "old_school_hiphop":     {"category":"Hip-Hop","tempo_range":(90,110),"mode":"minor","rhythm":"rhythmic","dur_pool":[0.5,0.5,1.0],"bass_style":"walking","density":0.7,"description":"Old School Hip-Hop"},
  "neo_soul":              {"category":"R&B","tempo_range":(70,100),"mode":"dorian","rhythm":"lyrical","dur_pool":[0.5,1.0,1.5,2.0],"bass_style":"walking","density":0.55,"description":"Neo-Soul"},
  "classic_rnb":           {"category":"R&B","tempo_range":(80,110),"mode":"minor","rhythm":"lyrical","dur_pool":[0.5,1.0,2.0],"bass_style":"root_fifth","density":0.6,"description":"Classic R&B"},
  "funk":                  {"category":"R&B","tempo_range":(95,120),"mode":"dorian","rhythm":"driving","dur_pool":[0.25,0.5,0.5,1.0],"bass_style":"arpeggiated","density":0.85,"description":"Funk"},
  "rnb_trap":              {"category":"R&B","tempo_range":(70,90),"mode":"minor","rhythm":"lyrical","dur_pool":[0.5,1.0,2.0],"bass_style":"pedal","density":0.5,"description":"Contemporary R&B / Trap Soul"},

  # ── Soul / Gospel ──────────────────────────────────────────────────────────
  "soul":                  {"category":"Soul","tempo_range":(70,110),"mode":"minor","rhythm":"lyrical","dur_pool":[0.5,1.0,2.0],"bass_style":"root_fifth","density":0.55,"description":"Soul"},
  "gospel":                {"category":"Soul","tempo_range":(80,120),"mode":"major","rhythm":"driving","dur_pool":[0.5,1.0,1.0],"bass_style":"root_fifth","density":0.8,"description":"Gospel"},
  "motown":                {"category":"Soul","tempo_range":(100,130),"mode":"major","rhythm":"rhythmic","dur_pool":[0.5,0.5,1.0],"bass_style":"walking","density":0.75,"description":"Motown"},

  # ── Country / Americana ────────────────────────────────────────────────────
  "country":               {"category":"Country","tempo_range":(90,130),"mode":"major","rhythm":"neutral","dur_pool":[0.5,1.0,1.0,2.0],"bass_style":"root_fifth","density":0.6,"description":"Country"},
  "bluegrass":             {"category":"Country","tempo_range":(130,180),"mode":"major","rhythm":"driving","dur_pool":[0.25,0.5,0.5],"bass_style":"walking","density":0.85,"description":"Bluegrass"},
  "americana":             {"category":"Country","tempo_range":(80,110),"mode":"major","rhythm":"lyrical","dur_pool":[0.5,1.0,2.0],"bass_style":"root_fifth","density":0.5,"description":"Americana / Folk-Country"},
  "outlaw_country":        {"category":"Country","tempo_range":(100,130),"mode":"mixolydian","rhythm":"neutral","dur_pool":[0.5,1.0,1.5],"bass_style":"root_fifth","density":0.65,"description":"Outlaw Country"},

  # ── Folk / Singer-Songwriter ───────────────────────────────────────────────
  "celtic_folk":           {"category":"Folk","tempo_range":(90,150),"mode":"dorian","rhythm":"driving","dur_pool":[0.25,0.5,1.0],"bass_style":"root_fifth","density":0.7,"description":"Celtic Folk"},
  "appalachian_folk":      {"category":"Folk","tempo_range":(80,120),"mode":"major","rhythm":"neutral","dur_pool":[0.5,1.0,1.0],"bass_style":"root_fifth","density":0.55,"description":"Appalachian Folk"},
  "singer_songwriter":     {"category":"Folk","tempo_range":(70,110),"mode":"major","rhythm":"lyrical","dur_pool":[0.5,1.0,2.0],"bass_style":"root_fifth","density":0.4,"description":"Singer-Songwriter"},
  "folk_baroque":          {"category":"Folk","tempo_range":(80,110),"mode":"dorian","rhythm":"lyrical","dur_pool":[0.5,1.0,1.5,2.0],"bass_style":"walking","density":0.5,"description":"Folk Baroque (Bert Jansch)"},

  # ── Reggae / Caribbean ─────────────────────────────────────────────────────
  "roots_reggae":          {"category":"Reggae","tempo_range":(70,90),"mode":"dorian","rhythm":"rhythmic","dur_pool":[0.5,1.0,1.0],"bass_style":"root_fifth","density":0.65,"description":"Roots Reggae"},
  "dancehall":             {"category":"Reggae","tempo_range":(90,115),"mode":"minor","rhythm":"driving","dur_pool":[0.25,0.5,0.5,1.0],"bass_style":"root_fifth","density":0.75,"description":"Dancehall"},
  "ska":                   {"category":"Reggae","tempo_range":(120,160),"mode":"major","rhythm":"rhythmic","dur_pool":[0.25,0.5,0.5],"bass_style":"walking","density":0.8,"description":"Ska"},

  # ── Latin ──────────────────────────────────────────────────────────────────
  "salsa":                 {"category":"Latin","tempo_range":(150,200),"mode":"major","rhythm":"driving","dur_pool":[0.25,0.5,0.5],"bass_style":"arpeggiated","density":0.9,"description":"Salsa"},
  "tango":                 {"category":"Latin","tempo_range":(110,140),"mode":"harmonic_minor","rhythm":"driving","dur_pool":[0.25,0.5,1.0],"bass_style":"arpeggiated","density":0.85,"description":"Tango"},
  "samba":                 {"category":"Latin","tempo_range":(90,130),"mode":"major","rhythm":"driving","dur_pool":[0.25,0.5,0.5],"bass_style":"arpeggiated","density":0.9,"description":"Samba"},
  "flamenco":              {"category":"Latin","tempo_range":(120,180),"mode":"harmonic_minor","rhythm":"driving","dur_pool":[0.25,0.5,0.5],"bass_style":"arpeggiated","density":0.9,"description":"Flamenco"},
  "cumbia":                {"category":"Latin","tempo_range":(90,115),"mode":"major","rhythm":"rhythmic","dur_pool":[0.5,0.5,1.0],"bass_style":"root_fifth","density":0.75,"description":"Cumbia"},

  # ── World ──────────────────────────────────────────────────────────────────
  "afrobeat":              {"category":"World","tempo_range":(96,120),"mode":"dorian","rhythm":"driving","dur_pool":[0.25,0.5,0.5,1.0],"bass_style":"arpeggiated","density":0.85,"description":"Afrobeat (Fela)"},
  "highlife":              {"category":"World","tempo_range":(100,130),"mode":"major","rhythm":"rhythmic","dur_pool":[0.5,0.5,1.0],"bass_style":"arpeggiated","density":0.75,"description":"Highlife"},
  "mbaqanga":              {"category":"World","tempo_range":(110,140),"mode":"pentatonic","rhythm":"driving","dur_pool":[0.5,0.5,0.5,1.0],"bass_style":"root_fifth","density":0.8,"description":"Mbaqanga (South Africa)"},
  "indian_classical":      {"category":"World","tempo_range":(60,120),"mode":"pentatonic","rhythm":"lyrical","dur_pool":[0.25,0.5,1.0,2.0],"bass_style":"pedal","density":0.5,"description":"Indian Classical (Raga feel)"},
  "middle_eastern":        {"category":"World","tempo_range":(80,130),"mode":"harmonic_minor","rhythm":"rhythmic","dur_pool":[0.25,0.5,1.0],"bass_style":"pedal","density":0.65,"description":"Middle Eastern / Maqam"},
  "balkan":                {"category":"World","tempo_range":(120,180),"mode":"harmonic_minor","rhythm":"driving","dur_pool":[0.25,0.25,0.5],"bass_style":"root_fifth","density":0.9,"description":"Balkan Brass"},
  "west_african_griot":    {"category":"World","tempo_range":(90,120),"mode":"pentatonic","rhythm":"rhythmic","dur_pool":[0.5,0.5,1.0],"bass_style":"pedal","density":0.6,"description":"West African Griot"},
  "celtic_ambient":        {"category":"World","tempo_range":(60,90),"mode":"dorian","rhythm":"sparse","dur_pool":[1.0,2.0,4.0],"bass_style":"pedal","density":0.3,"description":"Celtic Ambient / New Age"},

  # ── Metal ──────────────────────────────────────────────────────────────────
  "heavy_metal":           {"category":"Metal","tempo_range":(120,160),"mode":"minor","rhythm":"driving","dur_pool":[0.25,0.5,0.5],"bass_style":"root_fifth","density":0.9,"description":"Heavy Metal"},
  "thrash_metal":          {"category":"Metal","tempo_range":(160,220),"mode":"minor","rhythm":"driving","dur_pool":[0.25,0.25,0.5],"bass_style":"pedal","density":0.95,"description":"Thrash Metal"},
  "doom_metal":            {"category":"Metal","tempo_range":(50,80),"mode":"minor","rhythm":"sparse","dur_pool":[2.0,4.0,4.0],"bass_style":"pedal","density":0.5,"description":"Doom Metal"},
  "progressive_metal":     {"category":"Metal","tempo_range":(100,180),"mode":"dorian","rhythm":"driving","dur_pool":[0.25,0.5,1.0,2.0],"bass_style":"walking","density":0.85,"description":"Progressive Metal"},
  "black_metal":           {"category":"Metal","tempo_range":(150,240),"mode":"harmonic_minor","rhythm":"driving","dur_pool":[0.25,0.25,0.25],"bass_style":"pedal","density":0.98,"description":"Black Metal"},

  # ── Cinematic / Soundtrack ─────────────────────────────────────────────────
  "epic_orchestral":       {"category":"Cinematic","tempo_range":(80,120),"mode":"minor","rhythm":"driving","dur_pool":[0.5,1.0,2.0],"bass_style":"root_fifth","density":0.95,"description":"Epic Orchestral"},
  "cinematic_tension":     {"category":"Cinematic","tempo_range":(60,100),"mode":"harmonic_minor","rhythm":"sparse","dur_pool":[1.0,2.0,4.0],"bass_style":"pedal","density":0.3,"description":"Cinematic Tension"},
  "adventure_theme":       {"category":"Cinematic","tempo_range":(120,160),"mode":"major","rhythm":"driving","dur_pool":[0.5,0.5,1.0],"bass_style":"root_fifth","density":0.85,"description":"Adventure / Hero Theme"},
  "emotional_underscore":  {"category":"Cinematic","tempo_range":(60,90),"mode":"major","rhythm":"lyrical","dur_pool":[1.0,2.0,4.0],"bass_style":"arpeggiated","density":0.35,"description":"Emotional Underscore"},
  "horror_score":          {"category":"Cinematic","tempo_range":(50,80),"mode":"harmonic_minor","rhythm":"sparse","dur_pool":[2.0,4.0,8.0],"bass_style":"pedal","density":0.2,"description":"Horror Score"},
  "sci_fi_ambient":        {"category":"Cinematic","tempo_range":(70,100),"mode":"dorian","rhythm":"sparse","dur_pool":[2.0,4.0,8.0],"bass_style":"pedal","density":0.25,"description":"Sci-Fi Ambient"},

  # ── Video Game ─────────────────────────────────────────────────────────────
  "8bit_chiptune":         {"category":"Game","tempo_range":(140,200),"mode":"major","rhythm":"driving","dur_pool":[0.25,0.5,0.5,1.0],"bass_style":"arpeggiated","density":0.8,"description":"8-bit Chiptune"},
  "16bit_rpg":             {"category":"Game","tempo_range":(100,140),"mode":"major","rhythm":"neutral","dur_pool":[0.5,1.0,1.0,2.0],"bass_style":"arpeggiated","density":0.65,"description":"16-bit RPG"},
  "dungeon_crawl":         {"category":"Game","tempo_range":(70,100),"mode":"harmonic_minor","rhythm":"sparse","dur_pool":[1.0,2.0,2.0,4.0],"bass_style":"pedal","density":0.4,"description":"Dungeon Crawl"},
  "boss_battle":           {"category":"Game","tempo_range":(150,200),"mode":"minor","rhythm":"driving","dur_pool":[0.25,0.5,0.5],"bass_style":"root_fifth","density":0.95,"description":"Boss Battle"},
  "open_world":            {"category":"Game","tempo_range":(80,110),"mode":"major","rhythm":"lyrical","dur_pool":[1.0,2.0,2.0,4.0],"bass_style":"arpeggiated","density":0.5,"description":"Open World / Exploration"},

  # ── Neutral / Utility ──────────────────────────────────────────────────────
  "neutral":               {"category":"Utility","tempo_range":(100,130),"mode":"major","rhythm":"neutral","dur_pool":[0.5,1.0,1.0,2.0],"bass_style":"root_fifth","density":0.6,"description":"Neutral (balanced)"},
  "lyrical":               {"category":"Utility","tempo_range":(70,100),"mode":"major","rhythm":"lyrical","dur_pool":[1.0,2.0,2.0,4.0],"bass_style":"arpeggiated","density":0.4,"description":"Lyrical (sustained)"},
  "rhythmic":              {"category":"Utility","tempo_range":(120,150),"mode":"major","rhythm":"rhythmic","dur_pool":[0.25,0.5,0.5,1.0],"bass_style":"root_fifth","density":0.85,"description":"Rhythmic (pulse-driven)"},
}

def get_style_params(style: str) -> dict:
    """Return style dict, falling back to neutral."""
    return STYLE_CATALOG.get(style, STYLE_CATALOG["neutral"])


# ─────────────────────────────────────────────────────────────────────────────
# Song sections
# ─────────────────────────────────────────────────────────────────────────────

DEFAULT_SECTIONS = [
    {"type": "intro",   "measures": 4,  "label": "Intro"},
    {"type": "verse",   "measures": 8,  "label": "Verse 1"},
    {"type": "chorus",  "measures": 8,  "label": "Chorus"},
    {"type": "verse",   "measures": 8,  "label": "Verse 2"},
    {"type": "chorus",  "measures": 8,  "label": "Chorus"},
    {"type": "bridge",  "measures": 4,  "label": "Bridge"},
    {"type": "chorus",  "measures": 8,  "label": "Final Chorus"},
    {"type": "outro",   "measures": 4,  "label": "Outro"},
]

SECTION_TYPE_PARAMS: dict[str, dict] = {
    "intro":   {"density_scale": 0.5,  "octave_low": 4, "octave_high": 5, "melodic_variation": 0.0},
    "verse":   {"density_scale": 0.75, "octave_low": 4, "octave_high": 5, "melodic_variation": 0.2},
    "chorus":  {"density_scale": 1.0,  "octave_low": 4, "octave_high": 6, "melodic_variation": 0.0},
    "bridge":  {"density_scale": 0.8,  "octave_low": 3, "octave_high": 5, "melodic_variation": 0.5},
    "outro":   {"density_scale": 0.4,  "octave_low": 4, "octave_high": 5, "melodic_variation": 0.0},
}

# ─────────────────────────────────────────────────────────────────────────────
# Music theory tables
# ─────────────────────────────────────────────────────────────────────────────

_SCALES: dict[str, list[int]] = {
    "major":          [0, 2, 4, 5, 7, 9, 11],
    "minor":          [0, 2, 3, 5, 7, 8, 10],
    "dorian":         [0, 2, 3, 5, 7, 9, 10],
    "mixolydian":     [0, 2, 4, 5, 7, 9, 10],
    "pentatonic":     [0, 2, 4, 7, 9],
    "blues":          [0, 3, 5, 6, 7, 10],
    "harmonic_minor": [0, 2, 3, 5, 7, 8, 11],
}

_DIATONIC_CHORDS: dict[str, list[tuple[int, int, int]]] = {
    "major": [
        (0, 4, 7), (2, 5, 9), (4, 7, 11), (5, 9, 0),
        (7, 11, 2), (9, 0, 4), (11, 2, 5),
    ],
    "minor": [
        (0, 3, 7), (2, 5, 8), (3, 7, 10), (5, 8, 0),
        (7, 10, 2), (8, 0, 3), (10, 2, 5),
    ],
}

_PROGRESSIONS: dict[str, list[list[int]]] = {
    "major": [
        [0, 3, 4, 0],
        [0, 5, 3, 4],
        [0, 3, 5, 4],
        [0, 4, 5, 3],
        [0, 5, 1, 4],
    ],
    "minor": [
        [0, 3, 4, 0],
        [0, 6, 3, 4],
        [0, 3, 6, 4],
        [0, 5, 3, 4],
    ],
}

_ROOT_MIDI: dict[str, int] = {
    "C": 60, "C#": 61, "Db": 61, "D": 62, "D#": 63, "Eb": 63,
    "E": 64, "F": 65, "F#": 66, "Gb": 66, "G": 67, "G#": 68,
    "Ab": 68, "A": 69, "A#": 70, "Bb": 70, "B": 71,
}
_MIDI_TO_NAME = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"]


def _midi_name(midi: int) -> str:
    octave = (midi // 12) - 1
    return f"{_MIDI_TO_NAME[midi % 12]}{octave}"


def _scale_pitches(key: str, mode: str, octave_low: int = 4, octave_high: int = 6) -> list[int]:
    root = _ROOT_MIDI.get(key, 60) % 12
    scale_key = mode if mode in _SCALES else "major"
    intervals = _SCALES[scale_key]
    pitches = []
    for oct in range(octave_low, octave_high + 1):
        for iv in intervals:
            midi = (oct + 1) * 12 + root + iv
            if 24 <= midi <= 108:
                pitches.append(midi)
    return sorted(set(pitches))


def _chord_notes(key: str, mode: str, degree: int, octave: int = 4) -> list[int]:
    root_pc = _ROOT_MIDI.get(key, 60) % 12
    chord_mode = "minor" if mode in ("minor", "dorian", "harmonic_minor") else "major"
    chords = _DIATONIC_CHORDS.get(chord_mode, _DIATONIC_CHORDS["major"])
    triad = chords[degree % len(chords)]
    base = (octave + 1) * 12 + root_pc
    return [(base + iv) % 128 for iv in triad]


def _pick_progression(key: str, mode: str, measures: int, rng: random.Random) -> list[int]:
    prog_mode = "minor" if mode in ("minor", "dorian", "harmonic_minor", "blues") else "major"
    bank = _PROGRESSIONS.get(prog_mode, _PROGRESSIONS["major"])
    unit = rng.choice(bank)
    result = []
    while len(result) < measures:
        result.extend(unit)
    return result[:measures]


def _get_dur_pool(style_name: str, section_type: str = "verse") -> list[float]:
    sp = get_style_params(style_name)
    pool = list(sp["dur_pool"])
    sec = SECTION_TYPE_PARAMS.get(section_type, SECTION_TYPE_PARAMS["verse"])
    if sec["density_scale"] < 0.55:
        pool = [d * 1.5 for d in pool]
    elif sec["density_scale"] > 0.95:
        pool = [max(0.25, d * 0.75) for d in pool]
    return pool

# ─────────────────────────────────────────────────────────────────────────────
# Contextual generation engine
# ─────────────────────────────────────────────────────────────────────────────

def _contextual_melody(
    key: str, mode: str, measures: int, time_sig: str, style: str,
    seed_notes: list[str], rng: random.Random,
    section_type: str = "verse", measure_offset: int = 0
) -> tuple[list[dict], list[int]]:
    beats = int(time_sig.split("/")[0])
    sec_params = SECTION_TYPE_PARAMS.get(section_type, SECTION_TYPE_PARAMS["verse"])
    oct_low  = sec_params["octave_low"]
    oct_high = sec_params["octave_high"]
    effective_mode = mode
    pitches = _scale_pitches(key, effective_mode, octave_low=oct_low, octave_high=oct_high)
    if not pitches:
        pitches = list(range(60, 73))

    prog = _pick_progression(key, effective_mode, measures, rng)
    dur_pool = _get_dur_pool(style, section_type)

    notes_out: list[dict] = []
    prev_idx = len(pitches) // 2

    phrase_len = min(4, measures)
    antecedent: list[dict] = []

    for meas in range(1, phrase_len + 1):
        chord_notes = _chord_notes(key, effective_mode, prog[meas - 1], octave=oct_low)
        beat = 1.0
        while beat <= float(beats):
            on_strong = (beat % 2 == 1)
            chord_pcs = [n % 12 for n in chord_notes]
            chord_pitches = [p for p in pitches if p % 12 in chord_pcs]
            candidate_pool = chord_pitches if (on_strong and chord_pitches) else pitches

            idx_candidates = sorted(range(len(candidate_pool)),
                                    key=lambda i: abs(candidate_pool[i] - pitches[prev_idx]))
            top_n = idx_candidates[:3] if rng.random() > 0.15 else idx_candidates
            new_idx = rng.choice(top_n)
            midi = candidate_pool[new_idx]
            prev_idx = pitches.index(min(pitches, key=lambda p: abs(p - midi)))

            dur = rng.choice(dur_pool)
            dur = min(dur, float(beats) - beat + 1.0)
            antecedent.append({
                "pitch": _midi_name(midi), "pitch_midi": midi,
                "duration": dur, "measure": meas + measure_offset, "beat": beat,
            })
            beat += dur

    notes_out.extend(antecedent)

    melodic_var = sec_params.get("melodic_variation", 0.2)
    for phrase_start in range(phrase_len, measures, phrase_len):
        for n in antecedent:
            new_meas = (n["measure"] - measure_offset) + phrase_start + measure_offset
            if new_meas > measures + measure_offset:
                break
            midi = n["pitch_midi"]
            if rng.random() < melodic_var:
                step = rng.choice([-2, -1, 1, 2])
                candidate = midi + step
                if 36 <= candidate <= 96:
                    midi = candidate
            is_final = ((n["measure"] - measure_offset) == phrase_len)
            if is_final:
                tonic = _scale_pitches(key, effective_mode, octave_low=oct_low, octave_high=oct_high)
                root_pc = _ROOT_MIDI.get(key, 60) % 12
                tonic_pitches = [p for p in tonic if p % 12 == root_pc]
                if tonic_pitches:
                    midi = min(tonic_pitches, key=lambda p: abs(p - midi))
                elif rng.random() < 0.4:
                    midi = min(midi + 2, 96)
            notes_out.append({
                "pitch": _midi_name(midi), "pitch_midi": midi,
                "duration": n["duration"], "measure": new_meas, "beat": n["beat"],
            })

    return notes_out, prog


def _contextual_counter_melody(
    melody: list[dict], key: str, mode: str, time_sig: str,
    prog: list[int], rng: random.Random,
    measure_offset: int = 0
) -> list[dict]:
    beats = int(time_sig.split("/")[0])
    pitches = _scale_pitches(key, mode, octave_low=4, octave_high=6)
    max_meas = max((n["measure"] for n in melody), default=8)
    result: list[dict] = []

    occupied: dict[tuple, dict] = {
        (n["measure"], round(n["beat"] * 4) / 4): n
        for n in melody
    }

    prev_midi = (pitches[len(pitches) // 2 + 2]
                 if len(pitches) > 2 else pitches[-1])

    for meas in range(1, max_meas + 1):
        chord_notes = _chord_notes(key, mode,
                                   prog[meas - 1] if meas <= len(prog) else 0,
                                   octave=4)
        chord_pcs = [n % 12 for n in chord_notes]
        beat = 1.0
        while beat <= float(beats):
            slot = (meas, round(beat * 4) / 4)
            if slot in occupied:
                beat += 0.5
                continue

            mel_near = [n for n in melody
                        if n["measure"] == meas and abs(n["beat"] - beat) < 1.5]

            if mel_near:
                ref = mel_near[0]["pitch_midi"]
                if ref > prev_midi:
                    candidates = [p for p in pitches if p < ref and (p - ref) % 12 in (3, 4, 8, 9)]
                else:
                    candidates = [p for p in pitches if p > ref and (p - ref) % 12 in (3, 4, 8, 9)]
                if not candidates:
                    candidates = [p for p in pitches if p % 12 in chord_pcs]
                if not candidates:
                    candidates = pitches
            else:
                candidates = [p for p in pitches if p % 12 in chord_pcs] or pitches

            midi = min(candidates, key=lambda p: (abs(p - prev_midi) * 0.7
                                                   + rng.random() * 0.3))
            prev_midi = midi

            dur = rng.choice([0.5, 1.0, 1.0, 0.5])
            dur = min(dur, float(beats) - beat + 1.0)
            result.append({
                "pitch": _midi_name(midi), "pitch_midi": midi,
                "duration": dur, "measure": meas, "beat": beat,
            })
            beat += dur

    return result


def _contextual_harmony(
    key: str, mode: str, measures: int, time_sig: str,
    prog: list[int], style: str, rng: random.Random,
    measure_offset: int = 0, section_type: str = "verse"
) -> list[dict]:
    beats = int(time_sig.split("/")[0])
    notes_out: list[dict] = []
    sp = get_style_params(style)
    bass_style = sp.get("bass_style", "root_fifth")
    sec = SECTION_TYPE_PARAMS.get(section_type, SECTION_TYPE_PARAMS["verse"])
    density = sp.get("density", 0.6) * sec["density_scale"]

    arp = (bass_style == "arpeggiated") or (density > 0.75)

    for meas in range(1, measures + 1):
        global_meas = meas + measure_offset
        degree = prog[meas - 1] if meas <= len(prog) else 0
        chord = _chord_notes(key, mode, degree, octave=3)

        if arp:
            for b_idx, beat in enumerate([float(b + 1) for b in range(beats)]):
                midi = chord[b_idx % len(chord)]
                notes_out.append({
                    "pitch": _midi_name(midi), "pitch_midi": midi,
                    "duration": 1.0, "measure": global_meas, "beat": beat,
                })
        else:
            beat = 1.0
            while beat <= float(beats):
                dur = 2.0 if beats >= 4 else float(beats)
                dur = min(dur, float(beats) - beat + 1.0)
                for midi in chord:
                    notes_out.append({
                        "pitch": _midi_name(midi), "pitch_midi": midi,
                        "duration": dur, "measure": global_meas, "beat": beat,
                    })
                beat += dur

    return notes_out


def _contextual_bass(
    key: str, mode: str, measures: int, time_sig: str,
    prog: list[int], style: str, rng: random.Random,
    measure_offset: int = 0
) -> list[dict]:
    beats = int(time_sig.split("/")[0])
    bass_pitches = _scale_pitches(key, mode, octave_low=2, octave_high=3)
    notes_out: list[dict] = []
    sp = get_style_params(style)
    bass_style_name = sp.get("bass_style", "root_fifth")
    effective_rhythm = sp.get("rhythm", "neutral")

    for meas in range(1, measures + 1):
        global_meas = meas + measure_offset
        degree = prog[meas - 1] if meas <= len(prog) else 0
        chord = _chord_notes(key, mode, degree, octave=2)
        root = chord[0]
        fifth = chord[2] if len(chord) > 2 else root

        if effective_rhythm == "driving" or effective_rhythm == "rhythmic" or bass_style_name == "root_fifth":
            for beat, midi, dur in [
                (1.0, root, 1.0), (2.0, root, 1.0),
                (3.0, fifth, 1.0), (4.0, root + 2 if beats >= 4 else root, 1.0),
            ]:
                if beat > float(beats): break
                notes_out.append({"pitch": _midi_name(midi), "pitch_midi": midi,
                    "duration": dur, "measure": global_meas, "beat": beat})
        elif effective_rhythm == "lyrical" or bass_style_name == "arpeggiated":
            next_degree = prog[meas] if meas < len(prog) else prog[0]
            next_chord = _chord_notes(key, mode, next_degree, octave=2)
            next_root = next_chord[0]
            approach = next_root - 1 if next_root > root else next_root + 1
            approach = max(24, min(72, approach))
            for beat, midi, dur in [(1.0, root, 2.0), (3.0, approach, 2.0)]:
                if beat > float(beats): break
                dur = min(dur, float(beats) - beat + 1.0)
                notes_out.append({"pitch": _midi_name(midi), "pitch_midi": midi,
                    "duration": dur, "measure": global_meas, "beat": beat})
        elif bass_style_name == "pedal":
            notes_out.append({"pitch": _midi_name(root), "pitch_midi": root,
                "duration": float(beats), "measure": global_meas, "beat": 1.0})
        else:
            next_degree = prog[meas] if meas < len(prog) else prog[0]
            next_root = _chord_notes(key, mode, next_degree, octave=2)[0]
            walk = _walk(root, next_root, beats, bass_pitches, rng)
            for b_idx, midi in enumerate(walk):
                notes_out.append({"pitch": _midi_name(midi), "pitch_midi": midi,
                    "duration": 1.0, "measure": global_meas, "beat": float(b_idx + 1)})

    return notes_out


def _walk(start: int, end: int, steps: int, pool: list[int], rng: random.Random) -> list[int]:
    if not pool:
        return [start] * steps
    result = []
    cur = min(pool, key=lambda p: abs(p - start))
    target = min(pool, key=lambda p: abs(p - end))
    for i in range(steps):
        result.append(cur)
        remaining = steps - i - 1
        if remaining == 0: break
        direction = 1 if target > cur else -1
        candidates = [p for p in pool if (p - cur) * direction > 0 and abs(p - cur) <= 2]
        if candidates:
            cur = min(candidates, key=lambda p: abs(p - cur))
        else:
            cur = target
    return result


def _contextual_drums(
    time_sig: str, measures: int, style: str, rng: random.Random,
    section_type: str = "verse"
) -> dict[str, list[int]]:
    beats = int(time_sig.split("/")[0])
    steps = beats * 4

    sp = get_style_params(style)
    effective_rhythm = sp.get("rhythm", "neutral")
    density = sp.get("density", 0.6)
    sec = SECTION_TYPE_PARAMS.get(section_type, SECTION_TYPE_PARAMS["verse"])
    density *= sec["density_scale"]

    kit_keys = ["kick", "snare", "hihat", "open_hat", "crash", "tom"]
    pattern: dict[str, list[int]] = {k: [0] * (steps * measures) for k in kit_keys}

    for meas in range(measures):
        offset = meas * steps
        is_last_of_phrase = ((meas + 1) % 4 == 0)
        is_phrase_start = (meas % 4 == 0)

        if is_phrase_start:
            pattern["crash"][offset] = 1

        for i in range(steps):
            gi = offset + i

            if effective_rhythm == "driving":
                kick_steps = (0, 4, 8, 10, 14) if density > 0.8 else (0, 8)
            elif effective_rhythm == "sparse":
                kick_steps = (0,)
            elif effective_rhythm == "rhythmic":
                kick_steps = (0, 6, 8, 14)
            else:
                kick_steps = (0, 8)
            if i in kick_steps:
                pattern["kick"][gi] = 1

            if i in (4, 12):
                pattern["snare"][gi] = 1
            if density > 0.7 and rng.random() > 0.88 and i not in (4, 12):
                pattern["snare"][gi] = 1

            if effective_rhythm in ("driving", "rhythmic"):
                if i % 2 == 0: pattern["hihat"][gi] = 1
            elif effective_rhythm == "lyrical":
                if i % 4 == 0: pattern["hihat"][gi] = 1
            elif effective_rhythm == "sparse":
                if i % 8 == 0: pattern["hihat"][gi] = 1
            else:
                if i % 2 == 0: pattern["hihat"][gi] = 1

            if meas % 2 == 1 and i in (6, 14) and density > 0.5:
                pattern["open_hat"][gi] = 1
                pattern["hihat"][gi] = 0

        if is_last_of_phrase and density > 0.4:
            fill_start = offset + steps - 4
            for fi in range(4):
                pattern["tom"][fill_start + fi] = 1
                pattern["kick"][fill_start + fi] = 0
                pattern["snare"][fill_start + fi] = 0

    result: dict[str, list[int]] = {}
    for k in kit_keys:
        result[k] = pattern[k][:steps]
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Full-song multi-section generation
# ─────────────────────────────────────────────────────────────────────────────

def _generate_full_song(
    key: str, mode: str, sections: list[dict], time_sig: str,
    style: str, seed_notes: list[str]
) -> dict:
    all_melody: list[dict] = []
    all_counter: list[dict] = []
    all_harmony: list[dict] = []
    all_bass: list[dict] = []
    all_drums: dict[str, list[int]] = {}
    section_map: list[dict] = []

    measure_cursor = 0
    phrase_cache: dict[str, tuple[list[dict], list[int]]] = {}

    for sec_idx, sec in enumerate(sections):
        sec_type = sec.get("type", "verse")
        sec_measures = sec.get("measures", 8)
        label = sec.get("label", sec_type.title())
        rng = random.Random(hash((style, key, mode, sec_type, sec_idx)) & 0xFFFF)

        cache_key = f"{sec_type}_{style}_{key}_{mode}"
        if cache_key in phrase_cache and sec_type in ("chorus", "verse"):
            base_melody, prog = phrase_cache[cache_key]
            melody = [{**n, "measure": n["measure"] - 1 + measure_cursor + 1} for n in base_melody]
        else:
            melody, prog = _contextual_melody(
                key, mode, sec_measures, time_sig, style, seed_notes, rng,
                section_type=sec_type, measure_offset=measure_cursor
            )
            phrase_cache[cache_key] = (
                [{**n, "measure": n["measure"] - measure_cursor} for n in melody], prog
            )

        counter  = _contextual_counter_melody(melody, key, mode, time_sig, prog, rng, measure_cursor)
        harmony  = _contextual_harmony(key, mode, sec_measures, time_sig, prog, style, rng, measure_cursor, sec_type)
        bass     = _contextual_bass(key, mode, sec_measures, time_sig, prog, style, rng, measure_cursor)
        drums    = _contextual_drums(time_sig, sec_measures, style, rng, sec_type)

        all_melody.extend(melody)
        all_counter.extend(counter)
        all_harmony.extend(harmony)
        all_bass.extend(bass)

        for k, steps in drums.items():
            if k not in all_drums:
                all_drums[k] = []
            all_drums[k].extend(steps)

        section_map.append({
            "label": label, "type": sec_type,
            "start_measure": measure_cursor + 1,
            "end_measure": measure_cursor + sec_measures,
            "measures": sec_measures,
        })
        measure_cursor += sec_measures

    return {
        "parts": {"melody": all_melody, "counter_melody": all_counter,
                  "harmony": all_harmony, "bass": all_bass},
        "drum_pattern": all_drums,
        "sections": section_map,
        "total_measures": measure_cursor,
    }


# ─────────────────────────────────────────────────────────────────────────────
# MusicXML export helpers
# ─────────────────────────────────────────────────────────────────────────────

def _dur_type(dur: float) -> str:
    mapping = {4.0: "whole", 3.0: "dotted-half", 2.0: "half",
               1.5: "dotted-quarter", 1.0: "quarter",
               0.75: "dotted-eighth", 0.5: "eighth", 0.25: "16th"}
    return mapping.get(dur, "quarter")


def _composition_to_musicxml(comp: dict, parts: list[dict]) -> str:
    beats_str, beat_type = comp["time_signature"].split("/")
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN"',
        '  "http://www.musicxml.org/dtds/partwise.dtd">',
        '<score-partwise version="3.1">',
        f'  <movement-title>{comp["title"]}</movement-title>',
        '  <part-list>',
    ]
    for part in parts:
        pid = part["role"].replace(" ", "_")
        lines += [f'    <score-part id="{pid}">',
                  f'      <part-name>{part["role"].title()}</part-name>',
                  f'    </score-part>']
    lines.append('  </part-list>')

    for part in parts:
        pid = part["role"].replace(" ", "_")
        notes: list[dict] = json.loads(part.get("notes_json", "[]"))
        lines.append(f'  <part id="{pid}">')
        by_measure: dict[int, list] = {}
        for n in notes:
            by_measure.setdefault(n.get("measure", 1), []).append(n)
        for meas_num in sorted(by_measure.keys()):
            lines.append(f'    <measure number="{meas_num}">')
            if meas_num == 1:
                lines += [
                    f'      <attributes><divisions>4</divisions>',
                    f'        <key><fifths>0</fifths></key>',
                    f'        <time><beats>{beats_str}</beats><beat-type>{beat_type}</beat-type></time>',
                    f'        <clef><sign>G</sign><line>2</line></clef></attributes>',
                    f'      <direction placement="above"><direction-type>',
                    f'        <metronome><beat-unit>quarter</beat-unit>',
                    f'          <per-minute>{comp["tempo"]}</per-minute></metronome>',
                    f'      </direction-type></direction>',
                ]
            for n in sorted(by_measure[meas_num], key=lambda x: x.get("beat", 1)):
                dur_divs = max(1, int(n.get("duration", 1.0) * 4))
                pitch_str = n.get("pitch", "C4")
                m = re.match(r'([A-G][#b]?)(\d)', pitch_str)
                if m:
                    step_acc = m.group(1); oct_xml = int(m.group(2)); step = step_acc[0]
                    alter = ("<alter>1</alter>" if "#" in step_acc
                             else "<alter>-1</alter>" if "b" in step_acc else "")
                    lines += [f'      <note>',
                              f'        <pitch><step>{step}</step>{alter}<octave>{oct_xml}</octave></pitch>',
                              f'        <duration>{dur_divs}</duration>',
                              f'        <type>{_dur_type(n.get("duration", 1.0))}</type>',
                              f'      </note>']
                else:
                    lines.append(f'      <note><rest/><duration>{dur_divs}</duration></note>')
            lines.append('    </measure>')
        lines.append('  </part>')

    lines.append('</score-partwise>')
    return "\n".join(lines)

# ─────────────────────────────────────────────────────────────────────────────
# Auth helper
# ─────────────────────────────────────────────────────────────────────────────

def _assert_owns(comp_id: int, user) -> None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id FROM compositions WHERE id=? AND user_id=?", (comp_id, user.id)
        ).fetchone()
    if not row:
        raise HTTPException(403, "Not authorized or composition not found")

# ─────────────────────────────────────────────────────────────────────────────
# Routes — Styles
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/styles")
def list_styles():
    """Return the full style catalog grouped by category."""
    grouped: dict[str, list[dict]] = {}
    for sid, val in STYLE_CATALOG.items():
        cat = val["category"]
        grouped.setdefault(cat, [])
        grouped[cat].append({
            "id": sid, "description": val["description"],
            "tempo_range": val["tempo_range"], "mode": val["mode"], "category": cat,
        })
    return {"styles": grouped, "total": len(STYLE_CATALOG)}

# ─────────────────────────────────────────────────────────────────────────────
# Routes — Compositions
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/compositions", status_code=201)
def create_composition(body: CompositionCreate, user=Depends(get_current_user)):
    sections_json = json.dumps(body.sections if body.sections else DEFAULT_SECTIONS)
    if DATABASE_URL:
        with get_conn() as conn:
            cur = conn.execute(
                "INSERT INTO compositions (user_id, title, key, mode, tempo, time_signature, measures, style, sections_json) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (user.id, body.title, body.key, body.mode, body.tempo, body.time_signature, body.measures, body.style, sections_json)
            )
            comp_id = cur.lastrowid
    else:
        with get_conn() as conn:
            cur = conn.execute(
                "INSERT INTO compositions (user_id, title, key, mode, tempo, time_signature, measures, style, sections_json) VALUES (?,?,?,?,?,?,?,?,?)",
                (user.id, body.title, body.key, body.mode, body.tempo, body.time_signature, body.measures, body.style, sections_json)
            )
            comp_id = cur.lastrowid
    return {"id": comp_id, "title": body.title}


@router.get("/compositions")
def list_compositions(user=Depends(get_current_user)):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, title, key, mode, tempo, time_signature, measures, style, created_at FROM compositions WHERE user_id=? ORDER BY updated_at DESC",
            (user.id,)
        ).fetchall()
    return [dict(r) for r in rows]


@router.get("/compositions/{comp_id}")
def get_composition(comp_id: int, user=Depends(get_current_user)):
    with get_conn() as conn:
        comp = conn.execute(
            "SELECT * FROM compositions WHERE id=? AND user_id=?", (comp_id, user.id)
        ).fetchone()
        if not comp:
            raise HTTPException(404, "Composition not found")
        parts   = conn.execute("SELECT * FROM composition_parts WHERE composition_id=?", (comp_id,)).fetchall()
        drum    = conn.execute("SELECT * FROM drum_patterns WHERE composition_id=?", (comp_id,)).fetchone()
        rolls   = conn.execute("SELECT * FROM piano_rolls WHERE composition_id=?", (comp_id,)).fetchall()
        samples = conn.execute("SELECT * FROM samples WHERE composition_id=?", (comp_id,)).fetchall()
    comp_keys = comp.keys()
    return {
        "id": comp["id"], "title": comp["title"], "key": comp["key"],
        "mode": comp["mode"], "tempo": comp["tempo"],
        "time_signature": comp["time_signature"], "measures": comp["measures"],
        "style": comp["style"] if "style" in comp_keys else "neutral",
        "sections": json.loads(comp["sections_json"]) if "sections_json" in comp_keys else DEFAULT_SECTIONS,
        "parts": [{"role": p["role"], "instrument": p["instrument"],
                   "notes": json.loads(p["notes_json"])} for p in parts],
        "drum_pattern": {"pattern": json.loads(drum["pattern_json"]),
                         "steps": drum["steps"], "swing": drum["swing"]} if drum else None,
        "piano_rolls": [{"part_role": r["part_role"], "cells": json.loads(r["cells_json"])} for r in rolls],
        "samples": [{"id": s["id"], "name": s["name"], "source_type": s["source_type"],
                     "source_url": s["source_url"], "layer_role": s["layer_role"],
                     "start_measure": s["start_measure"], "end_measure": s["end_measure"],
                     "volume": s["volume"], "loop": bool(s["loop"])} for s in samples],
    }


@router.put("/compositions/{comp_id}")
def update_composition(comp_id: int, body: CompositionCreate, user=Depends(get_current_user)):
    _assert_owns(comp_id, user)
    sections_json = json.dumps(body.sections if body.sections else DEFAULT_SECTIONS)
    if DATABASE_URL:
        with get_conn() as conn:
            conn.execute(
                "UPDATE compositions SET title=%s, key=%s, mode=%s, tempo=%s, time_signature=%s, measures=%s, style=%s, sections_json=%s, updated_at=CURRENT_TIMESTAMP WHERE id=%s AND user_id=%s",
                (body.title, body.key, body.mode, body.tempo, body.time_signature, body.measures, body.style, sections_json, comp_id, user.id)
            )
    else:
        with get_conn() as conn:
            conn.execute(
                "UPDATE compositions SET title=?, key=?, mode=?, tempo=?, time_signature=?, measures=?, style=?, sections_json=?, updated_at=datetime('now') WHERE id=? AND user_id=?",
                (body.title, body.key, body.mode, body.tempo, body.time_signature, body.measures, body.style, sections_json, comp_id, user.id)
            )
    return {"ok": True}


@router.delete("/compositions/{comp_id}", status_code=204)
def delete_composition(comp_id: int, user=Depends(get_current_user)):
    with get_conn() as conn:
        conn.execute("DELETE FROM compositions WHERE id=? AND user_id=?", (comp_id, user.id))

# ─────────────────────────────────────────────────────────────────────────────
# Routes — Parts
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/compositions/{comp_id}/parts")
def upsert_part(comp_id: int, body: PartData, user=Depends(get_current_user)):
    _assert_owns(comp_id, user)
    notes_json = json.dumps(body.notes)
    if DATABASE_URL:
        with get_conn() as conn:
            conn.execute(
                """INSERT INTO composition_parts (composition_id, role, instrument, notes_json)
                   VALUES (%s,%s,%s,%s)
                   ON CONFLICT(composition_id, role) DO UPDATE SET
                   instrument=EXCLUDED.instrument, notes_json=EXCLUDED.notes_json,
                   updated_at=CURRENT_TIMESTAMP""",
                (comp_id, body.role, body.instrument, notes_json)
            )
    else:
        with get_conn() as conn:
            conn.execute(
                """INSERT INTO composition_parts (composition_id, role, instrument, notes_json)
                   VALUES (?,?,?,?)
                   ON CONFLICT(composition_id, role) DO UPDATE SET
                   instrument=excluded.instrument, notes_json=excluded.notes_json,
                   updated_at=datetime('now')""",
                (comp_id, body.role, body.instrument, notes_json)
            )
    return {"ok": True, "role": body.role}


@router.delete("/compositions/{comp_id}/parts/{role}", status_code=204)
def delete_part(comp_id: int, role: str, user=Depends(get_current_user)):
    _assert_owns(comp_id, user)
    with get_conn() as conn:
        conn.execute("DELETE FROM composition_parts WHERE composition_id=? AND role=?", (comp_id, role))

# ─────────────────────────────────────────────────────────────────────────────
# Routes — Drum pattern & Piano roll
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/compositions/{comp_id}/drum_pattern")
def save_drum_pattern(comp_id: int, body: DrumPatternData, user=Depends(get_current_user)):
    _assert_owns(comp_id, user)
    pj = json.dumps(body.pattern)
    if DATABASE_URL:
        with get_conn() as conn:
            conn.execute(
                """INSERT INTO drum_patterns (composition_id, pattern_json, steps, swing) VALUES (%s,%s,%s,%s)
                   ON CONFLICT(composition_id) DO UPDATE SET pattern_json=EXCLUDED.pattern_json,
                   steps=EXCLUDED.steps, swing=EXCLUDED.swing, updated_at=CURRENT_TIMESTAMP""",
                (comp_id, pj, body.steps, body.swing)
            )
    else:
        with get_conn() as conn:
            conn.execute(
                """INSERT INTO drum_patterns (composition_id, pattern_json, steps, swing) VALUES (?,?,?,?)
                   ON CONFLICT(composition_id) DO UPDATE SET pattern_json=excluded.pattern_json,
                   steps=excluded.steps, swing=excluded.swing, updated_at=datetime('now')""",
                (comp_id, pj, body.steps, body.swing)
            )
    return {"ok": True}


@router.post("/compositions/{comp_id}/piano_roll")
def save_piano_roll(comp_id: int, body: PianoRollData, user=Depends(get_current_user)):
    _assert_owns(comp_id, user)
    cj = json.dumps(body.cells)
    if DATABASE_URL:
        with get_conn() as conn:
            conn.execute(
                """INSERT INTO piano_rolls (composition_id, part_role, cells_json) VALUES (%s,%s,%s)
                   ON CONFLICT(composition_id, part_role) DO UPDATE SET
                   cells_json=EXCLUDED.cells_json, updated_at=CURRENT_TIMESTAMP""",
                (comp_id, body.part_role, cj)
            )
    else:
        with get_conn() as conn:
            conn.execute(
                """INSERT INTO piano_rolls (composition_id, part_role, cells_json) VALUES (?,?,?)
                   ON CONFLICT(composition_id, part_role) DO UPDATE SET
                   cells_json=excluded.cells_json, updated_at=datetime('now')""",
                (comp_id, body.part_role, cj)
            )
    return {"ok": True}

# ─────────────────────────────────────────────────────────────────────────────
# Routes — Samples
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/compositions/{comp_id}/samples", status_code=201)
def add_sample(comp_id: int, body: SampleData, user=Depends(get_current_user)):
    _assert_owns(comp_id, user)
    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO samples (composition_id, user_id, name, source_type, source_url,
               layer_role, start_measure, end_measure, volume, loop)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (comp_id, user.id, body.name, body.source_type, body.source_url,
             body.layer_role, body.start_measure, body.end_measure,
             body.volume, 1 if body.loop else 0)
        )
        sample_id = cur.lastrowid
    return {"id": sample_id, "name": body.name}


@router.post("/compositions/{comp_id}/samples/upload", status_code=201)
async def upload_sample(
    comp_id: int,
    file: UploadFile = File(...),
    layer_role: str = Form("sample"),
    start_measure: int = Form(1),
    volume: float = Form(1.0),
    loop: bool = Form(False),
    user=Depends(get_current_user)
):
    _assert_owns(comp_id, user)
    uploads_dir = "uploads"
    os.makedirs(uploads_dir, exist_ok=True)
    ext = os.path.splitext(file.filename or "sample.wav")[1] or ".wav"
    filename = f"{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(uploads_dir, filename)
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)
    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO samples (composition_id, user_id, name, source_type, file_path,
               layer_role, start_measure, volume, loop)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (comp_id, user.id, file.filename or filename, "upload", file_path,
             layer_role, start_measure, volume, 1 if loop else 0)
        )
        sample_id = cur.lastrowid
    return {"id": sample_id, "name": file.filename, "file_path": file_path}


@router.get("/compositions/{comp_id}/samples")
def list_samples(comp_id: int, user=Depends(get_current_user)):
    _assert_owns(comp_id, user)
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM samples WHERE composition_id=? ORDER BY start_measure", (comp_id,)
        ).fetchall()
    return [{"id": r["id"], "name": r["name"], "source_type": r["source_type"],
             "source_url": r["source_url"], "layer_role": r["layer_role"],
             "start_measure": r["start_measure"], "end_measure": r["end_measure"],
             "volume": r["volume"], "loop": bool(r["loop"])} for r in rows]


@router.delete("/compositions/{comp_id}/samples/{sample_id}", status_code=204)
def delete_sample(comp_id: int, sample_id: int, user=Depends(get_current_user)):
    _assert_owns(comp_id, user)
    with get_conn() as conn:
        conn.execute("DELETE FROM samples WHERE id=? AND composition_id=?", (sample_id, comp_id))

# ─────────────────────────────────────────────────────────────────────────────
# Routes — Generation
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/generate/melody")
def gen_melody(body: GenerateRequest, user=Depends(get_current_user)):
    rng = random.Random(42)
    notes, prog = _contextual_melody(
        body.key, body.mode, body.measures, body.time_signature, body.style,
        body.seed_notes, rng, section_type=body.section_type, measure_offset=body.measure_offset
    )
    return {"role": "melody", "notes": notes, "progression": prog, "engine": "contextual_local"}


@router.post("/generate/counter_melody")
def gen_counter(body: GenerateRequest, user=Depends(get_current_user)):
    rng = random.Random(99)
    if body.existing_melody:
        prog = _pick_progression(body.key, body.mode, body.measures, random.Random(7))
    else:
        _, prog = _contextual_melody(body.key, body.mode, body.measures,
                                      body.time_signature, body.style, [], rng)
    notes = _contextual_counter_melody(body.existing_melody, body.key, body.mode,
                                        body.time_signature, prog, rng,
                                        measure_offset=body.measure_offset)
    return {"role": "counter_melody", "notes": notes, "engine": "contextual_local"}


@router.post("/generate/harmony")
def gen_harmony(body: GenerateRequest, user=Depends(get_current_user)):
    rng = random.Random(13)
    if body.existing_melody:
        prog = _pick_progression(body.key, body.mode, body.measures, rng)
    else:
        _, prog = _contextual_melody(body.key, body.mode, body.measures,
                                      body.time_signature, body.style, [], rng)
    notes = _contextual_harmony(body.key, body.mode, body.measures, body.time_signature,
                                 prog, body.style, rng,
                                 measure_offset=body.measure_offset,
                                 section_type=body.section_type)
    return {"role": "harmony", "notes": notes, "progression": prog, "engine": "contextual_local"}


@router.post("/generate/bass")
def gen_bass(body: GenerateRequest, user=Depends(get_current_user)):
    rng = random.Random(5)
    if body.existing_melody or body.existing_harmony:
        prog = _pick_progression(body.key, body.mode, body.measures, rng)
    else:
        _, prog = _contextual_melody(body.key, body.mode, body.measures,
                                      body.time_signature, body.style, [], rng)
    notes = _contextual_bass(body.key, body.mode, body.measures, body.time_signature,
                              prog, body.style, rng, measure_offset=body.measure_offset)
    return {"role": "bass", "notes": notes, "engine": "contextual_local"}


@router.post("/generate/drums")
def gen_drums(body: GenerateRequest, user=Depends(get_current_user)):
    rng = random.Random(77)
    pattern = _contextual_drums(body.time_signature, body.measures, body.style, rng,
                                 section_type=body.section_type)
    return {"role": "drums", "pattern": pattern,
            "steps": len(list(pattern.values())[0]), "engine": "contextual_local"}


@router.post("/generate/song")
def gen_song(body: GenerateRequest, user=Depends(get_current_user)):
    """Generate a complete multi-section song using DEFAULT_SECTIONS template."""
    result = _generate_full_song(
        body.key, body.mode, DEFAULT_SECTIONS, body.time_signature,
        body.style, body.seed_notes
    )
    result["engine"] = "contextual_local_song"
    return result


@router.post("/generate/all")
def gen_all(body: GenerateRequest, user=Depends(get_current_user)):
    """Generate all parts in one call (single-section, legacy compat)."""
    rng = random.Random(42)
    melody, prog = _contextual_melody(
        body.key, body.mode, body.measures, body.time_signature, body.style,
        body.seed_notes, rng, section_type=body.section_type, measure_offset=body.measure_offset
    )
    counter = _contextual_counter_melody(melody, body.key, body.mode, body.time_signature,
                                          prog, random.Random(99))
    harmony = _contextual_harmony(body.key, body.mode, body.measures, body.time_signature,
                                   prog, body.style, random.Random(13))
    bass    = _contextual_bass(body.key, body.mode, body.measures, body.time_signature,
                                prog, body.style, random.Random(5))
    drums   = _contextual_drums(body.time_signature, body.measures, body.style,
                                 random.Random(77), section_type=body.section_type)
    return {
        "progression": prog,
        "parts": {"melody": melody, "counter_melody": counter,
                  "harmony": harmony, "bass": bass},
        "drum_pattern": drums,
        "engine": "contextual_local",
    }

# ─────────────────────────────────────────────────────────────────────────────
# Route — Export MusicXML
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/compositions/{comp_id}/export_xml")
def export_xml(comp_id: int, user=Depends(get_current_user)):
    with get_conn() as conn:
        comp = conn.execute(
            "SELECT * FROM compositions WHERE id=? AND user_id=?", (comp_id, user.id)
        ).fetchone()
        if not comp:
            raise HTTPException(404, "Not found")
        parts = conn.execute(
            "SELECT * FROM composition_parts WHERE composition_id=?", (comp_id,)
        ).fetchall()
    xml = _composition_to_musicxml(dict(comp), [dict(p) for p in parts])
    filename = comp["title"].replace(" ", "_") + ".xml"
    return Response(
        content=xml, media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

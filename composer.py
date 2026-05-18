"""composer.py

Local music composition endpoints for ScoreSync.
All generation uses pure-Python algorithms — no paid API required.
PostgreSQL (Render) + SQLite (local) dual-mode via database.IS_PG.

Upgrades (v2):
  • ~100 rich named styles with per-style generation parameters
  • Multi-section song structure: intro / verse / chorus / bridge / outro
  • Longer compositions: up to 128 measures with section-aware generation
  • Sample layering: user-uploaded audio + public sample URL references stored in DB
  • Style taxonomy with categories (genre, era, mood, world, etc.)
"""
from __future__ import annotations

import json
import os
import random
import re
import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from pydantic import BaseModel

from deps import get_current_user
from database import get_conn, IS_PG

router = APIRouter(prefix="/composer", tags=["composer"])


# ───────────────────────────────────────────────────────────────────────────────
# Helpers
# ───────────────────────────────────────────────────────────────────────────────

def _ph() -> str:
    return "%s" if IS_PG else "?"


def _now() -> str:
    return "CURRENT_TIMESTAMP" if IS_PG else "datetime('now')"


# ───────────────────────────────────────────────────────────────────────────────
# DB initialisation
# ───────────────────────────────────────────────────────────────────────────────

_PG_SCHEMA = """
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
"""

_SQLITE_SCHEMA = """
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
"""


def init_composer_tables() -> None:
    if IS_PG:
        with get_conn() as conn:
            for stmt in _PG_SCHEMA.split(";"):
                s = stmt.strip()
                if s:
                    conn.execute(s)
    else:
        with get_conn() as conn:
            conn.executescript(_SQLITE_SCHEMA)
    print(f"Composer tables initialized ({'PostgreSQL' if IS_PG else 'SQLite'})")


# ───────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ───────────────────────────────────────────────────────────────────────────────

class CompositionCreate(BaseModel):
    title: str = "Untitled"
    key: str = "C"
    mode: str = "major"
    tempo: int = 120
    time_signature: str = "4/4"
    measures: int = 8
    style: str = "neutral"
    sections: list[dict] = []

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
    source_type: str = "url"
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
    section_type: str = "verse"
    measure_offset: int = 0


# ───────────────────────────────────────────────────────────────────────────────
# Style taxonomy
# ───────────────────────────────────────────────────────────────────────────────

STYLE_CATALOG: dict[str, dict] = {
  "baroque_counterpoint":  {"category":"Classical","tempo_range":(70,100),"mode":"minor","rhythm":"rhythmic","dur_pool":[0.5,0.5,1.0],"bass_style":"walking","density":0.9,"description":"Baroque Counterpoint"},
  "classical_sonata":      {"category":"Classical","tempo_range":(100,140),"mode":"major","rhythm":"neutral","dur_pool":[0.5,1.0,1.0,2.0],"bass_style":"root_fifth","density":0.7,"description":"Classical Sonata"},
  "romantic_nocturne":     {"category":"Classical","tempo_range":(50,72),"mode":"minor","rhythm":"lyrical","dur_pool":[1.0,2.0,2.0,4.0],"bass_style":"arpeggiated","density":0.5,"description":"Romantic Nocturne"},
  "romantic_symphony":     {"category":"Classical","tempo_range":(80,130),"mode":"major","rhythm":"driving","dur_pool":[0.5,1.0,1.0],"bass_style":"root_fifth","density":1.0,"description":"Romantic Symphony"},
  "impressionist":         {"category":"Classical","tempo_range":(60,90),"mode":"dorian","rhythm":"lyrical","dur_pool":[1.0,1.5,2.0],"bass_style":"pedal","density":0.4,"description":"Impressionist (Debussy)"},
  "minimalist":            {"category":"Classical","tempo_range":(80,120),"mode":"major","rhythm":"rhythmic","dur_pool":[0.5,0.5,0.5,1.0],"bass_style":"pedal","density":0.3,"description":"Minimalist (Reich/Glass)"},
  "neoclassical":          {"category":"Classical","tempo_range":(90,120),"mode":"major","rhythm":"neutral","dur_pool":[0.5,1.0,2.0],"bass_style":"walking","density":0.6,"description":"Neoclassical"},
  "contemporary_classical":{"category":"Classical","tempo_range":(60,100),"mode":"harmonic_minor","rhythm":"sparse","dur_pool":[1.0,2.0,4.0],"bass_style":"pedal","density":0.35,"description":"Contemporary Classical"},
  "renaissance_polyphony": {"category":"Classical","tempo_range":(60,90),"mode":"dorian","rhythm":"neutral","dur_pool":[0.5,1.0,2.0],"bass_style":"walking","density":0.65,"description":"Renaissance Polyphony"},
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
  "delta_blues":           {"category":"Blues","tempo_range":(60,90),"mode":"blues","rhythm":"sparse","dur_pool":[1.0,1.0,2.0],"bass_style":"pedal","density":0.4,"description":"Delta Blues"},
  "chicago_blues":         {"category":"Blues","tempo_range":(90,130),"mode":"blues","rhythm":"rhythmic","dur_pool":[0.5,1.0,1.0],"bass_style":"root_fifth","density":0.65,"description":"Chicago Blues"},
  "electric_blues":        {"category":"Blues","tempo_range":(100,140),"mode":"blues","rhythm":"driving","dur_pool":[0.5,0.5,1.0],"bass_style":"walking","density":0.7,"description":"Electric Blues"},
  "boogie_woogie":         {"category":"Blues","tempo_range":(140,180),"mode":"blues","rhythm":"driving","dur_pool":[0.25,0.5,0.5],"bass_style":"arpeggiated","density":0.9,"description":"Boogie-Woogie"},
  "classic_rock":          {"category":"Rock","tempo_range":(110,145),"mode":"mixolydian","rhythm":"driving","dur_pool":[0.5,1.0,1.0],"bass_style":"root_fifth","density":0.75,"description":"Classic Rock"},
  "hard_rock":             {"category":"Rock","tempo_range":(130,160),"mode":"minor","rhythm":"driving","dur_pool":[0.25,0.5,1.0],"bass_style":"pedal","density":0.9,"description":"Hard Rock"},
  "punk_rock":             {"category":"Rock","tempo_range":(160,220),"mode":"major","rhythm":"driving","dur_pool":[0.25,0.5,0.5],"bass_style":"root_fifth","density":0.95,"description":"Punk Rock"},
  "indie_rock":            {"category":"Rock","tempo_range":(100,140),"mode":"major","rhythm":"neutral","dur_pool":[0.5,1.0,1.5],"bass_style":"root_fifth","density":0.6,"description":"Indie Rock"},
  "post_rock":             {"category":"Rock","tempo_range":(70,110),"mode":"major","rhythm":"lyrical","dur_pool":[1.0,2.0,2.0,4.0],"bass_style":"pedal","density":0.45,"description":"Post-Rock"},
  "grunge":                {"category":"Rock","tempo_range":(100,140),"mode":"minor","rhythm":"driving","dur_pool":[0.5,1.0,1.0],"bass_style":"pedal","density":0.8,"description":"Grunge"},
  "shoegaze":              {"category":"Rock","tempo_range":(90,130),"mode":"major","rhythm":"lyrical","dur_pool":[1.0,2.0,4.0],"bass_style":"pedal","density":0.35,"description":"Shoegaze"},
  "alternative_rock":      {"category":"Rock","tempo_range":(100,145),"mode":"minor","rhythm":"neutral","dur_pool":[0.5,1.0,1.5],"bass_style":"root_fifth","density":0.7,"description":"Alternative Rock"},
  "progressive_rock":      {"category":"Rock","tempo_range":(90,160),"mode":"dorian","rhythm":"driving","dur_pool":[0.25,0.5,1.0,2.0],"bass_style":"walking","density":0.85,"description":"Progressive Rock"},
  "pop_anthem":            {"category":"Pop","tempo_range":(120,140),"mode":"major","rhythm":"driving","dur_pool":[0.5,1.0,1.0],"bass_style":"root_fifth","density":0.8,"description":"Pop Anthem"},
  "synth_pop":             {"category":"Pop","tempo_range":(110,135),"mode":"minor","rhythm":"rhythmic","dur_pool":[0.5,0.5,1.0],"bass_style":"arpeggiated","density":0.7,"description":"Synth-Pop"},
  "bedroom_pop":           {"category":"Pop","tempo_range":(80,110),"mode":"major","rhythm":"lyrical","dur_pool":[0.5,1.0,2.0],"bass_style":"root_fifth","density":0.45,"description":"Bedroom Pop"},
  "power_pop":             {"category":"Pop","tempo_range":(130,160),"mode":"major","rhythm":"driving","dur_pool":[0.5,0.5,1.0],"bass_style":"root_fifth","density":0.85,"description":"Power Pop"},
  "art_pop":               {"category":"Pop","tempo_range":(90,130),"mode":"dorian","rhythm":"neutral","dur_pool":[0.5,1.0,1.5,2.0],"bass_style":"arpeggiated","density":0.6,"description":"Art Pop"},
  "dream_pop":             {"category":"Pop","tempo_range":(80,120),"mode":"major","rhythm":"lyrical","dur_pool":[1.0,2.0,4.0],"bass_style":"pedal","density":0.4,"description":"Dream Pop"},
  "k_pop":                 {"category":"Pop","tempo_range":(120,150),"mode":"major","rhythm":"driving","dur_pool":[0.25,0.5,1.0],"bass_style":"arpeggiated","density":0.9,"description":"K-Pop"},
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
  "boom_bap":              {"category":"Hip-Hop","tempo_range":(85,100),"mode":"minor","rhythm":"rhythmic","dur_pool":[0.5,1.0,1.0],"bass_style":"root_fifth","density":0.65,"description":"Boom Bap"},
  "trap":                  {"category":"Hip-Hop","tempo_range":(130,145),"mode":"minor","rhythm":"driving","dur_pool":[0.5,1.0,2.0],"bass_style":"pedal","density":0.6,"description":"Trap"},
  "old_school_hiphop":     {"category":"Hip-Hop","tempo_range":(90,110),"mode":"minor","rhythm":"rhythmic","dur_pool":[0.5,0.5,1.0],"bass_style":"walking","density":0.7,"description":"Old School Hip-Hop"},
  "neo_soul":              {"category":"R&B","tempo_range":(70,100),"mode":"dorian","rhythm":"lyrical","dur_pool":[0.5,1.0,1.5,2.0],"bass_style":"walking","density":0.55,"description":"Neo-Soul"},
  "classic_rnb":           {"category":"R&B","tempo_range":(80,110),"mode":"minor","rhythm":"lyrical","dur_pool":[0.5,1.0,2.0],"bass_style":"root_fifth","density":0.6,"description":"Classic R&B"},
  "funk":                  {"category":"R&B","tempo_range":(95,120),"mode":"dorian","rhythm":"driving","dur_pool":[0.25,0.5,0.5,1.0],"bass_style":"arpeggiated","density":0.85,"description":"Funk"},
  "rnb_trap":              {"category":"R&B","tempo_range":(70,90),"mode":"minor","rhythm":"lyrical","dur_pool":[0.5,1.0,2.0],"bass_style":"pedal","density":0.5,"description":"Contemporary R&B / Trap Soul"},
  "soul":                  {"category":"Soul","tempo_range":(70,110),"mode":"minor","rhythm":"lyrical","dur_pool":[0.5,1.0,2.0],"bass_style":"root_fifth","density":0.55,"description":"Soul"},
  "gospel":                {"category":"Soul","tempo_range":(80,120),"mode":"major","rhythm":"driving","dur_pool":[0.5,1.0,1.0],"bass_style":"root_fifth","density":0.8,"description":"Gospel"},
  "motown":                {"category":"Soul","tempo_range":(100,130),"mode":"major","rhythm":"rhythmic","dur_pool":[0.5,0.5,1.0],"bass_style":"walking","density":0.75,"description":"Motown"},
  "country":               {"category":"Country","tempo_range":(90,130),"mode":"major","rhythm":"neutral","dur_pool":[0.5,1.0,1.0,2.0],"bass_style":"root_fifth","density":0.6,"description":"Country"},
  "bluegrass":             {"category":"Country","tempo_range":(130,180),"mode":"major","rhythm":"driving","dur_pool":[0.25,0.5,0.5],"bass_style":"walking","density":0.85,"description":"Bluegrass"},
  "americana":             {"category":"Country","tempo_range":(80,110),"mode":"major","rhythm":"lyrical","dur_pool":[0.5,1.0,2.0],"bass_style":"root_fifth","density":0.5,"description":"Americana / Folk-Country"},
  "outlaw_country":        {"category":"Country","tempo_range":(100,130),"mode":"mixolydian","rhythm":"neutral","dur_pool":[0.5,1.0,1.5],"bass_style":"root_fifth","density":0.65,"description":"Outlaw Country"},
  "celtic_folk":           {"category":"Folk","tempo_range":(90,150),"mode":"dorian","rhythm":"driving","dur_pool":[0.25,0.5,1.0],"bass_style":"root_fifth","density":0.7,"description":"Celtic Folk"},
  "appalachian_folk":      {"category":"Folk","tempo_range":(80,120),"mode":"major","rhythm":"neutral","dur_pool":[0.5,1.0,1.0],"bass_style":"root_fifth","density":0.55,"description":"Appalachian Folk"},
  "singer_songwriter":     {"category":"Folk","tempo_range":(70,110),"mode":"major","rhythm":"lyrical","dur_pool":[0.5,1.0,2.0],"bass_style":"root_fifth","density":0.4,"description":"Singer-Songwriter"},
  "folk_baroque":          {"category":"Folk","tempo_range":(80,110),"mode":"dorian","rhythm":"lyrical","dur_pool":[0.5,1.0,1.5,2.0],"bass_style":"walking","density":0.5,"description":"Folk Baroque (Bert Jansch)"},
  "roots_reggae":          {"category":"Reggae","tempo_range":(70,90),"mode":"dorian","rhythm":"rhythmic","dur_pool":[0.5,1.0,1.0],"bass_style":"root_fifth","density":0.65,"description":"Roots Reggae"},
  "dancehall":             {"category":"Reggae","tempo_range":(90,115),"mode":"minor","rhythm":"driving","dur_pool":[0.25,0.5,0.5,1.0],"bass_style":"root_fifth","density":0.75,"description":"Dancehall"},
  "ska":                   {"category":"Reggae","tempo_range":(120,160),"mode":"major","rhythm":"rhythmic","dur_pool":[0.25,0.5,0.5],"bass_style":"walking","density":0.8,"description":"Ska"},
  "salsa":                 {"category":"Latin","tempo_range":(150,200),"mode":"major","rhythm":"driving","dur_pool":[0.25,0.5,0.5],"bass_style":"arpeggiated","density":0.9,"description":"Salsa"},
  "tango":                 {"category":"Latin","tempo_range":(110,140),"mode":"harmonic_minor","rhythm":"driving","dur_pool":[0.25,0.5,1.0],"bass_style":"arpeggiated","density":0.85,"description":"Tango"},
  "samba":                 {"category":"Latin","tempo_range":(90,130),"mode":"major","rhythm":"driving","dur_pool":[0.25,0.5,0.5],"bass_style":"arpeggiated","density":0.9,"description":"Samba"},
  "flamenco":              {"category":"Latin","tempo_range":(120,180),"mode":"harmonic_minor","rhythm":"driving","dur_pool":[0.25,0.5,0.5],"bass_style":"arpeggiated","density":0.9,"description":"Flamenco"},
  "cumbia":                {"category":"Latin","tempo_range":(90,115),"mode":"major","rhythm":"rhythmic","dur_pool":[0.5,0.5,1.0],"bass_style":"root_fifth","density":0.75,"description":"Cumbia"},
  "afrobeat":              {"category":"World","tempo_range":(96,120),"mode":"dorian","rhythm":"driving","dur_pool":[0.25,0.5,0.5,1.0],"bass_style":"arpeggiated","density":0.85,"description":"Afrobeat (Fela)"},
  "highlife":              {"category":"World","tempo_range":(100,130),"mode":"major","rhythm":"rhythmic","dur_pool":[0.5,0.5,1.0],"bass_style":"arpeggiated","density":0.75,"description":"Highlife"},
  "indian_classical":      {"category":"World","tempo_range":(60,120),"mode":"pentatonic","rhythm":"lyrical","dur_pool":[0.25,0.5,1.0,2.0],"bass_style":"pedal","density":0.5,"description":"Indian Classical (Raga feel)"},
  "middle_eastern":        {"category":"World","tempo_range":(80,130),"mode":"harmonic_minor","rhythm":"rhythmic","dur_pool":[0.25,0.5,1.0],"bass_style":"pedal","density":0.65,"description":"Middle Eastern / Maqam"},
  "balkan":                {"category":"World","tempo_range":(120,180),"mode":"harmonic_minor","rhythm":"driving","dur_pool":[0.25,0.25,0.5],"bass_style":"root_fifth","density":0.9,"description":"Balkan Brass"},
  "heavy_metal":           {"category":"Metal","tempo_range":(120,160),"mode":"minor","rhythm":"driving","dur_pool":[0.25,0.5,0.5],"bass_style":"root_fifth","density":0.9,"description":"Heavy Metal"},
  "thrash_metal":          {"category":"Metal","tempo_range":(160,220),"mode":"minor","rhythm":"driving","dur_pool":[0.25,0.25,0.5],"bass_style":"pedal","density":0.95,"description":"Thrash Metal"},
  "doom_metal":            {"category":"Metal","tempo_range":(50,80),"mode":"minor","rhythm":"sparse","dur_pool":[2.0,4.0,4.0],"bass_style":"pedal","density":0.5,"description":"Doom Metal"},
  "progressive_metal":     {"category":"Metal","tempo_range":(100,180),"mode":"dorian","rhythm":"driving","dur_pool":[0.25,0.5,1.0,2.0],"bass_style":"walking","density":0.85,"description":"Progressive Metal"},
  "black_metal":           {"category":"Metal","tempo_range":(150,240),"mode":"harmonic_minor","rhythm":"driving","dur_pool":[0.25,0.25,0.25],"bass_style":"pedal","density":0.98,"description":"Black Metal"},
  "epic_orchestral":       {"category":"Cinematic","tempo_range":(80,120),"mode":"minor","rhythm":"driving","dur_pool":[0.5,1.0,2.0],"bass_style":"root_fifth","density":0.95,"description":"Epic Orchestral"},
  "cinematic_tension":     {"category":"Cinematic","tempo_range":(60,100),"mode":"harmonic_minor","rhythm":"sparse","dur_pool":[1.0,2.0,4.0],"bass_style":"pedal","density":0.3,"description":"Cinematic Tension"},
  "adventure_theme":       {"category":"Cinematic","tempo_range":(120,160),"mode":"major","rhythm":"driving","dur_pool":[0.5,0.5,1.0],"bass_style":"root_fifth","density":0.85,"description":"Adventure / Hero Theme"},
  "emotional_underscore":  {"category":"Cinematic","tempo_range":(60,90),"mode":"major","rhythm":"lyrical","dur_pool":[1.0,2.0,4.0],"bass_style":"arpeggiated","density":0.35,"description":"Emotional Underscore"},
  "horror_score":          {"category":"Cinematic","tempo_range":(50,80),"mode":"harmonic_minor","rhythm":"sparse","dur_pool":[2.0,4.0,8.0],"bass_style":"pedal","density":0.2,"description":"Horror Score"},
  "sci_fi_ambient":        {"category":"Cinematic","tempo_range":(70,100),"mode":"dorian","rhythm":"sparse","dur_pool":[2.0,4.0,8.0],"bass_style":"pedal","density":0.25,"description":"Sci-Fi Ambient"},
  "8bit_chiptune":         {"category":"Game","tempo_range":(140,200),"mode":"major","rhythm":"driving","dur_pool":[0.25,0.5,0.5,1.0],"bass_style":"arpeggiated","density":0.8,"description":"8-bit Chiptune"},
  "16bit_rpg":             {"category":"Game","tempo_range":(100,140),"mode":"major","rhythm":"neutral","dur_pool":[0.5,1.0,1.0,2.0],"bass_style":"arpeggiated","density":0.65,"description":"16-bit RPG"},
  "dungeon_crawl":         {"category":"Game","tempo_range":(70,100),"mode":"harmonic_minor","rhythm":"sparse","dur_pool":[1.0,2.0,2.0,4.0],"bass_style":"pedal","density":0.4,"description":"Dungeon Crawl"},
  "boss_battle":           {"category":"Game","tempo_range":(150,200),"mode":"minor","rhythm":"driving","dur_pool":[0.25,0.5,0.5],"bass_style":"root_fifth","density":0.95,"description":"Boss Battle"},
  "open_world":            {"category":"Game","tempo_range":(80,110),"mode":"major","rhythm":"lyrical","dur_pool":[1.0,2.0,2.0,4.0],"bass_style":"arpeggiated","density":0.5,"description":"Open World / Exploration"},
  "neutral":               {"category":"Utility","tempo_range":(100,130),"mode":"major","rhythm":"neutral","dur_pool":[0.5,1.0,1.0,2.0],"bass_style":"root_fifth","density":0.6,"description":"Neutral (balanced)"},
  "lyrical":               {"category":"Utility","tempo_range":(70,100),"mode":"major","rhythm":"lyrical","dur_pool":[1.0,2.0,2.0,4.0],"bass_style":"arpeggiated","density":0.4,"description":"Lyrical (sustained)"},
  "rhythmic":              {"category":"Utility","tempo_range":(120,150),"mode":"major","rhythm":"rhythmic","dur_pool":[0.25,0.5,0.5,1.0],"bass_style":"root_fifth","density":0.85,"description":"Rhythmic (pulse-driven)"},
}


def get_style_params(style: str) -> dict:
    return STYLE_CATALOG.get(style, STYLE_CATALOG["neutral"])


# ───────────────────────────────────────────────────────────────────────────────
# Song sections
# ───────────────────────────────────────────────────────────────────────────────

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

# ───────────────────────────────────────────────────────────────────────────────
# Music theory tables
# ───────────────────────────────────────────────────────────────────────────────

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
    "major": [(0,4,7),(2,5,9),(4,7,11),(5,9,0),(7,11,2),(9,0,4),(11,2,5)],
    "minor": [(0,3,7),(2,5,8),(3,7,10),(5,8,0),(7,10,2),(8,0,3),(10,2,5)],
}

_PROGRESSIONS: dict[str, list[list[int]]] = {
    "major": [[0,3,4,0],[0,5,3,4],[0,3,5,4],[0,4,5,3],[0,5,1,4]],
    "minor": [[0,3,4,0],[0,6,3,4],[0,3,6,4],[0,5,3,4]],
}

_ROOT_MIDI: dict[str, int] = {
    "C":60,"C#":61,"Db":61,"D":62,"D#":63,"Eb":63,
    "E":64,"F":65,"F#":66,"Gb":66,"G":67,"G#":68,
    "Ab":68,"A":69,"A#":70,"Bb":70,"B":71,
}
_MIDI_TO_NAME = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"]


def _midi_name(midi: int) -> str:
    octave = (midi // 12) - 1
    return f"{_MIDI_TO_NAME[midi % 12]}{octave}"


def _scale_pitches(key: str, mode: str, octave_low: int = 4, octave_high: int = 6) -> list[int]:
    root = _ROOT_MIDI.get(key, 60) % 12
    intervals = _SCALES.get(mode, _SCALES["major"])
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
    unit = rng.choice(_PROGRESSIONS.get(prog_mode, _PROGRESSIONS["major"]))
    result: list[int] = []
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


# ───────────────────────────────────────────────────────────────────────────────
# Generation engine
# ───────────────────────────────────────────────────────────────────────────────

def _contextual_melody(
    key, mode, measures, time_sig, style, seed_notes, rng,
    section_type="verse", measure_offset=0
):
    beats = int(time_sig.split("/")[0])
    sec = SECTION_TYPE_PARAMS.get(section_type, SECTION_TYPE_PARAMS["verse"])
    pitches = _scale_pitches(key, mode, sec["octave_low"], sec["octave_high"]) or list(range(60,73))
    prog = _pick_progression(key, mode, measures, rng)
    dur_pool = _get_dur_pool(style, section_type)
    notes_out: list[dict] = []
    prev_idx = len(pitches) // 2
    phrase_len = min(4, measures)
    antecedent: list[dict] = []

    for meas in range(1, phrase_len + 1):
        chord_notes = _chord_notes(key, mode, prog[meas - 1], octave=sec["octave_low"])
        beat = 1.0
        while beat <= float(beats):
            chord_pcs = [n % 12 for n in chord_notes]
            chord_pitches = [p for p in pitches if p % 12 in chord_pcs]
            pool = chord_pitches if (beat % 2 == 1 and chord_pitches) else pitches
            top = sorted(range(len(pool)), key=lambda i: abs(pool[i] - pitches[prev_idx]))[:3]
            midi = pool[rng.choice(top)]
            prev_idx = pitches.index(min(pitches, key=lambda p: abs(p - midi)))
            dur = min(rng.choice(dur_pool), float(beats) - beat + 1.0)
            antecedent.append({"pitch": _midi_name(midi), "pitch_midi": midi,
                               "duration": dur, "measure": meas + measure_offset, "beat": beat})
            beat += dur

    notes_out.extend(antecedent)
    melodic_var = sec.get("melodic_variation", 0.2)
    for phrase_start in range(phrase_len, measures, phrase_len):
        for n in antecedent:
            new_meas = (n["measure"] - measure_offset) + phrase_start + measure_offset
            if new_meas > measures + measure_offset:
                break
            midi = n["pitch_midi"]
            if rng.random() < melodic_var:
                candidate = midi + rng.choice([-2, -1, 1, 2])
                if 36 <= candidate <= 96:
                    midi = candidate
            notes_out.append({"pitch": _midi_name(midi), "pitch_midi": midi,
                              "duration": n["duration"], "measure": new_meas, "beat": n["beat"]})

    return notes_out, prog


def _contextual_harmony(key, mode, measures, time_sig, prog, style, rng, measure_offset=0, section_type="verse"):
    beats = int(time_sig.split("/")[0])
    sp = get_style_params(style)
    sec = SECTION_TYPE_PARAMS.get(section_type, SECTION_TYPE_PARAMS["verse"])
    arp = sp.get("bass_style") == "arpeggiated" or sp.get("density", 0.6) > 0.75
    notes_out: list[dict] = []
    for meas in range(1, measures + 1):
        global_meas = meas + measure_offset
        chord = _chord_notes(key, mode, prog[meas - 1] if meas <= len(prog) else 0, octave=3)
        if arp:
            for b_idx in range(beats):
                midi = chord[b_idx % len(chord)]
                notes_out.append({"pitch": _midi_name(midi), "pitch_midi": midi,
                                  "duration": 1.0, "measure": global_meas, "beat": float(b_idx+1)})
        else:
            beat = 1.0
            while beat <= float(beats):
                dur = min(2.0 if beats >= 4 else float(beats), float(beats) - beat + 1.0)
                for midi in chord:
                    notes_out.append({"pitch": _midi_name(midi), "pitch_midi": midi,
                                      "duration": dur, "measure": global_meas, "beat": beat})
                beat += dur
    return notes_out


def _contextual_bass(key, mode, measures, time_sig, prog, style, rng, measure_offset=0):
    beats = int(time_sig.split("/")[0])
    bass_pitches = _scale_pitches(key, mode, 2, 3)
    sp = get_style_params(style)
    bs = sp.get("bass_style", "root_fifth")
    rhythm = sp.get("rhythm", "neutral")
    notes_out: list[dict] = []
    for meas in range(1, measures + 1):
        gm = meas + measure_offset
        chord = _chord_notes(key, mode, prog[meas-1] if meas <= len(prog) else 0, octave=2)
        root, fifth = chord[0], (chord[2] if len(chord) > 2 else chord[0])
        if rhythm in ("driving", "rhythmic") or bs == "root_fifth":
            for beat, midi, dur in [(1.0,root,1.0),(2.0,root,1.0),(3.0,fifth,1.0),(4.0,root+2 if beats>=4 else root,1.0)]:
                if beat > float(beats): break
                notes_out.append({"pitch":_midi_name(midi),"pitch_midi":midi,"duration":dur,"measure":gm,"beat":beat})
        elif rhythm == "lyrical" or bs == "arpeggiated":
            next_chord = _chord_notes(key, mode, prog[meas] if meas < len(prog) else prog[0], octave=2)
            approach = max(24, min(72, next_chord[0] + (1 if next_chord[0] > root else -1)))
            for beat, midi, dur in [(1.0,root,2.0),(3.0,approach,2.0)]:
                if beat > float(beats): break
                notes_out.append({"pitch":_midi_name(midi),"pitch_midi":midi,"duration":min(dur,float(beats)-beat+1.0),"measure":gm,"beat":beat})
        elif bs == "pedal":
            notes_out.append({"pitch":_midi_name(root),"pitch_midi":root,"duration":float(beats),"measure":gm,"beat":1.0})
        else:  # walking
            next_root = _chord_notes(key, mode, prog[meas] if meas < len(prog) else prog[0], octave=2)[0]
            walk = _walk(root, next_root, beats, bass_pitches, rng)
            for b_idx, midi in enumerate(walk):
                notes_out.append({"pitch":_midi_name(midi),"pitch_midi":midi,"duration":1.0,"measure":gm,"beat":float(b_idx+1)})
    return notes_out


def _walk(start, end, steps, pool, rng):
    if not pool: return [start] * steps
    result, cur = [], min(pool, key=lambda p: abs(p-start))
    target = min(pool, key=lambda p: abs(p-end))
    for i in range(steps):
        result.append(cur)
        if i == steps - 1: break
        direction = 1 if target > cur else -1
        cands = [p for p in pool if (p-cur)*direction > 0 and abs(p-cur) <= 2]
        cur = min(cands, key=lambda p: abs(p-cur)) if cands else target
    return result


def _contextual_drums(time_sig, measures, style, rng, section_type="verse"):
    beats = int(time_sig.split("/")[0])
    steps = beats * 4
    sp = get_style_params(style)
    rhythm = sp.get("rhythm", "neutral")
    density = sp.get("density", 0.6) * SECTION_TYPE_PARAMS.get(section_type, SECTION_TYPE_PARAMS["verse"])["density_scale"]
    kit = ["kick","snare","hihat","open_hat","crash","tom"]
    pattern = {k:[0]*(steps*measures) for k in kit}
    for meas in range(measures):
        offset = meas * steps
        if meas % 4 == 0: pattern["crash"][offset] = 1
        for i in range(steps):
            gi = offset + i
            kick_steps = (0,4,8,10,14) if rhythm=="driving" and density>0.8 else (0,8) if rhythm=="sparse" else (0,6,8,14) if rhythm=="rhythmic" else (0,8)
            if i in kick_steps: pattern["kick"][gi] = 1
            if i in (4,12): pattern["snare"][gi] = 1
            if density > 0.7 and rng.random() > 0.88 and i not in (4,12): pattern["snare"][gi] = 1
            if rhythm in ("driving","rhythmic"): pattern["hihat"][gi] = 1 if i%2==0 else 0
            elif rhythm == "lyrical": pattern["hihat"][gi] = 1 if i%4==0 else 0
            elif rhythm == "sparse": pattern["hihat"][gi] = 1 if i%8==0 else 0
            else: pattern["hihat"][gi] = 1 if i%2==0 else 0
            if meas%2==1 and i in (6,14) and density>0.5:
                pattern["open_hat"][gi] = 1; pattern["hihat"][gi] = 0
        if (meas+1)%4==0 and density>0.4:
            fs = offset+steps-4
            for fi in range(4):
                pattern["tom"][fs+fi]=1; pattern["kick"][fs+fi]=0; pattern["snare"][fs+fi]=0
    return {k: pattern[k][:steps] for k in kit}


def _generate_full_song(key, mode, sections, time_sig, style, seed_notes):
    all_melody, all_counter, all_harmony, all_bass = [], [], [], []
    all_drums: dict[str, list[int]] = {}
    section_map, phrase_cache = [], {}
    cursor = 0
    for idx, sec in enumerate(sections):
        st = sec.get("type", "verse")
        sm = sec.get("measures", 8)
        label = sec.get("label", st.title())
        rng = random.Random(hash((style, key, mode, st, idx)) & 0xFFFF)
        cache_key = f"{st}_{style}_{key}_{mode}"
        if cache_key in phrase_cache and st in ("chorus", "verse"):
            base_mel, prog = phrase_cache[cache_key]
            melody = [{**n, "measure": n["measure"]-1+cursor+1} for n in base_mel]
        else:
            melody, prog = _contextual_melody(key, mode, sm, time_sig, style, seed_notes, rng, st, cursor)
            phrase_cache[cache_key] = ([{**n, "measure": n["measure"]-cursor} for n in melody], prog)
        harmony = _contextual_harmony(key, mode, sm, time_sig, prog, style, rng, cursor, st)
        bass = _contextual_bass(key, mode, sm, time_sig, prog, style, rng, cursor)
        drums = _contextual_drums(time_sig, sm, style, rng, st)
        all_melody.extend(melody); all_harmony.extend(harmony); all_bass.extend(bass)
        for k, v in drums.items():
            all_drums.setdefault(k, []).extend(v)
        section_map.append({"label": label, "type": st, "start_measure": cursor+1, "end_measure": cursor+sm, "measures": sm})
        cursor += sm
    return {"parts": {"melody": all_melody, "harmony": all_harmony, "bass": all_bass},
            "drum_pattern": all_drums, "sections": section_map, "total_measures": cursor}


# ───────────────────────────────────────────────────────────────────────────────
# MusicXML export
# ───────────────────────────────────────────────────────────────────────────────

def _dur_type(dur):
    return {4.0:"whole",3.0:"dotted-half",2.0:"half",1.5:"dotted-quarter",
            1.0:"quarter",0.75:"dotted-eighth",0.5:"eighth",0.25:"16th"}.get(dur,"quarter")


def _composition_to_musicxml(comp, parts):
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
        pid = part["role"].replace(" ","_")
        lines += [f'    <score-part id="{pid}">',f'      <part-name>{part["role"].title()}</part-name>',f'    </score-part>']
    lines.append('  </part-list>')
    for part in parts:
        pid = part["role"].replace(" ","_")
        notes = json.loads(part.get("notes_json","[]"))
        lines.append(f'  <part id="{pid}">')
        by_measure: dict[int, list] = {}
        for n in notes:
            by_measure.setdefault(n.get("measure",1),[]).append(n)
        for mnum in sorted(by_measure.keys()):
            lines.append(f'    <measure number="{mnum}">')
            if mnum == 1:
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
            for n in sorted(by_measure[mnum], key=lambda x: x.get("beat",1)):
                dur_divs = max(1, int(n.get("duration",1.0)*4))
                pitch_str = n.get("pitch","C4")
                m = re.match(r'([A-G][#b]?)(\d)', pitch_str)
                if m:
                    sa = m.group(1); ov = int(m.group(2)); step = sa[0]
                    alter = ("<alter>1</alter>" if "#" in sa else "<alter>-1</alter>" if "b" in sa else "")
                    lines += [f'      <note>',
                              f'        <pitch><step>{step}</step>{alter}<octave>{ov}</octave></pitch>',
                              f'        <duration>{dur_divs}</duration>',
                              f'        <type>{_dur_type(n.get("duration",1.0))}</type>',
                              f'      </note>']
                else:
                    lines.append(f'      <note><rest/><duration>{dur_divs}</duration></note>')
            lines.append('    </measure>')
        lines.append('  </part>')
    lines.append('</score-partwise>')
    return "\n".join(lines)


# ───────────────────────────────────────────────────────────────────────────────
# Auth helpers
# ───────────────────────────────────────────────────────────────────────────────

def _user_id(user) -> int:
    return user["id"] if isinstance(user, dict) else user.id


def _assert_owns(comp_id: int, user) -> None:
    uid = _user_id(user)
    ph = _ph()
    with get_conn() as conn:
        row = conn.execute(f"SELECT id FROM compositions WHERE id={ph} AND user_id={ph}", (comp_id, uid)).fetchone()
    if not row:
        raise HTTPException(403, "Not authorized or composition not found")


# ───────────────────────────────────────────────────────────────────────────────
# Routes — Styles
# ───────────────────────────────────────────────────────────────────────────────

@router.get("/styles")
def list_styles():
    grouped: dict[str, list] = {}
    for sid, val in STYLE_CATALOG.items():
        cat = val["category"]
        grouped.setdefault(cat, []).append({"id": sid, "description": val["description"],
            "tempo_range": val["tempo_range"], "mode": val["mode"], "category": cat})
    return {"styles": grouped, "total": len(STYLE_CATALOG)}


# ───────────────────────────────────────────────────────────────────────────────
# Routes — Compositions CRUD
# ───────────────────────────────────────────────────────────────────────────────

@router.post("/compositions", status_code=201)
def create_composition(body: CompositionCreate, user=Depends(get_current_user)):
    uid = _user_id(user)
    ph = _ph()
    sj = json.dumps(body.sections if body.sections else DEFAULT_SECTIONS)
    with get_conn() as conn:
        if IS_PG:
            row = conn.execute(
                "INSERT INTO compositions (user_id,title,key,mode,tempo,time_signature,measures,style,sections_json) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
                (uid, body.title, body.key, body.mode, body.tempo, body.time_signature, body.measures, body.style, sj)
            ).fetchone()
            comp_id = row["id"]
        else:
            cur = conn.execute(
                "INSERT INTO compositions (user_id,title,key,mode,tempo,time_signature,measures,style,sections_json) VALUES (?,?,?,?,?,?,?,?,?)",
                (uid, body.title, body.key, body.mode, body.tempo, body.time_signature, body.measures, body.style, sj)
            )
            comp_id = cur.lastrowid
    return {"id": comp_id, "title": body.title}


@router.get("/compositions")
def list_compositions(user=Depends(get_current_user)):
    uid = _user_id(user)
    ph = _ph()
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT id,title,key,mode,tempo,time_signature,measures,style,created_at FROM compositions WHERE user_id={ph} ORDER BY updated_at DESC",
            (uid,)
        ).fetchall()
    return [dict(r) for r in rows]


@router.get("/compositions/{comp_id}")
def get_composition(comp_id: int, user=Depends(get_current_user)):
    uid = _user_id(user)
    ph = _ph()
    with get_conn() as conn:
        comp = conn.execute(f"SELECT * FROM compositions WHERE id={ph} AND user_id={ph}", (comp_id, uid)).fetchone()
        if not comp:
            raise HTTPException(404, "Composition not found")
        parts   = conn.execute(f"SELECT * FROM composition_parts WHERE composition_id={ph}", (comp_id,)).fetchall()
        drum    = conn.execute(f"SELECT * FROM drum_patterns WHERE composition_id={ph}", (comp_id,)).fetchone()
        rolls   = conn.execute(f"SELECT * FROM piano_rolls WHERE composition_id={ph}", (comp_id,)).fetchall()
        samples = conn.execute(f"SELECT * FROM samples WHERE composition_id={ph}", (comp_id,)).fetchall()
    comp_row = dict(comp)
    return {
        "id": comp_row["id"], "title": comp_row["title"], "key": comp_row["key"],
        "mode": comp_row["mode"], "tempo": comp_row["tempo"],
        "time_signature": comp_row["time_signature"], "measures": comp_row["measures"],
        "style": comp_row.get("style", "neutral"),
        "sections": json.loads(comp_row["sections_json"]) if comp_row.get("sections_json") else DEFAULT_SECTIONS,
        "parts": [{"role": p["role"], "instrument": p["instrument"], "notes": json.loads(p["notes_json"])} for p in parts],
        "drum_pattern": {"pattern": json.loads(drum["pattern_json"]), "steps": drum["steps"], "swing": drum["swing"]} if drum else None,
        "piano_rolls": [{"part_role": r["part_role"], "cells": json.loads(r["cells_json"])} for r in rolls],
        "samples": [{"id": s["id"], "name": s["name"], "source_type": s["source_type"],
                     "source_url": s["source_url"], "layer_role": s["layer_role"],
                     "start_measure": s["start_measure"], "end_measure": s["end_measure"],
                     "volume": s["volume"], "loop": bool(s["loop"])} for s in samples],
    }


@router.put("/compositions/{comp_id}")
def update_composition(comp_id: int, body: CompositionCreate, user=Depends(get_current_user)):
    _assert_owns(comp_id, user)
    uid = _user_id(user)
    ph = _ph(); ts = _now()
    sj = json.dumps(body.sections if body.sections else DEFAULT_SECTIONS)
    with get_conn() as conn:
        conn.execute(
            f"UPDATE compositions SET title={ph},key={ph},mode={ph},tempo={ph},time_signature={ph},measures={ph},style={ph},sections_json={ph},updated_at={ts} WHERE id={ph} AND user_id={ph}",
            (body.title, body.key, body.mode, body.tempo, body.time_signature, body.measures, body.style, sj, comp_id, uid)
        )
    return {"ok": True}


@router.delete("/compositions/{comp_id}", status_code=204)
def delete_composition(comp_id: int, user=Depends(get_current_user)):
    uid = _user_id(user); ph = _ph()
    with get_conn() as conn:
        conn.execute(f"DELETE FROM compositions WHERE id={ph} AND user_id={ph}", (comp_id, uid))


# ───────────────────────────────────────────────────────────────────────────────
# Routes — Parts
# ───────────────────────────────────────────────────────────────────────────────

@router.post("/compositions/{comp_id}/parts")
def upsert_part(comp_id: int, body: PartData, user=Depends(get_current_user)):
    _assert_owns(comp_id, user)
    ph = _ph(); ts = _now()
    nj = json.dumps(body.notes)
    exc = "EXCLUDED" if IS_PG else "excluded"
    with get_conn() as conn:
        conn.execute(
            f"INSERT INTO composition_parts (composition_id,role,instrument,notes_json) VALUES ({ph},{ph},{ph},{ph}) "
            f"ON CONFLICT(composition_id,role) DO UPDATE SET instrument={exc}.instrument,notes_json={exc}.notes_json,updated_at={ts}",
            (comp_id, body.role, body.instrument, nj)
        )
    return {"ok": True, "role": body.role}


@router.delete("/compositions/{comp_id}/parts/{role}", status_code=204)
def delete_part(comp_id: int, role: str, user=Depends(get_current_user)):
    _assert_owns(comp_id, user); ph = _ph()
    with get_conn() as conn:
        conn.execute(f"DELETE FROM composition_parts WHERE composition_id={ph} AND role={ph}", (comp_id, role))


# ───────────────────────────────────────────────────────────────────────────────
# Routes — Drum pattern & Piano roll
# ───────────────────────────────────────────────────────────────────────────────

@router.post("/compositions/{comp_id}/drum_pattern")
def save_drum_pattern(comp_id: int, body: DrumPatternData, user=Depends(get_current_user)):
    _assert_owns(comp_id, user)
    ph = _ph(); ts = _now(); pj = json.dumps(body.pattern)
    exc = "EXCLUDED" if IS_PG else "excluded"
    with get_conn() as conn:
        conn.execute(
            f"INSERT INTO drum_patterns (composition_id,pattern_json,steps,swing) VALUES ({ph},{ph},{ph},{ph}) "
            f"ON CONFLICT(composition_id) DO UPDATE SET pattern_json={exc}.pattern_json,steps={exc}.steps,swing={exc}.swing,updated_at={ts}",
            (comp_id, pj, body.steps, body.swing)
        )
    return {"ok": True}


@router.post("/compositions/{comp_id}/piano_roll")
def save_piano_roll(comp_id: int, body: PianoRollData, user=Depends(get_current_user)):
    _assert_owns(comp_id, user)
    ph = _ph(); ts = _now(); cj = json.dumps(body.cells)
    exc = "EXCLUDED" if IS_PG else "excluded"
    with get_conn() as conn:
        conn.execute(
            f"INSERT INTO piano_rolls (composition_id,part_role,cells_json) VALUES ({ph},{ph},{ph}) "
            f"ON CONFLICT(composition_id,part_role) DO UPDATE SET cells_json={exc}.cells_json,updated_at={ts}",
            (comp_id, body.part_role, cj)
        )
    return {"ok": True}


# ───────────────────────────────────────────────────────────────────────────────
# Routes — Samples
# ───────────────────────────────────────────────────────────────────────────────

@router.post("/compositions/{comp_id}/samples", status_code=201)
def add_sample(comp_id: int, body: SampleData, user=Depends(get_current_user)):
    _assert_owns(comp_id, user)
    uid = _user_id(user); ph = _ph()
    with get_conn() as conn:
        if IS_PG:
            row = conn.execute(
                "INSERT INTO samples (composition_id,user_id,name,source_type,source_url,layer_role,start_measure,end_measure,volume,loop) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
                (comp_id, uid, body.name, body.source_type, body.source_url, body.layer_role, body.start_measure, body.end_measure, body.volume, 1 if body.loop else 0)
            ).fetchone()
            sample_id = row["id"]
        else:
            cur = conn.execute(
                "INSERT INTO samples (composition_id,user_id,name,source_type,source_url,layer_role,start_measure,end_measure,volume,loop) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (comp_id, uid, body.name, body.source_type, body.source_url, body.layer_role, body.start_measure, body.end_measure, body.volume, 1 if body.loop else 0)
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
    uid = _user_id(user)
    uploads_dir = "uploads"
    os.makedirs(uploads_dir, exist_ok=True)
    ext = os.path.splitext(file.filename or "sample.wav")[1] or ".wav"
    fname = f"{uuid.uuid4().hex}{ext}"
    fpath = os.path.join(uploads_dir, fname)
    content = await file.read()
    with open(fpath, "wb") as f:
        f.write(content)
    with get_conn() as conn:
        if IS_PG:
            row = conn.execute(
                "INSERT INTO samples (composition_id,user_id,name,source_type,file_path,layer_role,start_measure,volume,loop) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
                (comp_id, uid, file.filename or fname, "upload", fpath, layer_role, start_measure, volume, 1 if loop else 0)
            ).fetchone()
            sample_id = row["id"]
        else:
            cur = conn.execute(
                "INSERT INTO samples (composition_id,user_id,name,source_type,file_path,layer_role,start_measure,volume,loop) VALUES (?,?,?,?,?,?,?,?,?)",
                (comp_id, uid, file.filename or fname, "upload", fpath, layer_role, start_measure, volume, 1 if loop else 0)
            )
            sample_id = cur.lastrowid
    return {"id": sample_id, "name": file.filename, "file_path": fpath}


@router.get("/compositions/{comp_id}/samples")
def list_samples(comp_id: int, user=Depends(get_current_user)):
    _assert_owns(comp_id, user); ph = _ph()
    with get_conn() as conn:
        rows = conn.execute(f"SELECT * FROM samples WHERE composition_id={ph} ORDER BY start_measure", (comp_id,)).fetchall()
    return [{"id": r["id"], "name": r["name"], "source_type": r["source_type"],
             "source_url": r["source_url"], "layer_role": r["layer_role"],
             "start_measure": r["start_measure"], "end_measure": r["end_measure"],
             "volume": r["volume"], "loop": bool(r["loop"])} for r in rows]


@router.delete("/compositions/{comp_id}/samples/{sample_id}", status_code=204)
def delete_sample(comp_id: int, sample_id: int, user=Depends(get_current_user)):
    _assert_owns(comp_id, user); ph = _ph()
    with get_conn() as conn:
        conn.execute(f"DELETE FROM samples WHERE id={ph} AND composition_id={ph}", (sample_id, comp_id))


# ───────────────────────────────────────────────────────────────────────────────
# Routes — Generation
# ───────────────────────────────────────────────────────────────────────────────

@router.post("/generate/melody")
def gen_melody(body: GenerateRequest, user=Depends(get_current_user)):
    notes, prog = _contextual_melody(body.key, body.mode, body.measures, body.time_signature, body.style,
                                     body.seed_notes, random.Random(42), body.section_type, body.measure_offset)
    return {"role": "melody", "notes": notes, "progression": prog, "engine": "contextual_local"}


@router.post("/generate/harmony")
def gen_harmony(body: GenerateRequest, user=Depends(get_current_user)):
    rng = random.Random(13)
    _, prog = _contextual_melody(body.key, body.mode, body.measures, body.time_signature, body.style, [], rng)
    notes = _contextual_harmony(body.key, body.mode, body.measures, body.time_signature, prog, body.style, rng,
                                body.measure_offset, body.section_type)
    return {"role": "harmony", "notes": notes, "progression": prog, "engine": "contextual_local"}


@router.post("/generate/bass")
def gen_bass(body: GenerateRequest, user=Depends(get_current_user)):
    rng = random.Random(5)
    _, prog = _contextual_melody(body.key, body.mode, body.measures, body.time_signature, body.style, [], rng)
    notes = _contextual_bass(body.key, body.mode, body.measures, body.time_signature, prog, body.style, rng, body.measure_offset)
    return {"role": "bass", "notes": notes, "engine": "contextual_local"}


@router.post("/generate/drums")
def gen_drums(body: GenerateRequest, user=Depends(get_current_user)):
    pattern = _contextual_drums(body.time_signature, body.measures, body.style, random.Random(77), body.section_type)
    return {"role": "drums", "pattern": pattern, "steps": len(list(pattern.values())[0]), "engine": "contextual_local"}


@router.post("/generate/song")
def gen_song(body: GenerateRequest, user=Depends(get_current_user)):
    # Use DEFAULT_SECTIONS but scale each section's measure count so the
    # total matches what the caller requested (body.measures).
    sections = DEFAULT_SECTIONS
    if body.measures and body.measures != 8:
        default_total = sum(s["measures"] for s in DEFAULT_SECTIONS)
        scale = body.measures / default_total
        sections = [{**s, "measures": max(1, round(s["measures"] * scale))} for s in DEFAULT_SECTIONS]
    result = _generate_full_song(body.key, body.mode, sections, body.time_signature, body.style, body.seed_notes)
    result["engine"] = "contextual_local_song"
    return result


@router.post("/generate/all")
def gen_all(body: GenerateRequest, user=Depends(get_current_user)):
    rng = random.Random(42)
    melody, prog = _contextual_melody(body.key, body.mode, body.measures, body.time_signature, body.style,
                                      body.seed_notes, rng, body.section_type, body.measure_offset)
    harmony = _contextual_harmony(body.key, body.mode, body.measures, body.time_signature, prog, body.style, random.Random(13))
    bass    = _contextual_bass(body.key, body.mode, body.measures, body.time_signature, prog, body.style, random.Random(5))
    drums   = _contextual_drums(body.time_signature, body.measures, body.style, random.Random(77), body.section_type)
    return {"progression": prog,
            "parts": {"melody": melody, "harmony": harmony, "bass": bass},
            "drum_pattern": drums, "engine": "contextual_local"}


# ───────────────────────────────────────────────────────────────────────────────
# Route — Export MusicXML
# ───────────────────────────────────────────────────────────────────────────────

@router.get("/compositions/{comp_id}/export_xml")
def export_xml(comp_id: int, user=Depends(get_current_user)):
    uid = _user_id(user); ph = _ph()
    with get_conn() as conn:
        comp = conn.execute(f"SELECT * FROM compositions WHERE id={ph} AND user_id={ph}", (comp_id, uid)).fetchone()
        if not comp:
            raise HTTPException(404, "Not found")
        parts = conn.execute(f"SELECT * FROM composition_parts WHERE composition_id={ph}", (comp_id,)).fetchall()
    comp_row = dict(comp)
    xml = _composition_to_musicxml(comp_row, [dict(p) for p in parts])
    filename = comp_row["title"].replace(" ","_") + ".xml"
    return Response(content=xml, media_type="application/xml",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/health")
def composer_health():
    return {"status": "ok", "styles": len(STYLE_CATALOG)}

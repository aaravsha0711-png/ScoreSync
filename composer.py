"""composer.py

Local music composition endpoints for ScoreSync.
All generation uses music21 or pure-Python fallback — no paid API required.
PostgreSQL (Render) + SQLite (local) dual-mode, consistent with database.py.
"""
from __future__ import annotations

import json
import math
import random
import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
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

# (rest of file unchanged)

# ─────────────────────────────────────────────────────────────────────────────
# Auth helper
# ─────────────────────────────────────────────────────────────────────────────

def _user_id(user) -> int:
    if isinstance(user, dict):
        return user["id"]
    return user.id


def _assert_owns(comp_id: int, user) -> None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id FROM compositions WHERE id=? AND user_id=?", (comp_id, _user_id(user))
        ).fetchone()
    if not row:
        raise HTTPException(403, "Not authorized or composition not found")

# ─────────────────────────────────────────────────────────────────────────────
# Routes — Compositions
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/compositions", status_code=201)
def create_composition(body: CompositionCreate, user=Depends(get_current_user)):
    uid = _user_id(user)
    if DATABASE_URL:
        with get_conn() as conn:
            cur = conn.execute(
                "INSERT INTO compositions (user_id, title, key, mode, tempo, time_signature, measures) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                (uid, body.title, body.key, body.mode, body.tempo, body.time_signature, body.measures)
            )
            comp_id = cur.lastrowid
    else:
        with get_conn() as conn:
            cur = conn.execute(
                "INSERT INTO compositions (user_id, title, key, mode, tempo, time_signature, measures) VALUES (?,?,?,?,?,?,?)",
                (uid, body.title, body.key, body.mode, body.tempo, body.time_signature, body.measures)
            )
            comp_id = cur.lastrowid
    return {"id": comp_id, "title": body.title}

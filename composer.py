"""composer.py

Local music composition endpoints for ScoreSync.
All generation uses music21 or pure-Python fallback — no paid API required.

POST /composer/compositions            — create a new composition
GET  /composer/compositions            — list user compositions
GET  /composer/compositions/{id}       — get full composition
PUT  /composer/compositions/{id}       — update composition
DELETE /composer/compositions/{id}     — delete composition

POST /composer/compositions/{id}/parts          — add/update a part
DELETE /composer/compositions/{id}/parts/{role} — remove a part

POST /composer/generate/melody         — generate melody (music21 or fallback)
POST /composer/generate/counter_melody — generate counter-melody
POST /composer/generate/harmony        — generate chords / harmony
POST /composer/generate/bass           — generate bass line
POST /composer/generate/drums          — suggest drum pattern

POST /composer/compositions/{id}/drum_pattern  — save drum pattern
POST /composer/compositions/{id}/piano_roll    — save piano roll
GET  /composer/compositions/{id}/export_xml    — export as MusicXML
"""
from __future__ import annotations

import json
import random
import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from deps import get_current_user
from database import get_conn

router = APIRouter(prefix="/composer", tags=["composer"])

# ─────────────────────────────────────────────────────────────────────────────
# DB initialisation  (called from main.py lifespan)
# ─────────────────────────────────────────────────────────────────────────────

def init_composer_tables() -> None:
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
    role: str          # melody | counter_melody | harmony | bass | other
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

# ─────────────────────────────────────────────────────────────────────────────
# Local music generation helpers — no paid API
# ─────────────────────────────────────────────────────────────────────────────

_SCALES: dict[str, list[int]] = {
    "major":       [0, 2, 4, 5, 7, 9, 11],
    "minor":       [0, 2, 3, 5, 7, 8, 10],
    "dorian":      [0, 2, 3, 5, 7, 9, 10],
    "mixolydian":  [0, 2, 4, 5, 7, 9, 10],
    "pentatonic":  [0, 2, 4, 7, 9],
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
    intervals = _SCALES.get(mode, _SCALES["major"])
    pitches = []
    for oct in range(octave_low, octave_high + 1):
        for interval in intervals:
            midi = (oct + 1) * 12 + root + interval
            if 36 <= midi <= 96:
                pitches.append(midi)
    return sorted(set(pitches))

def _try_music21_generate(key: str, mode: str, measures: int, seed_notes: list[str]) -> list[dict] | None:
    try:
        from music21 import stream, note as m21note, key as m21key, meter
        k = m21key.Key(key, mode)
        sc = k.getScale()
        available = [p.midi for p in sc.getPitches("C4", "C6")]
        if not available:
            return None
        rng = random.Random(42)
        notes_out: list[dict] = []
        prev_midi = available[len(available) // 2]
        for meas in range(1, measures + 1):
            beat = 1.0
            while beat <= 4.0:
                idx = min(range(len(available)), key=lambda i: abs(available[i] - prev_midi))
                delta = rng.choice([-2, -1, -1, 0, 1, 1, 2])
                new_idx = max(0, min(len(available) - 1, idx + delta))
                midi = available[new_idx]
                dur = rng.choice([0.5, 0.5, 1.0, 1.0, 1.0, 2.0])
                dur = min(dur, 4.0 - beat + 1.0)
                notes_out.append({
                    "pitch": _midi_name(midi), "pitch_midi": midi,
                    "duration": dur, "measure": meas, "beat": beat,
                })
                prev_midi = midi
                beat += dur
        return notes_out
    except Exception:
        return None

def _fallback_generate(key: str, mode: str, measures: int, style: str = "melody") -> list[dict]:
    if style == "bass":
        pitches = _scale_pitches(key, mode, octave_low=2, octave_high=3)
    elif style == "harmony":
        pitches = _scale_pitches(key, mode, octave_low=3, octave_high=5)
    else:
        pitches = _scale_pitches(key, mode, octave_low=4, octave_high=5)

    rng = random.Random(sum(ord(c) for c in key + mode + style))
    notes_out: list[dict] = []
    prev_idx = len(pitches) // 2
    for meas in range(1, measures + 1):
        beat = 1.0
        while beat <= 4.0:
            if style == "bass":
                delta = rng.choice([-1, 0, 0, 1])
            elif style == "harmony":
                delta = rng.choice([-3, -2, 0, 2, 3])
            else:
                delta = rng.choice([-2, -1, -1, 0, 1, 1, 2])
            idx = max(0, min(len(pitches) - 1, prev_idx + delta))
            midi = pitches[idx]
            if style == "bass":
                dur = rng.choice([1.0, 1.0, 2.0])
            elif style == "harmony":
                dur = rng.choice([2.0, 2.0, 4.0])
            else:
                dur = rng.choice([0.5, 0.5, 1.0, 1.0, 1.0, 2.0])
            dur = min(dur, 4.0 - beat + 1.0)
            notes_out.append({
                "pitch": _midi_name(midi), "pitch_midi": midi,
                "duration": dur, "measure": meas, "beat": beat,
            })
            prev_idx = idx
            beat += dur
    return notes_out

def _generate_counter_melody(existing: list[dict], key: str, mode: str) -> list[dict]:
    pitches = _scale_pitches(key, mode, octave_low=4, octave_high=6)
    rng = random.Random(99)
    result: list[dict] = []
    occupied: set[tuple] = {(n["measure"], round(n["beat"] * 2) / 2) for n in existing}
    max_meas = max((n["measure"] for n in existing), default=8)
    for meas in range(1, max_meas + 1):
        beat = 1.0
        while beat <= 4.0:
            key_ = (meas, round(beat * 2) / 2)
            if key_ not in occupied:
                existing_at = [n["pitch_midi"] for n in existing
                               if n["measure"] == meas and abs(n["beat"] - beat) < 1]
                if existing_at and pitches:
                    ref = existing_at[0]
                    candidates = [p for p in pitches if (p - ref) % 12 in (3, 4, 7, 8, 9) and p > ref]
                    midi = rng.choice(candidates) if candidates else rng.choice(pitches)
                elif pitches:
                    midi = rng.choice(pitches)
                else:
                    beat += 1.0
                    continue
                result.append({
                    "pitch": _midi_name(midi), "pitch_midi": midi,
                    "duration": 1.0, "measure": meas, "beat": beat,
                })
            beat += 1.0
    return result

def _generate_drum_suggestion(time_sig: str = "4/4") -> dict[str, list[int]]:
    beats = int(time_sig.split("/")[0])
    steps = beats * 4
    kit: dict[str, list[int]] = {
        "kick":     [0] * steps,
        "snare":    [0] * steps,
        "hihat":    [0] * steps,
        "open_hat": [0] * steps,
        "crash":    [0] * steps,
        "tom":      [0] * steps,
    }
    for i in range(steps):
        if i % 8 == 0: kit["kick"][i] = 1
        if i % 8 == 4: kit["snare"][i] = 1
        if i % 2 == 0: kit["hihat"][i] = 1
    if steps > 0:
        kit["crash"][0] = 1
    return kit

def _dur_type(dur: float) -> str:
    mapping = {4.0: "whole", 3.0: "dotted-half", 2.0: "half",
               1.5: "dotted-quarter", 1.0: "quarter",
               0.75: "dotted-eighth", 0.5: "eighth", 0.25: "16th"}
    return mapping.get(dur, "quarter")

def _composition_to_musicxml(comp: dict, parts: list[dict]) -> str:
    beats, beat_type = comp["time_signature"].split("/")
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
        lines += [
            f'    <score-part id="{pid}">',
            f'      <part-name>{part["role"].title()}</part-name>',
            f'    </score-part>',
        ]
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
                    f'      <attributes>',
                    f'        <divisions>4</divisions>',
                    f'        <key><fifths>0</fifths></key>',
                    f'        <time><beats>{beats}</beats><beat-type>{beat_type}</beat-type></time>',
                    f'        <clef><sign>G</sign><line>2</line></clef>',
                    f'      </attributes>',
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
                    step_acc = m.group(1)
                    oct_xml  = int(m.group(2))
                    step     = step_acc[0]
                    alter    = "<alter>1</alter>" if "#" in step_acc else ("<alter>-1</alter>" if "b" in step_acc else "")
                    lines += [
                        f'      <note>',
                        f'        <pitch><step>{step}</step>{alter}<octave>{oct_xml}</octave></pitch>',
                        f'        <duration>{dur_divs}</duration>',
                        f'        <type>{_dur_type(n.get("duration", 1.0))}</type>',
                        f'      </note>',
                    ]
                else:
                    lines.append(f'      <note><rest/><duration>{dur_divs}</duration></note>')
            lines.append(f'    </measure>')
        lines.append(f'  </part>')

    lines.append('</score-partwise>')
    return "\n".join(lines)

# ─────────────────────────────────────────────────────────────────────────────
# Auth helper
# ─────────────────────────────────────────────────────────────────────────────

def _assert_owns(comp_id: int, user) -> None:
    with get_conn() as conn:
        row = conn.execute("SELECT id FROM compositions WHERE id=? AND user_id=?", (comp_id, user.id)).fetchone()
    if not row:
        raise HTTPException(403, "Not authorized or composition not found")

# ─────────────────────────────────────────────────────────────────────────────
# Routes — Compositions
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/compositions", status_code=201)
def create_composition(body: CompositionCreate, user=Depends(get_current_user)):
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO compositions (user_id, title, key, mode, tempo, time_signature, measures) VALUES (?,?,?,?,?,?,?)",
            (user.id, body.title, body.key, body.mode, body.tempo, body.time_signature, body.measures)
        )
        comp_id = cur.lastrowid
    return {"id": comp_id, "title": body.title}

@router.get("/compositions")
def list_compositions(user=Depends(get_current_user)):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, title, key, mode, tempo, time_signature, measures, created_at FROM compositions WHERE user_id=? ORDER BY updated_at DESC",
            (user.id,)
        ).fetchall()
    return [dict(r) for r in rows]

@router.get("/compositions/{comp_id}")
def get_composition(comp_id: int, user=Depends(get_current_user)):
    with get_conn() as conn:
        comp = conn.execute("SELECT * FROM compositions WHERE id=? AND user_id=?", (comp_id, user.id)).fetchone()
        if not comp:
            raise HTTPException(404, "Composition not found")
        parts = conn.execute("SELECT * FROM composition_parts WHERE composition_id=?", (comp_id,)).fetchall()
        drum  = conn.execute("SELECT * FROM drum_patterns WHERE composition_id=?", (comp_id,)).fetchone()
        rolls = conn.execute("SELECT * FROM piano_rolls WHERE composition_id=?", (comp_id,)).fetchall()
    return {
        "id": comp["id"], "title": comp["title"], "key": comp["key"],
        "mode": comp["mode"], "tempo": comp["tempo"],
        "time_signature": comp["time_signature"], "measures": comp["measures"],
        "parts": [{"role": p["role"], "instrument": p["instrument"],
                   "notes": json.loads(p["notes_json"])} for p in parts],
        "drum_pattern": {"pattern": json.loads(drum["pattern_json"]),
                         "steps": drum["steps"], "swing": drum["swing"]} if drum else None,
        "piano_rolls": [{"part_role": r["part_role"], "cells": json.loads(r["cells_json"])} for r in rolls],
    }

@router.put("/compositions/{comp_id}")
def update_composition(comp_id: int, body: CompositionCreate, user=Depends(get_current_user)):
    _assert_owns(comp_id, user)
    with get_conn() as conn:
        conn.execute(
            "UPDATE compositions SET title=?, key=?, mode=?, tempo=?, time_signature=?, measures=?, updated_at=datetime('now') WHERE id=? AND user_id=?",
            (body.title, body.key, body.mode, body.tempo, body.time_signature, body.measures, comp_id, user.id)
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
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO composition_parts (composition_id, role, instrument, notes_json)
               VALUES (?,?,?,?)
               ON CONFLICT(composition_id, role) DO UPDATE SET
               instrument=excluded.instrument, notes_json=excluded.notes_json,
               updated_at=datetime('now')""",
            (comp_id, body.role, body.instrument, json.dumps(body.notes))
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
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO drum_patterns (composition_id, pattern_json, steps, swing)
               VALUES (?,?,?,?)
               ON CONFLICT(composition_id) DO UPDATE SET
               pattern_json=excluded.pattern_json, steps=excluded.steps,
               swing=excluded.swing, updated_at=datetime('now')""",
            (comp_id, json.dumps(body.pattern), body.steps, body.swing)
        )
    return {"ok": True}

@router.post("/compositions/{comp_id}/piano_roll")
def save_piano_roll(comp_id: int, body: PianoRollData, user=Depends(get_current_user)):
    _assert_owns(comp_id, user)
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO piano_rolls (composition_id, part_role, cells_json)
               VALUES (?,?,?)
               ON CONFLICT(composition_id, part_role) DO UPDATE SET
               cells_json=excluded.cells_json, updated_at=datetime('now')""",
            (comp_id, body.part_role, json.dumps(body.cells))
        )
    return {"ok": True}

# ─────────────────────────────────────────────────────────────────────────────
# Routes — Generation (local, no paid API)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/generate/melody")
def gen_melody(body: GenerateRequest, user=Depends(get_current_user)):
    notes = _try_music21_generate(body.key, body.mode, body.measures, body.seed_notes)
    engine = "music21"
    if notes is None:
        notes = _fallback_generate(body.key, body.mode, body.measures, "melody")
        engine = "local_fallback"
    return {"role": "melody", "notes": notes, "engine": engine}

@router.post("/generate/counter_melody")
def gen_counter(body: GenerateRequest, user=Depends(get_current_user)):
    notes = _generate_counter_melody(body.existing_melody, body.key, body.mode)
    return {"role": "counter_melody", "notes": notes, "engine": "local"}

@router.post("/generate/harmony")
def gen_harmony(body: GenerateRequest, user=Depends(get_current_user)):
    notes = _fallback_generate(body.key, body.mode, body.measures, "harmony")
    return {"role": "harmony", "notes": notes, "engine": "local"}

@router.post("/generate/bass")
def gen_bass(body: GenerateRequest, user=Depends(get_current_user)):
    notes = _fallback_generate(body.key, body.mode, body.measures, "bass")
    return {"role": "bass", "notes": notes, "engine": "local"}

@router.post("/generate/drums")
def gen_drums(body: GenerateRequest, user=Depends(get_current_user)):
    pattern = _generate_drum_suggestion(body.time_signature)
    return {"role": "drums", "pattern": pattern, "steps": 16, "engine": "local"}

# ─────────────────────────────────────────────────────────────────────────────
# Route — Export MusicXML
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/compositions/{comp_id}/export_xml")
def export_xml(comp_id: int, user=Depends(get_current_user)):
    with get_conn() as conn:
        comp = conn.execute("SELECT * FROM compositions WHERE id=? AND user_id=?", (comp_id, user.id)).fetchone()
        if not comp:
            raise HTTPException(404, "Not found")
        parts = conn.execute("SELECT * FROM composition_parts WHERE composition_id=?", (comp_id,)).fetchall()
    xml = _composition_to_musicxml(dict(comp), [dict(p) for p in parts])
    filename = comp["title"].replace(" ", "_") + ".xml"
    return Response(
        content=xml,
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )

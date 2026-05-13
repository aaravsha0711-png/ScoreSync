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
    style: str = "neutral"   # "lyrical" | "rhythmic" | "neutral"

# ─────────────────────────────────────────────────────────────────────────────
# Music theory tables
# ─────────────────────────────────────────────────────────────────────────────

_SCALES: dict[str, list[int]] = {
    "major":       [0, 2, 4, 5, 7, 9, 11],
    "minor":       [0, 2, 3, 5, 7, 8, 10],
    "dorian":      [0, 2, 3, 5, 7, 9, 10],
    "mixolydian":  [0, 2, 4, 5, 7, 9, 10],
    "pentatonic":  [0, 2, 4, 7, 9],
    "blues":       [0, 3, 5, 6, 7, 10],
    "harmonic_minor": [0, 2, 3, 5, 7, 8, 11],
}

# Diatonic triads (root interval, third interval, fifth interval) in scale degrees
# major: I ii iii IV V vi viidim
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
# Typical tonal progressions (indices into diatonic chord list, 0-based)
_PROGRESSIONS: dict[str, list[list[int]]] = {
    "major": [
        [0, 3, 4, 0],       # I IV V I
        [0, 5, 3, 4],       # I vi IV V
        [0, 3, 5, 4],       # I IV vi V
        [0, 4, 5, 3],       # I V vi IV  (pop axis)
        [0, 5, 1, 4],       # I vi ii V  (jazz turnaround)
    ],
    "minor": [
        [0, 3, 4, 0],       # i iv v i
        [0, 6, 3, 4],       # i VII iv v
        [0, 3, 6, 4],       # i iv VII v
        [0, 5, 3, 4],       # i VI iv v
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
    intervals = _SCALES.get(mode, _SCALES["major"])
    pitches = []
    for oct in range(octave_low, octave_high + 1):
        for iv in intervals:
            midi = (oct + 1) * 12 + root + iv
            if 24 <= midi <= 108:
                pitches.append(midi)
    return sorted(set(pitches))


def _chord_notes(key: str, mode: str, degree: int, octave: int = 4) -> list[int]:
    """Return MIDI notes for a diatonic triad at degree (0-based) in given octave."""
    root_pc = _ROOT_MIDI.get(key, 60) % 12
    chords = _DIATONIC_CHORDS.get(mode, _DIATONIC_CHORDS["major"])
    triad = chords[degree % len(chords)]
    base = (octave + 1) * 12 + root_pc
    return [(base + iv) % 128 for iv in triad]


def _pick_progression(key: str, mode: str, measures: int, rng: random.Random) -> list[int]:
    """Return a list of chord degrees (0-based), one per measure."""
    bank = _PROGRESSIONS.get(mode, _PROGRESSIONS["major"])
    unit = rng.choice(bank)           # e.g. [0,3,4,0]
    result = []
    while len(result) < measures:
        result.extend(unit)
    return result[:measures]

# ─────────────────────────────────────────────────────────────────────────────
# Contextual generation engine
# ─────────────────────────────────────────────────────────────────────────────

def _contextual_melody(
    key: str, mode: str, measures: int, time_sig: str, style: str,
    seed_notes: list[str], rng: random.Random
) -> tuple[list[dict], list[int]]:
    """
    Generate a melody with phrase structure (antecedent 4m + consequent 4m repeating).
    Returns (notes, chord_progression).
    """
    beats = int(time_sig.split("/")[0])
    pitches = _scale_pitches(key, mode, octave_low=4, octave_high=5)
    if not pitches:
        pitches = list(range(60, 73))

    prog = _pick_progression(key, mode, measures, rng)

    # Rhythmic vocabulary by style
    if style == "lyrical":
        dur_pool = [1.0, 1.0, 2.0, 2.0, 0.5]
    elif style == "rhythmic":
        dur_pool = [0.5, 0.5, 0.5, 1.0, 0.25]
    else:
        dur_pool = [0.5, 0.5, 1.0, 1.0, 1.0, 2.0]

    notes_out: list[dict] = []
    prev_idx = len(pitches) // 2

    # Build a 4-measure antecedent phrase, then vary it for the consequent
    phrase_len = min(4, measures)
    antecedent: list[dict] = []

    for meas in range(1, phrase_len + 1):
        chord_notes = _chord_notes(key, mode, prog[meas - 1], octave=4)
        beat = 1.0
        while beat <= float(beats):
            # Prefer chord tones on strong beats
            on_strong = (beat % 2 == 1)
            chord_pcs = [n % 12 for n in chord_notes]
            chord_pitches = [p for p in pitches if p % 12 in chord_pcs]
            candidate_pool = chord_pitches if (on_strong and chord_pitches) else pitches

            # Step-wise bias with occasional leap
            idx_candidates = sorted(range(len(candidate_pool)),
                                    key=lambda i: abs(candidate_pool[i] - pitches[prev_idx]))
            # mostly step (top 3 closest), rarely leap
            top_n = idx_candidates[:3] if rng.random() > 0.15 else idx_candidates
            new_idx = rng.choice(top_n)
            midi = candidate_pool[new_idx]
            prev_idx = pitches.index(min(pitches, key=lambda p: abs(p - midi)))

            dur = rng.choice(dur_pool)
            dur = min(dur, float(beats) - beat + 1.0)
            antecedent.append({
                "pitch": _midi_name(midi), "pitch_midi": midi,
                "duration": dur, "measure": meas, "beat": beat,
            })
            beat += dur

    notes_out.extend(antecedent)

    # Consequent: repeat with variation (raise/lower last note, alter final cadence)
    for phrase_start in range(phrase_len, measures, phrase_len):
        for n in antecedent:
            new_meas = n["measure"] + phrase_start
            if new_meas > measures:
                break
            midi = n["pitch_midi"]
            # Vary final measure of consequent toward tonic
            is_final = (n["measure"] == phrase_len)
            if is_final:
                tonic = _scale_pitches(key, mode, octave_low=4, octave_high=5)
                root_pc = _ROOT_MIDI.get(key, 60) % 12
                tonic_pitches = [p for p in tonic if p % 12 == root_pc]
                if tonic_pitches:
                    midi = min(tonic_pitches, key=lambda p: abs(p - midi))
                # Occasionally raise by a step for half-cadence
                elif rng.random() < 0.4:
                    midi = min(midi + 2, 96)
            notes_out.append({
                "pitch": _midi_name(midi), "pitch_midi": midi,
                "duration": n["duration"], "measure": new_meas, "beat": n["beat"],
            })

    return notes_out, prog


def _contextual_counter_melody(
    melody: list[dict], key: str, mode: str, time_sig: str,
    prog: list[int], rng: random.Random
) -> list[dict]:
    """
    Counter-melody that:
    - Fills melodic gaps (interleaves rhythmically)
    - Uses contrary motion where possible
    - Harmonises with thirds/sixths above or below
    """
    beats = int(time_sig.split("/")[0])
    pitches = _scale_pitches(key, mode, octave_low=4, octave_high=6)
    max_meas = max((n["measure"] for n in melody), default=8)
    result: list[dict] = []

    # Build a map of occupied (measure, beat) slots
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
                # Don't play on the same beat as melody; advance by smallest unit
                beat += 0.5
                continue

            # Look at melody context to decide motion
            mel_near = [n for n in melody
                        if n["measure"] == meas and abs(n["beat"] - beat) < 1.5]

            if mel_near:
                ref = mel_near[0]["pitch_midi"]
                # Prefer contrary motion: if melody is high, go lower; if low, go higher
                if ref > prev_midi:
                    candidates = [p for p in pitches if p < ref and (p - ref) % 12 in (3, 4, 8, 9)]
                else:
                    candidates = [p for p in pitches if p > ref and (p - ref) % 12 in (3, 4, 8, 9)]
                # Fall back to chord tones
                if not candidates:
                    candidates = [p for p in pitches if p % 12 in chord_pcs]
                if not candidates:
                    candidates = pitches
            else:
                candidates = [p for p in pitches if p % 12 in chord_pcs] or pitches

            # Step-wise preference from prev
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
    prog: list[int], style: str, rng: random.Random
) -> list[dict]:
    """
    Block chords or arpeggios following the chord progression.
    """
    beats = int(time_sig.split("/")[0])
    notes_out: list[dict] = []

    arp = (style == "rhythmic")

    for meas in range(1, measures + 1):
        degree = prog[meas - 1] if meas <= len(prog) else 0
        chord = _chord_notes(key, mode, degree, octave=3)

        if arp:
            # Arpeggio: one note per beat
            for b_idx, beat in enumerate([float(b + 1) for b in range(beats)]):
                midi = chord[b_idx % len(chord)]
                notes_out.append({
                    "pitch": _midi_name(midi), "pitch_midi": midi,
                    "duration": 1.0, "measure": meas, "beat": beat,
                })
        else:
            # Block chord: half-note chunks
            beat = 1.0
            while beat <= float(beats):
                dur = 2.0 if beats >= 4 else float(beats)
                dur = min(dur, float(beats) - beat + 1.0)
                for midi in chord:
                    notes_out.append({
                        "pitch": _midi_name(midi), "pitch_midi": midi,
                        "duration": dur, "measure": meas, "beat": beat,
                    })
                beat += dur

    return notes_out


def _contextual_bass(
    key: str, mode: str, measures: int, time_sig: str,
    prog: list[int], style: str, rng: random.Random
) -> list[dict]:
    """
    Bass line using chord roots with approach notes and occasional walking.
    """
    beats = int(time_sig.split("/")[0])
    bass_pitches = _scale_pitches(key, mode, octave_low=2, octave_high=3)
    root_pc = _ROOT_MIDI.get(key, 60) % 12
    notes_out: list[dict] = []

    prev_midi = None

    for meas in range(1, measures + 1):
        degree = prog[meas - 1] if meas <= len(prog) else 0
        # Root of the chord
        chord = _chord_notes(key, mode, degree, octave=2)
        root = chord[0]
        fifth = chord[2] if len(chord) > 2 else root

        if style == "rhythmic":
            # Syncopated: root on 1, fifth on 3, approach on 4
            for beat, midi, dur in [
                (1.0, root, 1.0),
                (2.0, root, 1.0),
                (3.0, fifth, 1.0),
                (4.0, root + 2 if beats >= 4 else root, 1.0),
            ]:
                if beat > float(beats):
                    break
                notes_out.append({
                    "pitch": _midi_name(midi), "pitch_midi": midi,
                    "duration": dur, "measure": meas, "beat": beat,
                })
        elif style == "lyrical":
            # Smooth: half-note root, half-note approach to next chord root
            next_degree = prog[meas] if meas < len(prog) else prog[0]
            next_chord = _chord_notes(key, mode, next_degree, octave=2)
            next_root = next_chord[0]
            approach = next_root - 1 if next_root > root else next_root + 1
            approach = max(24, min(72, approach))
            pairs = [(1.0, root, 2.0), (3.0, approach, 2.0)]
            for beat, midi, dur in pairs:
                if beat > float(beats):
                    break
                dur = min(dur, float(beats) - beat + 1.0)
                notes_out.append({
                    "pitch": _midi_name(midi), "pitch_midi": midi,
                    "duration": dur, "measure": meas, "beat": beat,
                })
        else:
            # Neutral walking: quarter notes, step-wise toward next chord
            next_degree = prog[meas] if meas < len(prog) else prog[0]
            next_root = _chord_notes(key, mode, next_degree, octave=2)[0]
            walk = _walk(root, next_root, beats, bass_pitches, rng)
            for b_idx, midi in enumerate(walk):
                notes_out.append({
                    "pitch": _midi_name(midi), "pitch_midi": midi,
                    "duration": 1.0, "measure": meas, "beat": float(b_idx + 1),
                })

        prev_midi = root

    return notes_out


def _walk(start: int, end: int, steps: int, pool: list[int], rng: random.Random) -> list[int]:
    """Walk from start to end in `steps` steps, staying within pool."""
    if not pool:
        return [start] * steps
    result = []
    cur = min(pool, key=lambda p: abs(p - start))
    target = min(pool, key=lambda p: abs(p - end))
    for i in range(steps):
        result.append(cur)
        remaining = steps - i - 1
        if remaining == 0:
            break
        # Move toward target
        direction = 1 if target > cur else -1
        candidates = [p for p in pool if (p - cur) * direction > 0 and abs(p - cur) <= 2]
        if candidates:
            cur = min(candidates, key=lambda p: abs(p - cur))
        else:
            cur = target
    return result


def _contextual_drums(
    time_sig: str, measures: int, style: str, rng: random.Random
) -> dict[str, list[int]]:
    """
    Context-aware drum pattern that evolves over measures.
    Fills, accents, and variations are added structurally.
    """
    beats = int(time_sig.split("/")[0])
    steps = beats * 4  # 16th-note resolution per measure

    kit_keys = ["kick", "snare", "hihat", "open_hat", "crash", "tom"]
    # We store measures * steps for richer patterns
    pattern: dict[str, list[int]] = {k: [0] * (steps * measures) for k in kit_keys}

    for meas in range(measures):
        offset = meas * steps
        is_first = (meas == 0)
        is_last_of_phrase = ((meas + 1) % 4 == 0)
        is_phrase_start = (meas % 4 == 0)

        if is_phrase_start:
            pattern["crash"][offset] = 1

        for i in range(steps):
            gi = offset + i   # global index

            # Kick
            if style == "rhythmic":
                if i in (0, 6, 8, 14): pattern["kick"][gi] = 1
            elif style == "lyrical":
                if i in (0, 8): pattern["kick"][gi] = 1
            else:
                if i in (0, 8): pattern["kick"][gi] = 1
                if i == 10 and rng.random() > 0.5: pattern["kick"][gi] = 1

            # Snare (backbeat)
            if i in (4, 12):
                pattern["snare"][gi] = 1
            # Ghost snare
            if rng.random() > 0.85 and i not in (4, 12):
                pattern["snare"][gi] = 1

            # Hi-hat
            if style == "lyrical":
                if i % 4 == 0: pattern["hihat"][gi] = 1
            elif style == "rhythmic":
                if i % 2 == 0: pattern["hihat"][gi] = 1
            else:
                if i % 2 == 0: pattern["hihat"][gi] = 1
            # Open hat on upbeats in even measures
            if meas % 2 == 1 and i in (6, 14):
                pattern["open_hat"][gi] = 1
                pattern["hihat"][gi] = 0  # mute hihat when open hat hits

        # Fill on last measure of phrase
        if is_last_of_phrase:
            fill_start = offset + steps - 4
            for fi in range(4):
                pattern["tom"][fill_start + fi] = 1
                pattern["kick"][fill_start + fi] = 0
                pattern["snare"][fill_start + fi] = 0

    # Trim to 16 steps (one measure worth) for the frontend's 16-step view
    # by collapsing to the most representative measure (measure 1 + any fills from last)
    result: dict[str, list[int]] = {}
    display_steps = steps
    for k in kit_keys:
        result[k] = pattern[k][:display_steps]
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Legacy music21 + pure-Python fallback (still used as engine for melody)
# ─────────────────────────────────────────────────────────────────────────────

def _try_music21_generate(
    key: str, mode: str, measures: int, seed_notes: list[str],
    prog: list[int], style: str
) -> list[dict] | None:
    try:
        from music21 import key as m21key
        k = m21key.Key(key, mode)
        sc = k.getScale()
        available = [p.midi for p in sc.getPitches("C4", "C6")]
        if not available:
            return None
        rng = random.Random(42)
        notes_out, _ = _contextual_melody(key, mode, measures, "4/4", style, seed_notes, rng)
        return notes_out
    except Exception:
        return None


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
                    f'        <time><beats>{beats_str}</beats><beat-type>{beat_type}</beat-type></time>',
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
                    oct_xml = int(m.group(2))
                    step = step_acc[0]
                    alter = ("<alter>1</alter>" if "#" in step_acc
                             else "<alter>-1</alter>" if "b" in step_acc else "")
                    lines += [
                        f'      <note>',
                        f'        <pitch><step>{step}</step>{alter}<octave>{oct_xml}</octave></pitch>',
                        f'        <duration>{dur_divs}</duration>',
                        f'        <type>{_dur_type(n.get("duration", 1.0))}</type>',
                        f'      </note>',
                    ]
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
# Routes — Compositions
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/compositions", status_code=201)
def create_composition(body: CompositionCreate, user=Depends(get_current_user)):
    if DATABASE_URL:
        with get_conn() as conn:
            cur = conn.execute(
                "INSERT INTO compositions (user_id, title, key, mode, tempo, time_signature, measures) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                (user.id, body.title, body.key, body.mode, body.tempo, body.time_signature, body.measures)
            )
            comp_id = cur.lastrowid
    else:
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
        comp = conn.execute(
            "SELECT * FROM compositions WHERE id=? AND user_id=?", (comp_id, user.id)
        ).fetchone()
        if not comp:
            raise HTTPException(404, "Composition not found")
        parts = conn.execute(
            "SELECT * FROM composition_parts WHERE composition_id=?", (comp_id,)
        ).fetchall()
        drum = conn.execute(
            "SELECT * FROM drum_patterns WHERE composition_id=?", (comp_id,)
        ).fetchone()
        rolls = conn.execute(
            "SELECT * FROM piano_rolls WHERE composition_id=?", (comp_id,)
        ).fetchall()
    return {
        "id": comp["id"], "title": comp["title"], "key": comp["key"],
        "mode": comp["mode"], "tempo": comp["tempo"],
        "time_signature": comp["time_signature"], "measures": comp["measures"],
        "parts": [{"role": p["role"], "instrument": p["instrument"],
                   "notes": json.loads(p["notes_json"])} for p in parts],
        "drum_pattern": {
            "pattern": json.loads(drum["pattern_json"]),
            "steps": drum["steps"], "swing": drum["swing"],
        } if drum else None,
        "piano_rolls": [
            {"part_role": r["part_role"], "cells": json.loads(r["cells_json"])} for r in rolls
        ],
    }


@router.put("/compositions/{comp_id}")
def update_composition(comp_id: int, body: CompositionCreate, user=Depends(get_current_user)):
    _assert_owns(comp_id, user)
    if DATABASE_URL:
        with get_conn() as conn:
            conn.execute(
                "UPDATE compositions SET title=%s, key=%s, mode=%s, tempo=%s, time_signature=%s, measures=%s, updated_at=CURRENT_TIMESTAMP WHERE id=%s AND user_id=%s",
                (body.title, body.key, body.mode, body.tempo, body.time_signature, body.measures, comp_id, user.id)
            )
    else:
        with get_conn() as conn:
            conn.execute(
                "UPDATE compositions SET title=?, key=?, mode=?, tempo=?, time_signature=?, measures=?, updated_at=datetime('now') WHERE id=? AND user_id=?",
                (body.title, body.key, body.mode, body.tempo, body.time_signature, body.measures, comp_id, user.id)
            )
    return {"ok": True}


@router.delete("/compositions/{comp_id}", status_code=204)
def delete_composition(comp_id: int, user=Depends(get_current_user)):
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM compositions WHERE id=? AND user_id=?", (comp_id, user.id)
        )

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
        conn.execute(
            "DELETE FROM composition_parts WHERE composition_id=? AND role=?", (comp_id, role)
        )

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
                """INSERT INTO drum_patterns (composition_id, pattern_json, steps, swing)
                   VALUES (%s,%s,%s,%s)
                   ON CONFLICT(composition_id) DO UPDATE SET
                   pattern_json=EXCLUDED.pattern_json, steps=EXCLUDED.steps,
                   swing=EXCLUDED.swing, updated_at=CURRENT_TIMESTAMP""",
                (comp_id, pj, body.steps, body.swing)
            )
    else:
        with get_conn() as conn:
            conn.execute(
                """INSERT INTO drum_patterns (composition_id, pattern_json, steps, swing)
                   VALUES (?,?,?,?)
                   ON CONFLICT(composition_id) DO UPDATE SET
                   pattern_json=excluded.pattern_json, steps=excluded.steps,
                   swing=excluded.swing, updated_at=datetime('now')""",
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
                """INSERT INTO piano_rolls (composition_id, part_role, cells_json)
                   VALUES (%s,%s,%s)
                   ON CONFLICT(composition_id, part_role) DO UPDATE SET
                   cells_json=EXCLUDED.cells_json, updated_at=CURRENT_TIMESTAMP""",
                (comp_id, body.part_role, cj)
            )
    else:
        with get_conn() as conn:
            conn.execute(
                """INSERT INTO piano_rolls (composition_id, part_role, cells_json)
                   VALUES (?,?,?)
                   ON CONFLICT(composition_id, part_role) DO UPDATE SET
                   cells_json=excluded.cells_json, updated_at=datetime('now')""",
                (comp_id, body.part_role, cj)
            )
    return {"ok": True}

# ─────────────────────────────────────────────────────────────────────────────
# Routes — Contextual generation (local, no paid API)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/generate/melody")
def gen_melody(body: GenerateRequest, user=Depends(get_current_user)):
    rng = random.Random(42)
    notes, prog = _contextual_melody(
        body.key, body.mode, body.measures, body.time_signature, body.style, body.seed_notes, rng
    )
    m21_notes = _try_music21_generate(body.key, body.mode, body.measures, body.seed_notes, prog, body.style)
    engine = "music21" if m21_notes else "contextual_local"
    return {"role": "melody", "notes": notes, "progression": prog, "engine": engine}


@router.post("/generate/counter_melody")
def gen_counter(body: GenerateRequest, user=Depends(get_current_user)):
    rng = random.Random(99)
    # Build or infer a progression from existing melody
    if body.existing_melody:
        rng2 = random.Random(7)
        prog = _pick_progression(body.key, body.mode, body.measures, rng2)
    else:
        _, prog = _contextual_melody(body.key, body.mode, body.measures, body.time_signature, body.style, [], rng)
    notes = _contextual_counter_melody(
        body.existing_melody, body.key, body.mode, body.time_signature, prog, rng
    )
    return {"role": "counter_melody", "notes": notes, "engine": "contextual_local"}


@router.post("/generate/harmony")
def gen_harmony(body: GenerateRequest, user=Depends(get_current_user)):
    rng = random.Random(13)
    if body.existing_melody:
        prog = _pick_progression(body.key, body.mode, body.measures, rng)
    else:
        _, prog = _contextual_melody(body.key, body.mode, body.measures, body.time_signature, body.style, [], rng)
    notes = _contextual_harmony(body.key, body.mode, body.measures, body.time_signature, prog, body.style, rng)
    return {"role": "harmony", "notes": notes, "progression": prog, "engine": "contextual_local"}


@router.post("/generate/bass")
def gen_bass(body: GenerateRequest, user=Depends(get_current_user)):
    rng = random.Random(5)
    if body.existing_melody or body.existing_harmony:
        prog = _pick_progression(body.key, body.mode, body.measures, rng)
    else:
        _, prog = _contextual_melody(body.key, body.mode, body.measures, body.time_signature, body.style, [], rng)
    notes = _contextual_bass(body.key, body.mode, body.measures, body.time_signature, prog, body.style, rng)
    return {"role": "bass", "notes": notes, "engine": "contextual_local"}


@router.post("/generate/drums")
def gen_drums(body: GenerateRequest, user=Depends(get_current_user)):
    rng = random.Random(77)
    pattern = _contextual_drums(body.time_signature, body.measures, body.style, rng)
    return {"role": "drums", "pattern": pattern, "steps": len(list(pattern.values())[0]), "engine": "contextual_local"}


@router.post("/generate/all")
def gen_all(body: GenerateRequest, user=Depends(get_current_user)):
    """Generate all parts in one call, sharing a single chord progression for coherence."""
    rng = random.Random(42)
    melody, prog = _contextual_melody(
        body.key, body.mode, body.measures, body.time_signature, body.style, body.seed_notes, rng
    )
    counter = _contextual_counter_melody(melody, body.key, body.mode, body.time_signature, prog, random.Random(99))
    harmony = _contextual_harmony(body.key, body.mode, body.measures, body.time_signature, prog, body.style, random.Random(13))
    bass    = _contextual_bass(body.key, body.mode, body.measures, body.time_signature, prog, body.style, random.Random(5))
    drums   = _contextual_drums(body.time_signature, body.measures, body.style, random.Random(77))
    return {
        "progression": prog,
        "parts": {
            "melody": melody,
            "counter_melody": counter,
            "harmony": harmony,
            "bass": bass,
        },
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
        content=xml,
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

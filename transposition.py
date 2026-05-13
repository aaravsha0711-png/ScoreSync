"""
core/transposition.py

Handles all instrument transposition logic.
- TRANSPOSITION_MAP:  instrument name → semitone offset (concert → written)
- transpose_musicxml: uses music21 to rewrite a MusicXML file for a given instrument
- transpose_score_bytes: convenience wrapper that returns transposed bytes
"""

from __future__ import annotations
import io
import tempfile
import os
from typing import Optional

# ── Semitone offsets: concert pitch → written pitch ──────────────────────────
# Positive = written is higher than concert (e.g. Bb clarinet sounds a M2 lower,
# so written is +2 semitones above concert).
TRANSPOSITION_MAP: dict[str, int] = {
    # Concert (C) instruments
    "Concert (C)":          0,
    "Piccolo":              12,
    "Flute":                0,
    "Alto Flute":          -5,
    "Oboe":                 0,
    "English Horn":        -7,
    "Bassoon":              0,
    "Contrabassoon":        0,
    "Piano":                0,
    "Organ":                0,
    "Harp":                 0,
    "Harpsichord":          0,
    "Celesta":             12,
    "Xylophone":           12,
    "Marimba":              0,
    "Vibraphone":           0,
    "Glockenspiel":        24,
    "Violin":               0,
    "Viola":                0,
    "Cello":                0,
    "Double Bass":          0,
    "Guitar":               0,
    "Bass Guitar":          0,
    # Bb instruments
    "Bb Trumpet":           2,
    "Bb Cornet":            2,
    "Flugelhorn":           2,
    "Bb Clarinet":          2,
    "Bb Bass Clarinet":    14,
    "Bass Clarinet (Bb)":  14,
    "Bb Soprano Sax":       2,
    "Bb Tenor Sax":        14,
    "Soprano Recorder":     0,
    # Eb instruments
    "Eb Trumpet":          -3,
    "Eb Alto Sax":          3,
    "Eb Baritone Sax":     -9,
    "Eb Clarinet":          3,
    # F instruments
    "F Horn":               7,
    "French Horn":          7,
    "Mellophone":           7,
    # Low brass / Concert pitch brass
    "Trombone":             0,
    "Bass Trombone":        0,
    "Alto Trombone":        0,
    "Tenor Trombone":       0,
    "Euphonium":            0,
    "Euphonium (Treble)": -14,
    "Baritone (Treble)": -14,
    "Tuba":                 0,
    "Contrabass Tuba":      0,
    "Sousaphone":           0,
    # Marching / Miscellaneous
    "Bugle":                2,
    "Drum Kit":             0,
    "Mallet Percussion":    0,
    "Timpani":              0,
    "Snare Drum":           0,
}


def semitones_for(instrument: str) -> int:
    """Return the concert→written semitone offset for a named instrument."""
    return TRANSPOSITION_MAP.get(instrument, 0)


def transpose_musicxml(xml_bytes: bytes, instrument: str) -> bytes:
    """
    Transpose a MusicXML file from concert pitch to the written pitch
    for the given instrument using music21.

    Returns the transposed MusicXML as bytes.
    Falls back to returning the original bytes if music21 is unavailable
    or the semitone offset is zero.
    """
    semitones = semitones_for(instrument)
    if semitones == 0:
        return xml_bytes

    try:
        import music21  # type: ignore
        from music21 import converter, interval  # type: ignore

        # Parse from bytes via a temp file (music21 needs a file path or stream)
        with tempfile.NamedTemporaryFile(suffix=".xml", delete=False) as tmp_in:
            tmp_in.write(xml_bytes)
            tmp_in_path = tmp_in.name

        score = converter.parse(tmp_in_path)
        os.unlink(tmp_in_path)

        # Build interval and transpose
        iv = interval.Interval(semitones)
        transposed = score.transpose(iv)

        # Export back to MusicXML
        with tempfile.NamedTemporaryFile(suffix=".xml", delete=False) as tmp_out:
            tmp_out_path = tmp_out.name

        transposed.write("musicxml", fp=tmp_out_path)
        with open(tmp_out_path, "rb") as f:
            result = f.read()
        os.unlink(tmp_out_path)
        return result

    except Exception as exc:
        # music21 unavailable or parse error — return original with a warning header
        warning = f"<!-- transposition skipped: {exc} -->\n".encode()
        return warning + xml_bytes


def concert_to_written_note(note_pc: int, instrument: str) -> int:
    """
    Given a concert-pitch pitch class (0-11) and instrument name,
    return the written pitch class the player needs to finger.
    """
    offset = semitones_for(instrument)
    return (note_pc + offset) % 12

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
    "Concert (C)":        0,
    "Bb Trumpet":         2,
    "Bb Clarinet":        2,
    "Bb Tenor Sax":      14,
    "Bb Soprano Sax":     2,
    "Eb Alto Sax":       -3,
    "Eb Baritone Sax":    9,
    "F Horn":             7,
    "Eb Trumpet":        -3,
    "Bass Clarinet (Bb)":14,
    "Flute":              0,
    "Oboe":               0,
    "Bassoon":            0,
    "Violin":             0,
    "Viola":              0,
    "Cello":              0,
    "Double Bass":        0,
    "Piano":              0,
    "Guitar":             0,
    "Tuba":               0,
    "Trombone":           0,
    "Euphonium":          0,
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

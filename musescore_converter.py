"""
analysis/musescore_converter.py

Converts MuseScore (.mscz / .mscx) files to MusicXML using the
MuseScore CLI (`mscore` or `musescore`).

The MuseScore desktop application must be installed on the server.
  - Linux:   sudo apt install musescore3   (or musescore4portable)
  - macOS:   brew install --cask musescore
  - Windows: winget install Musescore.Musescore

The binary is auto-detected from common installation paths.
Set the env var MUSESCORE_BIN to override.
"""

from __future__ import annotations
import os
import shutil
import subprocess
import tempfile
from pathlib import Path


# ── Binary detection ──────────────────────────────────────────────────────────

CANDIDATE_BINS = [
    "mscore",
    "mscore3",
    "mscore4",
    "musescore",
    "musescore3",
    "musescore4",
    "/usr/bin/mscore3",
    "/usr/bin/musescore3",
    "/Applications/MuseScore 4.app/Contents/MacOS/mscore",
    "/Applications/MuseScore 3.app/Contents/MacOS/mscore",
    r"C:\Program Files\MuseScore 4\bin\MuseScore4.exe",
    r"C:\Program Files\MuseScore 3\bin\MuseScore3.exe",
]


def _find_musescore_bin() -> str | None:
    override = os.environ.get("MUSESCORE_BIN")
    if override:
        return override if Path(override).exists() else None
    for candidate in CANDIDATE_BINS:
        found = shutil.which(candidate) or (Path(candidate).exists() and candidate)
        if found:
            return str(found)
    return None


MUSESCORE_BIN: str | None = _find_musescore_bin()


class MuseScoreNotInstalled(RuntimeError):
    """Raised when no MuseScore binary can be located."""


class ConversionError(RuntimeError):
    """Raised when MuseScore CLI returns a non-zero exit code."""


def is_available() -> bool:
    """Return True if a MuseScore binary is found on this system."""
    return MUSESCORE_BIN is not None


def convert_to_musicxml(mscz_bytes: bytes, source_ext: str = ".mscz") -> bytes:
    """
    Convert MuseScore file bytes to MusicXML bytes.

    Parameters
    ----------
    mscz_bytes  : raw bytes of the .mscz or .mscx file
    source_ext  : '.mscz' (compressed) or '.mscx' (uncompressed XML)

    Returns
    -------
    MusicXML bytes (UTF-8 encoded XML)

    Raises
    ------
    MuseScoreNotInstalled  — binary not found
    ConversionError        — MuseScore exited with an error
    """
    if not is_available():
        raise MuseScoreNotInstalled(
            "MuseScore is not installed or not on PATH. "
            "Install MuseScore 3/4 and ensure `mscore` is accessible, "
            "or set the MUSESCORE_BIN environment variable."
        )

    with tempfile.TemporaryDirectory() as tmpdir:
        src_path = Path(tmpdir) / f"input{source_ext}"
        out_path = Path(tmpdir) / "output.xml"

        src_path.write_bytes(mscz_bytes)

        result = subprocess.run(
            [MUSESCORE_BIN, "--export-to", str(out_path), str(src_path)],
            capture_output=True,
            timeout=60,
        )

        if result.returncode != 0:
            stderr = result.stderr.decode(errors="replace")
            raise ConversionError(
                f"MuseScore exited with code {result.returncode}: {stderr[:500]}"
            )

        if not out_path.exists():
            raise ConversionError(
                "MuseScore ran successfully but produced no output file. "
                "This can happen with corrupted or version-incompatible .mscz files."
            )

        return out_path.read_bytes()


def convert_to_pdf(mscz_bytes: bytes, source_ext: str = ".mscz") -> bytes:
    """
    Convert MuseScore file bytes to PDF bytes.
    Useful for rendering scores that the frontend displays as PDF.
    """
    if not is_available():
        raise MuseScoreNotInstalled("MuseScore binary not found.")

    with tempfile.TemporaryDirectory() as tmpdir:
        src_path = Path(tmpdir) / f"input{source_ext}"
        out_path = Path(tmpdir) / "output.pdf"

        src_path.write_bytes(mscz_bytes)

        result = subprocess.run(
            [MUSESCORE_BIN, "--export-to", str(out_path), str(src_path)],
            capture_output=True,
            timeout=60,
        )

        if result.returncode != 0:
            stderr = result.stderr.decode(errors="replace")
            raise ConversionError(f"MuseScore PDF export failed (code {result.returncode}): {stderr[:500]}")

        if not out_path.exists():
            raise ConversionError("MuseScore produced no PDF output.")

        return out_path.read_bytes()

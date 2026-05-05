"""
routers/scores.py

POST /scores/upload        — upload PDF / MusicXML / MuseScore file
POST /scores/analyze       — run stylistic analysis on uploaded MusicXML bytes
POST /scores/transpose     — return transposed MusicXML for user's instrument
POST /scores/musescore     — convert .mscz/.mscx → MusicXML (requires MuseScore CLI)
GET  /scores/musescore/status — check whether MuseScore binary is available
"""

from __future__ import annotations
import io
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response

from core.deps import get_current_user
from core.transposition import transpose_musicxml, semitones_for
from analysis.stylistic import analyze_musicxml
from analysis.musescore_converter import (
    convert_to_musicxml,
    convert_to_pdf,
    is_available as musescore_available,
    MuseScoreNotInstalled,
    ConversionError,
)
from db.database import get_conn

router = APIRouter(prefix="/scores", tags=["scores"])

UPLOAD_DIR = Path(os.environ.get("SCORESYNC_UPLOAD_DIR", "uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB


# ── Helpers ────────────────────────────────────────────────────────────────────

def _save_upload(user_id: int, filename: str, file_type: str, data: bytes) -> str:
    ext = Path(filename).suffix.lower()
    stored_name = f"{user_id}_{uuid.uuid4().hex}{ext}"
    stored_path = UPLOAD_DIR / stored_name
    stored_path.write_bytes(data)
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO score_uploads (user_id, filename, file_type, stored_path) VALUES (?,?,?,?)",
            (user_id, filename, file_type, str(stored_path)),
        )
    return str(stored_path)


def _detect_type(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    return {
        ".pdf": "pdf",
        ".xml": "musicxml",
        ".musicxml": "musicxml",
        ".mxl": "musicxml",
        ".mscz": "musescore",
        ".mscx": "musescore",
    }.get(ext, "unknown")


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_score(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """
    Accept PDF, MusicXML, or MuseScore file.
    Stores the file and returns metadata + file_type.
    For MuseScore files, also attempts conversion immediately if the
    MuseScore CLI is available.
    """
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 50 MB)")

    file_type = _detect_type(file.filename or "")
    if file_type == "unknown":
        raise HTTPException(
            status_code=422,
            detail="Unsupported file type. Accepted: .pdf, .xml, .musicxml, .mxl, .mscz, .mscx",
        )

    stored_path = _save_upload(current_user["id"], file.filename or "score", file_type, data)
    response: dict = {
        "filename": file.filename,
        "file_type": file_type,
        "size_bytes": len(data),
        "stored": True,
    }

    # Auto-convert MuseScore if possible
    if file_type == "musescore" and musescore_available():
        ext = Path(file.filename or "").suffix.lower()
        try:
            xml_bytes = convert_to_musicxml(data, source_ext=ext)
            response["converted_to"] = "musicxml"
            response["musicxml_base64"] = __import__("base64").b64encode(xml_bytes).decode()
        except ConversionError as e:
            response["conversion_warning"] = str(e)

    return response


@router.post("/analyze")
async def analyze_score(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """
    Accept a MusicXML file and return the full StyleReport.
    Zero-API: all analysis is done locally with the rule-based engine.
    """
    data = await file.read()
    ext = Path(file.filename or "").suffix.lower()

    if ext not in (".xml", ".musicxml", ".mxl"):
        raise HTTPException(
            status_code=422,
            detail="Stylistic analysis requires a MusicXML file (.xml, .musicxml, .mxl)",
        )

    report = analyze_musicxml(data)
    return report.to_dict()


@router.post("/transpose")
async def transpose_score(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """
    Accept a MusicXML file and return a transposed version for the
    user's registered instrument (concert → written pitch).
    Requires music21 to be installed.
    """
    data = await file.read()
    ext = Path(file.filename or "").suffix.lower()
    if ext not in (".xml", ".musicxml", ".mxl"):
        raise HTTPException(
            status_code=422,
            detail="Transposition requires a MusicXML file.",
        )

    # Look up user's instrument
    with get_conn() as conn:
        prof = conn.execute(
            "SELECT instrument, transposition FROM profiles WHERE user_id=?",
            (current_user["id"],),
        ).fetchone()

    if not prof:
        raise HTTPException(status_code=404, detail="Profile not found")

    instrument = prof["instrument"]
    semitones = semitones_for(instrument)

    if semitones == 0:
        # No transposition needed — return original
        return Response(
            content=data,
            media_type="application/xml",
            headers={
                "Content-Disposition": f'attachment; filename="score_concert.xml"',
                "X-Transposition-Semitones": "0",
                "X-Instrument": instrument,
            },
        )

    transposed = transpose_musicxml(data, instrument)
    fname = f"score_{instrument.replace(' ', '_').replace('(', '').replace(')', '')}.xml"
    return Response(
        content=transposed,
        media_type="application/xml",
        headers={
            "Content-Disposition": f'attachment; filename="{fname}"',
            "X-Transposition-Semitones": str(semitones),
            "X-Instrument": instrument,
        },
    )


@router.post("/musescore")
async def convert_musescore(
    file: UploadFile = File(...),
    output_format: str = "xml",   # 'xml' | 'pdf'
    current_user: dict = Depends(get_current_user),
):
    """
    Convert a MuseScore file to MusicXML or PDF using the local MuseScore CLI.
    Returns the converted bytes.
    """
    if not musescore_available():
        raise HTTPException(
            status_code=503,
            detail=(
                "MuseScore is not installed on this server. "
                "Install MuseScore 3 or 4 and restart the server. "
                "See: https://musescore.org/en/download"
            ),
        )

    data = await file.read()
    ext = Path(file.filename or "").suffix.lower()
    if ext not in (".mscz", ".mscx"):
        raise HTTPException(status_code=422, detail="Expected a .mscz or .mscx file")

    try:
        if output_format == "pdf":
            result = convert_to_pdf(data, source_ext=ext)
            return Response(
                content=result,
                media_type="application/pdf",
                headers={"Content-Disposition": 'attachment; filename="score.pdf"'},
            )
        else:
            result = convert_to_musicxml(data, source_ext=ext)
            return Response(
                content=result,
                media_type="application/xml",
                headers={"Content-Disposition": 'attachment; filename="score.xml"'},
            )
    except ConversionError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/musescore/status")
def musescore_status(_: dict = Depends(get_current_user)):
    """Check whether the MuseScore CLI is available on this server."""
    from analysis.musescore_converter import MUSESCORE_BIN
    return {
        "available": musescore_available(),
        "binary": MUSESCORE_BIN,
        "note": (
            "MuseScore conversion is active."
            if musescore_available()
            else "MuseScore not found. Install MuseScore 3/4 or set MUSESCORE_BIN env var."
        ),
    }

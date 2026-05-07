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
import re
import uuid
import wave
import struct
import math
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response

from core.deps import get_current_user
from core.transposition import transpose_musicxml, semitones_for
from stylistic import analyze_musicxml, analyze_audio_performance, load_audio_bytes
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

def _save_upload(user_id, filename, file_type, data):
    ext = Path(filename).suffix.lower()
    stored_name = "{}_{}{}".format(user_id, uuid.uuid4().hex, ext)
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


@router.post("/analyze/audio")
async def analyze_audio_performance_route(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """
    Accept an audio file and return performance analysis from Librosa.
    Supports WAV/MP3/FLAC/OGG/M4A input. The backend extracts dynamics,
    vibrato, and attack/release characteristics.
    """
    data = await file.read()
    ext = Path(file.filename or "").suffix.lower()
    supported = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac"}
    if ext not in supported:
        raise HTTPException(
            status_code=422,
            detail="Audio analysis requires WAV, MP3, FLAC, OGG, M4A, or AAC audio file.",
        )

    try:
        audio, sr = load_audio_bytes(data)
        report = analyze_audio_performance(audio, sr)
        return report
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Audio analysis failed: {str(e)}")


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


@router.post("/metronome")
async def generate_metronome(
    tempo_bpm: int,
    time_signature: str = "4/4",
    duration_beats: int = 8,
    current_user: dict = Depends(get_current_user),
):
    """
    Generate a simple metronome click track (WAV).
    Parameters:
    - tempo_bpm: Beats per minute
    - time_signature: e.g., "4/4", "3/4", "6/8"
    - duration_beats: Number of beats to generate
    
    Returns WAV file with metronome clicks.
    """
    sample_rate = 44100
    frequency = 1000  # Hz
    beat_duration = 60 / tempo_bpm  # seconds per beat
    samples_per_beat = int(sample_rate * beat_duration)
    click_length = int(sample_rate * 0.05)  # 50ms clicks
    
    audio_data = bytearray()
    beats_per_measure = int(time_signature.split("/")[0])
    
    for beat in range(duration_beats):
        # Accent first beat of measure (louder)
        is_accented = (beat % beats_per_measure) == 0
        amplitude = 32000 if is_accented else 16000
        
        # Generate sine wave click
        for i in range(click_length):
            phase = 2 * math.pi * frequency * i / sample_rate
            sample = int(amplitude * math.sin(phase))
            audio_data.extend(struct.pack('<h', sample))
        
        # Silence until next beat
        silence = samples_per_beat - click_length
        audio_data.extend(b'\x00' * (silence * 2))
    
    # Create WAV buffer
    wav_buffer = io.BytesIO()
    with wave.open(wav_buffer, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(bytes(audio_data))
    
    wav_bytes = wav_buffer.getvalue()
    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={"Content-Disposition": "attachment; filename=\"metronome.wav\""},
    )


@router.post("/rhythm-info")
async def get_rhythm_info(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """
    Extract detailed rhythm, time signature, tempo, and marking information.
    Returns RhythmInfo with all timing details.
    """
    data = await file.read()
    ext = Path(file.filename or "").suffix.lower()
    
    if ext not in (".xml", ".musicxml", ".mxl"):
        raise HTTPException(
            status_code=422,
            detail="Rhythm analysis requires a MusicXML file.",
        )
    
    report = analyze_musicxml(data)
    return {
        "rhythm_info": report.rhythm_info.to_dict() if report.rhythm_info else None,
        "rest_alerts": [r.to_dict() for r in (report.rest_alerts or [])],
        "complex_markings": [m.to_dict() for m in (report.complex_markings or [])],
        "rehearsal_letters": report.rehearsal_letters,
    }


@router.post("/extract-parts")
async def extract_parts(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """
    Extract individual instrumental parts from a score.
    Returns a list of available parts with their names and part IDs.
    """
    data = await file.read()
    ext = Path(file.filename or "").suffix.lower()
    
    if ext not in (".xml", ".musicxml", ".mxl"):
        raise HTTPException(
            status_code=422,
            detail="Part extraction requires a MusicXML file.",
        )
    
    text = data.decode("utf-8", errors="ignore")
    
    # Extract part list
    parts = []
    part_list_match = re.search(r'<part-list>(.*?)</part-list>', text, re.S)
    if part_list_match:
        part_list_body = part_list_match.group(1)
        for score_part in re.finditer(r'<score-part\s+id="([^"]+)"[^>]*>(.*?)</score-part>', part_list_body, re.S):
            part_id = score_part.group(1)
            part_body = score_part.group(2)
            
            # Extract part name
            name_match = re.search(r'<part-name[^>]*>([^<]+)</part-name>', part_body)
            part_name = name_match.group(1) if name_match else f"Part {part_id}"
            
            # Extract abbreviation
            abbr_match = re.search(r'<part-abbreviation[^>]*>([^<]+)</part-abbreviation>', part_body)
            part_abbr = abbr_match.group(1) if abbr_match else part_name[:3]
            
            # Extract instrument
            instr_match = re.search(r'<score-instrument\s+id="[^"]*"[^>]*>\s*<instrument-name[^>]*>([^<]+)</instrument-name>', part_body)
            instrument = instr_match.group(1) if instr_match else "Unknown"
            
            parts.append({
                "id": part_id,
                "name": part_name,
                "abbreviation": part_abbr,
                "instrument": instrument,
            })
    
    return {"parts": parts}


@router.post("/training/synthesize")
async def generate_synthesizer_track(
    file: UploadFile = File(...),
    tempo_override: int | None = None,
    current_user: dict = Depends(get_current_user),
):
    """
    Generate a synthesized audio track from MusicXML score for training.
    Uses basic note generation to create a reference playback.
    
    Returns WAV file with synthesized performance.
    Phase 2: Full integration with score markings and dynamics.
    """
    data = await file.read()
    ext = Path(file.filename or "").suffix.lower()
    
    if ext not in (".xml", ".musicxml", ".mxl"):
        raise HTTPException(
            status_code=422,
            detail="Synthesizer requires a MusicXML file.",
        )
    
    text = data.decode("utf-8", errors="ignore")
    
    # Extract tempo from score
    tempo_match = re.search(r'<metronome>[\s\S]*?<per-minute>(\d+)</per-minute>', text)
    tempo_bpm = tempo_override or (int(tempo_match.group(1)) if tempo_match else 120)
    
    # Extract time signature
    time_sig_match = re.search(r'<time>\s*<beats>(\d+)</beats>\s*<beat-type>(\d+)</beat-type>', text)
    beats_per_measure = int(time_sig_match.group(1)) if time_sig_match else 4
    beat_unit = int(time_sig_match.group(2)) if time_sig_match else 4
    
    # Generate synthesized audio (simplified: just metronome for now)
    sample_rate = 44100
    beat_duration = 60 / tempo_bpm
    
    # Count notes for duration estimation
    note_count = len(re.findall(r'<note\b', text))
    estimated_beats = max(8, min(note_count // 4, 64))  # Estimate 4 notes per beat
    
    audio_data = bytearray()
    frequency = 880  # A5 for synthesizer
    
    for beat in range(estimated_beats):
        is_accented = (beat % beats_per_measure) == 0
        amplitude = 24000 if is_accented else 12000
        samples_per_beat = int(sample_rate * beat_duration)
        note_length = int(samples_per_beat * 0.8)  # 80% of beat
        
        # Generate note
        for i in range(note_length):
            phase = 2 * math.pi * frequency * i / sample_rate
            sample = int(amplitude * math.sin(phase))
            audio_data.extend(struct.pack('<h', sample))
        
        # Silence
        silence = samples_per_beat - note_length
        audio_data.extend(b'\x00' * (silence * 2))
    
    # Create WAV
    wav_buffer = io.BytesIO()
    with wave.open(wav_buffer, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(bytes(audio_data))
    
    return Response(
        content=wav_buffer.getvalue(),
        media_type="audio/wav",
        headers={"Content-Disposition": "attachment; filename=\"synthesizer_track.wav\""},
    )


@router.post("/training/segments")
async def extract_training_segments(
    file: UploadFile = File(...),
    segment_size: int = 4,
    current_user: dict = Depends(get_current_user),
):
    """
    Break score into practice segments.
    segment_size: number of measures per segment
    
    Returns list of segments with timing info.
    Phase 2: Generate individual segment playback files.
    """
    data = await file.read()
    ext = Path(file.filename or "").suffix.lower()
    
    if ext not in (".xml", ".musicxml", ".mxl"):
        raise HTTPException(
            status_code=422,
            detail="Segment extraction requires a MusicXML file.",
        )
    
    text = data.decode("utf-8", errors="ignore")
    
    # Extract measures
    measures = []
    measure_pattern = r'<measure\b[^>]*number="([^"]*)"[^>]*>(.*?)</measure>'
    
    for match in re.finditer(measure_pattern, text, re.S):
        measure_num = int(match.group(1)) if match.group(1).isdigit() else 1
        measure_body = match.group(2)
        measures.append({
            "number": measure_num,
            "hasRests": bool(re.search(r'<rest\b', measure_body)),
            "hasAccents": bool(re.search(r'<accent', measure_body)),
        })
    
    # Group into segments
    segments = []
    for i in range(0, len(measures), segment_size):
        segment_measures = measures[i:i+segment_size]
        start_measure = segment_measures[0]["number"]
        end_measure = segment_measures[-1]["number"]
        
        segments.append({
            "segment_id": len(segments) + 1,
            "start_measure": start_measure,
            "end_measure": end_measure,
            "measure_count": len(segment_measures),
            "markings": {
                "hasRests": any(m["hasRests"] for m in segment_measures),
                "hasAccents": any(m["hasAccents"] for m in segment_measures),
            },
        })
    
    return {"segments": segments, "total_segments": len(segments)}

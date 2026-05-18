"""
routers/profile.py

GET  /profile              — fetch instrument + calibration status
PUT  /profile/instrument   — set instrument + compute transposition
POST /profile/calibration  — save a full calibration session (all scales)
GET  /profile/calibration  — retrieve stored calibration summary
DELETE /profile/calibration — clear calibration, reset to uncalibrated
"""

from __future__ import annotations
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from deps import get_current_user
from transposition import TRANSPOSITION_MAP, semitones_for
from database import get_conn, IS_PG

router = APIRouter(prefix="/profile", tags=["profile"])


def _ph() -> str:
    return "%s" if IS_PG else "?"


def _now() -> str:
    return "CURRENT_TIMESTAMP" if IS_PG else "datetime('now')"


# ── Schemas ───────────────────────────────────────────────────────────────────

class InstrumentRequest(BaseModel):
    instrument: str


class NoteEntry(BaseModel):
    note_name: str
    detected_freq: float
    cents_deviation: float = 0.0
    seq_index: int = 0


class ScaleCalibration(BaseModel):
    scale_name: str
    scale_type: str        # 'major' | 'meyer_v1' | 'meyer_v2' | 'meyer_v3'
    scale_root: int        # 0–11
    notes: list[NoteEntry]


class CalibrationRequest(BaseModel):
    sessions: list[ScaleCalibration]


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("")
def get_profile(current_user: dict = Depends(get_current_user)):
    ph = _ph()
    with get_conn() as conn:
        row = conn.execute(
            f"SELECT instrument, transposition, calibrated FROM profiles WHERE user_id = {ph}",
            (current_user["id"],),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Profile not found")
    return {
        "instrument": row["instrument"],
        "transposition": row["transposition"],
        "calibrated": bool(row["calibrated"]),
        "available_instruments": list(TRANSPOSITION_MAP.keys()),
    }


@router.put("/instrument")
def set_instrument(
    body: InstrumentRequest,
    current_user: dict = Depends(get_current_user),
):
    if body.instrument not in TRANSPOSITION_MAP:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown instrument. Valid options: {list(TRANSPOSITION_MAP.keys())}",
        )
    semitones = semitones_for(body.instrument)
    ph = _ph()
    ts = _now()
    if IS_PG:
        upsert = (
            f"INSERT INTO profiles (user_id, instrument, transposition) VALUES ({ph},{ph},{ph}) "
            f"ON CONFLICT(user_id) DO UPDATE SET instrument=EXCLUDED.instrument, "
            f"transposition=EXCLUDED.transposition, updated_at={ts}"
        )
    else:
        upsert = (
            f"INSERT INTO profiles (user_id, instrument, transposition) VALUES ({ph},{ph},{ph}) "
            f"ON CONFLICT(user_id) DO UPDATE SET instrument=excluded.instrument, "
            f"transposition=excluded.transposition, updated_at={ts}"
        )
    with get_conn() as conn:
        conn.execute(upsert, (current_user["id"], body.instrument, semitones))
    return {
        "instrument": body.instrument,
        "transposition_semitones": semitones,
        "concert_to_written": semitones,
        "note": (
            "No transposition needed — concert pitch instrument."
            if semitones == 0
            else f"Written parts are {abs(semitones)} semitone(s) {'higher' if semitones > 0 else 'lower'} than concert pitch."
        ),
    }


@router.post("/calibration", status_code=status.HTTP_201_CREATED)
def save_calibration(
    body: CalibrationRequest,
    current_user: dict = Depends(get_current_user),
):
    """Store all calibration sessions (idempotent — clears old data first)."""
    user_id = current_user["id"]
    ph = _ph()
    ts = _now()
    with get_conn() as conn:
        old_sessions = conn.execute(
            f"SELECT id FROM calibration_sessions WHERE user_id = {ph}", (user_id,)
        ).fetchall()
        for s in old_sessions:
            conn.execute(f"DELETE FROM calibration_notes WHERE session_id = {ph}", (s["id"],))
        conn.execute(f"DELETE FROM calibration_sessions WHERE user_id = {ph}", (user_id,))

        for sess in body.sessions:
            if IS_PG:
                row = conn.execute(
                    "INSERT INTO calibration_sessions (user_id, scale_name, scale_type, scale_root) VALUES (%s,%s,%s,%s) RETURNING id",
                    (user_id, sess.scale_name, sess.scale_type, sess.scale_root),
                ).fetchone()
                session_id = row["id"]
            else:
                cur = conn.execute(
                    "INSERT INTO calibration_sessions (user_id, scale_name, scale_type, scale_root) VALUES (?,?,?,?)",
                    (user_id, sess.scale_name, sess.scale_type, sess.scale_root),
                )
                session_id = cur.lastrowid
            for note in sess.notes:
                conn.execute(
                    f"INSERT INTO calibration_notes (session_id, note_name, detected_freq, cents_deviation, seq_index) VALUES ({ph},{ph},{ph},{ph},{ph})",
                    (session_id, note.note_name, note.detected_freq, note.cents_deviation, note.seq_index),
                )

        conn.execute(
            f"UPDATE profiles SET calibrated=1, updated_at={ts} WHERE user_id={ph}",
            (user_id,),
        )

    return {
        "sessions_saved": len(body.sessions),
        "calibrated": True,
    }


@router.get("/calibration")
def get_calibration(current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    ph = _ph()
    with get_conn() as conn:
        sessions = conn.execute(
            f"SELECT id, scale_name, scale_type, scale_root FROM calibration_sessions WHERE user_id={ph}",
            (user_id,),
        ).fetchall()

        if not sessions:
            return {"calibrated": False, "sessions": [], "tuning_tendency": None}

        all_notes = conn.execute(
            f"SELECT cn.note_name, cn.cents_deviation FROM calibration_notes cn "
            f"JOIN calibration_sessions cs ON cn.session_id = cs.id WHERE cs.user_id = {ph}",
            (user_id,),
        ).fetchall()

    # Average deviation per note
    note_devs: dict[str, list[float]] = {}
    for row in all_notes:
        note_devs.setdefault(row["note_name"], []).append(row["cents_deviation"])
    note_avgs = {n: sum(v)/len(v) for n, v in note_devs.items()}

    # Overall tendency
    if note_avgs:
        overall = sum(note_avgs.values()) / len(note_avgs)
        tendency = "sharp" if overall > 5 else "flat" if overall < -5 else "centred"
    else:
        overall = 0.0
        tendency = "centred"

    return {
        "calibrated": True,
        "sessions_count": len(sessions),
        "note_averages_cents": note_avgs,
        "overall_average_cents": round(overall, 2),
        "tuning_tendency": tendency,
        "sessions": [
            {"scale_name": s["scale_name"], "scale_type": s["scale_type"]}
            for s in sessions
        ],
    }


@router.delete("/calibration", status_code=status.HTTP_204_NO_CONTENT)
def clear_calibration(current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    ph = _ph()
    ts = _now()
    with get_conn() as conn:
        old = conn.execute(
            f"SELECT id FROM calibration_sessions WHERE user_id={ph}", (user_id,)
        ).fetchall()
        for s in old:
            conn.execute(f"DELETE FROM calibration_notes WHERE session_id={ph}", (s["id"],))
        conn.execute(f"DELETE FROM calibration_sessions WHERE user_id={ph}", (user_id,))
        conn.execute(
            f"UPDATE profiles SET calibrated=0, updated_at={ts} WHERE user_id={ph}",
            (user_id,),
        )

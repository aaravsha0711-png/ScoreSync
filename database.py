"""
db/database.py
SQLite persistence layer for ScoreSync.
Tables: users, profiles, calibration_sessions, calibration_notes
"""

import sqlite3
import os
from pathlib import Path

DB_PATH = Path(os.environ.get("SCORESYNC_DB", "scoresync.db"))


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    """Create all tables on first run."""
    with get_conn() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            email       TEXT    UNIQUE NOT NULL,
            name        TEXT    NOT NULL,
            hashed_pw   TEXT    NOT NULL,
            created_at  TEXT    DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS profiles (
            user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            instrument      TEXT    NOT NULL DEFAULT 'Concert (C)',
            transposition   INTEGER NOT NULL DEFAULT 0,
            calibrated      INTEGER NOT NULL DEFAULT 0,
            updated_at      TEXT    DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS calibration_sessions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            scale_name  TEXT    NOT NULL,
            scale_type  TEXT    NOT NULL,   -- 'major' | 'meyer_v1' | 'meyer_v2' | 'meyer_v3'
            scale_root  INTEGER NOT NULL,   -- 0-11 pitch class
            completed_at TEXT   DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS calibration_notes (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id      INTEGER NOT NULL REFERENCES calibration_sessions(id) ON DELETE CASCADE,
            note_name       TEXT    NOT NULL,
            detected_freq   REAL    NOT NULL,
            cents_deviation REAL    NOT NULL DEFAULT 0.0,
            seq_index       INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS score_uploads (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            filename    TEXT    NOT NULL,
            file_type   TEXT    NOT NULL,  -- 'pdf' | 'musicxml' | 'musescore'
            stored_path TEXT    NOT NULL,
            uploaded_at TEXT    DEFAULT (datetime('now'))
        );
        """)

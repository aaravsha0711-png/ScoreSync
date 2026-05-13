"""
database.py
PostgreSQL persistence for ScoreSync, with SQLite fallback for local development.
"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

DATABASE_URL = os.environ.get("DATABASE_URL")
SQLITE_PATH = Path(os.environ.get("SCORESYNC_DB", "scoresync.db"))


class PgRow(dict):
    def __getitem__(self, key):
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)


class PgCursor:
    def __init__(self, cursor, lastrowid=None):
        self._cursor = cursor
        self.lastrowid = lastrowid

    def fetchone(self):
        row = self._cursor.fetchone()
        return PgRow(row) if row else None

    def fetchall(self):
        return [PgRow(row) for row in self._cursor.fetchall()]


class PgConnection:
    def __init__(self):
        import psycopg2
        from psycopg2.extras import RealDictCursor
        self._conn = psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc_type:
            self._conn.rollback()
        else:
            self._conn.commit()
        self._conn.close()

    def execute(self, query, params=()):
        sql = query.replace("?", "%s").replace("datetime('now')", "CURRENT_TIMESTAMP")
        wants_id = _insert_needs_returning_id(sql)
        if wants_id:
            sql = f"{sql.rstrip()} RETURNING id"
        cur = self._conn.cursor()
        cur.execute(sql, params)
        lastrowid = None
        if wants_id:
            row = cur.fetchone()
            lastrowid = row["id"] if row else None
        return PgCursor(cur, lastrowid)

    def executescript(self, script):
        cur = self._conn.cursor()
        cur.execute(script)
        return PgCursor(cur)


def _insert_needs_returning_id(sql):
    compact = " ".join(sql.lower().split())
    prefixes = (
        "insert into users ",
        "insert into calibration_sessions ",
        "insert into shared_scores ",
    )
    return compact.startswith(prefixes) and " returning " not in compact


def _sqlite_conn():
    conn = sqlite3.connect(SQLITE_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def get_conn():
    return PgConnection() if DATABASE_URL else _sqlite_conn()


def init_db():
    if DATABASE_URL:
        with get_conn() as conn:
            conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, hashed_pw TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS profiles (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, instrument TEXT NOT NULL DEFAULT 'Concert (C)', transposition INTEGER NOT NULL DEFAULT 0, calibrated INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS calibration_sessions (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, scale_name TEXT NOT NULL, scale_type TEXT NOT NULL, scale_root INTEGER NOT NULL, completed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS calibration_notes (id SERIAL PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES calibration_sessions(id) ON DELETE CASCADE, note_name TEXT NOT NULL, detected_freq DOUBLE PRECISION NOT NULL, cents_deviation DOUBLE PRECISION NOT NULL DEFAULT 0.0, seq_index INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS score_uploads (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, filename TEXT NOT NULL, file_type TEXT NOT NULL, stored_path TEXT NOT NULL, uploaded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS shared_scores (id SERIAL PRIMARY KEY, score_id INTEGER NOT NULL REFERENCES score_uploads(id) ON DELETE CASCADE, owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, share_token TEXT UNIQUE NOT NULL, password_hash TEXT, expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, is_active BOOLEAN DEFAULT TRUE);
            """)
        return
    with get_conn() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, hashed_pw TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')));
        CREATE TABLE IF NOT EXISTS profiles (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, instrument TEXT NOT NULL DEFAULT 'Concert (C)', transposition INTEGER NOT NULL DEFAULT 0, calibrated INTEGER NOT NULL DEFAULT 0, updated_at TEXT DEFAULT (datetime('now')));
        CREATE TABLE IF NOT EXISTS calibration_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, scale_name TEXT NOT NULL, scale_type TEXT NOT NULL, scale_root INTEGER NOT NULL, completed_at TEXT DEFAULT (datetime('now')));
        CREATE TABLE IF NOT EXISTS calibration_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL REFERENCES calibration_sessions(id) ON DELETE CASCADE, note_name TEXT NOT NULL, detected_freq REAL NOT NULL, cents_deviation REAL NOT NULL DEFAULT 0.0, seq_index INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS score_uploads (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, filename TEXT NOT NULL, file_type TEXT NOT NULL, stored_path TEXT NOT NULL, uploaded_at TEXT DEFAULT (datetime('now')));
        CREATE TABLE IF NOT EXISTS shared_scores (id INTEGER PRIMARY KEY AUTOINCREMENT, score_id INTEGER NOT NULL REFERENCES score_uploads(id) ON DELETE CASCADE, owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, share_token TEXT UNIQUE NOT NULL, password_hash TEXT, expires_at TEXT, created_at TEXT DEFAULT (datetime('now')), is_active INTEGER DEFAULT 1);
        """)

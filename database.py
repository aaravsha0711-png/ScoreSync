"""
database.py - dual-mode connection layer.

PostgreSQL (Render / production): set DATABASE_URL to a postgres:// or
postgresql:// URL. SQLite (local dev): leave DATABASE_URL unset; this uses
scoresync.db in the working directory.

All callers use:

    with get_conn() as conn:
        conn.execute(sql, params)

For PostgreSQL, placeholders must be %s.
For SQLite, placeholders must be ?.
Use the IS_PG flag to branch when needed.
"""
from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from typing import Generator


DATABASE_URL: str = os.getenv("DATABASE_URL", "")

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = "postgresql://" + DATABASE_URL[len("postgres://"):]

IS_PG: bool = DATABASE_URL.startswith("postgresql://") or DATABASE_URL.startswith("postgresql+")

_pg_pool = None
_SQLITE_PATH = "scoresync.db"


def _get_pg_pool():
    global _pg_pool
    if _pg_pool is None:
        try:
            from psycopg2 import pool as pg_pool
            _pg_pool = pg_pool.ThreadedConnectionPool(1, 10, DATABASE_URL)
        except Exception as exc:
            raise RuntimeError(f"Could not connect to PostgreSQL: {exc}") from exc
    return _pg_pool


class _PgConnWrapper:
    def __init__(self, raw_conn):
        self._conn = raw_conn
        self._cursor = None

    def _cur(self):
        if self._cursor is None or self._cursor.closed:
            import psycopg2.extras
            self._cursor = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        return self._cursor

    def execute(self, sql: str, params=()):
        self._cur().execute(sql, params)
        return self

    def executescript(self, script: str):
        cursor = self._conn.cursor()
        for statement in script.split(";"):
            stmt = statement.strip()
            if stmt:
                cursor.execute(stmt)
        cursor.close()
        return self

    def fetchone(self):
        row = self._cur().fetchone()
        return dict(row) if row is not None else None

    def fetchall(self):
        return [dict(row) for row in self._cur().fetchall()]


@contextmanager
def get_conn() -> Generator:
    if IS_PG:
        pool = _get_pg_pool()
        raw = pool.getconn()
        raw.autocommit = False
        conn = _PgConnWrapper(raw)
        try:
            yield conn
            raw.commit()
        except Exception:
            raw.rollback()
            raise
        finally:
            pool.putconn(raw)
    else:
        raw = sqlite3.connect(_SQLITE_PATH, check_same_thread=False)
        raw.row_factory = sqlite3.Row
        raw.execute("PRAGMA journal_mode=WAL")
        raw.execute("PRAGMA foreign_keys=ON")
        try:
            yield raw
            raw.commit()
        except Exception:
            raw.rollback()
            raise
        finally:
            raw.close()


# Existing core schema omitted for brevity; init_db now also runs forward-only
# migrations that repair older databases in production.
_CORE_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    hashed_pw TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE,
    instrument TEXT NOT NULL DEFAULT 'Concert (C)',
    transposition INTEGER NOT NULL DEFAULT 0,
    calibrated INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS score_uploads (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    file_type TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP
);
"""


def _table_exists(conn, table_name: str) -> bool:
    if IS_PG:
        row = conn.execute(
            "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = %s",
            (table_name,),
        ).fetchone()
    else:
        row = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
            (table_name,),
        ).fetchone()
    return row is not None


def _column_exists(conn, table_name: str, column_name: str) -> bool:
    if IS_PG:
        row = conn.execute(
            "SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = %s AND column_name = %s",
            (table_name, column_name),
        ).fetchone()
        return row is not None
    rows = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    return any(row[1] == column_name for row in rows)


def _ensure_compositions_schema(conn) -> None:
    columns = {
        "user_id": "INTEGER NOT NULL",
        "title": "TEXT NOT NULL DEFAULT 'Untitled Composition'",
        "key": "TEXT",
        "mode": "TEXT",
        "tempo": "INTEGER",
        "time_signature": "TEXT",
        "measures": "INTEGER",
        "style": "TEXT",
        "sections": "TEXT",
        "chords": "TEXT",
        "melody": "TEXT",
        "lyrics": "TEXT",
        "metadata": "TEXT",
        "created_at": "TEXT DEFAULT CURRENT_TIMESTAMP",
        "updated_at": "TEXT DEFAULT CURRENT_TIMESTAMP",
    }

    if not _table_exists(conn, "compositions"):
        if IS_PG:
            conn.execute(
                """
                CREATE TABLE compositions (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    title TEXT NOT NULL DEFAULT 'Untitled Composition',
                    key TEXT,
                    mode TEXT,
                    tempo INTEGER,
                    time_signature TEXT,
                    measures INTEGER,
                    style TEXT,
                    sections TEXT,
                    chords TEXT,
                    melody TEXT,
                    lyrics TEXT,
                    metadata JSONB,
                    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        else:
            conn.execute(
                """
                CREATE TABLE compositions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    title TEXT NOT NULL DEFAULT 'Untitled Composition',
                    key TEXT,
                    mode TEXT,
                    tempo INTEGER,
                    time_signature TEXT,
                    measures INTEGER,
                    style TEXT,
                    sections TEXT,
                    chords TEXT,
                    melody TEXT,
                    lyrics TEXT,
                    metadata TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        return

    for column_name, column_type in columns.items():
        if not _column_exists(conn, "compositions", column_name):
            conn.execute(f"ALTER TABLE compositions ADD COLUMN {column_name} {column_type}")


def init_db() -> None:
    with get_conn() as conn:
        for statement in _CORE_SCHEMA.split(";"):
            stmt = statement.strip()
            if stmt:
                try:
                    conn.execute(stmt)
                except Exception:
                    pass

        _ensure_compositions_schema(conn)

    print(f"Database initialized ({'PostgreSQL' if IS_PG else 'SQLite'})")

"""
database.py — dual-mode connection layer.

PostgreSQL (Render / production): set DATABASE_URL env var to a postgres:// or postgresql:// URL.
SQLite (local dev): leave DATABASE_URL unset; uses scoresync.db in the working directory.

All callers use::

    with get_conn() as conn:
        conn.execute(sql, params)

For PostgreSQL, placeholders must be %s.
For SQLite, placeholders must be ?.
Use the IS_PG flag (or check DATABASE_URL) to branch when needed.
"""
from __future__ import annotations

import os
<<<<<<< Updated upstream
from contextlib import contextmanager
from datetime import datetime

from sqlalchemy import create_engine, Column, Integer, Float, String, JSON, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
=======
import sqlite3
from contextlib import contextmanager
from typing import Generator
>>>>>>> Stashed changes

# ── Config ────────────────────────────────────────────────────────────────────

<<<<<<< Updated upstream

class TrainingSession(Base):
    __tablename__ = "training_sessions"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer)
    session_type = Column(String)
    accuracy = Column(Float)
    tempo_stability = Column(Float)
    repeat_count = Column(Integer)
    duration_seconds = Column(Integer)
    error_types = Column(JSON)
    session_metadata = Column("metadata", JSON)
    created_at = Column(DateTime, default=datetime.utcnow)


class LoRAAdapterRecord(Base):
    __tablename__ = "lora_adapters"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer)
    adapter_name = Column(String, unique=True)
    s3_key = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)


def init_db():
    Base.metadata.create_all(bind=engine)
    print("✅ Database initialized (PostgreSQL / SQLite)")


@contextmanager
def get_conn():
    """Provide a database session that supports `with get_conn() as conn:`."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def get_db():
    """FastAPI dependency-compatible generator."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
=======
DATABASE_URL: str = os.getenv("DATABASE_URL", "")

# Render (and some other providers) emit "postgres://" which psycopg2 rejects;
# normalise to "postgresql://".
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = "postgresql://" + DATABASE_URL[len("postgres://"):]

IS_PG: bool = DATABASE_URL.startswith("postgresql://") or DATABASE_URL.startswith("postgresql+")

# ── PostgreSQL pool (lazy) ────────────────────────────────────────────────────

_pg_pool = None

def _get_pg_pool():
    global _pg_pool
    if _pg_pool is None:
        try:
            from psycopg2 import pool as pg_pool
            _pg_pool = pg_pool.ThreadedConnectionPool(1, 10, DATABASE_URL)
        except Exception as exc:  # pragma: no cover
            raise RuntimeError(f"Could not connect to PostgreSQL: {exc}") from exc
    return _pg_pool


class _PgConnWrapper:
    """Thin wrapper around a psycopg2 connection that mimics the SQLite dict-row API."""

    def __init__(self, raw_conn):
        self._conn = raw_conn
        self._cursor = None

    # ---- cursor management --------------------------------------------------

    def _cur(self):
        if self._cursor is None or self._cursor.closed:
            import psycopg2.extras
            self._cursor = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        return self._cursor

    # ---- public interface ---------------------------------------------------

    def execute(self, sql: str, params=()) -> "_PgConnWrapper":
        self._cur().execute(sql, params)
        return self

    def executemany(self, sql: str, seq_of_params):
        self._cur().executemany(sql, seq_of_params)
        return self

    def executescript(self, script: str):
        """Execute a multi-statement script (PostgreSQL does not have executescript)."""
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
        return [dict(r) for r in self._cur().fetchall()]

    @property
    def lastrowid(self):
        self._cur().execute("SELECT lastval()")
        return self._cur().fetchone()["lastval"]

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()


# ── SQLite row factory ────────────────────────────────────────────────────────

class _DictCursor(sqlite3.Row):
    """sqlite3.Row already supports dict-style access; this adds .keys()."""


_SQLITE_PATH = "scoresync.db"


# ── Public context manager ────────────────────────────────────────────────────

@contextmanager
def get_conn() -> Generator:
    """Yield an open database connection; auto-commit on clean exit, rollback on error."""
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


# ── Schema bootstrap ──────────────────────────────────────────────────────────

_PG_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id          SERIAL PRIMARY KEY,
    email       TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    hashed_pw   TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS profiles (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    instrument      TEXT NOT NULL DEFAULT 'Concert (C)',
    transposition   INTEGER NOT NULL DEFAULT 0,
    calibrated      INTEGER NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS score_uploads (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename    TEXT NOT NULL,
    file_type   TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    uploaded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS shared_scores (
    id          SERIAL PRIMARY KEY,
    score_id    INTEGER NOT NULL REFERENCES score_uploads(id) ON DELETE CASCADE,
    owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    share_token TEXT NOT NULL UNIQUE,
    expires_at  TEXT,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS calibration_sessions (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scale_name  TEXT NOT NULL,
    scale_type  TEXT NOT NULL,
    scale_root  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS calibration_notes (
    id              SERIAL PRIMARY KEY,
    session_id      INTEGER NOT NULL REFERENCES calibration_sessions(id) ON DELETE CASCADE,
    note_name       TEXT NOT NULL,
    detected_freq   REAL NOT NULL,
    cents_deviation REAL NOT NULL DEFAULT 0,
    seq_index       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS training_sessions (
    id                SERIAL PRIMARY KEY,
    user_id           INTEGER NOT NULL,
    session_type      TEXT,
    accuracy          REAL,
    tempo_stability   REAL,
    repeat_count      INTEGER,
    duration_seconds  INTEGER,
    error_types       JSONB,
    metadata          JSONB,
    created_at        TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lora_adapters (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL,
    adapter_name    TEXT NOT NULL UNIQUE,
    s3_key          TEXT,
    created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
"""

_SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    hashed_pw   TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS profiles (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL UNIQUE,
    instrument      TEXT NOT NULL DEFAULT 'Concert (C)',
    transposition   INTEGER NOT NULL DEFAULT 0,
    calibrated      INTEGER NOT NULL DEFAULT 0,
    updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS score_uploads (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    filename    TEXT NOT NULL,
    file_type   TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    uploaded_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shared_scores (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    score_id    INTEGER NOT NULL,
    owner_id    INTEGER NOT NULL,
    share_token TEXT NOT NULL UNIQUE,
    expires_at  TEXT,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS calibration_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    scale_name  TEXT NOT NULL,
    scale_type  TEXT NOT NULL,
    scale_root  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS calibration_notes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      INTEGER NOT NULL,
    note_name       TEXT NOT NULL,
    detected_freq   REAL NOT NULL,
    cents_deviation REAL NOT NULL DEFAULT 0,
    seq_index       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS training_sessions (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL,
    session_type      TEXT,
    accuracy          REAL,
    tempo_stability   REAL,
    repeat_count      INTEGER,
    duration_seconds  INTEGER,
    error_types       TEXT,
    metadata          TEXT,
    created_at        TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lora_adapters (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL,
    adapter_name    TEXT NOT NULL UNIQUE,
    s3_key          TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);
"""


def init_db() -> None:
    """Create all core tables (idempotent — safe to call on every startup)."""
    if IS_PG:
        with get_conn() as conn:
            for statement in _PG_SCHEMA.split(";"):
                stmt = statement.strip()
                if stmt:
                    conn.execute(stmt)
    else:
        with get_conn() as conn:
            conn.executescript(_SQLITE_SCHEMA)
    print(f"✅ Database initialized ({'PostgreSQL' if IS_PG else 'SQLite'})")
>>>>>>> Stashed changes

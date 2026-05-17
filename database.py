import os
from contextlib import contextmanager
from datetime import datetime

from sqlalchemy import create_engine, Column, Integer, Float, String, JSON, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL") or "sqlite:///scoresync.db"
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


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

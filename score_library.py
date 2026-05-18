"""Score library routes for listing and reloading stored uploads."""
from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from database import get_conn, IS_PG
from deps import get_current_user

router = APIRouter(prefix="/scores", tags=["scores"])

USE_OBJECT_STORAGE = bool(os.environ.get("S3_BUCKET"))


def _object_storage_client():
    if not USE_OBJECT_STORAGE:
        return None
    import boto3

    kwargs = {
        "aws_access_key_id": os.environ.get("S3_ACCESS_KEY_ID"),
        "aws_secret_access_key": os.environ.get("S3_SECRET_ACCESS_KEY"),
        "region_name": os.environ.get("S3_REGION", "auto"),
    }
    endpoint = os.environ.get("S3_ENDPOINT_URL")
    if endpoint:
        kwargs["endpoint_url"] = endpoint
    return boto3.client("s3", **kwargs)


def _read_stored_score(stored_path: str) -> bytes:
    if stored_path.startswith("s3://"):
        parsed = urlparse(stored_path)
        bucket = parsed.netloc
        key = parsed.path.lstrip("/")
        obj = _object_storage_client().get_object(Bucket=bucket, Key=key)
        return obj["Body"].read()

    path = Path(stored_path)
    if not path.exists():
        raise FileNotFoundError(stored_path)
    return path.read_bytes()


def _media_type(file_type: str, filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if file_type == "pdf" or ext == ".pdf":
        return "application/pdf"
    if ext == ".mxl":
        return "application/vnd.recordare.musicxml"
    if ext in {".xml", ".musicxml"} or file_type == "musicxml":
        return "application/xml"
    if ext in {".mscz", ".mscx"} or file_type == "musescore":
        return "application/octet-stream"
    return "application/octet-stream"


@router.get("/library")
def list_score_library(current_user: dict = Depends(get_current_user)):
    """Return the user's uploaded score files, newest first."""
    ph = "%s" if IS_PG else "?"
    with get_conn() as conn:
        rows = conn.execute(
            f"""
            SELECT id, filename, file_type, uploaded_at
            FROM score_uploads
            WHERE user_id = {ph}
            ORDER BY uploaded_at DESC, id DESC
            LIMIT 50
            """,
            (current_user["id"],),
        ).fetchall()

    return {
        "scores": [
            {
                "id": row["id"],
                "filename": row["filename"],
                "file_type": row["file_type"],
                "uploaded_at": str(row["uploaded_at"]),
            }
            for row in rows
        ]
    }


@router.get("/library/{score_id}/content")
def get_score_content(score_id: int, current_user: dict = Depends(get_current_user)):
    """Return bytes for one stored score so the frontend can reload it for practice."""
    ph = "%s" if IS_PG else "?"
    with get_conn() as conn:
        row = conn.execute(
            f"""
            SELECT id, filename, file_type, stored_path
            FROM score_uploads
            WHERE id = {ph} AND user_id = {ph}
            """,
            (score_id, current_user["id"]),
        ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Score not found")

    try:
        data = _read_stored_score(row["stored_path"])
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Stored score file is missing")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not load stored score: {exc}")

    filename = row["filename"] or "score"
    return Response(
        content=data,
        media_type=_media_type(row["file_type"], filename),
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
            "X-Score-Filename": filename,
            "X-Score-Type": row["file_type"],
        },
    )

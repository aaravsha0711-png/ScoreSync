"""Score sharing endpoints."""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from database import get_conn, IS_PG
from deps import get_current_user

router = APIRouter(prefix="/sharing", tags=["sharing"])


class ShareRequest(BaseModel):
    expires_in_days: int = 30


def _active_value():
    return True if IS_PG else 1


def _create_share_for_score(score_id: int, user_id: int, expires_in_days: int):
    token = secrets.token_urlsafe(24)
    expires_at = (datetime.utcnow() + timedelta(days=max(1, expires_in_days))).isoformat()
    ph = "%s" if IS_PG else "?"
    active = _active_value()

    with get_conn() as conn:
        score = conn.execute(
            f"SELECT id FROM score_uploads WHERE id = {ph} AND user_id = {ph}",
            (score_id, user_id),
        ).fetchone()
        if not score:
            raise HTTPException(status_code=404, detail="Score not found")

        existing = conn.execute(
            f"SELECT share_token FROM shared_scores WHERE score_id = {ph} AND is_active = {ph}",
            (score_id, active),
        ).fetchone()
        if existing:
            return {"token": existing["share_token"], "url": f"/shared/{existing['share_token']}"}

        conn.execute(
            f"INSERT INTO shared_scores (score_id, owner_id, share_token, expires_at, is_active) VALUES ({ph},{ph},{ph},{ph},{ph})",
            (score_id, user_id, token, expires_at, active),
        )

    return {"token": token, "url": f"/shared/{token}", "expires_at": expires_at}


@router.post("/scores/{score_id}")
def create_share(score_id: int, payload: ShareRequest, user=Depends(get_current_user)):
    return _create_share_for_score(score_id, user["id"], payload.expires_in_days)


@router.post("/latest")
def create_share_for_latest_score(payload: ShareRequest, user=Depends(get_current_user)):
    """Create a share link for the authenticated user's most recently uploaded score."""
    ph = "%s" if IS_PG else "?"
    with get_conn() as conn:
        row = conn.execute(
            f"SELECT id FROM score_uploads WHERE user_id = {ph} ORDER BY uploaded_at DESC, id DESC LIMIT 1",
            (user["id"],),
        ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="No uploaded score found to share yet")

    return _create_share_for_score(row["id"], user["id"], payload.expires_in_days)


@router.get("/{token}")
def get_shared_score(token: str):
    ph = "%s" if IS_PG else "?"
    active = _active_value()
    with get_conn() as conn:
        row = conn.execute(
            f"""SELECT s.id, s.filename, s.file_type, s.stored_path, sh.expires_at
            FROM shared_scores sh
            JOIN score_uploads s ON s.id = sh.score_id
            WHERE sh.share_token = {ph} AND sh.is_active = {ph}""",
            (token, active),
        ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Shared score not found")

    if row["expires_at"] and datetime.fromisoformat(str(row["expires_at"]).replace('Z', '')) < datetime.utcnow():
        raise HTTPException(status_code=410, detail="Share link has expired")

    return {
        "id": row["id"],
        "filename": row["filename"],
        "file_type": row["file_type"],
    }


def _read_stored_file(stored_path: str) -> bytes:
    """Read file bytes from local disk or S3."""
    if stored_path.startswith("s3://"):
        try:
            import boto3, os
            parsed = urlparse(stored_path)
            bucket = parsed.netloc
            key = parsed.path.lstrip("/")
            s3 = boto3.client(
                "s3",
                aws_access_key_id=os.environ.get("S3_ACCESS_KEY_ID"),
                aws_secret_access_key=os.environ.get("S3_SECRET_ACCESS_KEY"),
                region_name=os.environ.get("S3_REGION", "auto"),
                **(dict(endpoint_url=os.environ["S3_ENDPOINT_URL"]) if os.environ.get("S3_ENDPOINT_URL") else {}),
            )
            return s3.get_object(Bucket=bucket, Key=key)["Body"].read()
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Could not load file from storage: {exc}")
    path = Path(stored_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Score file is no longer available on this server.")
    return path.read_bytes()


def _media_type_for(file_type: str, filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if file_type == "pdf" or ext == ".pdf":
        return "application/pdf"
    if ext == ".mxl":
        return "application/vnd.recordare.musicxml"
    if ext in {".xml", ".musicxml"} or file_type == "musicxml":
        return "application/xml"
    return "application/octet-stream"


@router.get("/{token}/download")
def download_shared_score(token: str):
    """Stream the actual score bytes for a valid share token (no auth required)."""
    ph = "%s" if IS_PG else "?"
    active = _active_value()
    with get_conn() as conn:
        row = conn.execute(
            f"""SELECT s.id, s.filename, s.file_type, s.stored_path, sh.expires_at
            FROM shared_scores sh
            JOIN score_uploads s ON s.id = sh.score_id
            WHERE sh.share_token = {ph} AND sh.is_active = {ph}""",
            (token, active),
        ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Shared score not found")

    if row["expires_at"] and datetime.fromisoformat(str(row["expires_at"]).replace("Z", "+00:00").replace("+00:00", "")) < datetime.utcnow():
        raise HTTPException(status_code=410, detail="Share link has expired")

    data = _read_stored_file(row["stored_path"])
    filename = row["filename"] or "score"
    return Response(
        content=data,
        media_type=_media_type_for(row["file_type"], filename),
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

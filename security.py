"""
core/security.py
JWT authentication and bcrypt password hashing.
No external auth services — all local.
"""

import hashlib
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext

# ── Config ────────────────────────────────────────────────────────────────────
SECRET_KEY: str = os.environ.get(
    "SCORESYNC_SECRET",
    "change-me-in-production-use-a-long-random-string-here-32chars+"
)
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _normalize_password(password: str) -> str:
    """Pre-hash the password so bcrypt's 72-byte input limit is never reached.

    Using a SHA-256 hex digest yields a fixed 64-character ASCII string.
    This preserves the full entropy of long passwords while remaining
    compatible with bcrypt.
    """
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


# ── Password helpers ──────────────────────────────────────────────────────────

def hash_password(plain: str) -> str:
    return pwd_context.hash(_normalize_password(plain))


def verify_password(plain: str, hashed: str) -> bool:
    # First try the new normalized format.
    if pwd_context.verify(_normalize_password(plain), hashed):
        return True

    # Backward compatibility for accounts created before normalization.
    try:
        return pwd_context.verify(plain, hashed)
    except ValueError:
        return False


# ── JWT helpers ───────────────────────────────────────────────────────────────

def create_access_token(subject: str, expires_delta: Optional[timedelta] = None) -> str:
    """Create a signed JWT with the user email as subject."""
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    payload = {"sub": subject, "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> Optional[str]:
    """Decode token and return subject (email), or None if invalid/expired."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload.get("sub")
    except JWTError:
        return None

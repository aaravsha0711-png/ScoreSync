"""Minimal, deployment-safe composer module.

This fallback implementation preserves the API router and startup hooks while
avoiding database-specific initialization issues during deployment.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/composer", tags=["composer"])


def init_composer_tables() -> None:
    """No-op initialization to prevent startup failures."""
    print("Composer module initialized (safe mode)")


@router.get("/health")
def composer_health():
    return {"status": "ok", "mode": "safe"}

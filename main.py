"""ScoreSync FastAPI application."""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from auth import router as auth_router
from composer import router as composer_router, init_composer_tables
from database import init_db
from playback import router as playback_router
from profile import router as profile_router
from score_library import router as score_library_router
from scores import router as scores_router
from sharing import router as sharing_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    init_composer_tables()
    yield


app = FastAPI(
    title="ScoreSync API",
    description="Music practice application with score analysis and training tools",
    version="1.0.0",
    lifespan=lifespan,
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc) or "Internal Server Error"},
    )


_raw_origins = os.environ.get(
    "CORS_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000",
)
allowed_origins = [origin.strip() for origin in _raw_origins.split(",") if origin.strip()]

# Automatically include common deployment URLs when present.
for env_name in ("FRONTEND_URL", "PUBLIC_FRONTEND_URL", "RENDER_EXTERNAL_URL"):
    value = os.environ.get(env_name, "").strip()
    if value and value not in allowed_origins:
        allowed_origins.append(value)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(scores_router)
app.include_router(score_library_router)
app.include_router(playback_router)
app.include_router(profile_router)
app.include_router(sharing_router)
app.include_router(composer_router)

UPLOAD_DIR = Path("uploads")
if UPLOAD_DIR.exists():
    app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

STATIC_DIST_CANDIDATES = [Path("dist"), Path("static/dist")]
STATIC_DIST = next((path for path in STATIC_DIST_CANDIDATES if path.exists()), Path("dist"))

if STATIC_DIST.exists() and (STATIC_DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(STATIC_DIST / "assets")), name="assets")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/")
def root():
    index_file = STATIC_DIST / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return {"message": "ScoreSync API", "version": "1.0.0"}


@app.get("/{full_path:path}", include_in_schema=False)
def serve_spa(full_path: str):
    index_file = STATIC_DIST / "index.html"
    api_prefixes = (
        "auth",
        "profile",
        "scores",
        "playback",
        "sharing",
        "composer",
        "health",
        "docs",
        "openapi.json",
        "uploads",
        "assets",
    )

    if index_file.exists() and not full_path.startswith(api_prefixes):
        return FileResponse(index_file)

    return JSONResponse({"detail": "Not found"}, status_code=404)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)

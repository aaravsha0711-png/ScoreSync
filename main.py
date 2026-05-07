"""
ScoreSync - Music Practice Application

FastAPI backend for ScoreSync, providing score analysis, transposition,
training synthesis, and metronome functionality.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from scores import router as scores_router
from playback import router as playback_router
from profile import router as profile_router

# Create FastAPI app
app = FastAPI(
    title="ScoreSync API",
    description="Music practice application with score analysis and training tools",
    version="1.0.0",
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(scores_router)
app.include_router(playback_router)
app.include_router(profile_router)

# Mount static files (for uploaded scores)
from pathlib import Path
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

@app.get("/")
def root():
    """Root endpoint"""
    return {"message": "ScoreSync API", "version": "1.0.0"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
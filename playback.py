"""
Playback utilities for ScoreSync: metronome generation, click sounds, and audio synthesis.

POST /playback/metronome  — Generate metronome click sound (WAV)
POST /playback/click      — Generate single metronome click
"""

from __future__ import annotations

import io
import math
from dataclasses import dataclass
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/playback", tags=["playback"])


@dataclass
class MetronomeConfig:
    bpm: int
    time_signature: str  # e.g., "4/4"
    duration_seconds: float = 8.0
    accent_first: bool = True
    sample_rate: int = 44100


def _generate_sine_wave(frequency: float, duration: float, sample_rate: int = 44100) -> list[float]:
    """Generate a sine wave at given frequency."""
    num_samples = int(duration * sample_rate)
    samples = []
    for i in range(num_samples):
        t = i / sample_rate
        sample = 0.3 * math.sin(2 * math.pi * frequency * t)
        samples.append(sample)
    return samples


def _generate_click(frequency: float = 1000, duration: float = 0.1, sample_rate: int = 44100) -> list[float]:
    """Generate a metronome click sound with exponential decay."""
    num_samples = int(duration * sample_rate)
    samples = []
    decay_rate = 8  # Controls how quickly the click decays
    for i in range(num_samples):
        t = i / sample_rate
        # Exponential decay envelope
        envelope = math.exp(-decay_rate * t)
        # Add harmonics for richer sound
        sample = (
            0.4 * math.sin(2 * math.pi * frequency * t) * envelope +
            0.2 * math.sin(2 * math.pi * frequency * 1.5 * t) * envelope +
            0.1 * math.sin(2 * math.pi * frequency * 2 * t) * envelope
        )
        samples.append(sample)
    return samples


def _generate_metronome_track(config: MetronomeConfig) -> bytes:
    """Generate a complete metronome track as WAV bytes."""
    # Parse time signature
    parts = config.time_signature.split("/")
    beats_per_measure = int(parts[0]) if len(parts) > 0 else 4
    
    # Calculate beat duration
    beat_duration = 60 / config.bpm  # seconds per beat
    
    # Generate all samples
    all_samples = []
    num_beats = int(config.duration_seconds / beat_duration)
    
    for beat in range(num_beats):
        is_first_beat = (beat % beats_per_measure) == 0
        
        # Choose frequency and amplitude based on beat position
        if config.accent_first and is_first_beat:
            click = _generate_click(frequency=1200, duration=0.15)  # Higher, longer accent
        else:
            click = _generate_click(frequency=800, duration=0.1)  # Regular click
        
        # Add silence between clicks (beat duration - click duration)
        silence_duration = beat_duration - 0.1
        silence_samples = int(silence_duration * config.sample_rate)
        
        all_samples.extend(click)
        all_samples.extend([0.0] * silence_samples)
    
    # Convert to 16-bit PCM WAV
    return _samples_to_wav(all_samples, config.sample_rate)


def _samples_to_wav(samples: list[float], sample_rate: int = 44100) -> bytes:
    """Convert float samples to 16-bit PCM WAV format."""
    wav_file = io.BytesIO()
    
    # Normalize samples to prevent clipping
    max_sample = max(abs(s) for s in samples) if samples else 1.0
    if max_sample > 1.0:
        samples = [s / max_sample for s in samples]
    
    # Convert to 16-bit integers
    pcm_data = b""
    for sample in samples:
        # Clamp to [-1, 1]
        clamped = max(-1.0, min(1.0, sample))
        # Convert to 16-bit integer
        pcm_value = int(clamped * 32767)
        pcm_data += pcm_value.to_bytes(2, byteorder="little", signed=True)
    
    # Write WAV header
    num_channels = 1
    bytes_per_sample = 2
    num_samples = len(samples)
    byte_rate = sample_rate * num_channels * bytes_per_sample
    block_align = num_channels * bytes_per_sample
    data_size = num_samples * bytes_per_sample
    
    # RIFF header
    wav_file.write(b"RIFF")
    wav_file.write((36 + data_size).to_bytes(4, byteorder="little"))
    wav_file.write(b"WAVE")
    
    # fmt sub-chunk
    wav_file.write(b"fmt ")
    wav_file.write((16).to_bytes(4, byteorder="little"))  # Subchunk1Size
    wav_file.write((1).to_bytes(2, byteorder="little"))   # AudioFormat (1 = PCM)
    wav_file.write((num_channels).to_bytes(2, byteorder="little"))
    wav_file.write((sample_rate).to_bytes(4, byteorder="little"))
    wav_file.write((byte_rate).to_bytes(4, byteorder="little"))
    wav_file.write((block_align).to_bytes(2, byteorder="little"))
    wav_file.write((16).to_bytes(2, byteorder="little"))  # BitsPerSample
    
    # data sub-chunk
    wav_file.write(b"data")
    wav_file.write((data_size).to_bytes(4, byteorder="little"))
    wav_file.write(pcm_data)
    
    return wav_file.getvalue()


# ─── API Routes ────────────────────────────────────────────────────────────────

@router.post("/metronome")
async def generate_metronome(
    bpm: int,
    time_signature: str = "4/4",
    duration_seconds: float = 8.0,
    accent_first: bool = True,
):
    """
    Generate a metronome track as WAV audio.
    
    Args:
        bpm: Tempo in beats per minute
        time_signature: Time signature (e.g., "4/4", "3/4", "6/8")
        duration_seconds: Duration of the metronome track
        accent_first: Whether to accent the first beat of each measure
    
    Returns:
        WAV audio file with metronome clicks
    """
    if bpm < 30 or bpm > 300:
        raise HTTPException(status_code=422, detail="BPM must be between 30 and 300")
    
    if duration_seconds < 1 or duration_seconds > 60:
        raise HTTPException(status_code=422, detail="Duration must be between 1 and 60 seconds")
    
    config = MetronomeConfig(
        bpm=bpm,
        time_signature=time_signature,
        duration_seconds=duration_seconds,
        accent_first=accent_first,
    )
    
    try:
        wav_data = _generate_metronome_track(config)
        from fastapi.responses import Response
        return Response(
            content=wav_data,
            media_type="audio/wav",
            headers={"Content-Disposition": f"attachment; filename=metronome_{bpm}bpm.wav"},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Metronome generation failed: {str(e)}")


@router.post("/click")
async def generate_click(
    frequency: float = 800,
    duration: float = 0.1,
):
    """
    Generate a single metronome click sound.
    
    Args:
        frequency: Click frequency in Hz (default 800)
        duration: Click duration in seconds (default 0.1)
    
    Returns:
        WAV audio file with a single click
    """
    if frequency < 200 or frequency > 4000:
        raise HTTPException(status_code=422, detail="Frequency must be between 200 and 4000 Hz")
    
    if duration < 0.05 or duration > 0.5:
        raise HTTPException(status_code=422, detail="Duration must be between 0.05 and 0.5 seconds")
    
    try:
        click_samples = _generate_click(frequency=frequency, duration=duration)
        wav_data = _samples_to_wav(click_samples)
        from fastapi.responses import Response
        return Response(
            content=wav_data,
            media_type="audio/wav",
            headers={"Content-Disposition": "attachment; filename=click.wav"},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Click generation failed: {str(e)}")

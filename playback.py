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
    decay_rate = 8
    for i in range(num_samples):
        t = i / sample_rate
        envelope = math.exp(-decay_rate * t)
        sample = (
            0.4 * math.sin(2 * math.pi * frequency * t) * envelope
            + 0.2 * math.sin(2 * math.pi * frequency * 1.5 * t) * envelope
            + 0.1 * math.sin(2 * math.pi * frequency * 2 * t) * envelope
        )
        samples.append(sample)
    return samples


def _generate_metronome_track(config: MetronomeConfig) -> bytes:
    """Generate a complete metronome track as WAV bytes."""
    parts = config.time_signature.split("/")
    beats_per_measure = int(parts[0]) if len(parts) > 0 else 4

    beat_duration = 60 / config.bpm

    all_samples = []
    num_beats = int(config.duration_seconds / beat_duration)

    for beat in range(num_beats):
        is_first_beat = (beat % beats_per_measure) == 0

        if config.accent_first and is_first_beat:
            click_duration = 0.15
            click = _generate_click(
                frequency=1200,
                duration=click_duration,
                sample_rate=config.sample_rate,
            )
        else:
            click_duration = 0.1
            click = _generate_click(
                frequency=800,
                duration=click_duration,
                sample_rate=config.sample_rate,
            )

        # Preserve exact beat spacing by subtracting the actual click duration.
        silence_duration = max(0.0, beat_duration - click_duration)
        silence_samples = int(silence_duration * config.sample_rate)

        all_samples.extend(click)
        all_samples.extend([0.0] * silence_samples)

    return _samples_to_wav(all_samples, config.sample_rate)


def _samples_to_wav(samples: list[float], sample_rate: int = 44100) -> bytes:
    """Convert float samples to 16-bit PCM WAV format."""
    wav_file = io.BytesIO()

    max_sample = max(abs(s) for s in samples) if samples else 1.0
    if max_sample > 1.0:
        samples = [s / max_sample for s in samples]

    pcm_data = b""
    for sample in samples:
        clamped = max(-1.0, min(1.0, sample))
        pcm_value = int(clamped * 32767)
        pcm_data += pcm_value.to_bytes(2, byteorder="little", signed=True)

    num_channels = 1
    bytes_per_sample = 2
    num_samples = len(samples)
    byte_rate = sample_rate * num_channels * bytes_per_sample
    block_align = num_channels * bytes_per_sample
    data_size = num_samples * bytes_per_sample

    wav_file.write(b"RIFF")
    wav_file.write((36 + data_size).to_bytes(4, byteorder="little"))
    wav_file.write(b"WAVE")

    wav_file.write(b"fmt ")
    wav_file.write((16).to_bytes(4, byteorder="little"))
    wav_file.write((1).to_bytes(2, byteorder="little"))
    wav_file.write((num_channels).to_bytes(2, byteorder="little"))
    wav_file.write((sample_rate).to_bytes(4, byteorder="little"))
    wav_file.write((byte_rate).to_bytes(4, byteorder="little"))
    wav_file.write((block_align).to_bytes(2, byteorder="little"))
    wav_file.write((16).to_bytes(2, byteorder="little"))

    wav_file.write(b"data")
    wav_file.write((data_size).to_bytes(4, byteorder="little"))
    wav_file.write(pcm_data)

    return wav_file.getvalue()


@router.post("/metronome")
async def generate_metronome(
    bpm: int,
    time_signature: str = "4/4",
    duration_seconds: float = 8.0,
    accent_first: bool = True,
):
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

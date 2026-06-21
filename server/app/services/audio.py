from __future__ import annotations

import logging
import re
import shutil
import subprocess
import wave
from pathlib import Path

import httpx

from ..config import (
    AMBIENCE_DIR,
    BACKGROUND_NOISE_AMPLITUDE,
    CHAPTER_PAUSE_MS,
    DEFAULT_TTS_BASE_URL,
    DEFAULT_TTS_ENGINE,
    DEFAULT_TTS_FORMAT,
    DEFAULT_TTS_LANGUAGE,
    DEFAULT_TTS_MODEL,
    DEFAULT_TTS_PROVIDER,
    DEFAULT_TTS_VOICE,
)

AMBIENCE_EXTENSIONS = {".wav", ".mp3", ".m4a", ".ogg", ".flac", ".aac"}

logger = logging.getLogger("stream_epub.tts")


def require_ffmpeg() -> None:
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg is required to create chapter audio and m4b files.")


def chunk_text(text: str, max_chars: int) -> list[str]:
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks: list[str] = []
    for para in paragraphs:
        if len(para) <= max_chars:
            chunks.append(para)
            continue
        sentences = re.split(r"(?<=[.!?])\s+", para)
        buffer = ""
        for sentence in sentences:
            if buffer and len(buffer) + len(sentence) + 1 > max_chars:
                chunks.append(buffer)
                buffer = sentence
            else:
                buffer = f"{buffer} {sentence}".strip()
        if buffer:
            chunks.append(buffer)
    return chunks or [text[:max_chars]]


async def _log_http_error(exc: httpx.HTTPError, url: str) -> None:
    if isinstance(exc, httpx.HTTPStatusError):
        body = exc.response.text[:2000]
        logger.error(
            "voicebox request failed: %s %s -> %s %s",
            exc.request.method,
            url,
            exc.response.status_code,
            body,
        )
    else:
        logger.error("voicebox request failed: %s -> %s", url, exc)


async def list_voicebox_profiles(base_url: str) -> list[dict]:
    url = base_url.rstrip("/") + "/profiles"
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            response = await client.get(url)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            await _log_http_error(exc, url)
            raise
        return response.json()


async def list_voicebox_effect_presets(base_url: str) -> list[dict]:
    url = base_url.rstrip("/") + "/effects/presets"
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            response = await client.get(url)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            await _log_http_error(exc, url)
            raise
        return response.json()


async def synthesize_chunk(
    text: str,
    output_path: Path,
    base_url: str = DEFAULT_TTS_BASE_URL,
    provider: str = DEFAULT_TTS_PROVIDER,
    model: str = DEFAULT_TTS_MODEL,
    voice: str = DEFAULT_TTS_VOICE,
    engine: str = DEFAULT_TTS_ENGINE,
    language: str = DEFAULT_TTS_LANGUAGE,
    effects_chain: list[dict] | None = None,
    response_format: str = DEFAULT_TTS_FORMAT,
) -> None:
    if provider == "voicebox":
        url = base_url.rstrip("/") + "/generate/stream"
        payload = {
            "profile_id": voice,
            "text": text,
            "language": language,
            "model_size": model,
            "engine": engine,
            "max_chunk_chars": 5000,
            "crossfade_ms": 50,
            "normalize": True,
        }
        if effects_chain:
            payload["effects_chain"] = effects_chain
    else:
        url = base_url.rstrip("/") + "/v1/audio/speech"
        payload = {
            "model": model,
            "input": text,
            "voice": voice,
            "response_format": response_format,
        }
    timeout = httpx.Timeout(connect=20, read=600, write=60, pool=20)
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            async with client.stream("POST", url, json=payload) as response:
                if response.is_error:
                    body = (await response.aread())[:2000]
                    logger.error(
                        "voicebox request failed: POST %s -> %s %s",
                        url,
                        response.status_code,
                        body.decode("utf-8", "replace"),
                    )
                    response.raise_for_status()
                with output_path.open("wb") as file:
                    async for chunk in response.aiter_bytes():
                        file.write(chunk)
        except httpx.HTTPError as exc:
            if not isinstance(exc, httpx.HTTPStatusError):
                logger.error("voicebox request failed: POST %s -> %s", url, exc)
            raise


def make_silence(path: Path, milliseconds: int = CHAPTER_PAUSE_MS) -> None:
    require_ffmpeg()
    seconds = max(milliseconds, 0) / 1000
    cmd = [
        "ffmpeg",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=24000:cl=mono",
        "-t",
        str(seconds),
        "-c:a",
        "pcm_s16le",
        str(path),
    ]
    subprocess.run(cmd, check=True, capture_output=True)


def concat_audio(inputs: list[Path], output_path: Path, codec_args: list[str] | None = None) -> None:
    require_ffmpeg()
    list_path = output_path.with_suffix(".concat.txt")
    list_path.write_text("\n".join(f"file '{p.resolve().as_posix()}'" for p in inputs), encoding="utf-8")
    cmd = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(list_path)]
    cmd += codec_args or ["-c", "copy"]
    cmd.append(str(output_path))
    try:
        subprocess.run(cmd, check=True, capture_output=True)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(exc.stderr.decode("utf-8", "replace")) from exc
    finally:
        list_path.unlink(missing_ok=True)


NOISE_COLORS = {"white", "pink", "brown", "blue", "violet", "velvet"}


def add_background_noise(
    input_path: Path,
    output_path: Path,
    amplitude: float = BACKGROUND_NOISE_AMPLITUDE,
    color: str = "white",
) -> None:
    require_ffmpeg()
    if color not in NOISE_COLORS:
        raise ValueError(f"Unsupported noise color: {color}")
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(input_path),
        "-f",
        "lavfi",
        "-i",
        f"anoisesrc=color={color}:amplitude=1",
        "-filter_complex",
        "[0:a]aformat=sample_rates=44100:channel_layouts=mono[voice];"
        f"[1:a]aformat=sample_rates=44100:channel_layouts=mono,volume={amplitude}[noise];"
        "[voice][noise]amix=inputs=2:duration=first:normalize=0",
        "-c:a",
        "pcm_s16le",
        str(output_path),
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(exc.stderr.decode("utf-8", "replace")) from exc


def render_noise_preview(path: Path, color: str, amplitude: float, duration: float = 3.0) -> None:
    require_ffmpeg()
    if color not in NOISE_COLORS:
        raise ValueError(f"Unsupported noise color: {color}")
    cmd = [
        "ffmpeg",
        "-y",
        "-f",
        "lavfi",
        "-i",
        f"anoisesrc=color={color}:amplitude=1:duration={duration}",
        "-filter:a",
        f"volume={amplitude}",
        "-ar",
        "44100",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        str(path),
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(exc.stderr.decode("utf-8", "replace")) from exc


def _safe_segment(value: str) -> str:
    if not value or not re.fullmatch(r"[A-Za-z0-9_-]+", value):
        raise ValueError(f"Invalid identifier: {value!r}")
    return value


def list_ambience_categories() -> list[str]:
    if not AMBIENCE_DIR.exists():
        return []
    return sorted(
        entry.name
        for entry in AMBIENCE_DIR.iterdir()
        if entry.is_dir() and any(f.suffix.lower() in AMBIENCE_EXTENSIONS for f in entry.iterdir())
    )


def list_ambience_files(category: str) -> list[str]:
    category_dir = AMBIENCE_DIR / _safe_segment(category)
    if not category_dir.exists():
        return []
    return sorted(f.stem for f in category_dir.iterdir() if f.suffix.lower() in AMBIENCE_EXTENSIONS)


def resolve_ambience_file(category: str, file_id: str) -> Path:
    category_dir = AMBIENCE_DIR / _safe_segment(category)
    file_id = _safe_segment(file_id)
    for ext in AMBIENCE_EXTENSIONS:
        candidate = category_dir / f"{file_id}{ext}"
        if candidate.exists():
            return candidate
    raise FileNotFoundError(f"Ambience file not found: {category}/{file_id}")


def add_ambience(input_path: Path, output_path: Path, ambience_path: Path, amplitude: float) -> None:
    require_ffmpeg()
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(input_path),
        "-stream_loop",
        "-1",
        "-i",
        str(ambience_path),
        "-filter_complex",
        "[0:a]aformat=sample_rates=44100:channel_layouts=mono[voice];"
        f"[1:a]aformat=sample_rates=44100:channel_layouts=mono,volume={amplitude}[amb];"
        "[voice][amb]amix=inputs=2:duration=first:normalize=0",
        "-c:a",
        "pcm_s16le",
        str(output_path),
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(exc.stderr.decode("utf-8", "replace")) from exc


def render_ambience_preview(ambience_path: Path, path: Path, amplitude: float, duration: float = 5.0) -> None:
    require_ffmpeg()
    cmd = [
        "ffmpeg",
        "-y",
        "-stream_loop",
        "-1",
        "-i",
        str(ambience_path),
        "-t",
        str(duration),
        "-filter:a",
        f"volume={amplitude}",
        "-ar",
        "44100",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        str(path),
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(exc.stderr.decode("utf-8", "replace")) from exc


def probe_duration_ms(path: Path) -> int:
    try:
        with wave.open(str(path), "rb") as file:
            return int(file.getnframes() / file.getframerate() * 1000)
    except wave.Error:
        cmd = [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ]
        result = subprocess.run(cmd, check=True, capture_output=True, text=True)
        return int(float(result.stdout.strip()) * 1000)


def escape_ffmetadata(value: str) -> str:
    for char in ["=", ";", "#", "\\", "\n"]:
        value = value.replace(char, "\\" + char)
    return value


def build_m4b(
    title: str,
    author: str,
    chapter_files: list[tuple[Path, str]],
    output_path: Path,
    cover_path: Path | None = None,
) -> None:
    require_ffmpeg()
    if not chapter_files:
        raise ValueError("No chapter files are available to pack.")

    metadata = [";FFMETADATA1"]
    if title:
        metadata.append(f"title={escape_ffmetadata(title)}")
        metadata.append(f"album={escape_ffmetadata(title)}")
    if author:
        metadata.append(f"artist={escape_ffmetadata(author)}")
    metadata.append("genre=Audiobook")

    current_ms = 0
    for path, chapter_title in chapter_files:
        duration = probe_duration_ms(path)
        metadata += [
            "[CHAPTER]",
            "TIMEBASE=1/1000",
            f"START={current_ms}",
            f"END={current_ms + duration}",
            f"title={escape_ffmetadata(chapter_title)}",
        ]
        current_ms += duration

    meta_path = output_path.with_suffix(".ffmetadata.txt")
    list_path = output_path.with_suffix(".chapters.txt")
    meta_path.write_text("\n".join(metadata), encoding="utf-8")
    list_path.write_text(
        "\n".join(f"file '{path.resolve().as_posix()}'" for path, _ in chapter_files),
        encoding="utf-8",
    )

    cmd = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(list_path)]
    input_index = 1
    cover_index = None
    if cover_path and cover_path.exists():
        cmd += ["-i", str(cover_path)]
        cover_index = input_index
        input_index += 1
    cmd += ["-f", "ffmetadata", "-i", str(meta_path), "-map", "0:a", "-map_metadata", str(input_index)]
    if cover_index is not None:
        cmd += ["-map", f"{cover_index}:v", "-c:v", "copy", "-disposition:v:0", "attached_pic"]
    cmd += ["-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-movflags", "+faststart+use_metadata_tags", str(output_path)]

    try:
        subprocess.run(cmd, check=True, capture_output=True)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(exc.stderr.decode("utf-8", "replace")) from exc
    finally:
        meta_path.unlink(missing_ok=True)
        list_path.unlink(missing_ok=True)

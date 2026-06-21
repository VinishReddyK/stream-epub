from __future__ import annotations

import os
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("STREAM_EPUB_DATA_DIR", ROOT_DIR / "data"))
UPLOAD_DIR = DATA_DIR / "uploads"
WORK_DIR = DATA_DIR / "work"
OUTPUT_DIR = DATA_DIR / "outputs"
AUTH_FILE = DATA_DIR / "auth.json"
JOBS_FILE = DATA_DIR / "jobs.json"

JWT_SECRET = os.environ.get("STREAM_EPUB_JWT_SECRET", "change-me-for-real-use")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_MINUTES = int(os.environ.get("STREAM_EPUB_ACCESS_TOKEN_MINUTES", "1440"))

DEFAULT_TTS_BASE_URL = os.environ.get("TTS_BASE_URL", "http://127.0.0.1:17493")
DEFAULT_TTS_PROVIDER = os.environ.get("TTS_PROVIDER", "voicebox")
DEFAULT_TTS_MODEL = os.environ.get("TTS_MODEL", "0.6B")
DEFAULT_TTS_VOICE = os.environ.get("TTS_VOICE", "f275c129-9d3b-40fc-9cc1-90a62bb93a98")
DEFAULT_TTS_ENGINE = os.environ.get("TTS_ENGINE", "qwen")
DEFAULT_TTS_LANGUAGE = os.environ.get("TTS_LANGUAGE", "en")
DEFAULT_TTS_FORMAT = os.environ.get("TTS_FORMAT", "wav")
DEFAULT_CHUNK_CHARS = int(os.environ.get("STREAM_EPUB_CHUNK_CHARS", "1000"))
DEFAULT_CHUNK_CONCURRENCY = int(os.environ.get("STREAM_EPUB_CHUNK_CONCURRENCY", "10"))
CHAPTER_PAUSE_MS = int(os.environ.get("STREAM_EPUB_CHAPTER_PAUSE_MS", "400"))
BACKGROUND_NOISE_AMPLITUDE = float(os.environ.get("STREAM_EPUB_NOISE_AMPLITUDE", "0.01"))
AMBIENCE_DIR = Path(os.environ.get("STREAM_EPUB_AMBIENCE_DIR", ROOT_DIR / "server" / "assets" / "ambience"))

for directory in [DATA_DIR, UPLOAD_DIR, WORK_DIR, OUTPUT_DIR, AMBIENCE_DIR]:
    directory.mkdir(parents=True, exist_ok=True)

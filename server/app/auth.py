from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import jwt
from fastapi import HTTPException, Request, status

from .config import (
    ACCESS_TOKEN_MINUTES,
    AUTH_FILE,
    BACKGROUND_NOISE_AMPLITUDE,
    DEFAULT_CHUNK_CHARS,
    DEFAULT_CHUNK_CONCURRENCY,
    DEFAULT_TTS_BASE_URL,
    DEFAULT_TTS_ENGINE,
    DEFAULT_TTS_LANGUAGE,
    DEFAULT_TTS_MODEL,
    DEFAULT_TTS_VOICE,
    JWT_ALGORITHM,
    JWT_SECRET,
)


DEFAULT_USER_SETTINGS: dict[str, Any] = {
    "tts_base_url": DEFAULT_TTS_BASE_URL,
    "tts_voice": DEFAULT_TTS_VOICE,
    "tts_language": DEFAULT_TTS_LANGUAGE,
    "tts_model_option": f"{DEFAULT_TTS_ENGINE}-{DEFAULT_TTS_MODEL}" if DEFAULT_TTS_MODEL else DEFAULT_TTS_ENGINE,
    "tts_chunk_chars": DEFAULT_CHUNK_CHARS,
    "tts_chunk_concurrency": DEFAULT_CHUNK_CONCURRENCY,
    "tts_effects_id": "",
    "tts_effects_chain": None,
    "tts_bg_mode": "none",
    "tts_noise_color": "white",
    "tts_noise_amplitude": BACKGROUND_NOISE_AMPLITUDE,
    "tts_ambience_category": "",
    "tts_ambience_file": "",
    "tts_ambience_amplitude": 0.1,
    "tts_ambience_random": False,
}

def _hash_password(password: str, salt: bytes | None = None) -> dict[str, str]:
    salt = salt or os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 250_000)
    return {
        "salt": base64.b64encode(salt).decode("ascii"),
        "hash": base64.b64encode(digest).decode("ascii"),
    }


def _verify_password(password: str, record: dict[str, str]) -> bool:
    salt = base64.b64decode(record["salt"])
    expected = base64.b64decode(record["hash"])
    candidate = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 250_000)
    return hmac.compare_digest(candidate, expected)


def _load_auth() -> dict[str, Any]:
    if not AUTH_FILE.exists():
        data = {"users": {"admin": _hash_password("admin")}}
        _save_auth(data)
        return data
    return json.loads(AUTH_FILE.read_text(encoding="utf-8"))


def _save_auth(data: dict[str, Any]) -> None:
    AUTH_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = AUTH_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    tmp.replace(AUTH_FILE)


def authenticate(username: str, password: str) -> bool:
    users = _load_auth().get("users", {})
    record = users.get(username)
    return bool(record and _verify_password(password, record))


def create_token(username: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": username,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=ACCESS_TOKEN_MINUTES)).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def change_password(username: str, current_password: str, new_password: str) -> None:
    if len(new_password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters.")
    data = _load_auth()
    record = data.get("users", {}).get(username)
    if not record or not _verify_password(current_password, record):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")
    settings = record.get("settings", {})
    data["users"][username] = {**_hash_password(new_password), "settings": settings}
    _save_auth(data)


def get_settings(username: str) -> dict[str, Any]:
    record = _load_auth().get("users", {}).get(username)
    if not record:
        raise HTTPException(status_code=404, detail="User not found.")
    return {**DEFAULT_USER_SETTINGS, **record.get("settings", {})}


def update_settings(username: str, updates: dict[str, Any]) -> dict[str, Any]:
    data = _load_auth()
    record = data.get("users", {}).get(username)
    if not record:
        raise HTTPException(status_code=404, detail="User not found.")
    settings = record.setdefault("settings", {})
    settings.update(updates)
    _save_auth(data)
    return {**DEFAULT_USER_SETTINGS, **settings}


def decode_token(token: str) -> str:
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    username = payload.get("sub")
    if username != "admin":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unknown user.")
    return username


def current_user(request: Request) -> str:
    auth_header = request.headers.get("Authorization", "")
    token = request.query_params.get("token", "")
    if auth_header.lower().startswith("bearer "):
        token = auth_header.split(" ", 1)[1].strip()
    return decode_token(token)

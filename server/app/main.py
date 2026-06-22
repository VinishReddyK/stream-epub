from __future__ import annotations

import asyncio
import logging
import os
import tempfile
from pathlib import Path

import httpx
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

from .auth import authenticate, change_password, create_token, current_user, decode_token, get_settings, update_settings
from .config import (
    BACKGROUND_NOISE_AMPLITUDE,
    DEFAULT_CHUNK_CHARS,
    DEFAULT_CHUNK_CONCURRENCY,
    DEFAULT_TTS_BASE_URL,
    DEFAULT_TTS_ENGINE,
    DEFAULT_TTS_LANGUAGE,
    DEFAULT_TTS_MODEL,
    DEFAULT_TTS_PROVIDER,
    DEFAULT_TTS_VOICE,
)
from .jobs import store
from .services.audio import (
    NOISE_COLORS,
    list_ambience_categories,
    list_ambience_files,
    list_voicebox_effect_presets,
    list_voicebox_profiles,
    render_ambience_preview,
    render_noise_preview,
    resolve_ambience_file,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("stream_epub")

app = FastAPI(title="Stream EPUB")


app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_origin_regex=".*",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


class LoginRequest(BaseModel):
    username: str
    password: str


class PasswordRequest(BaseModel):
    current_password: str
    new_password: str


class SettingsRequest(BaseModel):
    settings: dict


class StartRequest(BaseModel):
    base_url: str = DEFAULT_TTS_BASE_URL
    provider: str = DEFAULT_TTS_PROVIDER
    model: str = DEFAULT_TTS_MODEL
    voice: str = DEFAULT_TTS_VOICE
    engine: str = DEFAULT_TTS_ENGINE
    language: str = DEFAULT_TTS_LANGUAGE
    effects_chain: list[dict] | None = None
    chunk_chars: int = DEFAULT_CHUNK_CHARS
    chunk_concurrency: int = DEFAULT_CHUNK_CONCURRENCY
    from_index: int | None = None
    to_index: int | None = None
    noise_color: str | None = None
    noise_amplitude: float = 0
    ambience_category: str | None = None
    ambience_file: str | None = None
    ambience_amplitude: float = 0
    ambience_random: bool = False


class ListeningProgressRequest(BaseModel):
    chapter_index: int
    position_seconds: float


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.post("/api/auth/login")
def login(body: LoginRequest) -> dict:
    if not authenticate(body.username, body.password):
        raise HTTPException(status_code=401, detail="Invalid username or password.")
    return {"access_token": create_token(body.username), "token_type": "bearer", "username": body.username}


@app.get("/api/auth/me")
def me(user: str = Depends(current_user)) -> dict:
    return {"username": user}


@app.post("/api/auth/password")
def update_password(body: PasswordRequest, user: str = Depends(current_user)) -> dict:
    change_password(user, body.current_password, body.new_password)
    return {"ok": True}


@app.get("/api/settings")
def read_settings(user: str = Depends(current_user)) -> dict:
    return get_settings(user)


@app.put("/api/settings")
def save_settings(body: SettingsRequest, user: str = Depends(current_user)) -> dict:
    return update_settings(user, body.settings)


@app.get("/api/tts/voicebox/profiles")
async def voicebox_profiles(base_url: str = DEFAULT_TTS_BASE_URL, user: str = Depends(current_user)) -> list[dict]:
    try:
        profiles = await list_voicebox_profiles(base_url)
    except httpx.HTTPError as exc:
        logger.error("Could not reach voicebox at %s: %s", base_url, exc)
        raise HTTPException(status_code=502, detail=f"Could not reach voicebox at {base_url}: {exc}") from exc
    return [{"id": profile["id"], "name": profile["name"]} for profile in profiles]


@app.get("/api/tts/voicebox/effects")
async def voicebox_effects(base_url: str = DEFAULT_TTS_BASE_URL, user: str = Depends(current_user)) -> list[dict]:
    try:
        presets = await list_voicebox_effect_presets(base_url)
    except httpx.HTTPError as exc:
        logger.error("Could not reach voicebox at %s: %s", base_url, exc)
        raise HTTPException(status_code=502, detail=f"Could not reach voicebox at {base_url}: {exc}") from exc
    return [{"id": preset["id"], "name": preset["name"], "effects_chain": preset["effects_chain"]} for preset in presets]


@app.get("/api/tts/noise/preview")
async def noise_preview(
    color: str = "white", amplitude: float = BACKGROUND_NOISE_AMPLITUDE, user: str = Depends(current_user)
) -> FileResponse:
    if color not in NOISE_COLORS:
        raise HTTPException(status_code=400, detail=f"Unsupported noise color: {color}")
    fd, tmp_name = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    tmp_path = Path(tmp_name)
    try:
        await asyncio.to_thread(render_noise_preview, tmp_path, color, amplitude)
    except RuntimeError as exc:
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return FileResponse(
        tmp_path, media_type="audio/wav", background=BackgroundTask(tmp_path.unlink, missing_ok=True)
    )


@app.get("/api/ambience/categories")
async def ambience_categories(user: str = Depends(current_user)) -> list[dict]:
    return [{"id": cat, "name": cat.replace("_", " ").replace("-", " ").title()} for cat in list_ambience_categories()]


@app.get("/api/ambience/categories/{category}/files")
async def ambience_files(category: str, user: str = Depends(current_user)) -> list[dict]:
    try:
        files = list_ambience_files(category)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return [{"id": item, "name": item.replace("_", " ").replace("-", " ").title()} for item in files]


@app.get("/api/tts/ambience/preview")
async def ambience_preview(
    category: str, file: str, amplitude: float = BACKGROUND_NOISE_AMPLITUDE, user: str = Depends(current_user)
) -> FileResponse:
    try:
        ambience_path = resolve_ambience_file(category, file)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    fd, tmp_name = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    tmp_path = Path(tmp_name)
    try:
        await asyncio.to_thread(render_ambience_preview, ambience_path, tmp_path, amplitude)
    except RuntimeError as exc:
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return FileResponse(
        tmp_path, media_type="audio/wav", background=BackgroundTask(tmp_path.unlink, missing_ok=True)
    )


@app.websocket("/api/ws/jobs")
async def jobs_ws(websocket: WebSocket, token: str = "") -> None:
    try:
        user = decode_token(token)
    except HTTPException:
        await websocket.close(code=4401)
        return

    await websocket.accept()
    queue = store.subscribe(user)
    disconnected = asyncio.Event()

    async def watch_disconnect() -> None:
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            disconnected.set()

    watcher = asyncio.create_task(watch_disconnect())
    try:
        await websocket.send_json(await store.list_jobs(user))
        while not disconnected.is_set():
            try:
                await asyncio.wait_for(queue.get(), timeout=30)
            except asyncio.TimeoutError:
                pass
            if disconnected.is_set():
                break
            await websocket.send_json(await store.list_jobs(user))
    finally:
        watcher.cancel()
        store.unsubscribe(user, queue)


@app.get("/api/jobs")
async def list_jobs(user: str = Depends(current_user)) -> list[dict]:
    return await store.list_jobs(user)


@app.post("/api/jobs")
async def create_job(file: UploadFile = File(...), user: str = Depends(current_user)) -> dict:
    try:
        return await store.create_job(user, file)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/jobs/{job_id}")
async def get_job(job_id: str, user: str = Depends(current_user)) -> dict:
    try:
        return await store.get_job(job_id, user)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found.") from exc


@app.post("/api/jobs/{job_id}/start")
async def start_job(job_id: str, body: StartRequest, user: str = Depends(current_user)) -> dict:
    try:
        return await store.start(job_id, user, body.model_dump())
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found.") from exc


@app.post("/api/jobs/{job_id}/stop")
async def stop_job(job_id: str, user: str = Depends(current_user)) -> dict:
    try:
        return await store.stop(job_id, user)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found.") from exc


@app.post("/api/jobs/{job_id}/chapters/{chapter_index}/regenerate")
async def regenerate_chapter(
    job_id: str, chapter_index: int, body: StartRequest, user: str = Depends(current_user)
) -> dict:
    try:
        return await store.regenerate_chapter(job_id, user, chapter_index, body.model_dump())
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job or chapter not found.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/jobs/{job_id}/chapters/{chapter_index}/stop")
async def stop_chapter(job_id: str, chapter_index: int, user: str = Depends(current_user)) -> dict:
    try:
        return await store.stop_chapter(job_id, user, chapter_index)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job or chapter not found.") from exc


@app.post("/api/jobs/{job_id}/listening-progress")
async def update_listening_progress(
    job_id: str, body: ListeningProgressRequest, user: str = Depends(current_user)
) -> dict:
    try:
        return await store.update_listening_progress(job_id, user, body.chapter_index, body.position_seconds)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job or chapter not found.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete("/api/jobs/{job_id}/chapters/{chapter_index}")
async def delete_chapter(job_id: str, chapter_index: int, user: str = Depends(current_user)) -> dict:
    try:
        return await store.delete_chapter(job_id, user, chapter_index)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job or chapter not found.") from exc


@app.delete("/api/jobs/{job_id}")
async def delete_job(job_id: str, user: str = Depends(current_user)) -> dict:
    try:
        await store.delete_job(job_id, user)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found.") from exc
    return {"ok": True}


@app.post("/api/jobs/{job_id}/pack-partial")
async def pack_partial(job_id: str, user: str = Depends(current_user)) -> dict:
    try:
        return await store.pack_partial(job_id, user)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found.") from exc


async def _chapter_file(job_id: str, chapter_index: int, user: str) -> tuple[dict, Path]:
    job = await store.get_job(job_id, user)
    chapter = next((item for item in job["chapters"] if item["index"] == chapter_index), None)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found.")
    path = Path(job["paths"]["chapters"]) / f"{chapter['filename_base']}.m4a"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Chapter audio is not ready yet.")
    return chapter, path


@app.get("/api/jobs/{job_id}/chapters/{chapter_index}/stream")
async def stream_chapter(job_id: str, chapter_index: int, user: str = Depends(current_user)) -> FileResponse:
    _chapter, path = await _chapter_file(job_id, chapter_index, user)
    return FileResponse(path, media_type="audio/mp4", headers={"Accept-Ranges": "bytes"})


@app.get("/api/jobs/{job_id}/chapters/{chapter_index}/download")
async def download_chapter(job_id: str, chapter_index: int, user: str = Depends(current_user)) -> FileResponse:
    chapter, path = await _chapter_file(job_id, chapter_index, user)
    return FileResponse(path, media_type="audio/mp4", filename=f"{chapter['index']:03d}-{chapter['title']}.m4a")


@app.get("/api/jobs/{job_id}/m4b")
async def download_m4b(job_id: str, user: str = Depends(current_user)) -> FileResponse:
    job = await store.get_job(job_id, user)
    path = Path(job["paths"]["output"])
    if not path.exists():
        raise HTTPException(status_code=404, detail="M4B is not ready yet.")
    return FileResponse(path, media_type="audio/mp4", filename=path.name)


@app.get("/api/jobs/{job_id}/partial-m4b")
async def download_partial_m4b(job_id: str, user: str = Depends(current_user)) -> FileResponse:
    job = await store.get_job(job_id, user)
    path = Path(job["paths"]["output"]).with_name(f"{Path(job['paths']['output']).stem}-partial.m4b")
    if not path.exists():
        raise HTTPException(status_code=404, detail="Partial M4B is not ready yet.")
    return FileResponse(path, media_type="audio/mp4", filename=path.name)

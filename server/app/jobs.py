from __future__ import annotations

import asyncio
import json
import random
import re
import shutil
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import UploadFile

from .config import DEFAULT_CHUNK_CHARS, DEFAULT_CHUNK_CONCURRENCY, JOBS_FILE, OUTPUT_DIR, UPLOAD_DIR, WORK_DIR
from .epub_parser import parse_epub
from .services.audio import (
    add_ambience,
    add_background_noise,
    build_m4b,
    chunk_text,
    concat_audio,
    list_ambience_categories,
    list_ambience_files,
    make_silence,
    probe_duration_ms,
    resolve_ambience_file,
    synthesize_chunk,
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_name(value: str) -> str:
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value).strip()
    value = re.sub(r"\s+", " ", value)
    return value[:90] or "book"


class JobStore:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._tasks: dict[str, asyncio.Task] = {}
        self._listeners: dict[str, set[asyncio.Queue]] = {}
        self._chapter_queues: dict[str, asyncio.Queue] = {}
        self._worker_locks: dict[str, asyncio.Lock] = {}
        self._worker_active: dict[str, bool] = {}
        self._pending: dict[str, set[int]] = {}
        self._current_chapter: dict[str, int] = {}
        self._stopping: dict[str, bool] = {}
        self._chunk_timestamps: dict[str, list[float]] = {}
        if not JOBS_FILE.exists():
            self._write({"jobs": {}})

    def _read(self) -> dict[str, Any]:
        return json.loads(JOBS_FILE.read_text(encoding="utf-8"))

    def _write(self, data: dict[str, Any]) -> None:
        JOBS_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = JOBS_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
        tmp.replace(JOBS_FILE)

    def subscribe(self, user: str) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        self._listeners.setdefault(user, set()).add(queue)
        return queue

    def unsubscribe(self, user: str, queue: asyncio.Queue) -> None:
        self._listeners.get(user, set()).discard(queue)

    def _notify(self, user: str) -> None:
        for queue in self._listeners.get(user, ()):
            queue.put_nowait(None)

    def _annotate_job(self, job: dict[str, Any]) -> dict[str, Any]:
        pending = self._pending.get(job["id"], set())
        for chapter in job["chapters"]:
            chapter["pending"] = chapter["index"] in pending

        timestamps = self._chunk_timestamps.get(job["id"], [])
        now = time.monotonic()
        recent = [t for t in timestamps if now - t <= 60]
        rate = len(recent) / (now - recent[0]) if len(recent) >= 2 else 0.0
        remaining = max(job["progress"]["chunks_total"] - job["progress"]["chunks_done"], 0)
        job["progress"]["chunks_per_second"] = round(rate, 3)
        job["progress"]["eta_seconds"] = round(remaining / rate) if rate > 0 else None
        return job

    @staticmethod
    def _fill_missing_durations(job: dict[str, Any]) -> bool:
        changed = False
        chapter_dir = Path(job["paths"]["chapters"])
        for chapter in job["chapters"]:
            if chapter.get("status") != "done" or chapter.get("duration_ms"):
                continue
            path = chapter_dir / f"{chapter['filename_base']}.m4a"
            if not path.exists():
                continue
            try:
                chapter["duration_ms"] = probe_duration_ms(path)
                changed = True
            except Exception:
                continue
        return changed

    async def list_jobs(self, user: str) -> list[dict[str, Any]]:
        async with self._lock:
            data = self._read()
            jobs = data["jobs"].values()
            owned = sorted(
                [job for job in jobs if job.get("owner") == user],
                key=lambda item: item.get("created_at", ""),
                reverse=True,
            )
            if any(self._fill_missing_durations(job) for job in owned):
                self._write(data)
            return [self._annotate_job(job) for job in owned]

    async def get_job(self, job_id: str, user: str) -> dict[str, Any]:
        async with self._lock:
            data = self._read()
            job = data["jobs"].get(job_id)
            if not job or job.get("owner") != user:
                raise KeyError(job_id)
            if self._fill_missing_durations(job):
                self._write(data)
            return self._annotate_job(job)

    async def create_job(self, user: str, upload: UploadFile) -> dict[str, Any]:
        if not upload.filename or not upload.filename.lower().endswith(".epub"):
            raise ValueError("Upload an .epub file.")

        job_id = uuid.uuid4().hex
        job_dir = WORK_DIR / job_id
        chapter_dir = job_dir / "chapters"
        chunks_dir = job_dir / "chunks"
        extract_dir = job_dir / "extract"
        for directory in [job_dir, chapter_dir, chunks_dir, extract_dir]:
            directory.mkdir(parents=True, exist_ok=True)

        epub_path = UPLOAD_DIR / f"{job_id}.epub"
        with epub_path.open("wb") as file:
            shutil.copyfileobj(upload.file, file)

        book, cover = parse_epub(epub_path)
        if not book.chapters:
            raise ValueError("No readable chapters were found in that EPUB.")
        cover_path = extract_dir / "cover.jpg"
        if cover:
            cover_path.write_bytes(cover)

        output_path = OUTPUT_DIR / f"{safe_name(book.title)}-{job_id[:8]}.m4b"
        chapters = []
        for chapter in book.chapters:
            text_path = extract_dir / f"{chapter.filename_base}.txt"
            text_path.write_text(chapter.text, encoding="utf-8")
            chapters.append(
                {
                    "index": chapter.index,
                    "title": chapter.title,
                    "word_count": chapter.word_count,
                    "filename_base": chapter.filename_base,
                    "status": "queued",
                    "chunks_done": 0,
                    "chunks_total": len(chunk_text(chapter.text, DEFAULT_CHUNK_CHARS)),
                    "duration_ms": None,
                    "audio_url": None,
                    "download_url": None,
                    "error": None,
                }
            )

        job = {
            "id": job_id,
            "owner": user,
            "status": "ready",
            "created_at": now_iso(),
            "updated_at": now_iso(),
            "book": {"title": book.title, "author": book.author, "language": book.language},
            "paths": {
                "epub": str(epub_path),
                "work": str(job_dir),
                "extract": str(extract_dir),
                "chapters": str(chapter_dir),
                "chunks": str(chunks_dir),
                "cover": str(cover_path) if cover else None,
                "output": str(output_path),
            },
            "settings": {"chunk_chars": DEFAULT_CHUNK_CHARS},
            "progress": {
                "chapters_done": 0,
                "chapters_total": len(chapters),
                "chunks_done": 0,
                "chunks_total": sum(c["chunks_total"] for c in chapters),
            },
            "chapters": chapters,
            "listening_progress": None,
            "m4b_url": None,
            "partial_m4b_url": None,
            "error": None,
        }
        async with self._lock:
            data = self._read()
            data["jobs"][job_id] = job
            self._write(data)
        self._notify(user)
        return job

    async def patch_job(self, job_id: str, updates: dict[str, Any]) -> dict[str, Any]:
        async with self._lock:
            data = self._read()
            job = data["jobs"][job_id]
            job.update(updates)
            job["updated_at"] = now_iso()
            self._write(data)
        self._notify(job["owner"])
        return job

    async def mutate_job(self, job_id: str, mutator) -> dict[str, Any]:
        async with self._lock:
            data = self._read()
            job = data["jobs"][job_id]
            mutator(job)
            job["updated_at"] = now_iso()
            self._write(data)
        self._notify(job["owner"])
        return job

    async def _enqueue_chapters(
        self, job_id: str, user: str, chapters: list[tuple[int, dict[str, Any]]]
    ) -> None:
        lock = self._worker_locks.setdefault(job_id, asyncio.Lock())
        async with lock:
            queue = self._chapter_queues.setdefault(job_id, asyncio.Queue())
            pending = self._pending.setdefault(job_id, set())
            for chapter_index, options in chapters:
                if chapter_index in pending:
                    continue
                pending.add(chapter_index)
                queue.put_nowait((chapter_index, options))
            if not self._worker_active.get(job_id):
                self._worker_active[job_id] = True
                self._stopping[job_id] = False
                self._tasks[job_id] = asyncio.create_task(self._worker_loop(job_id, user))
        self._notify(user)

    async def start(self, job_id: str, user: str, options: dict[str, Any]) -> dict[str, Any]:
        job = await self.get_job(job_id, user)
        from_index = options.get("from_index")
        to_index = options.get("to_index")
        targets = [
            (chapter["index"], options)
            for chapter in job["chapters"]
            if chapter["status"] != "done"
            and (from_index is None or chapter["index"] >= from_index)
            and (to_index is None or chapter["index"] <= to_index)
        ]
        await self._enqueue_chapters(job_id, user, targets)
        return await self.get_job(job_id, user)

    async def stop(self, job_id: str, user: str) -> dict[str, Any]:
        await self.get_job(job_id, user)
        self._stopping[job_id] = True
        task = self._tasks.get(job_id)
        if task and not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        lock = self._worker_locks.setdefault(job_id, asyncio.Lock())
        async with lock:
            self._worker_active[job_id] = False
            self._current_chapter.pop(job_id, None)
            queue = self._chapter_queues.get(job_id)
            if queue:
                while not queue.empty():
                    queue.get_nowait()
            self._pending[job_id] = set()
            self._chunk_timestamps[job_id] = []
        self._stopping[job_id] = False
        return await self.patch_job(job_id, {"status": "stopped"})

    async def stop_chapter(self, job_id: str, user: str, chapter_index: int) -> dict[str, Any]:
        job = await self.get_job(job_id, user)
        chapter = next((item for item in job["chapters"] if item["index"] == chapter_index), None)
        if not chapter:
            raise KeyError(chapter_index)

        lock = self._worker_locks.setdefault(job_id, asyncio.Lock())
        mark_stopped = False
        async with lock:
            if self._current_chapter.get(job_id) == chapter_index:
                task = self._tasks.get(job_id)
                if task and not task.done():
                    task.cancel()
            else:
                queue = self._chapter_queues.get(job_id)
                if queue:
                    remaining = []
                    while not queue.empty():
                        item = queue.get_nowait()
                        if item[0] != chapter_index:
                            remaining.append(item)
                    for item in remaining:
                        queue.put_nowait(item)
                pending = self._pending.get(job_id, set())
                if chapter_index in pending:
                    pending.discard(chapter_index)
                    mark_stopped = True

        if mark_stopped:
            await self.mutate_job(job_id, lambda item, idx=chapter_index: self._mark_chapter(item, idx, "stopped"))

        return await self.get_job(job_id, user)

    async def update_listening_progress(
        self, job_id: str, user: str, chapter_index: int, position_seconds: float
    ) -> dict[str, Any]:
        job = await self.get_job(job_id, user)
        chapter = next((item for item in job["chapters"] if item["index"] == chapter_index), None)
        if not chapter:
            raise KeyError(chapter_index)
        if chapter.get("status") != "done":
            raise ValueError("Chapter audio is not ready yet.")

        position = max(0.0, float(position_seconds))
        await self.mutate_job(job_id, lambda item, idx=chapter_index, seconds=position: self._mark_listening_progress(item, idx, seconds))
        return await self.get_job(job_id, user)

    @staticmethod
    def _mark_listening_progress(job: dict[str, Any], chapter_index: int, position_seconds: float) -> None:
        progress = job.get("listening_progress") or {}
        positions = dict(progress.get("chapter_positions") or {})
        positions[str(chapter_index)] = round(position_seconds, 2)
        job["listening_progress"] = {
            "chapter_index": chapter_index,
            "position_seconds": round(position_seconds, 2),
            "chapter_positions": positions,
            "updated_at": now_iso(),
        }

    async def delete_chapter(self, job_id: str, user: str, chapter_index: int) -> dict[str, Any]:
        job = await self.get_job(job_id, user)
        chapter = next((item for item in job["chapters"] if item["index"] == chapter_index), None)
        if not chapter:
            raise KeyError(chapter_index)

        lock = self._worker_locks.setdefault(job_id, asyncio.Lock())
        async with lock:
            if self._current_chapter.get(job_id) == chapter_index:
                task = self._tasks.get(job_id)
                if task and not task.done():
                    task.cancel()
            else:
                queue = self._chapter_queues.get(job_id)
                if queue:
                    remaining = []
                    while not queue.empty():
                        item = queue.get_nowait()
                        if item[0] != chapter_index:
                            remaining.append(item)
                    for item in remaining:
                        queue.put_nowait(item)
            self._pending.get(job_id, set()).discard(chapter_index)

        chunks_dir = Path(job["paths"]["chunks"])
        for chunk_path in chunks_dir.glob(f"{chapter['filename_base']}_*.wav"):
            chunk_path.unlink(missing_ok=True)
        chapter_dir = Path(job["paths"]["chapters"])
        (chapter_dir / f"{chapter['filename_base']}.wav").unlink(missing_ok=True)
        (chapter_dir / f"{chapter['filename_base']}.m4a").unlink(missing_ok=True)

        await self.mutate_job(job_id, lambda item, idx=chapter_index: self._reset_chapter(item, idx))
        return await self.get_job(job_id, user)

    async def regenerate_chapter(
        self, job_id: str, user: str, chapter_index: int, options: dict[str, Any]
    ) -> dict[str, Any]:
        job = await self.get_job(job_id, user)
        chapter = next((item for item in job["chapters"] if item["index"] == chapter_index), None)
        if not chapter:
            raise KeyError(chapter_index)
        if chapter_index in self._pending.get(job_id, set()):
            return job

        chunks_dir = Path(job["paths"]["chunks"])
        for chunk_path in chunks_dir.glob(f"{chapter['filename_base']}_*.wav"):
            chunk_path.unlink(missing_ok=True)
        chapter_dir = Path(job["paths"]["chapters"])
        (chapter_dir / f"{chapter['filename_base']}.wav").unlink(missing_ok=True)
        (chapter_dir / f"{chapter['filename_base']}.m4a").unlink(missing_ok=True)

        await self.mutate_job(job_id, lambda item, idx=chapter_index: self._reset_chapter(item, idx))
        await self._enqueue_chapters(job_id, user, [(chapter_index, options)])
        return await self.get_job(job_id, user)

    async def delete_job(self, job_id: str, user: str) -> None:
        job = await self.get_job(job_id, user)
        task = self._tasks.pop(job_id, None)
        if task and not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        self._chapter_queues.pop(job_id, None)
        self._worker_locks.pop(job_id, None)
        self._worker_active.pop(job_id, None)
        self._pending.pop(job_id, None)
        self._chunk_timestamps.pop(job_id, None)

        for key in ("work", "epub", "output"):
            path = job["paths"].get(key)
            if not path:
                continue
            path_obj = Path(path)
            if key == "output":
                for candidate in (path_obj, path_obj.with_name(f"{path_obj.stem}-partial.m4b")):
                    candidate.unlink(missing_ok=True)
            elif path_obj.is_dir():
                shutil.rmtree(path_obj, ignore_errors=True)
            else:
                path_obj.unlink(missing_ok=True)

        async with self._lock:
            data = self._read()
            data["jobs"].pop(job_id, None)
            self._write(data)
        self._notify(user)

    async def pack_partial(self, job_id: str, user: str) -> dict[str, Any]:
        job = await self.get_job(job_id, user)
        partial_path = Path(job["paths"]["output"]).with_name(f"{Path(job['paths']['output']).stem}-partial.m4b")
        await asyncio.to_thread(self._pack_available, job, partial_path)
        return await self.mutate_job(
            job_id,
            lambda item: item.update(
                {
                    "partial_m4b_url": f"/api/jobs/{job_id}/partial-m4b",
                    "updated_at": now_iso(),
                }
            ),
        )

    def _record_chunk_progress(self, job_id: str) -> None:
        now = time.monotonic()
        timestamps = self._chunk_timestamps.setdefault(job_id, [])
        timestamps.append(now)
        cutoff = now - 60
        while timestamps and timestamps[0] < cutoff:
            timestamps.pop(0)

    def _pack_available(self, job: dict[str, Any], output_path: Path) -> None:
        chapter_files = []
        chapter_dir = Path(job["paths"]["chapters"])
        for chapter in job["chapters"]:
            if chapter["status"] != "done":
                continue
            path = chapter_dir / f"{chapter['filename_base']}.m4a"
            if path.exists():
                chapter_files.append((path, chapter["title"]))
        cover = Path(job["paths"]["cover"]) if job["paths"].get("cover") else None
        build_m4b(job["book"]["title"], job["book"]["author"], chapter_files, output_path, cover)

    async def _worker_loop(self, job_id: str, user: str) -> None:
        lock = self._worker_locks[job_id]
        queue = self._chapter_queues[job_id]
        pending = self._pending[job_id]
        try:
            while True:
                async with lock:
                    if queue.empty():
                        self._worker_active[job_id] = False
                        self._current_chapter.pop(job_id, None)
                        break
                    chapter_index, options = queue.get_nowait()
                    self._current_chapter[job_id] = chapter_index

                await self.patch_job(job_id, {"status": "running", "error": None})
                try:
                    job = await self.get_job(job_id, user)
                    chapter = next((item for item in job["chapters"] if item["index"] == chapter_index), None)
                    if chapter:
                        silence_path = Path(job["paths"]["work"]) / "pause.wav"
                        if not silence_path.exists():
                            await asyncio.to_thread(make_silence, silence_path)
                        await self._synthesize_chapter(job_id, user, chapter, options, silence_path)
                except asyncio.CancelledError:
                    if self._stopping.get(job_id):
                        raise
                    await self.mutate_job(
                        job_id, lambda item, idx=chapter_index: self._mark_chapter(item, idx, "stopped")
                    )
                except Exception as exc:
                    await self.mutate_job(
                        job_id,
                        lambda item, idx=chapter_index, err=str(exc): self._mark_chapter_error(item, idx, err),
                    )
                finally:
                    pending.discard(chapter_index)
                    self._current_chapter.pop(job_id, None)

            job = await self.get_job(job_id, user)
            if all(item["status"] == "done" for item in job["chapters"]):
                await self.patch_job(job_id, {"status": "packing"})
                await asyncio.to_thread(self._pack_available, job, Path(job["paths"]["output"]))
                await self.patch_job(job_id, {"status": "done", "m4b_url": f"/api/jobs/{job_id}/m4b"})
            else:
                await self.patch_job(job_id, {"status": "ready"})
        except asyncio.CancelledError:
            async with lock:
                self._worker_active[job_id] = False
            raise
        except Exception as exc:
            async with lock:
                self._worker_active[job_id] = False
            await self.patch_job(job_id, {"status": "error", "error": str(exc)})

    @staticmethod
    def _pick_random_ambience() -> tuple[str | None, str | None]:
        categories = list_ambience_categories()
        if not categories:
            return None, None
        category = random.choice(categories)
        files = list_ambience_files(category)
        if not files:
            return None, None
        return category, random.choice(files)

    async def _synthesize_chapter(
        self,
        job_id: str,
        user: str,
        chapter: dict[str, Any],
        options: dict[str, Any],
        silence_path: Path,
    ) -> None:
        job = await self.get_job(job_id, user)
        chunk_chars = int(options.get("chunk_chars") or job["settings"]["chunk_chars"])
        base_url = options.get("base_url") or None
        provider = options.get("provider") or None
        model = options.get("model") or None
        voice = options.get("voice") or None
        engine = options.get("engine") or None
        language = options.get("language") or None
        effects_chain = options.get("effects_chain") or None
        chunk_concurrency = max(1, int(options.get("chunk_concurrency") or DEFAULT_CHUNK_CONCURRENCY))
        noise_color = options.get("noise_color") or None
        noise_amplitude = float(options.get("noise_amplitude") or 0)
        ambience_category = options.get("ambience_category") or None
        ambience_file = options.get("ambience_file") or None
        ambience_amplitude = float(options.get("ambience_amplitude") or 0)
        ambience_random = bool(options.get("ambience_random"))
        if ambience_random:
            ambience_category, ambience_file = self._pick_random_ambience()

        await self.mutate_job(job_id, lambda item, idx=chapter["index"]: self._mark_chapter(item, idx, "running"))
        text_path = Path(job["paths"]["extract"]) / f"{chapter['filename_base']}.txt"
        chunks = chunk_text(text_path.read_text(encoding="utf-8"), chunk_chars)
        chunk_paths = [
            Path(job["paths"]["chunks"]) / f"{chapter['filename_base']}_{i:04d}.wav"
            for i in range(1, len(chunks) + 1)
        ]
        missing_chunks = [
            (text, chunk_path)
            for text, chunk_path in zip(chunks, chunk_paths)
            if not chunk_path.exists()
        ]
        await self.mutate_job(
            job_id,
            lambda item, idx=chapter["index"], total=len(chunks), done=len(chunks) - len(missing_chunks): self._prepare_chapter_chunks(
                item,
                idx,
                total,
                done,
            ),
        )
        semaphore = asyncio.Semaphore(chunk_concurrency)

        async def synthesize_one(text: str, chunk_path: Path) -> None:
            async with semaphore:
                await synthesize_chunk(
                    text,
                    chunk_path,
                    **{
                        k: v
                        for k, v in {
                            "base_url": base_url,
                            "provider": provider,
                            "model": model,
                            "voice": voice,
                            "engine": engine,
                            "language": language,
                            "effects_chain": effects_chain,
                        }.items()
                        if v
                    },
                )
                self._record_chunk_progress(job_id)
                await self.mutate_job(
                    job_id,
                    lambda item, idx=chapter["index"], total=len(chunks): self._mark_chunk(item, idx, total),
                )

        tasks = [
            asyncio.create_task(synthesize_one(text, chunk_path))
            for text, chunk_path in missing_chunks
        ]
        try:
            await asyncio.gather(*tasks)
        except Exception:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            raise

        wav_path = Path(job["paths"]["chapters"]) / f"{chapter['filename_base']}.wav"
        m4a_path = Path(job["paths"]["chapters"]) / f"{chapter['filename_base']}.m4a"
        chapter_inputs: list[Path] = []
        for chunk_path in chunk_paths:
            chapter_inputs.append(chunk_path)
            chapter_inputs.append(silence_path)
        await asyncio.to_thread(concat_audio, chapter_inputs[:-1], wav_path, ["-c:a", "pcm_s16le"])
        if ambience_category and ambience_file and ambience_amplitude > 0:
            ambience_path = resolve_ambience_file(ambience_category, ambience_file)
            mixed_path = wav_path.with_name(f"{wav_path.stem}_bg.wav")
            await asyncio.to_thread(add_ambience, wav_path, mixed_path, ambience_path, ambience_amplitude)
            mixed_path.replace(wav_path)
        elif noise_color and noise_amplitude > 0:
            noisy_path = wav_path.with_name(f"{wav_path.stem}_noise.wav")
            await asyncio.to_thread(add_background_noise, wav_path, noisy_path, noise_amplitude, noise_color)
            noisy_path.replace(wav_path)
        await asyncio.to_thread(concat_audio, [wav_path], m4a_path, ["-c:a", "aac", "-b:a", "192k", "-ar", "44100"])
        duration_ms = await asyncio.to_thread(probe_duration_ms, m4a_path)
        await self.mutate_job(
            job_id,
            lambda item, idx=chapter["index"], duration=duration_ms: self._mark_chapter_done(item, idx, job_id, duration),
        )

    @staticmethod
    def _mark_chapter(job: dict[str, Any], index: int, status: str) -> None:
        for chapter in job["chapters"]:
            if chapter["index"] == index:
                chapter["status"] = status
                chapter["error"] = None

    @staticmethod
    def _reset_chapter(job: dict[str, Any], index: int) -> None:
        for chapter in job["chapters"]:
            if chapter["index"] == index:
                chapter["status"] = "queued"
                chapter["chunks_done"] = 0
                chapter["duration_ms"] = None
                chapter["audio_url"] = None
                chapter["download_url"] = None
                chapter["error"] = None
        job["progress"]["chapters_done"] = sum(1 for item in job["chapters"] if item["status"] == "done")
        job["progress"]["chunks_done"] = sum(item["chunks_done"] for item in job["chapters"])

    @staticmethod
    def _mark_chapter_error(job: dict[str, Any], index: int, error: str) -> None:
        for chapter in job["chapters"]:
            if chapter["index"] == index:
                chapter["status"] = "error"
                chapter["error"] = error

    @staticmethod
    def _mark_chunk(job: dict[str, Any], index: int, total: int) -> None:
        for chapter in job["chapters"]:
            if chapter["index"] == index:
                if chapter["chunks_done"] < total:
                    chapter["chunks_done"] += 1
                    job["progress"]["chunks_done"] += 1
                chapter["chunks_total"] = total

    @staticmethod
    def _mark_chapter_done(job: dict[str, Any], index: int, job_id: str, duration_ms: int) -> None:
        for chapter in job["chapters"]:
            if chapter["index"] == index:
                chapter["status"] = "done"
                chapter["chunks_done"] = chapter["chunks_total"]
                chapter["duration_ms"] = duration_ms
                chapter["audio_url"] = f"/api/jobs/{job_id}/chapters/{index}/stream"
                chapter["download_url"] = f"/api/jobs/{job_id}/chapters/{index}/download"
                job["progress"]["chapters_done"] = sum(1 for item in job["chapters"] if item["status"] == "done")

    @staticmethod
    def _prepare_chapter_chunks(job: dict[str, Any], index: int, total: int, done: int) -> None:
        for chapter in job["chapters"]:
            if chapter["index"] == index:
                chapter["chunks_total"] = total
                chapter["chunks_done"] = done
        job["progress"]["chunks_done"] = sum(item["chunks_done"] for item in job["chapters"])
        job["progress"]["chunks_total"] = sum(item["chunks_total"] for item in job["chapters"])


store = JobStore()

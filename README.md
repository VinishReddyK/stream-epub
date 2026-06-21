# Stream EPUB

Prototype for turning EPUB files into streamable chapter audio and downloadable `.m4b` audiobooks through an OpenAI-compatible TTS API.

The backend does not load or manage models. It calls a TTS server, defaulting to:

```sh
http://127.0.0.1:17493
```

with:

```sh
mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16
```

## Features

- FastAPI backend in `server/`
- React + Tailwind UI in `ui/`
- Simple JWT auth, default login `admin` / `admin`
- Password change from the UI
- Reflecting CORS origin support for browser clients without using `*`
- EPUB parsing adapted from the sibling `zipcast` project
- Upload EPUB, inspect chapters, start generation
- Per-chapter generation progress
- Stream and download each chapter as soon as it is ready
- Pack currently generated chapters into a partial `.m4b`
- Pack the full `.m4b` automatically when every chapter is done
- Durable job state and generated files under `data/`

## Requirements

- Python 3.11+
- Node 20+
- `ffmpeg` and `ffprobe` available on `PATH`
- An OpenAI-compatible audio speech endpoint at `/v1/audio/speech`

## Backend

```sh
cd server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Useful environment variables:

```sh
TTS_BASE_URL=http://127.0.0.1:17493
TTS_MODEL=mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16
TTS_VOICE=alloy
STREAM_EPUB_JWT_SECRET=replace-this
STREAM_EPUB_DATA_DIR=/absolute/path/to/data
```

## UI

```sh
cd ui
npm install
npm run dev
```

Open the printed Vite URL and log in with `admin` / `admin`.

If the backend is not on `http://127.0.0.1:8000`, start the UI with:

```sh
VITE_API_BASE_URL=http://127.0.0.1:8000 npm run dev
```

## Notes

This is intentionally a prototype. The data store is JSON-on-disk, and there is a single built-in admin user. The API boundaries are shaped so SQLite/Postgres, signup, queues, cancellation, server-sent progress, and true byte-range streaming can be added without rewriting the EPUB/TTS/M4B flow.

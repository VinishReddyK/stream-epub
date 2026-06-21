import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChevronLeft, ChevronRight, Download, KeyRound, Loader2, LogOut, Package, Play, RefreshCw, Search, Shuffle, Square, Trash2, Upload, Volume2 } from "lucide-react";
import "./styles.css";

const API = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";
const DEFAULT_TTS_BASE_URL = "http://127.0.0.1:17493";
const DEFAULT_TTS_PROFILE = "f275c129-9d3b-40fc-9cc1-90a62bb93a98";
const DEFAULT_TTS_LANGUAGE = "en";
const DEFAULT_TTS_ENGINE = "qwen";
const DEFAULT_TTS_MODEL = "0.6B";
const DEFAULT_CHUNK_CHARS = 1000;
const DEFAULT_CHUNK_CONCURRENCY = 10;
const DEFAULT_NOISE_AMPLITUDE = 0.01;
const DEFAULT_AMBIENCE_AMPLITUDE = 0.1;
const CHAPTER_PAGE_SIZE_OPTIONS = [5, 10, 20, 50, 100];
const DEFAULT_CHAPTER_PAGE_SIZE = 5;

const NOISE_COLORS = [
  { id: "white", name: "White" },
  { id: "pink", name: "Pink" },
  { id: "brown", name: "Brown" },
  { id: "blue", name: "Blue" },
  { id: "violet", name: "Violet" },
  { id: "velvet", name: "Velvet" },
];

type BackgroundMode = "none" | "noise" | "ambience";

type AmbienceOption = { id: string; name: string };

const LANGUAGES = [
  { id: "en", name: "English" },
  { id: "zh", name: "Chinese" },
  { id: "ja", name: "Japanese" },
  { id: "ko", name: "Korean" },
  { id: "de", name: "German" },
  { id: "fr", name: "French" },
  { id: "ru", name: "Russian" },
  { id: "pt", name: "Portuguese" },
  { id: "es", name: "Spanish" },
  { id: "it", name: "Italian" },
  { id: "he", name: "Hebrew" },
  { id: "ar", name: "Arabic" },
  { id: "da", name: "Danish" },
  { id: "el", name: "Greek" },
  { id: "fi", name: "Finnish" },
  { id: "hi", name: "Hindi" },
  { id: "ms", name: "Malay" },
  { id: "nl", name: "Dutch" },
  { id: "no", name: "Norwegian" },
  { id: "pl", name: "Polish" },
  { id: "sv", name: "Swedish" },
  { id: "sw", name: "Swahili" },
  { id: "tr", name: "Turkish" },
];

type ModelOption = { id: string; engine: string; model: string; name: string };

const MODEL_OPTIONS: ModelOption[] = [
  { id: "qwen-0.6B", engine: "qwen", model: "0.6B", name: "Qwen TTS 0.6B" },
  { id: "qwen-1.7B", engine: "qwen", model: "1.7B", name: "Qwen TTS 1.7B" },
  { id: "qwen_custom_voice-0.6B", engine: "qwen_custom_voice", model: "0.6B", name: "Qwen CustomVoice 0.6B" },
  { id: "qwen_custom_voice-1.7B", engine: "qwen_custom_voice", model: "1.7B", name: "Qwen CustomVoice 1.7B" },
  { id: "luxtts", engine: "luxtts", model: "", name: "LuxTTS (Fast, CPU-friendly)" },
  { id: "chatterbox", engine: "chatterbox", model: "", name: "Chatterbox TTS (Multilingual)" },
  { id: "chatterbox_turbo", engine: "chatterbox_turbo", model: "", name: "Chatterbox Turbo (English, Tags)" },
  { id: "tada-1B", engine: "tada", model: "1B", name: "TADA 1B (English)" },
  { id: "tada-3B", engine: "tada", model: "3B", name: "TADA 3B Multilingual" },
  { id: "kokoro", engine: "kokoro", model: "", name: "Kokoro 82M" },
];

type VoiceProfile = {
  id: string;
  name: string;
};

type EffectPreset = {
  id: string;
  name: string;
  effects_chain: Record<string, unknown>[];
};

type Chapter = {
  index: number;
  title: string;
  word_count: number;
  status: string;
  chunks_done: number;
  chunks_total: number;
  duration_ms?: number | null;
  audio_url: string | null;
  download_url: string | null;
  pending: boolean;
};

type Job = {
  id: string;
  status: string;
  created_at: string;
  updated_at: string;
  book: { title: string; author: string; language: string };
  progress: {
    chapters_done: number;
    chapters_total: number;
    chunks_done: number;
    chunks_total: number;
    chunks_per_second: number;
    eta_seconds: number | null;
  };
  chapters: Chapter[];
  m4b_url: string | null;
  partial_m4b_url: string | null;
  error: string | null;
};

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function apiUrl(path: string) {
  return `${API}${path}`;
}

function wsUrl(path: string, token: string) {
  const separator = path.includes("?") ? "&" : "?";
  return `${API.replace(/^http/, "ws")}${path}${separator}token=${encodeURIComponent(token)}`;
}

function authedMediaUrl(path: string, token: string) {
  const separator = path.includes("?") ? "&" : "?";
  return apiUrl(`${path}${separator}token=${encodeURIComponent(token)}`);
}

async function request<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(apiUrl(path), { ...init, headers });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || res.statusText);
  return res.json();
}

function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const result = await fetch(apiUrl("/api/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      if (!result.ok) throw new Error("Login failed");
      const data = await result.json();
      localStorage.setItem("stream_epub_token", data.access_token);
      onLogin(data.access_token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }

  return (
    <main className="min-h-screen grid place-items-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-lg border border-line bg-cream p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Stream EPUB</h1>
        <p className="mt-1 text-sm text-ink/65">Sign in to generate chapter audio and M4B audiobooks.</p>
        <label className="mt-6 block text-sm font-medium">Username</label>
        <input className="mt-2 w-full rounded-md border border-line bg-white px-3 py-2" value={username} onChange={(e) => setUsername(e.target.value)} />
        <label className="mt-4 block text-sm font-medium">Password</label>
        <input className="mt-2 w-full rounded-md border border-line bg-white px-3 py-2" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
        <button className="mt-6 w-full rounded-md bg-moss px-4 py-2 font-medium text-white">Login</button>
      </form>
    </main>
  );
}

function PasswordPanel({ token }: { token: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [message, setMessage] = useState("");

  async function save() {
    setMessage("");
    await request("/api/auth/password", token, {
      method: "POST",
      body: JSON.stringify({ current_password: current, new_password: next })
    });
    setCurrent("");
    setNext("");
    setMessage("Password updated.");
  }

  return (
    <section className="rounded-lg border border-line bg-white p-4">
      <div className="flex items-center gap-2 font-semibold"><KeyRound size={18} /> Password</div>
      <input className="mt-3 w-full rounded-md border border-line px-3 py-2 text-sm" type="password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      <input className="mt-2 w-full rounded-md border border-line px-3 py-2 text-sm" type="password" placeholder="New password" value={next} onChange={(e) => setNext(e.target.value)} />
      <button onClick={save} className="mt-3 rounded-md border border-line px-3 py-2 text-sm font-medium">Change password</button>
      {message && <p className="mt-2 text-sm text-moss">{message}</p>}
    </section>
  );
}

function ChapterSelect({ chapters, value, onChange, label, disabled }: { chapters: Chapter[]; value: number; onChange: (index: number) => void; label: string; disabled?: boolean }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const selected = chapters.find((chapter) => chapter.index === value);
  const placeholder = selected ? `${selected.index}. ${selected.title}` : "Search chapters...";
  const filtered = chapters.filter((chapter) => `${chapter.index}. ${chapter.title}`.toLowerCase().includes(query.toLowerCase()));

  function select(chapter: Chapter) {
    onChange(chapter.index);
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-xs font-medium text-ink/60">{label}</label>
      <input
        className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm placeholder:text-ink placeholder:opacity-100 disabled:opacity-50"
        value={query}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && !disabled && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-line bg-white text-sm shadow-md">
          {filtered.length ? filtered.map((chapter) => (
            <li
              key={chapter.index}
              onMouseDown={() => select(chapter)}
              className={`cursor-pointer px-3 py-2 hover:bg-cream ${chapter.index === value ? "bg-cream font-medium" : ""}`}
            >
              {chapter.index}. {chapter.title}
            </li>
          )) : (
            <li className="px-3 py-2 text-ink/50">No chapters found</li>
          )}
        </ul>
      )}
    </div>
  );
}

function formatEta(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function formatListenMinutes(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "0 min";
  const minutes = Math.round(milliseconds / 60000);
  if (minutes < 1) return "under 1 min";
  return `${minutes} min`;
}

function loadChapterRange(jobId: string, fallback: { from: number; to: number }): { from: number; to: number } {
  try {
    const stored = localStorage.getItem(`chapter_range_${jobId}`);
    if (!stored) return fallback;
    const parsed = JSON.parse(stored);
    if (typeof parsed.from === "number" && typeof parsed.to === "number") return parsed;
  } catch {
    // ignore malformed value
  }
  return fallback;
}

function chapterStatusLabel(chapter: Chapter): string {
  if (chapter.pending) return "pending";
  if (chapter.status === "queued") return "not generated";
  return chapter.status;
}

function JobCard({ job, token, refresh }: { job: Job; token: string; refresh: () => void }) {
  const percent = job.progress.chunks_total ? Math.round((job.progress.chunks_done / job.progress.chunks_total) * 100) : 0;
  const readyChapters = job.chapters.filter((chapter) => chapter.status === "done").length;
  const availableListenMs = job.chapters.reduce((total, chapter) => total + (chapter.status === "done" ? chapter.duration_ms ?? 0 : 0), 0);
  const defaultRange = { from: job.chapters[0]?.index ?? 1, to: job.chapters[job.chapters.length - 1]?.index ?? 1 };
  const [fromIndex, setFromIndex] = useState(() => loadChapterRange(job.id, defaultRange).from);
  const [toIndex, setToIndex] = useState(() => loadChapterRange(job.id, defaultRange).to);
  const [chapterQuery, setChapterQuery] = useState("");
  const [chapterStatusFilter, setChapterStatusFilter] = useState<"all" | "done" | "error" | "pending">("all");
  const [chapterPage, setChapterPage] = useState(0);
  const [chapterPageJump, setChapterPageJump] = useState("1");
  const [chapterPageSize, setChapterPageSize] = useState(() => Number(localStorage.getItem("chapter_page_size")) || DEFAULT_CHAPTER_PAGE_SIZE);

  function updateChapterPageSize(value: number) {
    setChapterPageSize(value);
    setChapterPage(0);
    localStorage.setItem("chapter_page_size", String(value));
  }

  function updateFromIndex(index: number) {
    setFromIndex(index);
    setChapterPage(0);
    localStorage.setItem(`chapter_range_${job.id}`, JSON.stringify({ from: index, to: toIndex }));
  }

  function updateToIndex(index: number) {
    setToIndex(index);
    setChapterPage(0);
    localStorage.setItem(`chapter_range_${job.id}`, JSON.stringify({ from: fromIndex, to: index }));
  }

  function backgroundOptions() {
    const mode = localStorage.getItem("tts_bg_mode") || "none";
    return {
      noise_color: mode === "noise" ? (localStorage.getItem("tts_noise_color") || "white") : null,
      noise_amplitude: mode === "noise" ? (Number(localStorage.getItem("tts_noise_amplitude")) || DEFAULT_NOISE_AMPLITUDE) : 0,
      ambience_category: mode === "ambience" ? (localStorage.getItem("tts_ambience_category") || null) : null,
      ambience_file: mode === "ambience" ? (localStorage.getItem("tts_ambience_file") || null) : null,
      ambience_amplitude: mode === "ambience" ? (Number(localStorage.getItem("tts_ambience_amplitude")) || DEFAULT_AMBIENCE_AMPLITUDE) : 0,
      ambience_random: mode === "ambience" ? (localStorage.getItem("tts_ambience_random") === "true") : false
    };
  }

  async function start() {
    const effectsChain = localStorage.getItem("tts_effects_chain");
    const modelOptionId = localStorage.getItem("tts_model_option") || `${DEFAULT_TTS_ENGINE}-${DEFAULT_TTS_MODEL}`;
    const modelOption = MODEL_OPTIONS.find((item) => item.id === modelOptionId) || MODEL_OPTIONS[0];
    await request(`/api/jobs/${job.id}/start`, token, {
      method: "POST",
      body: JSON.stringify({
        base_url: localStorage.getItem("tts_base_url") || DEFAULT_TTS_BASE_URL,
        voice: localStorage.getItem("tts_voice") || DEFAULT_TTS_PROFILE,
        language: localStorage.getItem("tts_language") || DEFAULT_TTS_LANGUAGE,
        engine: modelOption.engine,
        model: modelOption.model,
        effects_chain: effectsChain ? JSON.parse(effectsChain) : null,
        chunk_chars: Number(localStorage.getItem("tts_chunk_chars")) || DEFAULT_CHUNK_CHARS,
        chunk_concurrency: Number(localStorage.getItem("tts_chunk_concurrency")) || DEFAULT_CHUNK_CONCURRENCY,
        from_index: Math.min(fromIndex, toIndex),
        to_index: Math.max(fromIndex, toIndex),
        ...backgroundOptions()
      })
    });
    refresh();
  }

  async function regenerateChapter(index: number) {
    const effectsChain = localStorage.getItem("tts_effects_chain");
    const modelOptionId = localStorage.getItem("tts_model_option") || `${DEFAULT_TTS_ENGINE}-${DEFAULT_TTS_MODEL}`;
    const modelOption = MODEL_OPTIONS.find((item) => item.id === modelOptionId) || MODEL_OPTIONS[0];
    await request(`/api/jobs/${job.id}/chapters/${index}/regenerate`, token, {
      method: "POST",
      body: JSON.stringify({
        base_url: localStorage.getItem("tts_base_url") || DEFAULT_TTS_BASE_URL,
        voice: localStorage.getItem("tts_voice") || DEFAULT_TTS_PROFILE,
        language: localStorage.getItem("tts_language") || DEFAULT_TTS_LANGUAGE,
        engine: modelOption.engine,
        model: modelOption.model,
        effects_chain: effectsChain ? JSON.parse(effectsChain) : null,
        chunk_chars: Number(localStorage.getItem("tts_chunk_chars")) || DEFAULT_CHUNK_CHARS,
        chunk_concurrency: Number(localStorage.getItem("tts_chunk_concurrency")) || DEFAULT_CHUNK_CONCURRENCY,
        ...backgroundOptions()
      })
    });
    refresh();
  }

  async function stopChapter(index: number) {
    await request(`/api/jobs/${job.id}/chapters/${index}/stop`, token, { method: "POST" });
    refresh();
  }

  async function deleteChapter(chapter: Chapter) {
    if (!window.confirm(`Delete chapter ${chapter.index}. ${chapter.title}? This removes its generated audio and cannot be undone.`)) return;
    await request(`/api/jobs/${job.id}/chapters/${chapter.index}`, token, { method: "DELETE" });
    refresh();
  }

  async function packPartial() {
    await request(`/api/jobs/${job.id}/pack-partial`, token, { method: "POST" });
    refresh();
  }

  async function stop() {
    await request(`/api/jobs/${job.id}/stop`, token, { method: "POST" });
    refresh();
  }

  async function remove() {
    if (!window.confirm(`Delete "${job.book.title}"? This removes all generated audio and cannot be undone.`)) return;
    await request(`/api/jobs/${job.id}`, token, { method: "DELETE" });
    localStorage.removeItem(`chapter_range_${job.id}`);
    refresh();
  }

  const hasPendingChapters = job.chapters.some((chapter) => chapter.pending);
  const isActive = ["running", "packing"].includes(job.status) || hasPendingChapters;

  const rangeChapters = job.chapters.filter((chapter) => chapter.index >= Math.min(fromIndex, toIndex) && chapter.index <= Math.max(fromIndex, toIndex));
  const filteredChapters = rangeChapters.filter((chapter) => {
    if (chapterStatusFilter === "pending" && !chapter.pending) return false;
    if (chapterStatusFilter !== "all" && chapterStatusFilter !== "pending" && chapter.status !== chapterStatusFilter) return false;
    if (chapterQuery && !`${chapter.index}. ${chapter.title}`.toLowerCase().includes(chapterQuery.toLowerCase())) return false;
    return true;
  });
  const pageCount = Math.max(1, Math.ceil(filteredChapters.length / chapterPageSize));
  const currentPage = Math.min(chapterPage, pageCount - 1);
  const pagedChapters = filteredChapters.slice(currentPage * chapterPageSize, currentPage * chapterPageSize + chapterPageSize);

  useEffect(() => {
    setChapterPageJump(String(currentPage + 1));
  }, [currentPage, pageCount]);

  function updateChapterQuery(value: string) {
    setChapterQuery(value);
    setChapterPage(0);
  }

  function updateChapterStatusFilter(value: typeof chapterStatusFilter) {
    setChapterStatusFilter(value);
    setChapterPage(0);
  }

  function jumpToChapterPage() {
    const requestedPage = Number(chapterPageJump);
    if (!Number.isFinite(requestedPage)) return;
    const nextPage = Math.min(pageCount, Math.max(1, Math.trunc(requestedPage)));
    setChapterPage(nextPage - 1);
  }

  return (
    <article className="rounded-lg border border-line bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{job.book.title}</h2>
          <p className="text-sm text-ink/65">
            {job.book.author} · {job.progress.chapters_total} chapters · {formatListenMinutes(availableListenMs)} available to listen · {job.status}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={start} title="Generate every non-finished chapter in the selected range" className="inline-flex items-center gap-2 rounded-md bg-moss px-3 py-2 text-sm font-medium text-white"><Play size={16} /> Start all</button>
          <button onClick={stop} disabled={!isActive} title="Stop everything currently generating or pending" className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium disabled:opacity-40"><Square size={16} /> Stop all</button>
          <button onClick={packPartial} disabled={!readyChapters} className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium disabled:opacity-40"><Package size={16} /> Pack ready</button>
          {job.m4b_url && <a className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium" href={authedMediaUrl(job.m4b_url, token)}><Download size={16} /> M4B</a>}
          {job.partial_m4b_url && <a className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium" href={authedMediaUrl(job.partial_m4b_url, token)}>Partial</a>}
          <button onClick={remove} disabled={isActive} title={isActive ? "Stop the job before deleting it" : "Delete"} className="inline-flex items-center gap-2 rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-40"><Trash2 size={16} /></button>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <ChapterSelect chapters={job.chapters} value={fromIndex} onChange={updateFromIndex} label="From chapter" disabled={isActive} />
        <ChapterSelect chapters={job.chapters} value={toIndex} onChange={updateToIndex} label="To chapter" disabled={isActive} />
      </div>
      <div className="mt-4 h-2 rounded-full bg-paper">
        <div className="h-2 rounded-full bg-leaf" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-2 text-sm text-ink/65">
        {percent}% · {job.progress.chunks_done}/{job.progress.chunks_total} chunks · {readyChapters} ready
        {job.progress.chunks_per_second > 0 && <> · {job.progress.chunks_per_second.toFixed(2)} chunks/s</>}
        {formatEta(job.progress.eta_seconds) && <> · ETA {formatEta(job.progress.eta_seconds)}</>}
      </p>
      {job.error && <p className="mt-2 rounded-md bg-red-50 p-2 text-sm text-red-800">{job.error}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink/40" />
          <input
            className="w-full rounded-md border border-line bg-white py-2 pl-8 pr-3 text-sm"
            placeholder="Search chapters..."
            value={chapterQuery}
            onChange={(e) => updateChapterQuery(e.target.value)}
          />
        </div>
        <div className="flex gap-1">
          {(["all", "done", "pending", "error"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => updateChapterStatusFilter(option)}
              className={`rounded-md border px-2 py-1.5 text-xs font-medium capitalize ${chapterStatusFilter === option ? "border-moss bg-moss text-white" : "border-line text-ink/70"}`}
            >
              {option}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs font-medium text-ink/60">
          Per page
          <select
            className="rounded-md border border-line bg-white px-2 py-1.5 text-xs"
            value={chapterPageSize}
            onChange={(e) => updateChapterPageSize(Number(e.target.value))}
          >
            {CHAPTER_PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 grid gap-3">
        {!filteredChapters.length && (
          <p className="rounded-md border border-line bg-cream p-3 text-sm text-ink/60">No chapters match this search/filter.</p>
        )}
        {pagedChapters.map((chapter) => (
          <div key={chapter.index} className="rounded-md border border-line bg-cream p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{chapter.index}. {chapter.title}</p>
                <p className="text-xs text-ink/60">
                  {chapter.word_count} words
                  {chapter.duration_ms ? <> · {formatListenMinutes(chapter.duration_ms)}</> : null}
                  {" · "}{chapterStatusLabel(chapter)} · {chapter.chunks_done}/{chapter.chunks_total}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {chapter.download_url && <a className="text-sm font-medium text-moss" href={authedMediaUrl(chapter.download_url, token)}>Download</a>}
                {chapter.pending ? (
                  <>
                    <span className="flex items-center gap-1 text-sm font-medium text-ink/60">
                      <Loader2 size={14} className="animate-spin" /> Generating...
                    </span>
                    <button
                      onClick={() => stopChapter(chapter.index)}
                      title="Stop generating this chapter"
                      className="flex items-center gap-1 text-sm font-medium text-red-700"
                    >
                      <Square size={14} /> Stop
                    </button>
                  </>
                ) : chapter.status === "done" ? (
                  <button
                    onClick={() => regenerateChapter(chapter.index)}
                    title="Regenerate this chapter's audio"
                    className="flex items-center gap-1 text-sm font-medium text-ink/70 disabled:opacity-40"
                  >
                    <RefreshCw size={14} /> Regenerate
                  </button>
                ) : (
                  <button
                    onClick={() => regenerateChapter(chapter.index)}
                    title="Generate this chapter's audio"
                    className="flex items-center gap-1 text-sm font-medium text-ink/70 disabled:opacity-40"
                  >
                    <Play size={14} /> Generate
                  </button>
                )}
                <button
                  onClick={() => deleteChapter(chapter)}
                  title="Delete this chapter"
                  className="text-ink/50 hover:text-red-700"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            {chapter.audio_url && <audio className="mt-2 w-full" controls src={authedMediaUrl(chapter.audio_url, token)} />}
          </div>
        ))}
      </div>
      {pageCount > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm text-ink/65">
          <span>Page {currentPage + 1} of {pageCount} · {filteredChapters.length} chapters</span>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex items-center gap-1.5">
              <label htmlFor={`chapter-page-jump-${job.id}`} className="text-xs font-medium text-ink/60">Page</label>
              <input
                id={`chapter-page-jump-${job.id}`}
                type="number"
                min={1}
                max={pageCount}
                value={chapterPageJump}
                onChange={(e) => setChapterPageJump(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") jumpToChapterPage();
                }}
                className="w-16 rounded-md border border-line bg-white px-2 py-1.5 text-xs"
              />
              <button
                type="button"
                onClick={jumpToChapterPage}
                className="rounded-md border border-line px-2 py-1.5 text-xs font-medium"
              >
                Jump
              </button>
            </div>
            <button
              type="button"
              onClick={() => setChapterPage(Math.max(0, currentPage - 1))}
              disabled={currentPage === 0}
              className="flex items-center gap-1 rounded-md border border-line px-2 py-1.5 text-xs font-medium disabled:opacity-40"
            >
              <ChevronLeft size={14} /> Prev
            </button>
            <button
              type="button"
              onClick={() => setChapterPage(Math.min(pageCount - 1, currentPage + 1))}
              disabled={currentPage >= pageCount - 1}
              className="flex items-center gap-1 rounded-md border border-line px-2 py-1.5 text-xs font-medium disabled:opacity-40"
            >
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function Dashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [baseUrl, setBaseUrl] = useState(localStorage.getItem("tts_base_url") || DEFAULT_TTS_BASE_URL);
  const [voice, setVoice] = useState(localStorage.getItem("tts_voice") || DEFAULT_TTS_PROFILE);
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [voicesError, setVoicesError] = useState("");
  const [language, setLanguage] = useState(localStorage.getItem("tts_language") || DEFAULT_TTS_LANGUAGE);
  const [modelOptionId, setModelOptionId] = useState(localStorage.getItem("tts_model_option") || `${DEFAULT_TTS_ENGINE}-${DEFAULT_TTS_MODEL}`);
  const [chunkChars, setChunkChars] = useState(Number(localStorage.getItem("tts_chunk_chars")) || DEFAULT_CHUNK_CHARS);
  const [chunkConcurrency, setChunkConcurrency] = useState(Number(localStorage.getItem("tts_chunk_concurrency")) || DEFAULT_CHUNK_CONCURRENCY);
  const [effectsPresets, setEffectsPresets] = useState<EffectPreset[]>([]);
  const [effectsId, setEffectsId] = useState(localStorage.getItem("tts_effects_id") || "");
  const [loadingEffects, setLoadingEffects] = useState(false);
  const [effectsError, setEffectsError] = useState("");
  const [bgMode, setBgMode] = useState<BackgroundMode>((localStorage.getItem("tts_bg_mode") as BackgroundMode) || "none");
  const [noiseColor, setNoiseColor] = useState(localStorage.getItem("tts_noise_color") || "white");
  const [noiseAmplitude, setNoiseAmplitude] = useState(Number(localStorage.getItem("tts_noise_amplitude")) || DEFAULT_NOISE_AMPLITUDE);
  const [ambienceCategories, setAmbienceCategories] = useState<AmbienceOption[]>([]);
  const [loadingAmbienceCategories, setLoadingAmbienceCategories] = useState(false);
  const [ambienceCategory, setAmbienceCategory] = useState(localStorage.getItem("tts_ambience_category") || "");
  const [ambienceFiles, setAmbienceFiles] = useState<AmbienceOption[]>([]);
  const [loadingAmbienceFiles, setLoadingAmbienceFiles] = useState(false);
  const [ambienceFile, setAmbienceFile] = useState(localStorage.getItem("tts_ambience_file") || "");
  const [ambienceAmplitude, setAmbienceAmplitude] = useState(Number(localStorage.getItem("tts_ambience_amplitude")) || DEFAULT_AMBIENCE_AMPLITUDE);
  const [ambienceRandomPerChapter, setAmbienceRandomPerChapter] = useState(localStorage.getItem("tts_ambience_random") === "true");
  const [previewError, setPreviewError] = useState("");
  const socketRef = useRef<WebSocket | null>(null);

  async function loadVoices() {
    setLoadingVoices(true);
    setVoicesError("");
    try {
      const result = await request<VoiceProfile[]>(`/api/tts/voicebox/profiles?base_url=${encodeURIComponent(baseUrl)}`, token);
      setVoices(result);
      if (result.length && !result.some((profile) => profile.id === voice)) {
        setVoice(result[0].id);
        localStorage.setItem("tts_voice", result[0].id);
      }
    } catch (err) {
      setVoices([]);
      setVoicesError(err instanceof Error ? err.message : "Could not load voices");
    } finally {
      setLoadingVoices(false);
    }
  }

  useEffect(() => {
    loadVoices();
  }, [baseUrl]);

  async function loadEffects() {
    setLoadingEffects(true);
    setEffectsError("");
    try {
      const result = await request<EffectPreset[]>(`/api/tts/voicebox/effects?base_url=${encodeURIComponent(baseUrl)}`, token);
      setEffectsPresets(result);
    } catch (err) {
      setEffectsPresets([]);
      setEffectsError(err instanceof Error ? err.message : "Could not load effects");
    } finally {
      setLoadingEffects(false);
    }
  }

  useEffect(() => {
    loadEffects();
  }, [baseUrl]);

  function selectEffects(id: string) {
    setEffectsId(id);
    localStorage.setItem("tts_effects_id", id);
    const preset = effectsPresets.find((item) => item.id === id);
    if (preset) {
      localStorage.setItem("tts_effects_chain", JSON.stringify(preset.effects_chain));
    } else {
      localStorage.removeItem("tts_effects_chain");
    }
  }

  async function loadAmbienceCategories() {
    setLoadingAmbienceCategories(true);
    try {
      const result = await request<AmbienceOption[]>("/api/ambience/categories", token);
      setAmbienceCategories(result);
      if (result.length && !result.some((item) => item.id === ambienceCategory)) {
        setAmbienceCategory(result[0].id);
        localStorage.setItem("tts_ambience_category", result[0].id);
      }
    } catch {
      setAmbienceCategories([]);
    } finally {
      setLoadingAmbienceCategories(false);
    }
  }

  useEffect(() => {
    if (bgMode === "ambience") loadAmbienceCategories();
  }, [bgMode]);

  async function loadAmbienceFiles(category: string) {
    if (!category) {
      setAmbienceFiles([]);
      return;
    }
    setLoadingAmbienceFiles(true);
    try {
      const result = await request<AmbienceOption[]>(`/api/ambience/categories/${encodeURIComponent(category)}/files`, token);
      setAmbienceFiles(result);
      if (result.length && !result.some((item) => item.id === ambienceFile)) {
        setAmbienceFile(result[0].id);
        localStorage.setItem("tts_ambience_file", result[0].id);
      }
    } catch {
      setAmbienceFiles([]);
    } finally {
      setLoadingAmbienceFiles(false);
    }
  }

  useEffect(() => {
    if (bgMode === "ambience" && ambienceCategory) loadAmbienceFiles(ambienceCategory);
  }, [bgMode, ambienceCategory]);

  function selectBgMode(mode: BackgroundMode) {
    setBgMode(mode);
    localStorage.setItem("tts_bg_mode", mode);
  }

  async function refresh() {
    try {
      setJobs(await request<Job[]>("/api/jobs", token));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load jobs");
    }
  }

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: number | undefined;

    function connect() {
      const socket = new WebSocket(wsUrl("/api/ws/jobs", token));
      socketRef.current = socket;
      socket.onmessage = (event) => {
        try {
          setJobs(JSON.parse(event.data));
          setError("");
        } catch {
          // ignore malformed payloads
        }
      };
      socket.onclose = () => {
        if (cancelled) return;
        setError("Live updates disconnected, reconnecting...");
        reconnectTimer = window.setTimeout(connect, 2000);
      };
    }

    connect();
    return () => {
      cancelled = true;
      window.clearTimeout(reconnectTimer);
      socketRef.current?.close();
    };
  }, [token]);

  function saveSettings() {
    localStorage.setItem("tts_base_url", baseUrl);
    localStorage.setItem("tts_voice", voice);
  }

  function selectLanguage(value: string) {
    setLanguage(value);
    localStorage.setItem("tts_language", value);
  }

  function selectModelOption(id: string) {
    setModelOptionId(id);
    localStorage.setItem("tts_model_option", id);
  }

  function selectChunkChars(value: number) {
    setChunkChars(value);
    localStorage.setItem("tts_chunk_chars", String(value));
  }

  function selectChunkConcurrency(value: number) {
    setChunkConcurrency(value);
    localStorage.setItem("tts_chunk_concurrency", String(value));
  }

  function selectNoiseColor(value: string) {
    setNoiseColor(value);
    localStorage.setItem("tts_noise_color", value);
  }

  function selectNoiseAmplitude(value: number) {
    setNoiseAmplitude(value);
    localStorage.setItem("tts_noise_amplitude", String(value));
  }

  function selectAmbienceCategory(value: string) {
    setAmbienceCategory(value);
    localStorage.setItem("tts_ambience_category", value);
    setAmbienceFile("");
  }

  function selectAmbienceFile(value: string) {
    setAmbienceFile(value);
    localStorage.setItem("tts_ambience_file", value);
  }

  function selectAmbienceAmplitude(value: number) {
    setAmbienceAmplitude(value);
    localStorage.setItem("tts_ambience_amplitude", String(value));
  }

  function selectAmbienceRandomPerChapter(value: boolean) {
    setAmbienceRandomPerChapter(value);
    localStorage.setItem("tts_ambience_random", String(value));
  }

  async function randomizeAmbience() {
    setPreviewError("");
    let categories = ambienceCategories;
    if (!categories.length) {
      setLoadingAmbienceCategories(true);
      try {
        categories = await request<AmbienceOption[]>("/api/ambience/categories", token);
        setAmbienceCategories(categories);
      } catch (err) {
        setPreviewError(err instanceof Error ? err.message : "Could not load ambiance categories");
        return;
      } finally {
        setLoadingAmbienceCategories(false);
      }
    }
    if (!categories.length) return;
    const category = categories[Math.floor(Math.random() * categories.length)].id;
    setLoadingAmbienceFiles(true);
    try {
      const files = await request<AmbienceOption[]>(`/api/ambience/categories/${encodeURIComponent(category)}/files`, token);
      setAmbienceFiles(files);
      if (!files.length) return;
      const file = files[Math.floor(Math.random() * files.length)].id;
      setAmbienceCategory(category);
      localStorage.setItem("tts_ambience_category", category);
      setAmbienceFile(file);
      localStorage.setItem("tts_ambience_file", file);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Could not randomize ambiance");
    } finally {
      setLoadingAmbienceFiles(false);
    }
  }

  function previewNoise() {
    setPreviewError("");
    const url = authedMediaUrl(`/api/tts/noise/preview?color=${noiseColor}&amplitude=${noiseAmplitude}`, token);
    new Audio(url).play().catch((err) => setPreviewError(err instanceof Error ? err.message : "Could not play preview"));
  }

  function previewAmbience() {
    setPreviewError("");
    if (!ambienceCategory || !ambienceFile) return;
    const url = authedMediaUrl(
      `/api/tts/ambience/preview?category=${encodeURIComponent(ambienceCategory)}&file=${encodeURIComponent(ambienceFile)}&amplitude=${ambienceAmplitude}`,
      token
    );
    new Audio(url).play().catch((err) => setPreviewError(err instanceof Error ? err.message : "Could not play preview"));
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError("");
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch(apiUrl("/api/jobs"), { method: "POST", headers: authHeaders(token), body: form });
        if (!res.ok) throw new Error((await res.json()).detail || "Upload failed");
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <main className="mx-auto max-w-7xl p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">Stream EPUB</h1>
          <p className="text-sm text-ink/65">Generate chapter audio as it finishes, then pack the ready chapters or the whole book as M4B.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={refresh} className="inline-flex items-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm font-medium"><RefreshCw size={16} /> Refresh</button>
          <button onClick={onLogout} className="inline-flex items-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm font-medium"><LogOut size={16} /> Logout</button>
        </div>
      </header>

      <div className="mt-6 grid gap-4 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-4">
          <section className="rounded-lg border border-line bg-white p-4">
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-leaf bg-cream px-4 py-8 text-sm font-medium">
              <Upload size={18} /> {uploading ? "Uploading..." : "Upload EPUB"}
              <input hidden type="file" accept=".epub" multiple onChange={(e) => upload(e.target.files)} />
            </label>
          </section>
          <section className="rounded-lg border border-line bg-white p-4">
            <h2 className="font-semibold">TTS API</h2>
            <label className="mt-3 block text-xs font-medium text-ink/60">Base URL</label>
            <input className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} onBlur={saveSettings} />
            <div className="mt-2 flex items-center justify-between">
              <label className="block text-xs font-medium text-ink/60">Voice</label>
              <button type="button" onClick={loadVoices} disabled={loadingVoices} className="flex items-center gap-1 text-xs font-medium text-moss disabled:opacity-50">
                <RefreshCw size={12} className={loadingVoices ? "animate-spin" : ""} /> {loadingVoices ? "Loading" : "Refresh"}
              </button>
            </div>
            <select
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm"
              value={voice}
              onChange={(e) => { setVoice(e.target.value); localStorage.setItem("tts_voice", e.target.value); }}
              disabled={loadingVoices || !voices.length}
            >
              {!voices.length && <option value={voice}>{voice}</option>}
              {voices.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name}</option>
              ))}
            </select>
            {voicesError && <p className="mt-1 text-xs text-red-700">{voicesError}</p>}

            <label className="mt-3 block text-xs font-medium text-ink/60">Language</label>
            <select
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm"
              value={language}
              onChange={(e) => selectLanguage(e.target.value)}
            >
              {LANGUAGES.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>

            <label className="mt-3 block text-xs font-medium text-ink/60">Model</label>
            <select
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm"
              value={modelOptionId}
              onChange={(e) => selectModelOption(e.target.value)}
            >
              {MODEL_OPTIONS.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>

            <div className="mt-3 flex items-center justify-between">
              <label className="block text-xs font-medium text-ink/60">Effects</label>
              <button type="button" onClick={loadEffects} disabled={loadingEffects} className="flex items-center gap-1 text-xs font-medium text-moss disabled:opacity-50">
                <RefreshCw size={12} className={loadingEffects ? "animate-spin" : ""} /> {loadingEffects ? "Loading" : "Refresh"}
              </button>
            </div>
            <select
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm"
              value={effectsId}
              onChange={(e) => selectEffects(e.target.value)}
              disabled={loadingEffects}
            >
              <option value="">None</option>
              {effectsPresets.map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.name}</option>
              ))}
            </select>
            {effectsError && <p className="mt-1 text-xs text-red-700">{effectsError}</p>}

            <div className="mt-3 grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-ink/60">Chars per chunk</label>
                <input
                  type="number"
                  min={100}
                  max={5000}
                  className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm"
                  value={chunkChars}
                  onChange={(e) => selectChunkChars(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink/60">Chunks per batch</label>
                <input
                  type="number"
                  min={1}
                  max={16}
                  className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm"
                  value={chunkConcurrency}
                  onChange={(e) => selectChunkConcurrency(Number(e.target.value))}
                />
              </div>
            </div>
          </section>
          <section className="rounded-lg border border-line bg-white p-4">
            <h2 className="font-semibold">Background sound</h2>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => selectBgMode("none")}
                className={`rounded-md border px-2 py-1.5 text-xs font-medium ${bgMode === "none" ? "border-moss bg-moss text-white" : "border-line text-ink/70"}`}
              >
                None
              </button>
              <button
                type="button"
                onClick={() => selectBgMode("noise")}
                className={`rounded-md border px-2 py-1.5 text-xs font-medium ${bgMode === "noise" ? "border-moss bg-moss text-white" : "border-line text-ink/70"}`}
              >
                Noise
              </button>
              <button
                type="button"
                onClick={() => selectBgMode("ambience")}
                className={`rounded-md border px-2 py-1.5 text-xs font-medium ${bgMode === "ambience" ? "border-moss bg-moss text-white" : "border-line text-ink/70"}`}
              >
                Ambiance
              </button>
            </div>

            {bgMode === "noise" && (
              <div className="mt-3">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-ink/60">Type</label>
                  <button type="button" onClick={previewNoise} className="flex items-center gap-1 text-xs font-medium text-moss">
                    <Volume2 size={12} /> Preview
                  </button>
                </div>
                <select
                  className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm"
                  value={noiseColor}
                  onChange={(e) => selectNoiseColor(e.target.value)}
                >
                  {NOISE_COLORS.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
                <div className="mt-3">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-medium text-ink/60">Volume</label>
                    <span className="text-xs text-ink/60">{noiseAmplitude.toFixed(3)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={0.05}
                    step={0.001}
                    className="mt-1 w-full"
                    value={noiseAmplitude}
                    onChange={(e) => selectNoiseAmplitude(Number(e.target.value))}
                  />
                </div>
              </div>
            )}

            {bgMode === "ambience" && (
              <div className="mt-3">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-ink/60">Randomize every chapter</label>
                  <button
                    type="button"
                    onClick={() => selectAmbienceRandomPerChapter(!ambienceRandomPerChapter)}
                    className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium ${ambienceRandomPerChapter ? "border-moss bg-moss text-white" : "border-line text-ink/70"}`}
                  >
                    <Shuffle size={12} /> {ambienceRandomPerChapter ? "On" : "Off"}
                  </button>
                </div>
                {ambienceRandomPerChapter && (
                  <p className="mt-1 text-xs text-ink/60">
                    A new random sound is picked for every chapter. The volume below is still used as set.
                  </p>
                )}

                {!ambienceRandomPerChapter && (
                  <>
                    <div className="mt-3 flex items-center justify-between">
                      <label className="block text-xs font-medium text-ink/60">Category</label>
                      <div className="flex items-center gap-3">
                        <button type="button" onClick={randomizeAmbience} disabled={loadingAmbienceCategories || loadingAmbienceFiles} className="flex items-center gap-1 text-xs font-medium text-moss disabled:opacity-50">
                          <Shuffle size={12} /> Randomize
                        </button>
                        <button type="button" onClick={loadAmbienceCategories} disabled={loadingAmbienceCategories} className="flex items-center gap-1 text-xs font-medium text-moss disabled:opacity-50">
                          <RefreshCw size={12} className={loadingAmbienceCategories ? "animate-spin" : ""} /> Refresh
                        </button>
                      </div>
                    </div>
                    {ambienceCategories.length ? (
                      <>
                        <select
                          className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm"
                          value={ambienceCategory}
                          onChange={(e) => selectAmbienceCategory(e.target.value)}
                        >
                          {ambienceCategories.map((item) => (
                            <option key={item.id} value={item.id}>{item.name}</option>
                          ))}
                        </select>

                        <div className="mt-3 flex items-center justify-between">
                          <label className="block text-xs font-medium text-ink/60">Sound</label>
                          <button type="button" onClick={previewAmbience} disabled={!ambienceFile} className="flex items-center gap-1 text-xs font-medium text-moss disabled:opacity-50">
                            <Volume2 size={12} /> Preview
                          </button>
                        </div>
                        <select
                          className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm disabled:opacity-50"
                          value={ambienceFile}
                          onChange={(e) => selectAmbienceFile(e.target.value)}
                          disabled={loadingAmbienceFiles || !ambienceFiles.length}
                        >
                          {ambienceFiles.map((item) => (
                            <option key={item.id} value={item.id}>{item.name}</option>
                          ))}
                        </select>
                      </>
                    ) : (
                      <p className="mt-1 text-xs text-ink/60">
                        No ambiance files yet. Add audio files under <code>server/assets/ambience/&lt;category&gt;/</code> on the server, then refresh.
                      </p>
                    )}
                  </>
                )}

                <div className="mt-3">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-medium text-ink/60">Volume</label>
                    <span className="text-xs text-ink/60">{ambienceAmplitude.toFixed(3)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={0.3}
                    step={0.005}
                    className="mt-1 w-full"
                    value={ambienceAmplitude}
                    onChange={(e) => selectAmbienceAmplitude(Number(e.target.value))}
                  />
                </div>
              </div>
            )}
            {previewError && <p className="mt-2 text-xs text-red-700">{previewError}</p>}
          </section>
          <PasswordPanel token={token} />
        </aside>

        <section className="space-y-4">
          {error && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          {!jobs.length && <div className="rounded-lg border border-line bg-white p-8 text-center text-ink/65">Upload an EPUB to create the first job.</div>}
          {jobs.map((job) => <JobCard key={job.id} job={job} token={token} refresh={refresh} />)}
        </section>
      </div>
    </main>
  );
}

function App() {
  const [token, setToken] = useState(localStorage.getItem("stream_epub_token") || "");
  if (!token) return <Login onLogin={setToken} />;
  return <Dashboard token={token} onLogout={() => { localStorage.removeItem("stream_epub_token"); setToken(""); }} />;
}

createRoot(document.getElementById("root")!).render(<App />);

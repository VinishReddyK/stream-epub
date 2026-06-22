import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Loader2, Package, Play, RefreshCw, Search, Square, Trash2 } from "lucide-react";
import { CHAPTER_PAGE_SIZE_OPTIONS, DEFAULT_AMBIENCE_AMPLITUDE, DEFAULT_CHAPTER_PAGE_SIZE, DEFAULT_CHUNK_CHARS, DEFAULT_CHUNK_CONCURRENCY, DEFAULT_NOISE_AMPLITUDE, DEFAULT_TTS_BASE_URL, DEFAULT_TTS_ENGINE, DEFAULT_TTS_LANGUAGE, DEFAULT_TTS_MODEL, DEFAULT_TTS_PROFILE, MODEL_OPTIONS } from "../lib/constants";
import { authedMediaUrl, request } from "../lib/api";
import { formatEta, formatListenMinutes, loadChapterRange, chapterStatusLabel } from "../lib/utils";
import type { Chapter, Job } from "../types";
import { ChapterSelect } from "./ChapterSelect";

export function JobCard({ job, token, refresh }: { job: Job; token: string; refresh: () => void }) {
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


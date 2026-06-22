import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, FastForward, Moon, Pause, Play, RefreshCw, Rewind, Sun, WifiOff } from "lucide-react";
import { LISTENING_CHAPTER_KEY, LISTENING_JOB_KEY, OFFLINE_AUDIO_CACHE } from "../lib/constants";
import { authedMediaUrl, offlineAudioKey, request } from "../lib/api";
import { formatClock, formatListenMinutes, formatSyncTime, latestListeningJob } from "../lib/utils";
import { navigateTo } from "../lib/navigation";
import type { Chapter, Job } from "../types";

export function ListenPage({ jobs, token, refresh }: { jobs: Job[]; token: string; refresh: () => void }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const initialProgressJob = latestListeningJob(jobs);
  const initialReadyJob = jobs.find((job) => job.chapters.some((chapter) => chapter.status === "done" && chapter.audio_url));
  const [selectedJobId, setSelectedJobId] = useState(initialProgressJob?.id || localStorage.getItem(LISTENING_JOB_KEY) || initialReadyJob?.id || "");
  const [selectedChapterIndex, setSelectedChapterIndex] = useState(initialProgressJob?.listening_progress?.chapter_index || Number(localStorage.getItem(LISTENING_CHAPTER_KEY)) || 0);
  const [audioSrc, setAudioSrc] = useState("");
  const [objectUrl, setObjectUrl] = useState("");
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(initialProgressJob?.listening_progress?.updated_at || null);
  const [cachedChapters, setCachedChapters] = useState<Record<string, boolean>>({});
  const [savingChapters, setSavingChapters] = useState<Record<string, boolean>>({});
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => localStorage.getItem("listen_theme") === "dark" ? "dark" : "light");
  const [error, setError] = useState("");
  const appliedProgressRef = useRef("");
  const currentTimeRef = useRef(0);
  const manualChapterChangeUntilRef = useRef(0);
  const resumeAfterChapterSwitchRef = useRef(false);
  const resumeTimerRef = useRef<number | null>(null);
  const syncingProgressRef = useRef(false);

  const readyJobs = jobs.filter((job) => job.chapters.some((chapter) => chapter.status === "done" && chapter.audio_url));
  const selectedJob = readyJobs.find((job) => job.id === selectedJobId) || readyJobs[0];
  const readyChapters = selectedJob?.chapters.filter((chapter) => chapter.status === "done" && chapter.audio_url) || [];
  const selectedChapter = readyChapters.find((chapter) => chapter.index === selectedChapterIndex) || readyChapters[0];
  const selectedChapterPosition = selectedChapter ? readyChapters.findIndex((chapter) => chapter.index === selectedChapter.index) : -1;
  const selectedCacheKey = selectedJob && selectedChapter ? offlineAudioKey(selectedJob.id, selectedChapter.index) : "";
  const serverProgress = selectedJob?.listening_progress || null;
  const visibleLastSyncAt = serverProgress?.updated_at || lastSyncAt;
  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const isDark = theme === "dark";
  const pageClass = isDark ? "bg-[#0e1411] text-[#f7f8f5]" : "text-ink";
  const panelClass = isDark ? "border-white/10 bg-[#151d18]" : "border-line bg-white";
  const innerPanelClass = isDark ? "bg-[#202a23]" : "bg-cream";
  const controlClass = isDark ? "border-white/10 bg-[#111814] text-[#f7f8f5]" : "border-line bg-white text-ink/75";
  const selectClass = isDark ? "border-white/10 bg-[#111814] text-[#f7f8f5]" : "border-line bg-white";
  const mutedClass = isDark ? "text-white/60" : "text-ink/60";
  const faintClass = isDark ? "text-white/45" : "text-ink/45";
  const syncPillClass = isDark ? "bg-white/10 text-white/65" : "bg-cream text-ink/55";
  const subtleButtonClass = isDark ? "text-white/65 hover:text-white" : "text-ink/55 hover:text-ink";

  function chapterPosition(chapterIndex: number): number {
    if (!serverProgress) return 0;
    const mapped = serverProgress.chapter_positions?.[String(chapterIndex)];
    if (typeof mapped === "number" && Number.isFinite(mapped)) return mapped;
    if (serverProgress.chapter_index === chapterIndex && Number.isFinite(serverProgress.position_seconds)) return serverProgress.position_seconds;
    return 0;
  }

  useEffect(() => {
    if (!selectedJob && readyJobs[0]) setSelectedJobId(readyJobs[0].id);
  }, [readyJobs, selectedJob]);

  useEffect(() => {
    const progressJob = latestListeningJob(readyJobs);
    if (!progressJob?.listening_progress || selectedJobId) return;
    setSelectedJobId(progressJob.id);
    setSelectedChapterIndex(progressJob.listening_progress.chapter_index);
  }, [readyJobs, selectedJobId]);

  useEffect(() => {
    if (!selectedJob || !selectedChapter) return;
    localStorage.setItem(LISTENING_JOB_KEY, selectedJob.id);
    localStorage.setItem(LISTENING_CHAPTER_KEY, String(selectedChapter.index));
  }, [selectedJob, selectedChapter]);

  useEffect(() => {
    let cancelled = false;
    async function loadCachedStates() {
      if (!("caches" in window)) return;
      const cache = await caches.open(OFFLINE_AUDIO_CACHE);
      const entries: Record<string, boolean> = {};
      for (const job of readyJobs) {
        for (const chapter of job.chapters) {
          if (chapter.status !== "done" || !chapter.audio_url) continue;
          const key = offlineAudioKey(job.id, chapter.index);
          entries[key] = Boolean(await cache.match(key));
        }
      }
      if (!cancelled) setCachedChapters(entries);
    }
    loadCachedStates().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [jobs]);

  useEffect(() => {
    let cancelled = false;
    async function loadSource() {
      if (!selectedJob || !selectedChapter?.audio_url) {
        setAudioSrc("");
        return;
      }
      setDuration(0);
      setCurrentTime(0);
      setError("");
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        setObjectUrl("");
      }
      const key = offlineAudioKey(selectedJob.id, selectedChapter.index);
      if ("caches" in window) {
        const cached = await caches.open(OFFLINE_AUDIO_CACHE).then((cache) => cache.match(key));
        if (cached) {
          const url = URL.createObjectURL(await cached.blob());
          if (!cancelled) {
            setObjectUrl(url);
            setAudioSrc(url);
          }
          return;
        }
      }
      if (!cancelled) setAudioSrc(authedMediaUrl(selectedChapter.audio_url, token));
    }
    loadSource().catch((err) => setError(err instanceof Error ? err.message : "Could not load audio"));
    return () => {
      cancelled = true;
    };
  }, [selectedJob?.id, selectedChapter?.index, token]);

  useEffect(() => {
    if (!selectedJob || !serverProgress) return;
    setLastSyncAt(serverProgress.updated_at);
    const progressKey = `${selectedJob.id}:${selectedChapter?.index}:${serverProgress.updated_at}`;
    if (appliedProgressRef.current === progressKey) return;
    if (isPlaying) return;
    appliedProgressRef.current = progressKey;
    if (serverProgress.chapter_index !== selectedChapter?.index) {
      if (Date.now() < manualChapterChangeUntilRef.current) return;
      setSelectedChapterIndex(serverProgress.chapter_index);
      return;
    }
    const audio = audioRef.current;
    const nextTime = Math.max(0, selectedChapter ? chapterPosition(selectedChapter.index) : 0);
    setCurrentTime(nextTime);
    if (audio && Number.isFinite(nextTime)) audio.currentTime = nextTime;
  }, [selectedJob?.id, serverProgress?.chapter_index, serverProgress?.position_seconds, serverProgress?.chapter_positions, serverProgress?.updated_at, selectedChapter?.index, isPlaying]);

  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (resumeTimerRef.current) window.clearTimeout(resumeTimerRef.current);
    };
  }, [objectUrl]);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    localStorage.setItem("listen_theme", theme);
    document.body.classList.toggle("listen-dark-page", isDark);
    return () => document.body.classList.remove("listen-dark-page");
  }, [theme, isDark]);

  async function syncListeningProgress(positionSeconds = audioRef.current?.currentTime ?? currentTimeRef.current) {
    if (!selectedJob || !selectedChapter || syncingProgressRef.current) return;
    if (!Number.isFinite(positionSeconds)) return;
    syncingProgressRef.current = true;
    try {
      await request(`/api/jobs/${selectedJob.id}/listening-progress`, token, {
        method: "POST",
        body: JSON.stringify({
          chapter_index: selectedChapter.index,
          position_seconds: Math.max(0, positionSeconds),
        }),
      });
      setLastSyncAt(new Date().toISOString());
    } catch {
      // Progress sync is best-effort; playback should never show an error for it.
    } finally {
      syncingProgressRef.current = false;
    }
  }

  async function syncChapterSelection(chapterIndex: number) {
    if (!selectedJob) return;
    try {
      await request(`/api/jobs/${selectedJob.id}/listening-progress`, token, {
        method: "POST",
        body: JSON.stringify({
          chapter_index: chapterIndex,
          position_seconds: chapterPosition(chapterIndex),
        }),
      });
      setLastSyncAt(new Date().toISOString());
    } catch {
      // Progress sync is best-effort; chapter switching should still work offline.
    }
  }

  useEffect(() => {
    if (!selectedJob || !selectedChapter || !isPlaying) return;
    const timer = window.setInterval(() => {
      syncListeningProgress();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [selectedJob?.id, selectedChapter?.index, token, isPlaying]);

  function selectJob(jobId: string) {
    syncListeningProgress();
    const job = readyJobs.find((item) => item.id === jobId);
    manualChapterChangeUntilRef.current = Date.now() + 8000;
    setSelectedJobId(jobId);
    setSelectedChapterIndex(job?.listening_progress?.chapter_index || job?.chapters.find((chapter) => chapter.status === "done" && chapter.audio_url)?.index || 0);
  }

  function skip(delta: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.min(Math.max(audio.currentTime + delta, 0), audio.duration || Number.MAX_SAFE_INTEGER);
  }

  function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    if (resumeTimerRef.current) {
      window.clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
      resumeAfterChapterSwitchRef.current = false;
    }
    if (audio.paused) audio.play();
    else audio.pause();
  }

  function seek(next: number) {
    setCurrentTime(next);
    currentTimeRef.current = next;
    if (audioRef.current) audioRef.current.currentTime = next;
  }

  function selectRelativeChapter(delta: number) {
    const audio = audioRef.current;
    const shouldResume = Boolean(audio && !audio.paused);
    if (resumeTimerRef.current) {
      window.clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
    if (audio) {
      audio.pause();
      syncListeningProgress(audio.currentTime);
    } else {
      syncListeningProgress();
    }
    setIsPlaying(false);
    const next = readyChapters[selectedChapterPosition + delta];
    if (next) {
      resumeAfterChapterSwitchRef.current = shouldResume;
      manualChapterChangeUntilRef.current = Date.now() + 8000;
      setSelectedChapterIndex(next.index);
      syncChapterSelection(next.index);
    }
  }

  function selectChapter(index: number) {
    const audio = audioRef.current;
    const shouldResume = Boolean(audio && !audio.paused);
    if (resumeTimerRef.current) {
      window.clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
    if (audio) {
      audio.pause();
      syncListeningProgress(audio.currentTime);
    } else {
      syncListeningProgress();
    }
    setIsPlaying(false);
    resumeAfterChapterSwitchRef.current = shouldResume;
    manualChapterChangeUntilRef.current = Date.now() + 8000;
    setSelectedChapterIndex(index);
    syncChapterSelection(index);
  }

  async function saveOffline(job: Job, chapter: Chapter) {
    if (!chapter.download_url && !chapter.audio_url) return;
    if (!("caches" in window)) {
      setError("Offline audio cache is not available in this browser.");
      return;
    }
    const key = offlineAudioKey(job.id, chapter.index);
    setSavingChapters((current) => ({ ...current, [key]: true }));
    setError("");
    try {
      const mediaPath = chapter.download_url || chapter.audio_url!;
      const response = await fetch(authedMediaUrl(mediaPath, token));
      if (!response.ok) throw new Error("Could not download chapter audio");
      const cache = await caches.open(OFFLINE_AUDIO_CACHE);
      await cache.put(key, new Response(await response.blob(), { headers: { "Content-Type": "audio/mp4" } }));
      setCachedChapters((current) => ({ ...current, [key]: true }));
      if (selectedCacheKey === key) {
        const cached = await cache.match(key);
        if (cached) {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          const url = URL.createObjectURL(await cached.blob());
          setObjectUrl(url);
          setAudioSrc(url);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save audio offline");
    } finally {
      setSavingChapters((current) => ({ ...current, [key]: false }));
    }
  }

  async function removeOffline(job: Job, chapter: Chapter) {
    if (!("caches" in window)) return;
    const key = offlineAudioKey(job.id, chapter.index);
    await caches.open(OFFLINE_AUDIO_CACHE).then((cache) => cache.delete(key));
    setCachedChapters((current) => ({ ...current, [key]: false }));
    if (selectedCacheKey === key && chapter.audio_url) setAudioSrc(authedMediaUrl(chapter.audio_url, token));
  }

  async function saveReadyChaptersOffline() {
    if (!selectedJob) return;
    for (const chapter of readyChapters) {
      if (!cachedChapters[offlineAudioKey(selectedJob.id, chapter.index)]) {
        await saveOffline(selectedJob, chapter);
      }
    }
  }

  async function downloadCurrent() {
    if (!selectedJob || !selectedChapter) return;
    const filename = `${String(selectedChapter.index).padStart(3, "0")}-${selectedChapter.title}.m4a`;
    let href = selectedChapter.download_url ? authedMediaUrl(selectedChapter.download_url, token) : audioSrc;
    let temporaryUrl = "";
    if (cachedChapters[selectedCacheKey] && "caches" in window) {
      const cached = await caches.open(OFFLINE_AUDIO_CACHE).then((cache) => cache.match(selectedCacheKey));
      if (cached) {
        temporaryUrl = URL.createObjectURL(await cached.blob());
        href = temporaryUrl;
      }
    }
    const link = document.createElement("a");
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    if (temporaryUrl) window.setTimeout(() => URL.revokeObjectURL(temporaryUrl), 1000);
  }

  async function downloadReadyChapters() {
    if (!selectedJob) return;
    for (const chapter of readyChapters) {
      const filename = `${String(chapter.index).padStart(3, "0")}-${chapter.title}.m4a`;
      const key = offlineAudioKey(selectedJob.id, chapter.index);
      let href = chapter.download_url ? authedMediaUrl(chapter.download_url, token) : chapter.audio_url ? authedMediaUrl(chapter.audio_url, token) : "";
      let temporaryUrl = "";
      if (cachedChapters[key] && "caches" in window) {
        const cached = await caches.open(OFFLINE_AUDIO_CACHE).then((cache) => cache.match(key));
        if (cached) {
          temporaryUrl = URL.createObjectURL(await cached.blob());
          href = temporaryUrl;
        }
      }
      if (!href) continue;
      const link = document.createElement("a");
      link.href = href;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      if (temporaryUrl) window.setTimeout(() => URL.revokeObjectURL(temporaryUrl), 1000);
      await new Promise((resolve) => window.setTimeout(resolve, 150));
    }
  }

  return (
    <main className={`mx-auto min-h-screen max-w-5xl px-3 py-4 sm:p-6 ${pageClass}`}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">Listen</h1>
          <p className={`hidden text-sm sm:block ${mutedClass}`}>Focused playback for generated chapters, including offline-saved audio.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setTheme(isDark ? "light" : "dark")}
            title={isDark ? "Use light theme" : "Use dark theme"}
            aria-label={isDark ? "Use light theme" : "Use dark theme"}
            className={`inline-flex h-10 w-10 items-center justify-center rounded-md border text-sm font-medium ${controlClass}`}
          >
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button onClick={refresh} className={`inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium ${controlClass}`}><RefreshCw size={16} /> Refresh</button>
          <button onClick={() => navigateTo("/")} className={`hidden h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium md:inline-flex ${controlClass}`}><ChevronLeft size={16} /> Library</button>
        </div>
      </header>

      {!readyJobs.length ? (
        <section className={`mt-6 rounded-lg border p-8 text-center ${panelClass} ${mutedClass}`}>
          No generated chapters are ready yet.
        </section>
      ) : (
        <section className={`mt-4 rounded-lg border p-3 sm:mt-6 sm:p-5 ${panelClass}`}>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
            <label className="block text-sm font-medium">
              Book
              <select className={`mt-1 h-11 w-full rounded-md border px-3 text-sm ${selectClass}`} value={selectedJob?.id || ""} onChange={(e) => selectJob(e.target.value)}>
                {readyJobs.map((job) => (
                  <option key={job.id} value={job.id}>{job.book.title}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium">
              Chapter
              <select className={`mt-1 h-11 w-full rounded-md border px-3 text-sm ${selectClass}`} value={selectedChapter?.index || ""} onChange={(e) => selectChapter(Number(e.target.value))}>
                {readyChapters.map((chapter) => (
                  <option key={chapter.index} value={chapter.index}>
                    {chapter.index}. {chapter.title}{chapter.duration_ms ? ` (${formatListenMinutes(chapter.duration_ms)})` : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {selectedJob && selectedChapter && (
            <>
              <div className={`mt-4 rounded-md border p-3 shadow-sm sm:mt-5 sm:p-5 ${panelClass}`}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className={`truncate text-xs font-semibold uppercase tracking-wide ${faintClass}`}>{selectedJob.book.author}</p>
                    <h2 className="mt-1 text-xl font-semibold leading-tight sm:text-2xl">{selectedChapter.index}. {selectedChapter.title}</h2>
                    <p className={`mt-1 text-sm ${mutedClass}`}>
                      {selectedChapter.word_count} words
                      {selectedChapter.duration_ms ? <> · {formatListenMinutes(selectedChapter.duration_ms)}</> : null}
                      {cachedChapters[selectedCacheKey] ? <> · saved offline</> : null}
                    </p>
                  </div>
                  <p className={`w-fit rounded-full px-3 py-1 text-xs font-medium ${syncPillClass}`}>{formatSyncTime(visibleLastSyncAt)}</p>
                </div>

                <audio
                  ref={audioRef}
                  src={audioSrc}
                  preload="metadata"
                  onLoadedMetadata={(e) => {
                    const audio = e.currentTarget;
                    setDuration(audio.duration || 0);
                    const nextTime = selectedChapter ? chapterPosition(selectedChapter.index) : 0;
                    if (Number.isFinite(nextTime) && nextTime > 0) {
                      audio.currentTime = Math.min(nextTime, audio.duration || nextTime);
                      setCurrentTime(audio.currentTime);
                      currentTimeRef.current = audio.currentTime;
                    }
                    if (resumeAfterChapterSwitchRef.current) {
                      resumeAfterChapterSwitchRef.current = false;
                      if (resumeTimerRef.current) window.clearTimeout(resumeTimerRef.current);
                      resumeTimerRef.current = window.setTimeout(() => {
                        resumeTimerRef.current = null;
                        audio.play().catch(() => undefined);
                      }, 2000);
                    }
                  }}
                  onTimeUpdate={(e) => {
                    currentTimeRef.current = e.currentTarget.currentTime;
                    setCurrentTime(e.currentTarget.currentTime);
                  }}
                  onPlay={() => setIsPlaying(true)}
                  onPause={(e) => {
                    setIsPlaying(false);
                    syncListeningProgress(e.currentTarget.currentTime);
                  }}
                  onEnded={(e) => {
                    syncListeningProgress(e.currentTarget.currentTime);
                    selectRelativeChapter(1);
                  }}
                  onError={() => setError(cachedChapters[selectedCacheKey] ? "Could not play saved audio." : "Could not stream audio. Save chapters offline while the server is available.")}
                  className="hidden"
                />

                <div className={`mt-5 rounded-md px-3 py-5 sm:mt-8 sm:px-4 ${innerPanelClass}`}>
                  <div className="grid grid-cols-[40px_1fr_64px_1fr_40px] items-center gap-2 sm:flex sm:justify-center sm:gap-4">
                    <button
                      onClick={() => selectRelativeChapter(-1)}
                      disabled={selectedChapterPosition <= 0}
                      title="Previous chapter"
                      aria-label="Previous chapter"
                      className={`inline-flex h-10 w-10 items-center justify-center rounded-full border disabled:opacity-35 ${controlClass}`}
                    >
                      <ChevronLeft size={20} />
                    </button>
                    <button
                      onClick={() => skip(-5)}
                      title="Back 5 seconds"
                      aria-label="Back 5 seconds"
                      className={`inline-flex h-11 items-center justify-center gap-1 rounded-full border px-2 text-sm font-semibold sm:min-w-16 sm:px-3 ${controlClass}`}
                    >
                      <Rewind size={17} /> 5s
                    </button>
                    <button
                      onClick={togglePlayback}
                      title={isPlaying ? "Pause" : "Play"}
                      aria-label={isPlaying ? "Pause" : "Play"}
                      className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-moss text-white shadow-sm transition hover:scale-[1.02]"
                    >
                      {isPlaying ? <Pause size={26} /> : <Play size={26} className="ml-0.5" />}
                    </button>
                    <button
                      onClick={() => skip(5)}
                      title="Forward 5 seconds"
                      aria-label="Forward 5 seconds"
                      className={`inline-flex h-11 items-center justify-center gap-1 rounded-full border px-2 text-sm font-semibold sm:min-w-16 sm:px-3 ${controlClass}`}
                    >
                      5s <FastForward size={17} />
                    </button>
                    <button
                      onClick={() => selectRelativeChapter(1)}
                      disabled={selectedChapterPosition >= readyChapters.length - 1}
                      title="Next chapter"
                      aria-label="Next chapter"
                      className={`inline-flex h-10 w-10 items-center justify-center rounded-full border disabled:opacity-35 ${controlClass}`}
                    >
                      <ChevronRight size={20} />
                    </button>
                  </div>

                  <div className="mt-6">
                    <div className={`mb-2 flex items-center justify-between text-xs font-medium ${mutedClass}`}>
                      <span>{formatClock(currentTime)}</span>
                      <span>{Math.round(progressPercent)}%</span>
                      <span>{formatClock(duration)}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={duration || 0}
                      step={0.1}
                      value={Math.min(currentTime, duration || currentTime)}
                      onChange={(e) => seek(Number(e.target.value))}
                      className="h-2 w-full cursor-pointer accent-moss"
                    />
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => saveOffline(selectedJob, selectedChapter)}
                    disabled={savingChapters[selectedCacheKey]}
                    title="Save this chapter for offline playback"
                    className={`inline-flex h-11 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium disabled:opacity-40 ${controlClass}`}
                  >
                    <WifiOff size={16} /> {cachedChapters[selectedCacheKey] ? "Update offline" : savingChapters[selectedCacheKey] ? "Saving..." : "Save offline"}
                  </button>
                  <button onClick={downloadCurrent} title="Download this chapter audio file" className={`inline-flex h-11 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium ${controlClass}`}>
                    <Download size={16} /> Download
                  </button>
                </div>

                <div className={`mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs font-medium ${subtleButtonClass}`}>
                  {cachedChapters[selectedCacheKey] && (
                    <button onClick={() => removeOffline(selectedJob, selectedChapter)} className="underline-offset-4 hover:underline">Remove offline copy</button>
                  )}
                  <button onClick={saveReadyChaptersOffline} title="Save all ready chapters for offline playback" className="underline-offset-4 hover:underline">Save all offline</button>
                  <button onClick={downloadReadyChapters} title="Download all ready chapter audio files" className="underline-offset-4 hover:underline">Download all</button>
                  {selectedJob.m4b_url && (
                    <a href={authedMediaUrl(selectedJob.m4b_url, token)} title="Download the full M4B audiobook" className="underline-offset-4 hover:underline">Download M4B</a>
                  )}
                </div>
              </div>

            </>
          )}

          {error && <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        </section>
      )}
    </main>
  );
}

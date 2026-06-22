import { OFFLINE_JOBS_KEY } from "./constants";
import type { Job, Chapter } from "../types";

export function formatEta(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function formatListenMinutes(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "0 min";
  const minutes = Math.round(milliseconds / 60000);
  if (minutes < 1) return "under 1 min";
  return `${minutes} min`;
}

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function formatSyncTime(value: string | null): string {
  if (!value) return "Not synced yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not synced yet";
  return `Last sync ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
}

export function loadJobsSnapshot(): Job[] {
  try {
    const stored = localStorage.getItem(OFFLINE_JOBS_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function latestListeningJob(jobs: Job[]): Job | undefined {
  return jobs
    .filter((job) => job.listening_progress)
    .sort((a, b) => Date.parse(b.listening_progress?.updated_at || "") - Date.parse(a.listening_progress?.updated_at || ""))[0];
}

export function loadChapterRange(jobId: string, fallback: { from: number; to: number }): { from: number; to: number } {
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

export function chapterStatusLabel(chapter: Chapter): string {
  if (chapter.pending) return "pending";
  if (chapter.status === "queued") return "not generated";
  return chapter.status;
}


export type AmbienceOption = { id: string; name: string };

export type BackgroundMode = "none" | "noise" | "ambience";

export type ModelOption = { id: string; engine: string; model: string; name: string };

export type VoiceProfile = {
  id: string;
  name: string;
};

export type EffectPreset = {
  id: string;
  name: string;
  effects_chain: Record<string, unknown>[];
};

export type Chapter = {
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

export type Job = {
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
  listening_progress?: {
    chapter_index: number;
    position_seconds: number;
    chapter_positions?: Record<string, number>;
    updated_at: string;
  } | null;
  m4b_url: string | null;
  partial_m4b_url: string | null;
  error: string | null;
};

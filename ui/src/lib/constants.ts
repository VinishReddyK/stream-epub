import type { ModelOption } from "../types";

export const API = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";
export const DEFAULT_TTS_BASE_URL = "http://127.0.0.1:17493";
export const DEFAULT_TTS_PROFILE = "f275c129-9d3b-40fc-9cc1-90a62bb93a98";
export const DEFAULT_TTS_LANGUAGE = "en";
export const DEFAULT_TTS_ENGINE = "qwen";
export const DEFAULT_TTS_MODEL = "0.6B";
export const DEFAULT_CHUNK_CHARS = 1000;
export const DEFAULT_CHUNK_CONCURRENCY = 10;
export const DEFAULT_NOISE_AMPLITUDE = 0.01;
export const DEFAULT_AMBIENCE_AMPLITUDE = 0.1;
export const CHAPTER_PAGE_SIZE_OPTIONS = [5, 10, 20, 50, 100];
export const DEFAULT_CHAPTER_PAGE_SIZE = 5;
export const OFFLINE_AUDIO_CACHE = "stream-epub-audio-v1";
export const OFFLINE_JOBS_KEY = "stream_epub_jobs_snapshot";
export const LISTENING_JOB_KEY = "stream_epub_listen_job";
export const LISTENING_CHAPTER_KEY = "stream_epub_listen_chapter";

export const NOISE_COLORS = [
  { id: "white", name: "White" },
  { id: "pink", name: "Pink" },
  { id: "brown", name: "Brown" },
  { id: "blue", name: "Blue" },
  { id: "violet", name: "Violet" },
  { id: "velvet", name: "Velvet" },
];

export const LANGUAGES = [
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

export const MODEL_OPTIONS: ModelOption[] = [
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

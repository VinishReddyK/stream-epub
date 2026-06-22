import { useEffect, useRef, useState } from "react";
import { ListMusic, LogOut, RefreshCw, Shuffle, Upload, Volume2 } from "lucide-react";
import { DEFAULT_AMBIENCE_AMPLITUDE, DEFAULT_CHUNK_CHARS, DEFAULT_CHUNK_CONCURRENCY, DEFAULT_NOISE_AMPLITUDE, DEFAULT_TTS_BASE_URL, DEFAULT_TTS_ENGINE, DEFAULT_TTS_LANGUAGE, DEFAULT_TTS_MODEL, DEFAULT_TTS_PROFILE, LANGUAGES, MODEL_OPTIONS, NOISE_COLORS, OFFLINE_JOBS_KEY } from "../lib/constants";
import { apiUrl, authHeaders, authedMediaUrl, request, wsUrl } from "../lib/api";
import { loadJobsSnapshot } from "../lib/utils";
import { navigateTo } from "../lib/navigation";
import type { AmbienceOption, BackgroundMode, EffectPreset, Job, UserSettings, VoiceProfile } from "../types";
import { JobCard } from "../components/JobCard";
import { PasswordPanel } from "../components/PasswordPanel";
import { ListenPage } from "./ListenPage";

export function Dashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [jobs, setJobs] = useState<Job[]>(() => loadJobsSnapshot());
  const [path, setPath] = useState(window.location.pathname);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 767px)").matches);
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

  function persistSettings(updates: UserSettings) {
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(value));
    });
    request("/api/settings", token, {
      method: "PUT",
      body: JSON.stringify({ settings: updates }),
    }).catch(() => undefined);
  }

  useEffect(() => {
    let cancelled = false;
    async function loadUserSettings() {
      try {
        const settings = await request<UserSettings>("/api/settings", token);
        if (cancelled) return;
        if (typeof settings.tts_base_url === "string") setBaseUrl(settings.tts_base_url);
        if (typeof settings.tts_voice === "string") setVoice(settings.tts_voice);
        if (typeof settings.tts_language === "string") setLanguage(settings.tts_language);
        if (typeof settings.tts_model_option === "string") setModelOptionId(settings.tts_model_option);
        if (typeof settings.tts_chunk_chars === "number") setChunkChars(settings.tts_chunk_chars);
        if (typeof settings.tts_chunk_concurrency === "number") setChunkConcurrency(settings.tts_chunk_concurrency);
        if (typeof settings.tts_effects_id === "string") setEffectsId(settings.tts_effects_id);
        if (typeof settings.tts_bg_mode === "string") setBgMode(settings.tts_bg_mode as BackgroundMode);
        if (typeof settings.tts_noise_color === "string") setNoiseColor(settings.tts_noise_color);
        if (typeof settings.tts_noise_amplitude === "number") setNoiseAmplitude(settings.tts_noise_amplitude);
        if (typeof settings.tts_ambience_category === "string") setAmbienceCategory(settings.tts_ambience_category);
        if (typeof settings.tts_ambience_file === "string") setAmbienceFile(settings.tts_ambience_file);
        if (typeof settings.tts_ambience_amplitude === "number") setAmbienceAmplitude(settings.tts_ambience_amplitude);
        if (typeof settings.tts_ambience_random === "boolean") setAmbienceRandomPerChapter(settings.tts_ambience_random);
        Object.entries(settings).forEach(([key, value]) => {
          if (value !== null && value !== undefined) localStorage.setItem(key, String(value));
        });
      } catch {
        // Local settings remain as fallback.
      }
    }
    loadUserSettings();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    const updatePath = () => setPath(window.location.pathname);
    window.addEventListener("popstate", updatePath);
    return () => window.removeEventListener("popstate", updatePath);
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const updateMobile = () => setIsMobile(query.matches);
    updateMobile();
    query.addEventListener("change", updateMobile);
    return () => query.removeEventListener("change", updateMobile);
  }, []);

  useEffect(() => {
    if (!isMobile || window.location.pathname === "/listen") return;
    window.history.replaceState({}, "", "/listen");
    setPath("/listen");
  }, [isMobile]);

  async function loadVoices() {
    setLoadingVoices(true);
    setVoicesError("");
    try {
      const result = await request<VoiceProfile[]>(`/api/tts/voicebox/profiles?base_url=${encodeURIComponent(baseUrl)}`, token);
      setVoices(result);
      if (result.length && !result.some((profile) => profile.id === voice)) {
        setVoice(result[0].id);
        persistSettings({ tts_voice: result[0].id });
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
    const preset = effectsPresets.find((item) => item.id === id);
    if (preset) {
      persistSettings({ tts_effects_id: id, tts_effects_chain: JSON.stringify(preset.effects_chain) });
    } else {
      persistSettings({ tts_effects_id: id, tts_effects_chain: null });
    }
  }

  async function loadAmbienceCategories() {
    setLoadingAmbienceCategories(true);
    try {
      const result = await request<AmbienceOption[]>("/api/ambience/categories", token);
      setAmbienceCategories(result);
      if (result.length && !result.some((item) => item.id === ambienceCategory)) {
        setAmbienceCategory(result[0].id);
        persistSettings({ tts_ambience_category: result[0].id });
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
        persistSettings({ tts_ambience_file: result[0].id });
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
    persistSettings({ tts_bg_mode: mode });
  }

  async function refresh() {
    try {
      const result = await request<Job[]>("/api/jobs", token);
      setJobs(result);
      localStorage.setItem(OFFLINE_JOBS_KEY, JSON.stringify(result));
      setError("");
    } catch (err) {
      const snapshot = loadJobsSnapshot();
      if (snapshot.length) setJobs(snapshot);
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
          const nextJobs = JSON.parse(event.data);
          setJobs(nextJobs);
          localStorage.setItem(OFFLINE_JOBS_KEY, JSON.stringify(nextJobs));
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
    persistSettings({ tts_base_url: baseUrl, tts_voice: voice });
  }

  function selectLanguage(value: string) {
    setLanguage(value);
    persistSettings({ tts_language: value });
  }

  function selectModelOption(id: string) {
    setModelOptionId(id);
    persistSettings({ tts_model_option: id });
  }

  function selectChunkChars(value: number) {
    setChunkChars(value);
    persistSettings({ tts_chunk_chars: value });
  }

  function selectChunkConcurrency(value: number) {
    setChunkConcurrency(value);
    persistSettings({ tts_chunk_concurrency: value });
  }

  function selectNoiseColor(value: string) {
    setNoiseColor(value);
    persistSettings({ tts_noise_color: value });
  }

  function selectNoiseAmplitude(value: number) {
    setNoiseAmplitude(value);
    persistSettings({ tts_noise_amplitude: value });
  }

  function selectAmbienceCategory(value: string) {
    setAmbienceCategory(value);
    persistSettings({ tts_ambience_category: value });
    setAmbienceFile("");
  }

  function selectAmbienceFile(value: string) {
    setAmbienceFile(value);
    persistSettings({ tts_ambience_file: value });
  }

  function selectAmbienceAmplitude(value: number) {
    setAmbienceAmplitude(value);
    persistSettings({ tts_ambience_amplitude: value });
  }

  function selectAmbienceRandomPerChapter(value: boolean) {
    setAmbienceRandomPerChapter(value);
    persistSettings({ tts_ambience_random: value });
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
      setAmbienceFile(file);
      persistSettings({ tts_ambience_category: category, tts_ambience_file: file });
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

  if (isMobile || path === "/listen") {
    return <ListenPage jobs={jobs} token={token} refresh={refresh} />;
  }

  return (
    <main className="mx-auto max-w-7xl p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">Stream EPUB</h1>
          <p className="text-sm text-ink/65">Generate chapter audio as it finishes, then pack the ready chapters or the whole book as M4B.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => navigateTo("/listen")} className="inline-flex items-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm font-medium"><ListMusic size={16} /> Listen</button>
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
              onChange={(e) => { setVoice(e.target.value); persistSettings({ tts_voice: e.target.value }); }}
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

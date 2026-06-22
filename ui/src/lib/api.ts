import { API } from "./constants";

export function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export function apiUrl(path: string) {
  return `${API}${path}`;
}

export function wsUrl(path: string, token: string) {
  const separator = path.includes("?") ? "&" : "?";
  return `${API.replace(/^http/, "ws")}${path}${separator}token=${encodeURIComponent(token)}`;
}

export function authedMediaUrl(path: string, token: string) {
  const separator = path.includes("?") ? "&" : "?";
  return apiUrl(`${path}${separator}token=${encodeURIComponent(token)}`);
}

export function offlineAudioKey(jobId: string, chapterIndex: number) {
  return `/offline-audio/${jobId}/${chapterIndex}`;
}

export async function request<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(apiUrl(path), { ...init, headers });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || res.statusText);
  return res.json();
}


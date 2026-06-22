import React, { useState } from "react";
import { apiUrl } from "../lib/api";

export function Login({ onLogin }: { onLogin: (token: string) => void }) {
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


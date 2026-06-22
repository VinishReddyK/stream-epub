import { useState } from "react";
import { KeyRound } from "lucide-react";
import { request } from "../lib/api";

export function PasswordPanel({ token }: { token: string }) {
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


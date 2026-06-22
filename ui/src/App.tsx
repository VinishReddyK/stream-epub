import { useState } from "react";
import { Login } from "./components/Login";
import { Dashboard } from "./pages/Dashboard";

export function App() {
  const [token, setToken] = useState(localStorage.getItem("stream_epub_token") || "");
  if (!token) return <Login onLogin={setToken} />;
  return <Dashboard token={token} onLogout={() => { localStorage.removeItem("stream_epub_token"); setToken(""); }} />;
}


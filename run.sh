#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$ROOT_DIR/server"
UI_DIR="$ROOT_DIR/ui"

BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
PROXY_HOST="${PROXY_HOST:-0.0.0.0}"
PROXY_PORT="${PROXY_PORT:-3000}"

if [[ -x "$SERVER_DIR/.venv/bin/python" ]]; then
  PYTHON="$SERVER_DIR/.venv/bin/python"
else
  PYTHON="${PYTHON:-python3}"
fi

if [[ ! -d "$UI_DIR/node_modules" ]]; then
  echo "Installing UI dependencies..."
  (cd "$UI_DIR" && npm install)
fi

echo "Building UI..."
(cd "$UI_DIR" && VITE_API_BASE_URL="" npm run build)

cleanup() {
  local status="${1:-$?}"
  trap - EXIT INT TERM

  echo
  echo "Shutting down..."

  for pid in ${BACKEND_PID:-} ${PROXY_PID:-}; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done

  for _ in {1..20}; do
    local alive=0
    for pid in ${BACKEND_PID:-} ${PROXY_PID:-}; do
      if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
        alive=1
      fi
    done
    [[ "$alive" -eq 0 ]] && break
    sleep 0.25
  done

  for pid in ${BACKEND_PID:-} ${PROXY_PID:-}; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  done

  wait ${BACKEND_PID:-} ${PROXY_PID:-} 2>/dev/null || true
  exit "$status"
}
trap 'cleanup 130' INT
trap 'cleanup 143' TERM
trap 'cleanup $?' EXIT

echo "Starting backend on http://$BACKEND_HOST:$BACKEND_PORT ..."
(cd "$SERVER_DIR" && "$PYTHON" -m uvicorn app.main:app --host "$BACKEND_HOST" --port "$BACKEND_PORT") &
BACKEND_PID=$!

echo "Starting UI/proxy on http://$PROXY_HOST:$PROXY_PORT ..."
ROOT_DIR="$ROOT_DIR" BACKEND_HOST="$BACKEND_HOST" BACKEND_PORT="$BACKEND_PORT" PROXY_HOST="$PROXY_HOST" PROXY_PORT="$PROXY_PORT" node <<'NODE' &
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");

const rootDir = process.env.ROOT_DIR;
const distDir = path.join(rootDir, "ui", "dist");
const backendHost = process.env.BACKEND_HOST || "127.0.0.1";
const backendPort = Number(process.env.BACKEND_PORT || 8000);
const proxyHost = process.env.PROXY_HOST || "0.0.0.0";
const proxyPort = Number(process.env.PROXY_PORT || 3000);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

function proxyHttp(req, res) {
  const headers = { ...req.headers, host: `${backendHost}:${backendPort}` };
  const upstream = http.request(
    {
      hostname: backendHost,
      port: backendPort,
      method: req.method,
      path: req.url,
      headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    }
  );
  upstream.on("error", () => {
    res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Backend unavailable");
  });
  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  if (!req.url) {
    res.writeHead(400);
    res.end("Bad request");
    return;
  }

  if (req.url.startsWith("/api/")) {
    proxyHttp(req, res);
    return;
  }

  const urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const requestedPath = path.normalize(path.join(distDir, urlPath));
  if (!requestedPath.startsWith(distDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.stat(requestedPath, (err, stat) => {
    if (!err && stat.isFile()) {
      sendFile(res, requestedPath);
      return;
    }
    sendFile(res, path.join(distDir, "index.html"));
  });
});

server.on("upgrade", (req, socket, head) => {
  if (!req.url || !req.url.startsWith("/api/")) {
    socket.destroy();
    return;
  }

  const upstream = net.connect(backendPort, backendHost, () => {
    upstream.write(
      `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n` +
      Object.entries({ ...req.headers, host: `${backendHost}:${backendPort}` })
        .map(([key, value]) => `${key}: ${value}`)
        .join("\r\n") +
      "\r\n\r\n"
    );
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });

  upstream.on("error", () => socket.destroy());
});

server.listen(proxyPort, proxyHost, () => {
  console.log(`Listening on http://${proxyHost}:${proxyPort}`);
});
NODE
PROXY_PID=$!

echo "Ready: http://127.0.0.1:$PROXY_PORT"
while true; do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "Backend exited."
    exit 1
  fi
  if ! kill -0 "$PROXY_PID" 2>/dev/null; then
    echo "Proxy exited."
    exit 1
  fi
  sleep 1
done

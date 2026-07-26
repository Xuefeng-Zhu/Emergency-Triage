#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi

.venv/bin/python -m pip install -e 'apps/api[dev]'
pnpm install

cleanup() {
  kill "${api_pid:-}" "${web_pid:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

.venv/bin/uvicorn app.main:app \
  --app-dir apps/api \
  --host 0.0.0.0 \
  --port 8787 &
api_pid=$!

pnpm run dev:web &
web_pid=$!

wait -n "$api_pid" "$web_pid"

#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

if [[ "$(uname -m)" != "aarch64" ]]; then
  echo "Warning: this bootstrap was validated for the Dell GB10 ARM64 host." >&2
fi

for command in docker ffmpeg python3; do
  command -v "$command" >/dev/null || {
    echo "Missing prerequisite: $command" >&2
    exit 1
  }
done

if ! command -v nemoclaw >/dev/null; then
  echo "NemoClaw is not installed."
  echo "Run scripts/install-nemoclaw.sh after reviewing NVIDIA's third-party notice."
fi

if ! command -v uv >/dev/null; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi

uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -e 'apps/api[dev,stt]'

if ! command -v node >/dev/null; then
  echo "Node.js 22.16+ is required. The NemoClaw installer can install it." >&2
  exit 1
fi

corepack enable
pnpm install --frozen-lockfile
pnpm run build

mkdir -p data
echo "Native application dependencies installed. No app containers were created."

#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
sandbox_name="${NEMOCLAW_SANDBOX:-emergency-trial-agent}"
model="${OLLAMA_MODEL:-qwen3.5:9b}"
context_window="${NEMOCLAW_CONTEXT_WINDOW:-16384}"

if ! command -v nemoclaw >/dev/null 2>&1; then
  curl -fsSL https://www.nvidia.com/nemoclaw.sh |
    NEMOCLAW_ACCEPT_THIRD_PARTY_SOFTWARE=1 \
    NEMOCLAW_NON_INTERACTIVE=1 \
    NEMOCLAW_PROVIDER=ollama \
    NEMOCLAW_MODEL="$model" \
    NEMOCLAW_CONTEXT_WINDOW="$context_window" \
    NEMOCLAW_SANDBOX_NAME="$sandbox_name" \
    NEMOCLAW_YES=1 \
    bash
fi

NEMOCLAW_PROVIDER=ollama \
NEMOCLAW_MODEL="$model" \
NEMOCLAW_CONTEXT_WINDOW="$context_window" \
NEMOCLAW_SANDBOX_NAME="$sandbox_name" \
NEMOCLAW_YES=1 \
nemoclaw onboard \
  --fresh \
  --recreate-sandbox \
  --name "$sandbox_name" \
  --agent openclaw \
  --agents "$repository_root/infra/nemoclaw/agents.yaml" \
  --non-interactive \
  --yes \
  --yes-i-accept-third-party-software

nemoclaw "$sandbox_name" status

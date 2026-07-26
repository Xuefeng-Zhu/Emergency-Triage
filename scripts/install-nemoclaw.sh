#!/usr/bin/env bash
set -euo pipefail

sandbox_name="${NEMOCLAW_SANDBOX_NAME:-emergency-trial-agent}"

if [[ "${NEMOCLAW_ACCEPT_THIRD_PARTY_SOFTWARE:-}" != "1" ]]; then
  cat >&2 <<'NOTICE'
NemoClaw installs OpenClaw and uses OpenShell with the host container runtime.
Review NVIDIA's third-party software notice, then rerun with:
  NEMOCLAW_ACCEPT_THIRD_PARTY_SOFTWARE=1 scripts/install-nemoclaw.sh
NOTICE
  exit 2
fi

curl -fsSL https://www.nvidia.com/nemoclaw.sh | \
  NEMOCLAW_AGENT=openclaw \
  NEMOCLAW_NON_INTERACTIVE=1 \
  NEMOCLAW_ACCEPT_THIRD_PARTY_SOFTWARE=1 \
  NEMOCLAW_PROVIDER=install-vllm \
  NEMOCLAW_VLLM_MODEL=qwen3.6-35b-a3b-nvfp4 \
  NEMOCLAW_POLICY_TIER=restricted \
  NEMOCLAW_SANDBOX_NAME="$sandbox_name" \
  bash

nemoclaw "$sandbox_name" status
nemoclaw "$sandbox_name" policy-add \
  --from-file agent/presets/mock-lis.yaml \
  --dry-run

echo
echo "Policy dry-run passed. Apply it explicitly with:"
echo "  nemoclaw $sandbox_name policy-add --from-file agent/presets/mock-lis.yaml --yes"

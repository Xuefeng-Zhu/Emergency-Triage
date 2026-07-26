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

# Both steps below are skipped when already satisfied, so this is safe to rerun
# on a provisioned box (the CLI install is a network fetch; the onboard is not
# idempotent on its own and would need --recreate-sandbox).
if command -v nemoclaw >/dev/null 2>&1; then
  echo "nemoclaw already installed ($(nemoclaw --version 2>/dev/null || echo present)); skipping installer."
else
  curl -fsSL https://www.nvidia.com/nemoclaw.sh | \
    NEMOCLAW_AGENT=openclaw \
    NEMOCLAW_NON_INTERACTIVE=1 \
    NEMOCLAW_ACCEPT_THIRD_PARTY_SOFTWARE=1 \
    NEMOCLAW_PROVIDER=install-vllm \
    NEMOCLAW_VLLM_MODEL=qwen3.6-35b-a3b-nvfp4 \
    NEMOCLAW_POLICY_TIER=restricted \
    NEMOCLAW_SANDBOX_NAME="$sandbox_name" \
    bash
fi

if nemoclaw list --json | grep -q "\"name\": \"$sandbox_name\""; then
  echo "Sandbox '$sandbox_name' already exists; skipping onboard."
else
  # The gateway shares one inference route across every registered sandbox, so
  # keep the model identical to any sibling sandbox or onboarding is refused as
  # unprovable. `onboard` reads the provider/model from these env vars.
  NEMOCLAW_PROVIDER=install-vllm \
  NEMOCLAW_VLLM_MODEL=qwen3.6-35b-a3b-nvfp4 \
  NEMOCLAW_POLICY_TIER=restricted \
  nemoclaw onboard \
    --name "$sandbox_name" \
    --agent openclaw \
    --gpu \
    --non-interactive \
    --yes \
    --yes-i-accept-third-party-software
fi

nemoclaw "$sandbox_name" status
nemoclaw "$sandbox_name" policy-add \
  --from-file agent/presets/mock-lis.yaml \
  --dry-run

echo
echo "Policy dry-run passed. Apply it explicitly with:"
echo "  nemoclaw $sandbox_name policy-add --from-file agent/presets/mock-lis.yaml --yes"

#!/usr/bin/env bash
set -euo pipefail

cd /opt/emergency-trial
set -a
# shellcheck disable=SC1091
source /opt/emergency-trial/.env
set +a

if [[ -z "${AGENT_DATABASE_URL:-}" ]]; then
  printf 'AGENT_DATABASE_URL is required\n' >&2
  exit 1
fi
export DATABASE_URL="$AGENT_DATABASE_URL"
exec /usr/bin/pnpm --filter @emergency-trial/agent-worker start

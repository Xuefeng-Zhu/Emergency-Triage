#!/usr/bin/env bash
set -euo pipefail

caddy_port="${CADDY_PORT:-8080}"
tailscale status >/dev/null
tailscale serve --bg "http://127.0.0.1:${caddy_port}"
tailscale serve status

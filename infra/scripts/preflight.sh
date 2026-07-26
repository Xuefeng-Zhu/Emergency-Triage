#!/usr/bin/env bash
set -euo pipefail

failures=0

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1" >&2; failures=$((failures + 1)); }
need() {
  if command -v "$1" >/dev/null 2>&1; then pass "$1 available"; else fail "$1 missing"; fi
}

if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  source /etc/os-release
  if [[ "${ID:-}" == "ubuntu" ]] && [[ "${VERSION_ID%%.*}" -ge 22 ]]; then
    pass "Ubuntu ${VERSION_ID}"
  else
    fail "Ubuntu 22.04 or newer required"
  fi
else
  fail "/etc/os-release unavailable"
fi

for binary in docker node pnpm ffmpeg tailscale nvidia-smi; do need "$binary"; done

if docker compose version >/dev/null 2>&1; then pass "Docker Compose available"; else fail "Docker Compose missing"; fi
if docker info >/dev/null 2>&1; then pass "Docker daemon reachable"; else fail "Docker daemon unavailable"; fi
if docker info 2>/dev/null | grep -q nvidia; then pass "NVIDIA container runtime registered"; else fail "NVIDIA container runtime unavailable"; fi

node_version="$(node -p "process.versions.node" 2>/dev/null || printf '0.0.0')"
node_major="${node_version%%.*}"
node_minor="${node_version#*.}"; node_minor="${node_minor%%.*}"
if (( node_major > 22 || (node_major == 22 && node_minor >= 16) )); then
  pass "Node ${node_version}"
else
  fail "Node 22.16+ required; found ${node_version}"
fi

ram_gib="$(awk '/MemTotal/ {printf "%d", $2 / 1024 / 1024}' /proc/meminfo)"
if (( ram_gib >= 16 )); then pass "RAM ${ram_gib} GiB"; else fail "16 GiB RAM recommended; found ${ram_gib} GiB"; fi

disk_gib="$(df -Pk . | awk 'NR==2 {printf "%d", $4 / 1024 / 1024}')"
if (( disk_gib >= 50 )); then pass "free disk ${disk_gib} GiB"; else fail "50 GiB free disk required; found ${disk_gib} GiB"; fi

vram_mib="$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d ' ')"
if [[ "${vram_mib:-0}" =~ ^[0-9]+$ ]] && (( vram_mib >= 16000 )); then
  pass "GPU VRAM ${vram_mib} MiB"
else
  fail "NVIDIA GPU with at least 16000 MiB VRAM required"
fi

for port in 8080 3000 3001 5432; do
  if ss -H -ltn "sport = :${port}" 2>/dev/null | grep -q .; then
    fail "TCP port ${port} already in use"
  else
    pass "TCP port ${port} available"
  fi
done

if (( failures > 0 )); then
  printf '\nPreflight failed with %d issue(s).\n' "$failures" >&2
  exit 1
fi
printf '\nPreflight passed.\n'

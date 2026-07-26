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
uv pip install --python .venv/bin/python -e 'apps/api[dev]'

if [[ "$(uname -m)" == "aarch64" ]]; then
  # WhisperX's default ARM64 resolution selects CPU PyTorch. Install NVIDIA's
  # native CUDA 13 wheels first, then keep them in place while installing the
  # currently validated WhisperX release and its non-PyTorch dependencies.
  UV_HTTP_TIMEOUT="${UV_HTTP_TIMEOUT:-3600}" uv pip install \
    --python .venv/bin/python \
    --index-url https://download.pytorch.org/whl/cu130 \
    torch torchaudio torchvision torchcodec
  UV_HTTP_TIMEOUT="${UV_HTTP_TIMEOUT:-3600}" uv pip install \
    --python .venv/bin/python \
    "ctranslate2>=4.5.0,<5" \
    "faster-whisper>=1.2.0,<2" \
    "huggingface-hub>=0.28.1" \
    "nltk>=3.9.1" \
    "numpy>=2.1.0" \
    "omegaconf>=2.3.0" \
    "pandas>=2.2.3" \
    "pyannote-audio>=4.0.0" \
    "transformers>=4.48.0" \
    nvidia-cublas-cu12 \
    "nvidia-cudnn-cu12>=9,<10"
  uv pip install --python .venv/bin/python --no-deps "whisperx==3.8.6"
else
  uv pip install --python .venv/bin/python -e 'apps/api[stt]'
fi

if ! command -v node >/dev/null; then
  echo "Node.js 22.16+ is required. The NemoClaw installer can install it." >&2
  exit 1
fi

corepack enable
pnpm install --frozen-lockfile
pnpm run build

mkdir -p data
echo "Native application dependencies installed. No app containers were created."

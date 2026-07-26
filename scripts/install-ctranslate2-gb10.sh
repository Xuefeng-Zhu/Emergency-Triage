#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

if [[ "$(uname -m)" != "aarch64" ]]; then
  echo "This installer is only for the Dell GB10 ARM64 host." >&2
  exit 1
fi

for command in apt cmake c++ dpkg-deb git; do
  command -v "$command" >/dev/null || {
    echo "Missing build prerequisite: $command" >&2
    exit 1
  }
done

if [[ ! -x .venv/bin/python ]]; then
  echo "Missing .venv. Run scripts/bootstrap-dell.sh first." >&2
  exit 1
fi

if command -v uv >/dev/null; then
  uv_command="$(command -v uv)"
elif [[ -x "$HOME/.local/bin/uv" ]]; then
  uv_command="$HOME/.local/bin/uv"
else
  echo "uv was not found. Run scripts/bootstrap-dell.sh first." >&2
  exit 1
fi

if command -v nvcc >/dev/null; then
  nvcc_path="$(command -v nvcc)"
elif [[ -x /usr/local/cuda-13.0/bin/nvcc ]]; then
  nvcc_path="/usr/local/cuda-13.0/bin/nvcc"
elif [[ -x /usr/local/cuda/bin/nvcc ]]; then
  nvcc_path="/usr/local/cuda/bin/nvcc"
else
  echo "CUDA nvcc was not found. Install the CUDA 13 toolkit first." >&2
  exit 1
fi

cuda_root="$(cd "$(dirname "$nvcc_path")/.." && pwd)"
python_version="$(
  .venv/bin/python -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")'
)"
site_packages="$(
  .venv/bin/python -c 'import site; print(site.getsitepackages()[0])'
)"
cudnn_root="$site_packages/nvidia/cudnn"
cudnn_library="$cudnn_root/lib/libcudnn.so.9"

if [[ ! -f "$cudnn_root/include/cudnn.h" || ! -f "$cudnn_library" ]]; then
  echo "CUDA cuDNN headers and libraries are missing from the virtualenv." >&2
  echo "Install nvidia-cudnn-cu12 before running this script." >&2
  exit 1
fi

version="${CTRANSLATE2_VERSION:-4.8.1}"
build_root="$project_root/.build"
source_dir="$build_root/ctranslate2"
build_dir="$source_dir/build-gb10"
install_dir="$build_root/ctranslate2-install"
python_dev_dir="$build_root/python-dev"

mkdir -p "$build_root"
if [[ ! -d "$source_dir/.git" ]]; then
  git clone --branch "v$version" --depth 1 --recurse-submodules \
    https://github.com/OpenNMT/CTranslate2.git "$source_dir"
else
  git -C "$source_dir" -c fetch.recurseSubmodules=false \
    fetch --tags --force origin
  git -C "$source_dir" checkout --detach "v$version"
  git -C "$source_dir" submodule update --init --recursive
fi

# CTranslate2 4.8.1's legacy CUDA parser predates compute capability 12.1.
# Keep its validated 9.0 baseline and add the GB10 target explicitly.
CUDA_ARCH_LIST=9.0 \
CUDA_NVCC_FLAGS="-gencode=arch=compute_121,code=sm_121" \
cmake -S "$source_dir" -B "$build_dir" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$install_dir" \
  -DCMAKE_INSTALL_RPATH="$cudnn_root/lib;$cuda_root/targets/sbsa-linux/lib" \
  -DCUDA_TOOLKIT_ROOT_DIR="$cuda_root" \
  -DCUDNN_INCLUDE_DIR="$cudnn_root/include" \
  -DCUDNN_LIBRARY="$cudnn_library" \
  -DCUDA_DYNAMIC_LOADING=ON \
  -DOPENMP_RUNTIME=COMP \
  -DWITH_CUDA=ON \
  -DWITH_CUDNN=ON \
  -DWITH_MKL=OFF \
  -DWITH_RUY=ON

cmake --build "$build_dir" --parallel "$(getconf _NPROCESSORS_ONLN)"
cmake --install "$build_dir"

python_include_root="/usr/include"
if [[ ! -f "$python_include_root/python$python_version/Python.h" ]]; then
  python_include_root="$python_dev_dir/usr/include"
  if [[ ! -f "$python_include_root/python$python_version/Python.h" ]]; then
    mkdir -p "$python_dev_dir/packages"
    (
      cd "$python_dev_dir/packages"
      apt download "libpython$python_version-dev"
    )
    python_dev_package="$(
      find "$python_dev_dir/packages" -maxdepth 1 -name "libpython${python_version}-dev_*.deb" \
        -print -quit
    )"
    if [[ -z "$python_dev_package" ]]; then
      echo "Unable to download the Python development headers." >&2
      exit 1
    fi
    dpkg-deb -x "$python_dev_package" "$python_dev_dir"
  fi
fi

CTRANSLATE2_ROOT="$install_dir" \
CFLAGS="-I$python_include_root/python$python_version -I$python_include_root" \
CXXFLAGS="-I$python_include_root/python$python_version -I$python_include_root" \
LDFLAGS="-Wl,-rpath,$install_dir/lib" \
"$uv_command" pip install \
  --python .venv/bin/python \
  --force-reinstall \
  --no-deps \
  "$source_dir/python"

.venv/bin/python - <<'PY'
import ctranslate2

compute_types = ctranslate2.get_supported_compute_types("cuda")
if "float16" not in compute_types:
    raise SystemExit(f"CTranslate2 CUDA float16 is unavailable: {compute_types}")
print(f"CTranslate2 {ctranslate2.__version__} CUDA compute types: {sorted(compute_types)}")
PY

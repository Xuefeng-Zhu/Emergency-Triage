FROM nvidia/cuda:12.8.1-cudnn-runtime-ubuntu24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1
ENV VIRTUAL_ENV=/opt/venv
ENV PATH="/opt/venv/bin:$PATH"

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates ffmpeg python3 python3-pip python3-venv \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m venv "$VIRTUAL_ENV"

WORKDIR /app
COPY services/whisperx/pyproject.toml ./
RUN pip install --no-cache-dir .
COPY services/whisperx/worker.py ./worker.py

RUN useradd --system --uid 1001 --create-home worker \
  && mkdir -p /data /models \
  && chown -R worker:worker /data /models /app

USER worker
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD test -f /tmp/whisperx-worker-ready
CMD ["python", "worker.py"]

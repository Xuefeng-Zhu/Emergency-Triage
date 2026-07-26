# Native GB10 runbook

The application services run directly on Ubuntu. Docker Compose is not used.
The existing Docker daemon is used only by the supported NemoClaw/OpenShell
sandbox and managed local vLLM path.

## Local stub mode

```bash
cp .env.example .env
scripts/dev.sh
```

Open `http://localhost:5173`. Stub mode exercises the full transcript,
suggestion, consult, policy-refusal, approval, mock-order, and audit path without
loading GPU models.

## Dell GB10 bootstrap

```bash
git clone https://github.com/Xuefeng-Zhu/Emergency-Trial ~/Emergency-Trial
cd ~/Emergency-Trial
cp .env.example .env
scripts/bootstrap-dell.sh
```

On ARM64, the bootstrap deliberately installs the CUDA 13 PyTorch wheels before
WhisperX. It also installs CUDA 12 cuBLAS/cuDNN compatibility libraries, then
builds CTranslate2 4.8.1 from source for the GB10's compute capability 12.1.
The published ARM64 CTranslate2 wheel is CPU-only, so do not replace this with a
plain `pip install whisperx`.

Install NemoClaw only after reviewing its third-party notice:

```bash
NEMOCLAW_ACCEPT_THIRD_PARTY_SOFTWARE=1 scripts/install-nemoclaw.sh
nemoclaw emergency-trial-agent policy-add \
  --from-file agent/presets/mock-lis.yaml \
  --yes
```

The script selects the validated managed-vLLM model recipe for a GB10-class
Spark system and the restricted NemoClaw policy tier. It does not enable web
search, messaging, or external MCP integrations.

The API, WhisperX, and UI run directly on Ubuntu and do not use Docker.
NemoClaw/OpenShell itself still requires Docker on its supported Linux path.

Copy `agent/AGENTS.md` into the sandbox workspace:

```bash
openshell sandbox upload emergency-trial-agent \
  agent/AGENTS.md /sandbox/workspace/AGENTS.md
```

Switch `.env` to live mode only after all checks pass:

```dotenv
TRIAGE_MODE=live
ORDER_PERMIT_SECRET=<generate-a-long-random-value-on-the-host>
```

## Verification

```bash
.venv/bin/pytest apps/api/tests
pnpm run typecheck
pnpm run build
nemoclaw emergency-trial-agent status
nemoclaw emergency-trial-agent policy-get
curl -fsS http://127.0.0.1:8787/healthz
```

The live acceptance path is:

1. Open the live WhisperX console and confirm three-second microphone chunks
   append to the transcript while speaking.
2. Create a session from the tablet.
3. Hold to talk, release, and confirm WhisperX returns text.
4. Confirm suggestions update from the JSON pathway.
5. Request a consult and verify an out-of-envelope imaging proposal is already
   `refused`.
6. Approve the allowed lab proposal and verify a `submitted` audit row and mock
   LIS reference.
7. From the sandbox, try any undeclared destination and confirm OpenShell denies
   it.

## Systemd

After building and setting `.env`, copy the unit templates with `sudo`:

```bash
sudo cp deploy/systemd/emergency-trial-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now emergency-trial-api emergency-trial-web
```

The tablet URL is `http://172.16.10.137:4173`.

Browsers allow microphone capture only from a secure context. For a quick
private-network test without adding TLS, tunnel the web service and use the
browser's trusted `localhost` origin:

```bash
ssh -N -L 4173:127.0.0.1:4173 dell@172.16.10.137
```

Then open `http://localhost:4173/whisperx`, select **Start listening**, and grant
microphone access. The console sends ordered three-second WAV chunks to the
local API and appends non-empty WhisperX results as they finish.

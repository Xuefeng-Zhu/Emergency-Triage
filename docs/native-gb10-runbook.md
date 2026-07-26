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

1. Create a session from the tablet.
2. Hold to talk, release, and confirm WhisperX returns text.
3. Confirm suggestions update from the JSON pathway.
4. Request a consult and verify an out-of-envelope imaging proposal is already
   `refused`.
5. Approve the allowed lab proposal and verify a `submitted` audit row and mock
   LIS reference.
6. From the sandbox, try any undeclared destination and confirm OpenShell denies
   it.

## Systemd

After building and setting `.env`, copy the unit templates with `sudo`:

```bash
sudo cp deploy/systemd/emergency-trial-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now emergency-trial-api emergency-trial-web
```

The tablet URL is `http://172.16.10.137:4173`.

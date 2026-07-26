# Emergency Trial

A self-hosted, multi-user voice workspace built around four local-first layers:

- **Next.js** for the authenticated browser workspace.
- **PostgreSQL + Drizzle** for durable recordings, transcripts, jobs, and analyses.
- **WhisperLiveKit + WhisperX** for provisional live captions and authoritative final transcripts.
- **NemoClaw + OpenClaw + OpenShell** for sandboxed, local transcript analysis.

The application is designed for a single Ubuntu host with an NVIDIA GPU, Docker,
NVIDIA Container Toolkit, Ollama, and Tailscale. The browser reaches only the
Tailscale HTTPS origin; application services and the OpenShell gateway remain
private.

## Repository layout

```text
apps/web/                 Next.js application and Better Auth
packages/contracts/       Shared Zod schemas and public event types
packages/db/              Drizzle schema, migrations, and queue helpers
services/realtime/        Authenticated PCM WebSocket gateway
services/whisperx/        CUDA WhisperX finalization worker
services/agent-worker/    Host-side NemoClaw analysis worker
infra/                    Caddy, systemd, and Ubuntu bootstrap scripts
```

## Local development

Requirements: Node.js 22.16+, pnpm 11+, Docker, and Compose.

```bash
cp .env.example .env
pnpm install
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

Open `http://localhost:3000/preview` for a database-free interactive UI preview,
or bootstrap an administrator and use the authenticated application:

```bash
pnpm bootstrap:admin -- --email admin@example.test --name "Local Admin"
```

The bootstrap command prints a strong initial password once. Store it in a
password manager; it cannot be recovered from the database.

## Production host

1. Run `infra/scripts/preflight.sh`.
2. Copy `.env.example` to `.env` and replace every `change-me` value.
3. Run `infra/scripts/bootstrap-nemoclaw.sh` to install and onboard the
   `emergency-trial-agent` OpenClaw sandbox with Local Ollama.
4. Start the application with `docker compose up -d --build`.
5. Install `infra/systemd/emergency-trial-agent-worker.service`.
6. Run `infra/scripts/tailscale-serve.sh`.

Detailed deployment, backup, recovery, health, and teardown commands live in
[docs/operations.md](docs/operations.md).

## Safety boundary

Transcripts are treated as untrusted data. The agent worker uses a dedicated,
fresh job directory and session for each analysis. OpenClaw receives no database
credentials, Docker socket, messaging integration, web-search integration, or
external MCP server. OpenShell remains the credential and policy boundary.

The earlier one-day hackathon scope is preserved in
[docs/er-triage-agent-scope.md](docs/er-triage-agent-scope.md); it is historical
context and intentionally differs from the implemented multi-user architecture.

# Next.js Voice Agent Boilerplate

## Summary

Build a self-hosted multi-user voice workspace:

- Next.js App Router UI with invite-only authentication.
- PostgreSQL and Drizzle for users, recordings, transcripts, jobs, and analyses.
- WhisperLiveKit for sub-two-second provisional captions.
- WhisperX for authoritative final transcripts, word timestamps, and optional speaker labels.
- OpenClaw running inside OpenShell, managed through NemoClaw, for structured briefs and custom analysis.
- Docker Compose on a Dell Ubuntu host, with the NemoClaw agent worker managed by systemd.
- Private HTTPS access through Tailscale.

NemoClaw, OpenShell, and OpenClaw are treated as one layered agent stack: NemoClaw manages the deployment, OpenShell enforces isolation and inference routing, and OpenClaw performs analysis.

Reference: [NVIDIA NemoClaw architecture](https://docs.nvidia.com/nemoclaw/latest/user-guide/openclaw/reference/architecture)

## Implementation

### Application, data, and authentication

- Initialize a pnpm and TypeScript monorepo containing the Next.js app, shared contracts and database packages, realtime gateway, WhisperX worker, and host agent worker.
- Use a standalone Next.js production image, Server Components for database reads, Server Actions for UI mutations, and Route Handlers only for authentication, audio delivery, health, and realtime-supporting APIs.
- Use Drizzle with PostgreSQL and migrations for:
  - Better Auth users, sessions, roles, and accounts.
  - Enrollment tokens with hashed values, expiry, and one-time use.
  - Recordings and durable five-second audio chunk manifests.
  - Provisional and final transcripts, structured segments, and word timestamps.
  - Analysis runs and leased background jobs.
- Configure Better Auth's PostgreSQL and Drizzle adapter, admin support, custom Argon2id hashing, secure database sessions, and disabled public registration.
- Bootstrap the first administrator through a CLI. Admins generate one-time enrollment URLs; users set their own passwords without requiring an email service.
- Scope every recording, transcript, analysis, WebSocket, and audio-download operation by authenticated owner. Audio is never served as a static directory.

Reference: [Better Auth Next.js integration](https://better-auth.com/docs/integrations/next)

### Realtime speech and WhisperX

- Add an authenticated WebSocket gateway behind `/ws/recordings/:id`.
- Use a browser AudioWorklet to capture mono 16 kHz PCM16, send binary frames, and support a ten-second reconnect window.
- The gateway simultaneously:
  - Forwards frames to WhisperLiveKit's native WebSocket API.
  - Emits provisional caption events to the browser.
  - Accumulates durable five-second chunks under opaque owner and recording paths.
- On Stop, assemble chunks into a lossless FLAC source, enqueue finalization idempotently, and remove redundant chunks after checksum verification.
- Run WhisperLiveKit with its small streaming model and PCM input mode.
- Run WhisperX with a balanced multilingual `medium` and FP16 profile, batch size 4 with automatic 4 to 2 to 1 out-of-memory backoff, and one finalization job at a time.
- Replace provisional text with the final WhisperX transcript.
- Enable speaker diarization only when the Hugging Face token and accepted pyannote terms are present; otherwise complete normally without speakers.
- If live ASR fails, continue recording and show that live captions are unavailable; final WhisperX processing remains available.
- Automatically delete source audio after 30 days while retaining transcripts and analyses. Exclude active jobs and record every purge.

References:

- [WhisperLiveKit](https://github.com/QuentinFuxa/WhisperLiveKit)
- [WhisperX](https://github.com/m-bain/whisperX)

### NemoClaw agent pipeline

- Install NemoClaw on the Ubuntu host and onboard a sandbox named `emergency-trial-agent` with OpenClaw and Local Ollama.
- Pin `qwen3.5:9b` as the initial tool-capable local model with a 16K context window. Let NemoClaw validate structured tool calling and route inference through OpenShell's authenticated local proxy.
- Bake a dedicated transcript-analyst profile with no messaging, web search, or external MCP integrations.
- Run the agent worker on the host under systemd so it can use supported `nemoclaw` commands without mounting the Docker socket into the web application.
- For each analysis:
  - Create an isolated sandbox job directory and fresh agent session.
  - Upload only the selected transcript and prompt.
  - Treat transcript contents as untrusted data, never executable instructions.
  - Invoke OpenClaw through the NemoClaw JSON command surface.
  - Validate the result against shared schemas, persist it, then delete the sandbox job directory and unload Ollama.
- Generate a standard brief containing a summary, key points, decisions, action items, risks, and timestamped notable quotes.
- Support bounded custom prompts and Markdown results with timestamp references.
- For transcripts exceeding the model context, run timestamp-preserving map/reduce analysis rather than truncating content.
- Use a PostgreSQL advisory lock for GPU-exclusive WhisperX and Ollama work.
- On the 16 GB profile, heavy work waits while any live recording is active so caption latency remains protected.

Reference: [NemoClaw local inference](https://docs.nvidia.com/nemoclaw/latest/inference/use-local-inference.html)

### Deployment and operations

- Compose services:
  - PostgreSQL.
  - Next.js.
  - Realtime gateway.
  - WhisperLiveKit.
  - WhisperX worker.
  - Internal Caddy router.
- Keep all services on internal Docker networking and publish only Caddy to host loopback.
- Use Tailscale Serve to terminate trusted HTTPS and proxy to Caddy, including WebSocket upgrades.
- Add Ubuntu preflight checks for Docker, the NVIDIA driver and container toolkit, GPU compute and VRAM, Node.js 22.16 or later, disk, RAM, ffmpeg, Tailscale, and required ports.
- Provide environment templates without secrets, migration and bootstrap commands, systemd units, health checks, structured redacted logs, backup and restore instructions, and a clean teardown runbook.
- Keep the OpenShell gateway and OpenClaw dashboard loopback-only.
- Operate NemoClaw-managed lifecycle with `nemoclaw`, using `openshell` only for documented lower-level inspection or file transfer.

## Public contracts

### Status types

- `RecordingStatus`: `recording | interrupted | finalizing | ready | failed | audio_expired`
- `JobStatus`: `queued | leased | running | succeeded | failed | cancelled`
- `AnalysisKind`: `meeting_brief | custom`

### Realtime protocol

Client messages:

- `start`
- Binary PCM frames
- `stop`
- `resume`
- `ping`

Server events:

- `ready`
- `partial_caption`
- `committed_caption`
- `recording_status`
- `finalization_queued`
- Typed retryable and non-retryable errors

### HTTP surface

- Better Auth under `/api/auth/*`.
- Recording creation and status.
- Authenticated ranged audio delivery.
- Finalization retry.
- Analysis creation and status.
- Recording deletion.
- Liveness and readiness endpoints that separately report database, realtime ASR, WhisperX worker, queue, and NemoClaw status.
- Shared Zod schemas and stable error codes for all request and event payloads.

## Test plan

- Unit tests for ownership guards, invite expiry and use, state transitions, chunk sequencing, path sanitization, retention, analysis schemas, prompt and data separation, and GPU-lock behavior.
- Integration tests with PostgreSQL and fake ASR and agent adapters for leases, retries, crash recovery, idempotent Stop and finalize, reconnects, and long-transcript map/reduce.
- Browser tests for enrollment, login, microphone permission, live captions, disconnect and reconnect, Stop and finalization, brief generation, custom prompts, audio playback, and deletion.
- Security tests proving:
  - Unauthenticated WebSockets are rejected.
  - Cross-user resources return no data.
  - Raw filesystem paths cannot be supplied.
  - Public signup is unavailable.
- Dell-host acceptance:
  - Warm live captions have measured p95 end-to-end latency below two seconds.
  - A completed recording produces a final timestamped transcript.
  - Diarization works when configured and degrades cleanly when absent.
  - Structured and custom OpenClaw analyses complete through the real NemoClaw, OpenShell, and Ollama path.
  - Active live sessions prevent competing heavy GPU jobs.
  - The application works through its Tailscale HTTPS origin after reboot.

## Assumptions

- Ubuntu 22.04 or newer, a modern NVIDIA GPU with at least 16 GB VRAM, and NVIDIA Container Toolkit are available.
- The host is enrolled in a Tailscale network and users access it through the generated HTTPS hostname.
- File upload and true live speaker labeling are outside v1.
- Microphone streaming receives provisional text, while speaker labels appear only after WhisperX finalization.
- Audio expires after 30 days; transcript and analysis retention is indefinite until the owner deletes the recording.
- The initial deployment is one application instance and one GPU worker pool, so Redis and distributed cache infrastructure are intentionally omitted.

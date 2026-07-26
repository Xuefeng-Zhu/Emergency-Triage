# Operations runbook

## Install

Run all commands on Ubuntu 22.04 or newer as the dedicated
`emergency-trial` service user unless the command explicitly uses `sudo`.

```bash
cd /opt/emergency-trial
infra/scripts/preflight.sh
cp .env.example .env
chmod 600 .env
```

Replace every `change-me` value. Set `APP_ORIGIN` and `BETTER_AUTH_URL` to the
same Tailscale HTTPS URL. `HF_TOKEN` is optional; leave it empty unless the
pyannote model terms have been accepted for that token.

`AGENT_DATABASE_URL` uses the password-protected PostgreSQL Unix socket at
`/run/emergency-trial-postgres`. This lets the systemd worker lease jobs without
publishing PostgreSQL on a host TCP port; Caddy remains the only published
Compose port.

Install and validate the isolated OpenClaw sandbox:

```bash
infra/scripts/bootstrap-nemoclaw.sh
nemoclaw emergency-trial-agent status
```

The script selects Local Ollama and `qwen3.5:9b`, recreates the sandbox to bake
`infra/nemoclaw/agents.yaml`, and leaves the OpenShell gateway and dashboard on
their NemoClaw-managed loopback bindings.

On the first GPU startup, WhisperLiveKit and WhisperX need outbound HTTPS to
hydrate the `model-cache` volume. They are the only Compose services attached
to the un-published `model-egress` network. Subsequent starts reuse the cache.

Build the host worker, migrate, and start:

```bash
pnpm install --frozen-lockfile
pnpm --filter @emergency-trial/agent-worker build
sudo install -d -o emergency-trial -g emergency-trial -m 0700 /var/lib/emergency-trial/agent-jobs
sudo install -m 0644 infra/systemd/emergency-trial.service /etc/systemd/system/
sudo install -m 0644 infra/systemd/emergency-trial-agent-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now emergency-trial.service
sudo systemctl enable --now emergency-trial-agent-worker.service
infra/scripts/tailscale-serve.sh
```

Bootstrap the first administrator from a trusted shell:

```bash
pnpm bootstrap:admin -- --email admin@example.com --name "Administrator"
```

The command emits a strong initial password once. Do not capture it in shell
history or logs; store it in a password manager and sign in through the
Tailscale URL.

## Health and logs

```bash
curl --fail http://127.0.0.1:8080/api/health/live
curl --fail http://127.0.0.1:8080/api/health/ready
docker compose ps
nemoclaw emergency-trial-agent status
systemctl status emergency-trial-agent-worker
journalctl -u emergency-trial-agent-worker --since "15 minutes ago"
```

Readiness reports database, queue depth, realtime ASR, WhisperX heartbeat, and
NemoClaw worker heartbeat separately. Worker logs are one JSON object per line
and contain IDs and stable error codes, never transcript, prompt, token,
password, or cookie contents.

## Backup

Quiesce new work, then create encrypted/off-host copies of both database and
audio. The database is authoritative for audio checksums and paths, so keep the
two artifacts from the same maintenance window.

```bash
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > emergency-trial.dump
docker run --rm -v emergency-trial_audio-data:/source:ro -v "$PWD":/backup alpine tar -C /source -czf /backup/emergency-trial-audio.tgz .
```

Do not back up `.env`, NemoClaw proxy tokens, or authenticated dashboard URLs
into the same archive. Test restores periodically.

## Restore

On a stopped, clean stack:

```bash
docker compose up -d postgres
docker compose exec -T postgres pg_restore --clean --if-exists -U "$POSTGRES_USER" -d "$POSTGRES_DB" < emergency-trial.dump
docker run --rm -v emergency-trial_audio-data:/target -v "$PWD":/backup alpine sh -c 'cd /target && tar -xzf /backup/emergency-trial-audio.tgz'
docker compose up -d
```

Verify `/api/health/ready`, play an owner-authorized recording, and compare its
stored SHA-256 before reopening access.

## Upgrade and rollback

Build and test the candidate revision before replacing the checkout. Back up,
stop the two systemd units, update the repository, run the migration service,
rebuild the host worker, then start the units. Database migrations are
forward-only; rollback means restoring the matching database and audio backup
plus its application revision.

## Clean teardown

This destroys durable database, audio, and model volumes. Back up first.

```bash
sudo systemctl disable --now emergency-trial-agent-worker.service emergency-trial.service
tailscale serve reset
nemoclaw emergency-trial-agent status
nemoclaw uninstall
docker compose down --volumes --remove-orphans
sudo rm -f /etc/systemd/system/emergency-trial.service
sudo rm -f /etc/systemd/system/emergency-trial-agent-worker.service
sudo systemctl daemon-reload
```

Remove `/var/lib/emergency-trial/agent-jobs` only after confirming no worker is
running. NemoClaw owns the OpenShell lifecycle; use `openshell` only for the
documented low-level inspection or transfer procedures printed by NemoClaw.

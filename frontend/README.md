# Frontend — Design Mockup + Live Wiring

Visual mockup of the nurse tablet UI, built to iterate on layout and styling quickly
without waiting on Lane B/C. It has two data modes, toggled by the **"Test data"**
checkbox (top-right of the page):

- **Test data ON (default)** — fully static, hardcoded placeholder content, zero
  network calls. Safe to run standalone, no backend required.
- **Test data OFF** — creates a real session against `apps/api` and drives the
  transcript, suggestions, consult/approval flow, and visit note from live responses.

This is separate from [`apps/web`](../apps/web), which is the other, independently
API-wired frontend. Once the visual design here is settled, the plan is either to
restyle `apps/web` to match it, or fold this into `apps/web` directly — not to
maintain two frontends long-term.

## Run just the mockup (Test data mode only)

```bash
npm install
npm run dev
```

Opens on **http://localhost:5174**. `apps/web`'s own dev server uses port 5173, so
both can run at the same time without clashing.

## Run with live wiring (Test data OFF)

Also start `apps/api` locally — no GPU or model downloads required, it runs in stub
mode:

```bash
# from the repo root, first time only
python -m venv .venv
.venv/bin/pip install -e "apps/api[dev]"        # macOS/Linux
# .venv\Scripts\pip install -e "apps/api[dev]"  # Windows

# start the API (stub reasoning + echo STT — type text instead of speaking)
TRIAGE_MODE=stub TRIAGE_STT_MODE=echo TRIAGE_WEB_ORIGIN=http://localhost:5174 \
  .venv/bin/uvicorn app.main:app --app-dir apps/api --host 127.0.0.1 --port 8787
```

Then `npm run dev` in this folder as above, load `http://localhost:5174`, and
uncheck **Test data**. `vite.config.ts` proxies `/api/*` to `127.0.0.1:8787`, so no
CORS setup is needed — the two just need to be running at the same time.

See [`docs/frontend-contract.md`](../docs/frontend-contract.md) for the wire shapes
this mockup is designed against.

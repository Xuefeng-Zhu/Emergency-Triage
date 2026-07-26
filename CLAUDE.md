# Emergency Triage — Hackathon Build

Three-lane, one-day build. Read these in order before touching code:

1. [`docs/er-triage-agent-scope.md`](docs/er-triage-agent-scope.md) — frozen architecture,
   lane split, and the endpoint seam (§6). This is the source of truth for system shape.
2. [`docs/nextjs-voice-agent-boilerplate-plan.md`](docs/nextjs-voice-agent-boilerplate-plan.md) —
   reference conventions for typed realtime events and shared schemas (not the literal stack
   for this project — no Postgres/Next.js/Tailscale here, just the message-shape style).
3. [`docs/frontend-contract.md`](docs/frontend-contract.md) — **the wire contract**. Every
   payload/message shape between Lane A (client) and Lane B (inference)/Lane C (governance):
   live transcript & suggestion pushes, test-order approval payloads, and the final visit
   note structure. Treat this file as frozen the same way §6 of the scope doc is frozen —
   change it in a commit both lanes see, not silently in one lane's code.

No other CLAUDE.md files exist yet. If a lane grows enough internal detail to need its own
(e.g. `apps/client/CLAUDE.md`), link it from here rather than duplicating this content.

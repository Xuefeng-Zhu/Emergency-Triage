# Frontend — Design Mockup (Static)

This is a **standalone visual mockup** of the nurse tablet UI, built to iterate on layout
and styling quickly without waiting on Lane B/C. It does not call any API and has no
real data — everything on screen is hardcoded placeholder content.

This is separate from [`apps/web`](../apps/web), which is the real, API-wired frontend.
Once the visual design here is settled, the plan is either to restyle `apps/web` to match
it, or fold this into `apps/web` directly — not to maintain two frontends long-term.

Run it with:

```bash
npm install
npm run dev
```

See [`docs/frontend-contract.md`](../docs/frontend-contract.md) for the wire shapes this
mockup is designed against.

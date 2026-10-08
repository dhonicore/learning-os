# Learning OS — frontend (Next.js)

The product frontend: Next.js App Router, React 19, TypeScript, Tailwind CSS v4 and
daisyUI. Built alongside the Streamlit app, which stays the working fallback until this
frontend passes acceptance testing (see `../MIGRATION_PLAN.md`).

## Status

Phase 2 — foundation only. Present: app shell, navigation, design tokens,
Light/Dark/System themes, page skeletons and an API health probe.
Not built yet: the SQL editor (Phase 3), the tutor turn (Phase 4), Progress data (Phase 5).

## Run it

The frontend reads question metadata and health from the FastAPI backend, so start it
first from the repository root:

```bash
.venv/bin/python -m uvicorn app_main:app --port 8000
```

Then, in this directory:

```bash
npm install
npm run dev          # http://localhost:3000, proxies /api/* to the backend
```

Production build:

```bash
npm run build && npm start
```

Set `NEXT_PUBLIC_API_ORIGIN` to point the `/api/*` proxy somewhere other than
`http://127.0.0.1:8000`.

## Checks

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run test        # vitest (tokens, theme engine, health probe)
npm run build       # production build
npm run check       # all four in order
```

`tests/tokens.test.ts` reads `app/globals.css` and fails if `lib/tokens.ts` drifts
from the CSS source of truth, so components that need raw colours stay in sync.

## Structure

```
app/                     routes: / (Learn), /progress, /settings
components/shell/        app shell: drawer on small screens, sidebar on large
components/system/       theme control, API health probe (E1)
components/learn/        Learn workspace skeleton
components/settings/     appearance, diagnostics, about
components/ui/           design-system primitives (panel, eyebrow, section head)
lib/                     tokens, theme engine, API client, class helper
types/api.ts             typed mirrors of the Phase 1 FastAPI contracts
tests/                   vitest suites
```

## Conventions

- Components use semantic tokens (`bg-surface`, `text-muted`, `border-line`), never raw
  palette values, so no component needs `dark:` variants.
- No raw palette values in components: use semantic tokens (`bg-surface`, `text-muted`,
  `border-line`). The palette is defined in `app/globals.css` and mirrored in
  `lib/tokens.ts`.
- 1px borders only where they aid orientation; no decorative gradients or drop shadows.
- Anything belonging to a later phase is labelled as pending rather than faked.

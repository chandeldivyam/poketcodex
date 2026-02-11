# poketcodex

Phase-0 monorepo scaffold for PocketCodex.

## Prerequisites

- Node.js 20+
- pnpm 10+

## Workspace Layout

- `apps/backend`: Fastify backend service (health endpoint + tests)
- `apps/web`: Vite web app shell
- `packages/shared`: Shared TypeScript utilities/types
- `infra`: Infrastructure notes and scripts
- `docs`: Project docs

## Commands

- `pnpm install`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm dev` (loads `.env` and runs backend+frontend dev servers together)
- `pnpm dev:backend` (backend only, with `.env`)
- `pnpm dev:web` (frontend only, with `.env`)
- `pnpm longrun:up` (builds backend+web and runs both as background services)
- `pnpm longrun:status`
- `pnpm longrun:logs`
- `pnpm longrun:down`
- `pnpm audit --audit-level=high`

## Environment

The backend validates configuration at startup and exits on invalid values.

1. Copy `.env.example` to `.env`.
2. Set strong values for `AUTH_PASSWORD`, `SESSION_SECRET`, and `CSRF_SECRET`.
3. Set `ALLOWED_WORKSPACE_ROOTS` to absolute paths only.
4. Keep `COOKIE_SECURE=false` for local HTTP dev, use `true` behind HTTPS.
5. Optional frontend bind settings:
   - `WEB_DEV_HOST`, `WEB_DEV_PORT` for `pnpm dev`
   - `WEB_PREVIEW_HOST`, `WEB_PREVIEW_PORT` for long-running preview mode

## Running

### Local development (foreground)

```bash
pnpm dev
```

This starts:
- backend on `HOST:PORT` from `.env` (defaults `127.0.0.1:8787`)
- web Vite dev server on `WEB_DEV_HOST:WEB_DEV_PORT` (defaults `127.0.0.1:5173`)

### Long-running mode (mobile/Tailscale)

```bash
pnpm longrun:up
```

This will:
1. Build backend and web
2. Start backend (`pnpm --filter @poketcodex/backend start`) in background
3. Start web preview (`pnpm --filter @poketcodex/web start`) in background
4. Write logs and pid files under `.runtime/`

Useful commands:

```bash
pnpm longrun:status
pnpm longrun:logs
pnpm longrun:down
```

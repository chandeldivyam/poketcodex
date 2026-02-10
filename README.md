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
- `pnpm dev`

## Environment

The backend validates configuration at startup and exits on invalid values.

1. Copy `.env.example` to `.env`.
2. Set strong values for `SESSION_SECRET` and `CSRF_SECRET` (32+ chars).
3. Set `ALLOWED_WORKSPACE_ROOTS` to absolute paths only.

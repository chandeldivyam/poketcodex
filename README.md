# poketcodex

Phase-0 monorepo scaffold for PocketCodex.

## Prerequisites

- Node.js 22+
- pnpm 10+
- Codex CLI available on `PATH` (`codex`)
- Tailscale CLI available on `PATH` (`tailscale`)

## Workspace Layout

- `apps/backend`: Fastify backend service (health endpoint + tests)
- `apps/web`: Vite web app shell
- `packages/shared`: Shared TypeScript utilities/types for backend and web apps
- `infra`: Infrastructure notes and scripts
- `docs`: Project docs

## Commands

- `pnpm install`
- `pnpm poketcodex -- help` (local CLI wrapper)
- `pnpm poketcodex -- --version`
- `pnpm poketcodex -- init --yes`
- `pnpm poketcodex -- up`
- `pnpm poketcodex -- down`
- `pnpm poketcodex -- status`
- `pnpm poketcodex -- logs`
- `pnpm poketcodex -- doctor`
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

## One-Command Installer (`curl | sh`)

Installer assets are published via GitHub Releases.

```bash
curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error \
  https://github.com/chandeldivyam/poketcodex/releases/latest/download/install.sh | bash
```

Current implementation uses a source payload, so `node` and `pnpm` must already be installed.

Helpful options:

```bash
bash ./scripts/install.sh --help
bash ./scripts/install.sh --version=v0.1.0
bash ./scripts/install.sh --skip-start --yes
```

Remote access from another device (recommended):

```bash
~/.local/bin/poketcodex share tailscale
```

Then open the `https://<device>.ts.net` URL shown by the command.

Important:
- Do not use `https://<device>.ts.net:4173` directly.
- Port `4173` is HTTP preview; Safari/iCloud Private Relay may block or warn on that HTTPS form.

Build local release assets:

```bash
pnpm installer:build-assets
pnpm installer:build-assets -- --ref=WORKTREE
```

## Automated Version Releases

This repo now uses Release Please for release management:

- Merging feature PRs into `main` does **not** immediately publish a new version.
- A Release PR is automatically created/updated from `main`.
- Merging the Release PR creates a semantic version tag + GitHub Release.
- `release-installer-assets` then publishes installer assets for that release tag.

See `docs/release-process.md` for full operational flow.

## Environment

The backend validates configuration at startup and exits on invalid values.

1. Copy `.env.example` to `.env`.
2. Set strong values for `AUTH_PASSWORD`, `SESSION_SECRET`, and `CSRF_SECRET`.
3. Set `ALLOWED_WORKSPACE_ROOTS` to absolute paths only.
4. Keep `COOKIE_SECURE=false` for local HTTP dev, use `true` behind HTTPS.
5. Optional frontend bind settings:
   - `WEB_DEV_HOST`, `WEB_DEV_PORT` for `pnpm dev`
   - `WEB_PREVIEW_HOST`, `WEB_PREVIEW_PORT` for long-running preview mode
   - `WEB_ALLOWED_HOSTS` for Vite host allowlist (include your Tailscale hostname if needed)

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

## Runtime Policy

The backend currently enforces YOLO-style Codex runtime defaults on all thread/turn starts:

- `approvalPolicy: "never"`
- `sandbox: "danger-full-access"` (thread-level default)
- `sandboxPolicy: { "type": "dangerFullAccess" }` (turn-level override)

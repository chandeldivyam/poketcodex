# PocketCodex One-Command Install and CLI Strategy

## 1. Objective

Make PocketCodex easy to install and run with a single command, assuming users already have:

- Codex CLI installed
- Tailscale installed

No code changes are proposed in this document. This is a product and implementation strategy for the next iteration.

## 2. Current state (repo audit)

Today, onboarding is developer-oriented, not end-user-oriented:

- Users manually install dependencies (`pnpm install`) and run scripts from `README.md`.
- `.env` is mandatory and must be manually created and edited (`README.md`, `scripts/run-with-env.sh`).
- Startup fails fast without valid secrets and workspace roots (`apps/backend/src/config.ts`).
- Long-running mode exists and is good foundation (`scripts/longrun-up.sh`, `scripts/longrun-status.sh`, `scripts/longrun-logs.sh`, `scripts/longrun-down.sh`).
- Runtime already depends on local Codex CLI (`apps/backend/src/codex/workspace-app-server-pool.ts` spawns `codex app-server`).

### Main friction points

1. Manual `.env` creation and secret generation.
2. No preflight checks for Codex/Tailscale availability.
3. No single command that installs + configures + starts.
4. No standardized way to expose the service over Tailnet for remote/mobile use.

## 3. What top products do (relevant patterns)

### Pattern A: `init` generates config and env scaffolding

- Prisma uses `npx prisma init` to create starter files including `.env`.
- Supabase uses `supabase init` to create local project config.

Why it matters for PocketCodex: users should not handcraft `.env` for first run.

### Pattern B: lifecycle commands are explicit and predictable

- Supabase has clear `start`, `status`, `stop` lifecycle commands.
- Ollama documents install + serve + stop flows as first-class operations.

Why it matters: your existing `longrun:*` scripts map naturally to this model.

### Pattern C: multi-channel distribution, single UX

- GitHub CLI distributes via brew/apt/yum/winget and keeps one consistent command UX.
- Vercel CLI supports npm/pnpm/yarn/bun install channels and one CLI surface.

Why it matters: PocketCodex should pick one primary channel first, then expand channels without changing command semantics.

### Pattern D: one-shot execution via `npx` is common

- npm `npx` runs package binaries and prompts before installing missing packages (can be suppressed with `--yes`).

Why it matters: `npx` is the fastest path to "single command" for users who already have Node tooling.

### Pattern E: secure local-first + explicit sharing

- Tailscale Serve can expose local services on Tailnet HTTPS.
- Tailscale Funnel is separate/explicit when public internet exposure is desired.

Why it matters: keep PocketCodex bound to localhost by default, and make remote access an explicit command.

## 4. Recommended PocketCodex product UX

### 4.1 Command surface

Ship a dedicated CLI package (example name: `@poketcodex/cli`) with:

- `poketcodex init`
- `poketcodex up`
- `poketcodex down`
- `poketcodex status`
- `poketcodex logs`
- `poketcodex doctor`
- `poketcodex --version`
- `poketcodex share tailscale`
- `poketcodex unshare tailscale`

This directly mirrors what users already expect from other local-dev CLIs.

### 4.2 The one-command path

Recommended first-run command:

```bash
curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error \
  https://github.com/<org>/<repo>/releases/latest/download/install.sh | bash
```

Expected behavior:

1. Run preflight checks (`codex`, `tailscale`, writable data dir, ports, and any payload-specific runtime dependency).
2. If first run, execute `init` flow automatically.
3. Generate `.env` smart defaults.
4. Start backend + web in long-running mode.
5. Print local URL, Tailnet URL (if sharing enabled), and admin password handling guidance.

### 4.3 Smart `.env` generation spec

Generate `.env` from template plus detected values:

- `SESSION_SECRET`: cryptographically random (>= 32 chars)
- `CSRF_SECRET`: cryptographically random (>= 32 chars)
- `AUTH_PASSWORD`: prompt user once (hidden input) or generate random if `--non-interactive`
- `ALLOWED_WORKSPACE_ROOTS`: default to user-provided path(s), always absolute
- `HOST=127.0.0.1`, `WEB_DEV_HOST=127.0.0.1`, `WEB_PREVIEW_HOST=127.0.0.1` by default
- `WEB_ALLOWED_HOSTS`: include `localhost,127.0.0.1,.ts.net` and detected Tailnet hostname when available
- `COOKIE_SECURE`: default `false` for local HTTP; settable by mode flag (for HTTPS-only access flows)

Rules:

- Never overwrite existing `.env` without explicit `--force`.
- Write file permissions as user-only where possible.
- Redact secrets from logs.
- Print exact path to generated `.env`.

### 4.4 Tailscale integration model

Recommended default: do not bind backend/web to `0.0.0.0`.

Instead:

1. Keep services local (`127.0.0.1`).
2. Use `tailscale serve` in background mode to publish web preview port to Tailnet.
3. Keep public exposure (`tailscale funnel`) as opt-in, separate command, explicit warning.

This preserves local-default security while enabling remote/mobile access quickly.

## 5. Distribution options and tradeoffs

### Option A: npm package + `npx`

- UX: `npx --yes @poketcodex/cli@latest up`
- Pros: fastest to ship if you already rely on Node toolchains.
- Cons: less aligned with your preferred `curl | sh` onboarding path.

### Option B (selected): install script wrapper (`curl | sh`)

- UX: `curl ... | sh`
- Pros: shortest onboarding command, easy to promote in README, common open-source pattern.
- Cons: requires stronger release hygiene (checksums, pinned versions, CI hardening, smoke tests).

### Option C: Homebrew + winget

- UX: `brew install ...` / `winget install ...`
- Pros: polished native package manager experience.
- Cons: extra maintenance and release automation overhead.

Recommendation update: implement Option B first, keep Option A as fallback, add Option C after installer stabilizes.

### 5.1 Option B delivery choices on GitHub

| Choice | Installer URL shape | Immutability | Operational complexity | Notes |
| --- | --- | --- | --- | --- |
| B1. Branch raw file | `raw.githubusercontent.com/<org>/<repo>/main/install.sh` | Low | Low | Fastest but mutable; avoid as primary production URL. |
| B2. Release-hosted script | `github.com/<org>/<repo>/releases/latest/download/install.sh` | Medium | Medium | Good default for "latest". |
| B3. Pinned release script | `github.com/<org>/<repo>/releases/download/vX.Y.Z/install.sh` | High | Medium | Best for reproducibility and rollback. |

Recommended: support both B2 and B3. Use B2 in marketing docs, B3 in incident response/runbooks and CI.

### 5.2 Payload strategies behind the installer

| Payload strategy | Satisfies "Codex + Tailscale only" | Time to ship | Notes |
| --- | --- | --- | --- |
| P1. Source install (`git archive` + `pnpm install`) | No (needs Node+pnpm) | Fast | Lowest engineering lift; good internal alpha. |
| P2. Built app bundle (`dist` + production deps) | No (needs Node runtime) | Medium | Faster startup than P1; still runtime dependency on Node. |
| P3. Portable runtime bundle (includes Node runtime) | Yes | Higher | Best fit for your stated constraint; recommended target. |

Recommended rollout: P1 for rapid validation, then move to P3 for public "Codex + Tailscale only" promise.

### 5.3 User-facing install commands

Quick install (latest):

```bash
curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error \
  https://github.com/<org>/<repo>/releases/latest/download/install.sh | bash
```

Pinned install (reproducible):

```bash
curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error \
  https://github.com/<org>/<repo>/releases/download/v0.3.0/install.sh | bash -s -- --version=v0.3.0
```

Review-first install (safer, still simple):

```bash
curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error \
  -o /tmp/poketcodex-install.sh \
  https://github.com/<org>/<repo>/releases/latest/download/install.sh
less /tmp/poketcodex-install.sh
bash /tmp/poketcodex-install.sh
```

## 6. Proposed rollout plan

### Phase 0: finalize installer contract (1-2 days)

1. Freeze install root conventions:
   - `~/.local/share/poketcodex` for payloads/runtime state
   - `~/.local/bin/poketcodex` symlinked launcher
2. Freeze installer flags:
   - `--version=<tag|latest>`
   - `--install-root=<path>`
   - `--bin-dir=<path>`
   - `--skip-start`
   - `--yes`
3. Freeze preflight expectations:
   - `codex` present
   - `tailscale` present and logged in
   - required ports free
4. Freeze `.env` generation behavior (non-destructive, `--force` for overwrite only).

### Phase 1: implement GitHub release payload + checksums (2-4 days)

1. Add packaging script for chosen payload strategy (P1 first or P3 directly).
2. Produce deterministic asset names per OS/arch.
3. Generate `checksums.txt` for all assets.
4. Attach assets to GitHub Releases.

### Phase 2: implement bootstrap installer (2-3 days)

1. Host `install.sh` as a release asset.
2. Script downloads payload + checksum file from same release.
3. Script verifies checksum before extraction.
4. Script installs/updates symlinked launcher.
5. Script runs `poketcodex init` then `poketcodex up` (unless `--skip-start`).

### Phase 3: GitHub Actions hardening (2-3 days)

1. Trigger on `release.published`.
2. Set least-privilege workflow `permissions`.
3. Upload assets with checksum file.
4. Add artifact attestation generation for release assets.
5. Add smoke-test workflow that executes the one-liner on Linux + macOS.

### Phase 4: Tailnet UX and supportability (2-3 days)

1. Add `share tailscale`/`unshare tailscale` command behavior.
2. Print local URL + Tailnet URL after `up`.
3. Add `doctor` report for missing login state / stale processes / permission issues.

### 6.1 Installer script skeleton (snippet)

Assumption for this snippet: payload strategy P3 with per-platform assets named
`poketcodex-<os>-<arch>.tar.gz`. If you start with P1, adjust asset naming and extraction logic.

```bash
#!/usr/bin/env bash
set -euo pipefail

OWNER="<org>"
REPO="<repo>"
VERSION="latest"
INSTALL_ROOT="${POCKETCODEX_HOME:-$HOME/.local/share/poketcodex}"
BIN_DIR="${POCKETCODEX_BIN_DIR:-$HOME/.local/bin}"
SKIP_START=0

for arg in "$@"; do
  case "$arg" in
    --version=*) VERSION="${arg#*=}" ;;
    --install-root=*) INSTALL_ROOT="${arg#*=}" ;;
    --bin-dir=*) BIN_DIR="${arg#*=}" ;;
    --skip-start) SKIP_START=1 ;;
    --yes) : ;; # reserved for non-interactive prompts
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "missing required command: $1" >&2; exit 1; }
}

curl_get() {
  curl --proto '=https' --tlsv1.2 --fail --location --retry 5 --retry-connrefused \
    --silent --show-error "$@"
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

require_cmd curl
require_cmd tar
require_cmd codex
require_cmd tailscale

if ! tailscale status >/dev/null 2>&1; then
  echo "tailscale is installed but not connected; run: tailscale up" >&2
  exit 1
fi

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo "unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

ASSET="poketcodex-${OS}-${ARCH}.tar.gz"
if [[ "$VERSION" == "latest" ]]; then
  BASE="https://github.com/${OWNER}/${REPO}/releases/latest/download"
else
  BASE="https://github.com/${OWNER}/${REPO}/releases/download/${VERSION}"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl_get "${BASE}/${ASSET}" -o "${TMP}/${ASSET}"
curl_get "${BASE}/checksums.txt" -o "${TMP}/checksums.txt"

EXPECTED="$(awk -v name="$ASSET" '$2==name {print $1}' "${TMP}/checksums.txt")"
ACTUAL="$(sha256_file "${TMP}/${ASSET}")"
if [[ -z "${EXPECTED}" || "${EXPECTED}" != "${ACTUAL}" ]]; then
  echo "checksum verification failed for ${ASSET}" >&2
  exit 1
fi

mkdir -p "${INSTALL_ROOT}/releases" "${BIN_DIR}"
DEST="${INSTALL_ROOT}/releases/${VERSION}"
rm -rf "${DEST}"
mkdir -p "${DEST}"
tar -xzf "${TMP}/${ASSET}" -C "${DEST}"
ln -sfn "${DEST}/bin/poketcodex" "${BIN_DIR}/poketcodex"

"${BIN_DIR}/poketcodex" init --non-interactive
if [[ "${SKIP_START}" -eq 0 ]]; then
  "${BIN_DIR}/poketcodex" up
fi
```

### 6.2 `.env` generation snippet for `init` (matches current backend requirements)

```bash
#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:-$HOME/.local/share/poketcodex/.env}"
WORKSPACE_ROOT="${2:-$PWD}"

abs_path() {
  cd "$1" && pwd
}

gen_secret_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
  fi
}

gen_password() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 24 | tr -d '\n' | tr '/+' 'ab'
  else
    python3 - <<'PY'
import secrets, string
alphabet = string.ascii_letters + string.digits
print(''.join(secrets.choice(alphabet) for _ in range(24)))
PY
  fi
}

mkdir -p "$(dirname "$ENV_FILE")"
if [[ -f "$ENV_FILE" ]]; then
  echo "env file exists: $ENV_FILE (use --force to overwrite)" >&2
  exit 1
fi

cat >"$ENV_FILE" <<EOF
NODE_ENV=development
HOST=127.0.0.1
PORT=8787
SQLITE_DATABASE_PATH=./data/poketcodex.db
LOG_LEVEL=info
AUTH_MODE=single_user
AUTH_PASSWORD=$(gen_password)
SESSION_SECRET=$(gen_secret_hex)
CSRF_SECRET=$(gen_secret_hex)
COOKIE_SECURE=false
SESSION_TTL_MINUTES=1440
ALLOWED_WORKSPACE_ROOTS=$(abs_path "$WORKSPACE_ROOT")
WEB_DEV_HOST=127.0.0.1
WEB_DEV_PORT=5173
WEB_PREVIEW_HOST=127.0.0.1
WEB_PREVIEW_PORT=4173
WEB_ALLOWED_HOSTS=localhost,127.0.0.1,.ts.net
EOF

chmod 600 "$ENV_FILE"
echo "created: $ENV_FILE"
```

### 6.3 GitHub Actions release workflow snippet

```yaml
name: release-installer-assets

on:
  release:
    types: [published]

permissions:
  contents: write
  id-token: write
  attestations: write

jobs:
  package:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Build release assets
        run: |
          set -euo pipefail
          TAG="${GITHUB_REF_NAME}"
          mkdir -p dist

          # Placeholder packaging commands:
          # 1) build portable/source payload into dist/poketcodex-<os>-<arch>.tar.gz
          # 2) copy installer script
          cp scripts/install.sh dist/install.sh

          # Example source payload; replace with real per-platform runtime payloads.
          tar -czf "dist/poketcodex-source-${TAG}.tar.gz" \
            --exclude=.git --exclude=node_modules --exclude=.runtime .
          cp "dist/poketcodex-source-${TAG}.tar.gz" "dist/poketcodex-linux-x64.tar.gz"
          cp "dist/poketcodex-source-${TAG}.tar.gz" "dist/poketcodex-darwin-arm64.tar.gz"

          (cd dist && sha256sum install.sh poketcodex-*.tar.gz > checksums.txt)

      - name: Upload release assets
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          gh release upload "${GITHUB_REF_NAME}" \
            dist/install.sh \
            dist/checksums.txt \
            dist/poketcodex-linux-x64.tar.gz \
            dist/poketcodex-darwin-arm64.tar.gz \
            --clobber

      - name: Generate artifact attestation
        uses: actions/attest-build-provenance@v3
        with:
          subject-path: "dist/*"
```

### 6.4 Installer smoke test workflow snippet

```yaml
name: installer-smoke

on:
  workflow_dispatch:
  schedule:
    - cron: "0 4 * * *"

jobs:
  smoke:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - name: Run installer (latest)
        run: |
          set -euo pipefail
          curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error \
            https://github.com/<org>/<repo>/releases/latest/download/install.sh | bash -s -- --skip-start --yes

      - name: Verify launcher
        run: |
          set -euo pipefail
          ~/.local/bin/poketcodex --help
```

## 7. Quality bar for "easy install"

Treat these as release gates:

1. Fresh machine with Codex+Tailscale can run one install command successfully.
2. Installer supports both `latest` and pinned version (`--version=vX.Y.Z`).
3. Installer fails closed on checksum mismatch.
4. No manual `.env` editing required for basic first run.
5. Clear errors for missing Codex login / Tailscale login / bad workspace path.
6. `status` and `logs` must make failures diagnosable without reading source.
7. Re-running installer is idempotent and does not destroy existing `.env` unless forced.
8. Uninstall path is documented and reliable.

## 8. Key design decisions to make now

1. Which payload strategy is Phase-1 target:
   - P1 source payload (fastest) or
   - P3 portable runtime payload (meets "Codex + Tailscale only")
2. Versioning and channel model:
   - `latest` only or `stable` + pinned tags
3. Credential policy:
   - prompt for `AUTH_PASSWORD` vs auto-generate
   - where/how to reveal or rotate after first run
4. Installer trust posture:
   - single-command path only, or document review-first flow as recommended
5. Runtime home directory convention:
   - `~/.local/share/poketcodex/{releases,data,logs}`
6. Tailnet behavior default:
   - local-only start
   - explicit share command for remote access

## 9. External references

- Supabase CLI local lifecycle:
  https://supabase.com/docs/reference/cli/start
- Supabase CLI init/get started:
  https://supabase.com/docs/guides/local-development/cli/getting-started
- Prisma init (`.env` scaffolding pattern):
  https://www.prisma.io/docs/getting-started/setup-prisma/add-to-existing-project/relational-databases/introspection-node-cockroachdb
- GitHub CLI install channels:
  https://github.com/cli/cli#installation
- GitHub release assets and latest download URL pattern:
  https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases
- GitHub REST API for latest release:
  https://docs.github.com/en/rest/releases/releases#get-the-latest-release
- GitHub REST API for release assets:
  https://docs.github.com/en/rest/releases/assets
- GitHub Actions workflow syntax (`release` event):
  https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions
- GitHub Actions token permissions (least privilege):
  https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication
- GitHub attestation verification:
  https://docs.github.com/en/actions/security-guides/using-artifact-attestations-to-establish-provenance-for-builds
- GitHub attest action (`actions/attest-build-provenance`):
  https://github.com/actions/attest-build-provenance
- GitHub permanent links guidance (immutability context):
  https://docs.github.com/en/repositories/working-with-files/using-files/getting-permanent-links-to-files
- curl option reference (`--fail`, `--location`, retry behavior):
  https://curl.se/docs/manpage.html
- Tailscale Serve CLI:
  https://tailscale.com/kb/1242/tailscale-serve
- Tailscale Serve and Funnel behavior:
  https://tailscale.com/kb/1312/serve

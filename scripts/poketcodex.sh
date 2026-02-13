#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_ENV_FILE="${ROOT_DIR}/.env"

usage() {
  cat <<'USAGE'
Usage:
  poketcodex init [--env-file=<path>] [--workspace-root=<path>] [--auth-password=<value>] [--force] [--yes|--non-interactive]
  poketcodex up [--skip-install] [--share-tailscale]
  poketcodex down
  poketcodex status
  poketcodex logs
  poketcodex doctor
  poketcodex share tailscale
  poketcodex unshare tailscale

Environment overrides:
  POCKETCODEX_ENV_FILE   Path to .env file (default: <repo>/.env)
USAGE
}

log() {
  printf '[poketcodex] %s\n' "$*"
}

warn() {
  printf '[poketcodex] %s\n' "$*" >&2
}

die() {
  warn "$*"
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

node_major_version() {
  node -e "process.stdout.write(String(Number(process.versions.node.split('.')[0])))"
}

require_min_node_version() {
  local min_major="$1"
  local current_major
  current_major="$(node_major_version)"

  if [[ "${current_major}" -lt "${min_major}" ]]; then
    die "Node.js ${min_major}+ is required (found $(node -v))"
  fi
}

resolve_tailscale_cmd() {
  local candidate

  if candidate="$(command -v tailscale 2>/dev/null)"; then
    printf '%s\n' "${candidate}"
    return 0
  fi

  # macOS app bundle fallback (GUI app installed, CLI not on PATH).
  for candidate in \
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale" \
    "/Applications/Tailscale.app/Contents/MacOS/tailscale"; do
    if [[ -x "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done

  return 1
}

tailscale_dns_name() {
  local tailscale_cmd="$1"

  command_exists node || return 1

  local status_json
  status_json="$("${tailscale_cmd}" status --json 2>/dev/null || true)"
  [[ -n "${status_json}" ]] || return 1

  printf '%s' "${status_json}" | node -e '
let input = "";
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  try {
    const parsed = JSON.parse(input);
    const dns = String(parsed?.Self?.DNSName ?? "").replace(/\.$/, "");
    if (!dns) {
      process.exit(1);
    }
    process.stdout.write(dns);
  } catch {
    process.exit(1);
  }
});
' || return 1
}

resolve_env_file() {
  local env_file="${POCKETCODEX_ENV_FILE:-${DEFAULT_ENV_FILE}}"
  if [[ "${env_file}" != /* ]]; then
    env_file="${ROOT_DIR}/${env_file}"
  fi
  printf '%s\n' "${env_file}"
}

resolve_abs_path() {
  local path_input="$1"

  if [[ ! -d "${path_input}" ]]; then
    die "Workspace root does not exist: ${path_input}"
  fi

  if command_exists realpath; then
    realpath "${path_input}"
    return 0
  fi

  (
    cd "${path_input}"
    pwd
  )
}

generate_secret_hex() {
  if command_exists openssl; then
    openssl rand -hex 32
    return 0
  fi

  if command_exists node; then
    node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
    return 0
  fi

  die "Unable to generate cryptographic secret (missing openssl and node)"
}

generate_password() {
  if command_exists openssl; then
    openssl rand -base64 24 | tr -d '\n' | tr '/+' 'ab'
    return 0
  fi

  if command_exists node; then
    node -e "const c=require('node:crypto');const a='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';let o='';for(let i=0;i<24;i++)o+=a[c.randomInt(a.length)];process.stdout.write(o);"
    return 0
  fi

  die "Unable to generate password (missing openssl and node)"
}

load_env_file() {
  local env_file="$1"
  if [[ ! -f "${env_file}" ]]; then
    die "Missing env file: ${env_file}. Run: poketcodex init"
  fi

  set -a
  # shellcheck disable=SC1090
  source "${env_file}"
  set +a
}

ensure_repo_prerequisites() {
  command_exists node || die "node is required"
  require_min_node_version 22
  command_exists pnpm || die "pnpm is required"
  command_exists bash || die "bash is required"
}

run_in_repo() {
  (
    cd "${ROOT_DIR}"
    "$@"
  )
}

run_init() {
  local force=0
  local non_interactive=0
  local workspace_root="${HOME}"
  local auth_password=""
  local env_file

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --force)
        force=1
        ;;
      --yes|--non-interactive)
        non_interactive=1
        ;;
      --workspace-root=*)
        workspace_root="${1#*=}"
        ;;
      --auth-password=*)
        auth_password="${1#*=}"
        ;;
      --env-file=*)
        env_file="${1#*=}"
        export POCKETCODEX_ENV_FILE="${env_file}"
        ;;
      *)
        die "Unknown init argument: $1"
        ;;
    esac
    shift
  done

  env_file="$(resolve_env_file)"
  mkdir -p "$(dirname "${env_file}")"

  if [[ -f "${env_file}" && "${force}" -eq 0 ]]; then
    log "env already exists at ${env_file}; skipping (use --force to overwrite)"
    return 0
  fi

  local workspace_root_abs
  workspace_root_abs="$(resolve_abs_path "${workspace_root}")"

  if [[ -z "${auth_password}" && "${non_interactive}" -eq 0 && -t 0 && -t 1 ]]; then
    printf 'Enter AUTH_PASSWORD (leave blank to auto-generate): '
    IFS= read -r -s auth_password
    printf '\n'
  fi

  local generated_password=0
  if [[ -z "${auth_password}" ]]; then
    auth_password="$(generate_password)"
    generated_password=1
  fi

  if [[ "${#auth_password}" -lt 12 ]]; then
    die "AUTH_PASSWORD must be at least 12 characters"
  fi

  local session_secret csrf_secret
  session_secret="$(generate_secret_hex)"
  csrf_secret="$(generate_secret_hex)"

  cat >"${env_file}" <<ENVVARS
NODE_ENV=development
HOST=127.0.0.1
PORT=8787
SQLITE_DATABASE_PATH=./data/poketcodex.db
LOG_LEVEL=info
AUTH_MODE=single_user
AUTH_PASSWORD=${auth_password}
SESSION_SECRET=${session_secret}
CSRF_SECRET=${csrf_secret}
COOKIE_SECURE=false
SESSION_TTL_MINUTES=1440
ALLOWED_WORKSPACE_ROOTS=${workspace_root_abs}
WEB_DEV_HOST=127.0.0.1
WEB_DEV_PORT=5173
WEB_PREVIEW_HOST=127.0.0.1
WEB_PREVIEW_PORT=4173
WEB_ALLOWED_HOSTS=localhost,127.0.0.1,.ts.net
ENVVARS

  chmod 600 "${env_file}"
  log "created env file: ${env_file}"

  if [[ "${generated_password}" -eq 1 ]]; then
    log "generated AUTH_PASSWORD: ${auth_password}"
  else
    log "AUTH_PASSWORD set from provided input"
  fi
}

run_up() {
  local skip_install=0
  local share_tailscale=0

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --skip-install)
        skip_install=1
        ;;
      --share-tailscale)
        share_tailscale=1
        ;;
      *)
        die "Unknown up argument: $1"
        ;;
    esac
    shift
  done

  local env_file
  env_file="$(resolve_env_file)"
  [[ -f "${env_file}" ]] || die "Missing env file: ${env_file}. Run: poketcodex init"

  ensure_repo_prerequisites

  if [[ "${skip_install}" -eq 0 ]]; then
    run_in_repo bash ./scripts/run-with-env.sh pnpm install --frozen-lockfile
  fi

  run_in_repo bash ./scripts/longrun-up.sh

  load_env_file "${env_file}"
  local preview_port
  preview_port="${WEB_PREVIEW_PORT:-4173}"
  log "local preview URL: http://127.0.0.1:${preview_port}"

  local tailscale_cmd dns_name
  if tailscale_cmd="$(resolve_tailscale_cmd)" && "${tailscale_cmd}" status >/dev/null 2>&1; then
    if dns_name="$(tailscale_dns_name "${tailscale_cmd}")"; then
      log "tailscale direct URL (HTTP): http://${dns_name}:${preview_port}"
      log "do not use https://${dns_name}:${preview_port} (that port is HTTP and may show iCloud/Safari warnings)"
      log "for HTTPS access, run: poketcodex share tailscale"
    else
      log "for secure remote access, run: poketcodex share tailscale"
    fi
  fi

  if [[ "${share_tailscale}" -eq 1 ]]; then
    run_share_tailscale
  fi
}

run_down() {
  run_in_repo bash ./scripts/longrun-down.sh
}

run_status() {
  run_in_repo bash ./scripts/longrun-status.sh
}

run_logs() {
  run_in_repo bash ./scripts/longrun-logs.sh
}

run_doctor() {
  local failures=0

  check_cmd() {
    local name="$1"
    if command_exists "${name}"; then
      log "ok: ${name} found"
    else
      warn "missing: ${name}"
      failures=$((failures + 1))
    fi
  }

  check_cmd codex
  local tailscale_cmd=""
  if tailscale_cmd="$(resolve_tailscale_cmd)"; then
    log "ok: tailscale found (${tailscale_cmd})"
  else
    warn "missing: tailscale"
    failures=$((failures + 1))
  fi
  check_cmd node
  if command_exists node; then
    local current_node_major
    current_node_major="$(node_major_version)"
    if [[ "${current_node_major}" -ge 22 ]]; then
      log "ok: node runtime compatible ($(node -v))"
    else
      warn "node version incompatible ($(node -v)); require Node.js 22+"
      failures=$((failures + 1))
    fi
  fi
  check_cmd pnpm
  check_cmd curl
  check_cmd tar

  if [[ -n "${tailscale_cmd}" ]]; then
    if "${tailscale_cmd}" status >/dev/null 2>&1; then
      log "ok: tailscale connected"
    else
      warn "tailscale installed but not connected; run: tailscale up"
      failures=$((failures + 1))
    fi
  fi

  local env_file
  env_file="$(resolve_env_file)"
  if [[ -f "${env_file}" ]]; then
    log "ok: env exists at ${env_file}"
  else
    warn "missing env file at ${env_file}; run: poketcodex init"
    failures=$((failures + 1))
  fi

  if [[ "${failures}" -gt 0 ]]; then
    die "doctor found ${failures} issue(s)"
  fi

  log "doctor passed"
}

run_share_tailscale() {
  local env_file preview_port
  env_file="$(resolve_env_file)"
  load_env_file "${env_file}"
  preview_port="${WEB_PREVIEW_PORT:-4173}"
  local tailscale_cmd
  tailscale_cmd="$(resolve_tailscale_cmd)" || die "tailscale is required"
  "${tailscale_cmd}" status >/dev/null 2>&1 || die "tailscale is installed but not connected; run: tailscale up"

  "${tailscale_cmd}" serve --bg --https=443 "http://127.0.0.1:${preview_port}"
  log "tailscale serve configured (HTTPS) for http://127.0.0.1:${preview_port}"

  local dns_name
  if dns_name="$(tailscale_dns_name "${tailscale_cmd}")"; then
    log "secure tailnet URL: https://${dns_name}"
  fi
  log "check active serve config: ${tailscale_cmd} serve status"
}

run_unshare_tailscale() {
  local tailscale_cmd
  tailscale_cmd="$(resolve_tailscale_cmd)" || die "tailscale is required"
  "${tailscale_cmd}" serve --https=443 off
  log "tailscale HTTPS serve disabled for port 443"
}

main() {
  local command="${1:-help}"
  shift || true

  if [[ "${command}" == "--" ]]; then
    command="${1:-help}"
    shift || true
  fi

  case "${command}" in
    init)
      run_init "$@"
      ;;
    up)
      run_up "$@"
      ;;
    down)
      run_down "$@"
      ;;
    status)
      run_status "$@"
      ;;
    logs)
      run_logs "$@"
      ;;
    doctor)
      run_doctor "$@"
      ;;
    share)
      local target="${1:-}"
      shift || true
      [[ "${target}" == "tailscale" ]] || die "Supported share target: tailscale"
      run_share_tailscale "$@"
      ;;
    unshare)
      local target="${1:-}"
      shift || true
      [[ "${target}" == "tailscale" ]] || die "Supported unshare target: tailscale"
      run_unshare_tailscale "$@"
      ;;
    help|-h|--help)
      usage
      ;;
    *)
      usage
      die "Unknown command: ${command}"
      ;;
  esac
}

main "$@"

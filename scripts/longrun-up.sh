#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${ROOT_DIR}/.runtime"
ENV_FILE="${POCKETCODEX_ENV_FILE:-${ROOT_DIR}/.env}"

mkdir -p "${RUNTIME_DIR}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "[poketcodex] Missing env file: ${ENV_FILE}" >&2
  echo "[poketcodex] Copy .env.example to .env and fill required secrets." >&2
  exit 1
fi

export POCKETCODEX_ENV_FILE="${ENV_FILE}"
cd "${ROOT_DIR}"

start_service() {
  local name="$1"
  shift
  local -a command=("$@")
  local pid_file="${RUNTIME_DIR}/${name}.pid"
  local log_file="${RUNTIME_DIR}/${name}.log"

  if [[ -f "${pid_file}" ]]; then
    local existing_pid
    existing_pid="$(cat "${pid_file}")"
    if [[ -n "${existing_pid}" ]] && kill -0 "${existing_pid}" 2>/dev/null; then
      echo "[poketcodex] ${name} already running (pid ${existing_pid})"
      return
    fi
    rm -f "${pid_file}"
  fi

  setsid env POCKETCODEX_ENV_FILE="${ENV_FILE}" bash ./scripts/run-with-env.sh "${command[@]}" >"${log_file}" 2>&1 < /dev/null &
  local pid=$!
  echo "${pid}" >"${pid_file}"
  echo "[poketcodex] started ${name} (pid ${pid})"
}

echo "[poketcodex] building backend + web for long-running mode..."
bash ./scripts/run-with-env.sh pnpm --filter @poketcodex/backend build
bash ./scripts/run-with-env.sh pnpm --filter @poketcodex/web build

start_service "backend" pnpm --filter @poketcodex/backend start
start_service "web" pnpm --filter @poketcodex/web start

echo "[poketcodex] long-running services are up"
echo "[poketcodex] logs: tail -f .runtime/backend.log .runtime/web.log"
echo "[poketcodex] stop: pnpm longrun:down"

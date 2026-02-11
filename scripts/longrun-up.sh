#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${ROOT_DIR}/.runtime"
ENV_FILE="${POCKETCODEX_ENV_FILE:-${ROOT_DIR}/.env}"

mkdir -p "${RUNTIME_DIR}"

# macOS does not ship setsid; fall back to a no-op wrapper.
if command -v setsid >/dev/null 2>&1; then
  __setsid() { setsid "$@"; }
else
  __setsid() { exec "$@"; }
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "[poketcodex] Missing env file: ${ENV_FILE}" >&2
  echo "[poketcodex] Copy .env.example to .env and fill required secrets." >&2
  exit 1
fi

export POCKETCODEX_ENV_FILE="${ENV_FILE}"
cd "${ROOT_DIR}"

service_pattern() {
  local name="$1"
  case "${name}" in
    backend)
      echo "dist/index.js"
      ;;
    *)
      echo ""
      ;;
  esac
}

read_service_pid() {
  local pid_file="$1"
  local raw
  raw="$(cat "${pid_file}")"
  echo "${raw%%|*}"
}

is_service_pid_running() {
  local name="$1"
  local pid="$2"

  if [[ -z "${pid}" ]]; then
    return 1
  fi

  if ! kill -0 "${pid}" 2>/dev/null; then
    return 1
  fi

  local cmdline
  cmdline="$(ps -p "${pid}" -o args= 2>/dev/null || true)"
  if [[ -z "${cmdline}" ]]; then
    return 1
  fi

  if [[ "${name}" == "web" ]]; then
    [[ "${cmdline}" == *"vite"* && "${cmdline}" == *"preview"* ]]
    return
  fi

  local pattern
  pattern="$(service_pattern "${name}")"
  if [[ -z "${pattern}" ]]; then
    return 0
  fi

  [[ "${cmdline}" == *"${pattern}"* ]]
}

start_service() {
  local name="$1"
  local workdir="$2"
  shift 2
  local -a command=("$@")
  local pid_file="${RUNTIME_DIR}/${name}.pid"
  local log_file="${RUNTIME_DIR}/${name}.log"

  if [[ -f "${pid_file}" ]]; then
    local existing_pid
    existing_pid="$(read_service_pid "${pid_file}")"
    if is_service_pid_running "${name}" "${existing_pid}"; then
      echo "[poketcodex] ${name} already running (pid ${existing_pid})"
      return
    fi
    rm -f "${pid_file}"
  fi

  (
    cd "${ROOT_DIR}/${workdir}"
    __setsid env POCKETCODEX_ENV_FILE="${ENV_FILE}" bash "${ROOT_DIR}/scripts/run-with-env.sh" "${command[@]}" >"${log_file}" 2>&1 < /dev/null &
    echo "$!" >"${pid_file}"
  )

  local pid
  pid="$(cat "${pid_file}")"
  echo "${pid}|${name}" >"${pid_file}"

  for _ in {1..15}; do
    if is_service_pid_running "${name}" "${pid}"; then
      echo "[poketcodex] started ${name} (pid ${pid})"
      return
    fi
    sleep 0.2
  done

  echo "[poketcodex] failed to start ${name}; check ${log_file}" >&2
  rm -f "${pid_file}"
  exit 1
}

echo "[poketcodex] building backend + web for long-running mode..."
bash ./scripts/run-with-env.sh pnpm --filter @poketcodex/backend build
bash ./scripts/run-with-env.sh pnpm --filter @poketcodex/web build

start_service "backend" "apps/backend" node dist/index.js
start_service "web" "apps/web" ../../node_modules/.bin/vite preview

echo "[poketcodex] long-running services are up"
echo "[poketcodex] logs: tail -f .runtime/backend.log .runtime/web.log"
echo "[poketcodex] stop: pnpm longrun:down"

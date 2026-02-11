#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${ROOT_DIR}/.runtime"

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

stop_service() {
  local name="$1"
  local pid_file="${RUNTIME_DIR}/${name}.pid"

  if [[ ! -f "${pid_file}" ]]; then
    echo "[poketcodex] ${name} is not running"
    return
  fi

  local pid
  pid="$(read_service_pid "${pid_file}")"
  if is_service_pid_running "${name}" "${pid}"; then
    kill "${pid}" 2>/dev/null || true

    for _ in {1..20}; do
      if ! kill -0 "${pid}" 2>/dev/null; then
        break
      fi
      sleep 0.2
    done

    if kill -0 "${pid}" 2>/dev/null; then
      kill -9 "${pid}" 2>/dev/null || true
    fi

    echo "[poketcodex] stopped ${name} (pid ${pid})"
  else
    echo "[poketcodex] ${name} pid file found but process is not running"
  fi

  rm -f "${pid_file}"
}

stop_service "backend"
stop_service "web"

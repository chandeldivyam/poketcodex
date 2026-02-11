#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${ROOT_DIR}/.runtime"

stop_service() {
  local name="$1"
  local pid_file="${RUNTIME_DIR}/${name}.pid"

  if [[ ! -f "${pid_file}" ]]; then
    echo "[poketcodex] ${name} is not running"
    return
  fi

  local pid
  pid="$(cat "${pid_file}")"
  if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
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

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${ROOT_DIR}/.runtime"

mkdir -p "${RUNTIME_DIR}"

touch "${RUNTIME_DIR}/backend.log" "${RUNTIME_DIR}/web.log"

tail -n 150 -f "${RUNTIME_DIR}/backend.log" "${RUNTIME_DIR}/web.log"

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${ROOT_DIR}/dist/release"
REF="HEAD"

usage() {
  cat <<'USAGE'
Usage:
  build-installer-assets.sh [--out-dir=<path>] [--ref=<git-ref>]

Builds release artifacts used by scripts/install.sh:
  - install.sh
  - poketcodex-source.tar.gz
  - checksums.txt

Notes:
  --ref=WORKTREE creates an archive from the current working tree
  (including uncommitted files, excluding .git/node_modules/.runtime/dist/coverage/.env*).
USAGE
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

die() {
  printf '[build-installer-assets] %s\n' "$*" >&2
  exit 1
}

sha256_line() {
  local file_path="$1"

  if command_exists sha256sum; then
    sha256sum "${file_path}"
    return 0
  fi

  if command_exists shasum; then
    shasum -a 256 "${file_path}" | awk '{print $1 "  " $2}'
    return 0
  fi

  die "Missing checksum tool (sha256sum or shasum)"
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == "--" ]]; then
      shift
      continue
    fi

    case "$1" in
      --out-dir=*)
        OUT_DIR="${1#*=}"
        ;;
      --ref=*)
        REF="${1#*=}"
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        die "Unknown argument: $1"
        ;;
    esac
    shift
  done
}

main() {
  parse_args "$@"

  command_exists git || die "git is required"
  [[ -f "${ROOT_DIR}/scripts/install.sh" ]] || die "scripts/install.sh not found"

  mkdir -p "${OUT_DIR}"
  rm -f "${OUT_DIR}/install.sh" "${OUT_DIR}/poketcodex-source.tar.gz" "${OUT_DIR}/checksums.txt"

  cp "${ROOT_DIR}/scripts/install.sh" "${OUT_DIR}/install.sh"
  chmod +x "${OUT_DIR}/install.sh"

  if [[ "${REF}" == "WORKTREE" ]]; then
    (
      cd "${ROOT_DIR}"
      tar -czf "${OUT_DIR}/poketcodex-source.tar.gz" \
        --exclude=.git \
        --exclude=node_modules \
        --exclude=.runtime \
        --exclude=dist \
        --exclude=coverage \
        --exclude=.env \
        --exclude=.env.* \
        --transform='s|^|poketcodex/|' \
        .
    )
  else
    git -C "${ROOT_DIR}" rev-parse --verify "${REF}^{commit}" >/dev/null
    git -C "${ROOT_DIR}" archive --format=tar.gz --prefix=poketcodex/ "${REF}" > "${OUT_DIR}/poketcodex-source.tar.gz"
  fi

  (
    cd "${OUT_DIR}"
    {
      sha256_line "install.sh"
      sha256_line "poketcodex-source.tar.gz"
    } > "checksums.txt"
  )

  printf '[build-installer-assets] wrote %s\n' "${OUT_DIR}"
}

main "$@"

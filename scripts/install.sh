#!/usr/bin/env bash
set -euo pipefail

DEFAULT_OWNER="chandeldivyam"
DEFAULT_REPO="poketcodex"
DEFAULT_SOURCE_ASSET="poketcodex-source.tar.gz"
DEFAULT_CHECKSUMS_ASSET="checksums.txt"

VERSION="latest"
OWNER="${POCKETCODEX_GITHUB_OWNER:-${DEFAULT_OWNER}}"
REPO="${POCKETCODEX_GITHUB_REPO:-${DEFAULT_REPO}}"
INSTALL_ROOT="${POCKETCODEX_HOME:-$HOME/.local/share/poketcodex}"
BIN_DIR="${POCKETCODEX_BIN_DIR:-$HOME/.local/bin}"
SKIP_START=0
YES_MODE=0
SKIP_CODEX_CHECK=0
SKIP_TAILSCALE_CHECK=0
SKIP_NODE_CHECK=0
SKIP_PNPM_CHECK=0
LOCAL_SOURCE_TARBALL=""
LOCAL_CHECKSUMS_FILE=""
WORKSPACE_ROOT="${HOME}"
TAILSCALE_CMD=""

usage() {
  cat <<'USAGE'
Usage:
  install.sh [options]

Options:
  --version=<tag|latest>         Release version selector (default: latest)
  --repo-owner=<owner>           GitHub owner/org (default from script/env)
  --repo-name=<repo>             GitHub repo name (default from script/env)
  --install-root=<path>          Install root (default: ~/.local/share/poketcodex)
  --bin-dir=<path>               Launcher directory (default: ~/.local/bin)
  --workspace-root=<path>        Default ALLOWED_WORKSPACE_ROOTS value for init (default: ~)
  --skip-start                   Install and init, but do not start services
  --yes                          Non-interactive mode
  --skip-codex-check             Skip codex binary presence check
  --skip-tailscale-check         Skip tailscale install/login check
  --skip-node-check              Skip node runtime check
  --skip-pnpm-check              Skip pnpm check
  --source-tarball=<path>        Use local source tarball instead of downloading release asset
  --checksums-file=<path>        Use local checksums file (required with --source-tarball)
  --help                         Show help

Examples:
  curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error \
    https://github.com/chandeldivyam/poketcodex/releases/latest/download/install.sh | bash

  bash install.sh --source-tarball=dist/release/poketcodex-source.tar.gz \
    --checksums-file=dist/release/checksums.txt --skip-start --yes \
    --skip-codex-check --skip-tailscale-check
USAGE
}

log() {
  printf '[poketcodex-install] %s\n' "$*"
}

warn() {
  printf '[poketcodex-install] %s\n' "$*" >&2
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

require_cmd() {
  local cmd="$1"
  command_exists "${cmd}" || die "Missing required command: ${cmd}"
}

sha256_of_file() {
  local file_path="$1"

  if command_exists sha256sum; then
    sha256sum "${file_path}" | awk '{print $1}'
    return 0
  fi

  if command_exists shasum; then
    shasum -a 256 "${file_path}" | awk '{print $1}'
    return 0
  fi

  die "Missing sha256 checksum tool (need sha256sum or shasum)"
}

fetch_asset() {
  local url="$1"
  local out="$2"

  curl --proto '=https' --tlsv1.2 --fail --location --retry 5 --retry-connrefused \
    --silent --show-error --output "${out}" "${url}"
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --version=*)
        VERSION="${1#*=}"
        ;;
      --repo-owner=*)
        OWNER="${1#*=}"
        ;;
      --repo-name=*)
        REPO="${1#*=}"
        ;;
      --install-root=*)
        INSTALL_ROOT="${1#*=}"
        ;;
      --bin-dir=*)
        BIN_DIR="${1#*=}"
        ;;
      --workspace-root=*)
        WORKSPACE_ROOT="${1#*=}"
        ;;
      --skip-start)
        SKIP_START=1
        ;;
      --yes)
        YES_MODE=1
        ;;
      --skip-codex-check)
        SKIP_CODEX_CHECK=1
        ;;
      --skip-tailscale-check)
        SKIP_TAILSCALE_CHECK=1
        ;;
      --skip-node-check)
        SKIP_NODE_CHECK=1
        ;;
      --skip-pnpm-check)
        SKIP_PNPM_CHECK=1
        ;;
      --source-tarball=*)
        LOCAL_SOURCE_TARBALL="${1#*=}"
        ;;
      --checksums-file=*)
        LOCAL_CHECKSUMS_FILE="${1#*=}"
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

resolve_abs_path() {
  local input_path="$1"

  if [[ ! -d "${input_path}" ]]; then
    die "Workspace root does not exist: ${input_path}"
  fi

  if command_exists realpath; then
    realpath "${input_path}"
    return 0
  fi

  (
    cd "${input_path}"
    pwd
  )
}

preflight() {
  require_cmd bash
  require_cmd curl
  require_cmd tar

  if [[ "${SKIP_NODE_CHECK}" -eq 0 ]]; then
    require_cmd node
    require_min_node_version 22
  fi

  if [[ "${SKIP_PNPM_CHECK}" -eq 0 ]]; then
    require_cmd pnpm
  fi

  if [[ "${SKIP_CODEX_CHECK}" -eq 0 ]]; then
    require_cmd codex
  fi

  if [[ "${SKIP_TAILSCALE_CHECK}" -eq 0 ]]; then
    if ! TAILSCALE_CMD="$(resolve_tailscale_cmd)"; then
      die "Missing required command: tailscale (or macOS app CLI path /Applications/Tailscale.app/Contents/MacOS/Tailscale)"
    fi

    if ! "${TAILSCALE_CMD}" status >/dev/null 2>&1; then
      die "tailscale is installed but not connected; run: tailscale up"
    fi
  fi
}

prepare_assets() {
  local tmp_dir="$1"

  if [[ -n "${LOCAL_SOURCE_TARBALL}" || -n "${LOCAL_CHECKSUMS_FILE}" ]]; then
    [[ -n "${LOCAL_SOURCE_TARBALL}" ]] || die "--checksums-file requires --source-tarball"
    [[ -n "${LOCAL_CHECKSUMS_FILE}" ]] || die "--source-tarball requires --checksums-file"
    [[ -f "${LOCAL_SOURCE_TARBALL}" ]] || die "Source tarball not found: ${LOCAL_SOURCE_TARBALL}"
    [[ -f "${LOCAL_CHECKSUMS_FILE}" ]] || die "Checksums file not found: ${LOCAL_CHECKSUMS_FILE}"

    cp "${LOCAL_SOURCE_TARBALL}" "${tmp_dir}/${DEFAULT_SOURCE_ASSET}"
    cp "${LOCAL_CHECKSUMS_FILE}" "${tmp_dir}/${DEFAULT_CHECKSUMS_ASSET}"
    return 0
  fi

  local base_url
  if [[ "${VERSION}" == "latest" ]]; then
    base_url="https://github.com/${OWNER}/${REPO}/releases/latest/download"
  else
    base_url="https://github.com/${OWNER}/${REPO}/releases/download/${VERSION}"
  fi

  log "downloading installer assets from ${base_url}"
  fetch_asset "${base_url}/${DEFAULT_SOURCE_ASSET}" "${tmp_dir}/${DEFAULT_SOURCE_ASSET}"
  fetch_asset "${base_url}/${DEFAULT_CHECKSUMS_ASSET}" "${tmp_dir}/${DEFAULT_CHECKSUMS_ASSET}"
}

verify_assets() {
  local tmp_dir="$1"
  local source_tarball="${tmp_dir}/${DEFAULT_SOURCE_ASSET}"
  local checksums_file="${tmp_dir}/${DEFAULT_CHECKSUMS_ASSET}"

  local expected actual
  expected="$(awk -v name="${DEFAULT_SOURCE_ASSET}" '$2==name {print $1}' "${checksums_file}")"
  [[ -n "${expected}" ]] || die "Could not find checksum for ${DEFAULT_SOURCE_ASSET} in ${checksums_file}"

  actual="$(sha256_of_file "${source_tarball}")"
  [[ "${expected}" == "${actual}" ]] || die "Checksum verification failed for ${DEFAULT_SOURCE_ASSET}"

  log "checksum verified for ${DEFAULT_SOURCE_ASSET}"
}

install_release() {
  local tmp_dir="$1"
  local source_tarball="${tmp_dir}/${DEFAULT_SOURCE_ASSET}"

  mkdir -p "${INSTALL_ROOT}/releases" "${BIN_DIR}"

  local release_id
  release_id="${VERSION}"
  if [[ "${release_id}" == "latest" ]]; then
    release_id="latest-$(date -u +%Y%m%d%H%M%S)"
  fi

  local release_dir="${INSTALL_ROOT}/releases/${release_id}"
  rm -rf "${release_dir}"
  mkdir -p "${release_dir}"

  tar -xzf "${source_tarball}" -C "${release_dir}" --strip-components=1
  ln -sfn "${release_dir}" "${INSTALL_ROOT}/current"

  local launcher_path="${BIN_DIR}/poketcodex"
  cat >"${launcher_path}" <<EOF
#!/usr/bin/env bash
set -euo pipefail

INSTALL_ROOT_DEFAULT="${INSTALL_ROOT}"
resolved_root="\${POCKETCODEX_HOME:-\${INSTALL_ROOT_DEFAULT}}"
target="\${resolved_root}/current/scripts/poketcodex.sh"

if [[ ! -x "\${target}" ]]; then
  echo "[poketcodex] launcher target not found: \${target}" >&2
  echo "[poketcodex] reinstall using the install script." >&2
  exit 1
fi

exec bash "\${target}" "\$@"
EOF
  chmod +x "${launcher_path}"

  log "installed release into ${release_dir}"
  log "launcher created at ${launcher_path}"

  if [[ ":${PATH}:" != *":${BIN_DIR}:"* ]]; then
    warn "${BIN_DIR} is not on PATH in this shell"
  fi
}

bootstrap() {
  local launcher_path="${BIN_DIR}/poketcodex"
  local workspace_root_abs
  workspace_root_abs="$(resolve_abs_path "${WORKSPACE_ROOT}")"
  local env_file="${INSTALL_ROOT}/current/.env"
  local -a init_args=("init" "--workspace-root=${workspace_root_abs}" "--env-file=${env_file}")

  if [[ "${YES_MODE}" -eq 1 ]]; then
    init_args+=("--yes")
  fi

  "${launcher_path}" "${init_args[@]}"

  if [[ "${SKIP_START}" -eq 0 ]]; then
    "${launcher_path}" up
  else
    log "skipped start (--skip-start). Next step: ${launcher_path} up"
  fi
}

main() {
  parse_args "$@"
  preflight

  local tmp_dir
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "${tmp_dir:-}"' EXIT

  prepare_assets "${tmp_dir}"
  verify_assets "${tmp_dir}"
  install_release "${tmp_dir}"
  bootstrap

  log "install complete"
}

main "$@"

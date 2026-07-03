#!/usr/bin/env bash
# ============================================================
# hiclaw-dashboard.sh — Install / upgrade / uninstall TaDashboard
# as an optional component of an existing AgentTeams (HiClaw) deployment.
#
# Usage:
#   bash hiclaw-dashboard.sh              # interactive install (first time)
#   bash hiclaw-dashboard.sh update       # pull latest image & recreate
#   bash hiclaw-dashboard.sh uninstall    # remove dashboard container
#
# Non-interactive:
#   HICLAW_NON_INTERACTIVE=1 HICLAW_PORT_DASHBOARD=13000 bash hiclaw-dashboard.sh
# ============================================================
set -euo pipefail

# ---------- constants ----------
CONTAINER_NAME="hiclaw-dashboard"
NETWORK_NAME="hiclaw-net"
DEFAULT_PORT=13000
DEFAULT_IMAGE="hiclaw-dashboard:latest"
DATA_VOLUME="hiclaw-dashboard-data"
ENV_FILE="${HOME}/.hiclaw-dashboard.env"

# ---------- helpers ----------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }

detect_docker() {
  DOCKER_CMD="docker"
  if ! docker version >/dev/null 2>&1; then
    if podman version >/dev/null 2>&1; then
      DOCKER_CMD="podman"
    else
      err "Neither docker nor podman found. Please install one."; exit 1
    fi
  fi
  info "Using: ${DOCKER_CMD}"
}

# ---------- env persistence ----------
save_env() {
  cat > "${ENV_FILE}" <<EOF
HICLAW_PORT_DASHBOARD=${HICLAW_PORT_DASHBOARD}
HICLAW_DASHBOARD_IMAGE=${HICLAW_DASHBOARD_IMAGE}
HICLAW_CONTROLLER_URL=${HICLAW_CONTROLLER_URL}
NEXT_PUBLIC_MATRIX_API_URL=${NEXT_PUBLIC_MATRIX_API_URL}
HICLAW_AI_GATEWAY_ADMIN_URL=${HICLAW_AI_GATEWAY_ADMIN_URL:-}
HICLAW_LOCAL_ONLY=${HICLAW_LOCAL_ONLY:-0}
EOF
  ok "Configuration saved to ${ENV_FILE}"
}

load_env() {
  if [ ! -f "${ENV_FILE}" ]; then
    err "No saved configuration found at ${ENV_FILE}"
    err "Run 'bash hiclaw-dashboard.sh' (without arguments) to install first."
    exit 1
  fi
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  # Apply defaults for any missing values
  HICLAW_PORT_DASHBOARD="${HICLAW_PORT_DASHBOARD:-${DEFAULT_PORT}}"
  HICLAW_DASHBOARD_IMAGE="${HICLAW_DASHBOARD_IMAGE:-${DEFAULT_IMAGE}}"
  HICLAW_CONTROLLER_URL="${HICLAW_CONTROLLER_URL:-http://hiclaw-controller:8090}"
  NEXT_PUBLIC_MATRIX_API_URL="${NEXT_PUBLIC_MATRIX_API_URL:-http://matrix-local.hiclaw.io:6167}"
  HICLAW_LOCAL_ONLY="${HICLAW_LOCAL_ONLY:-0}"
}

# ---------- uninstall ----------
do_uninstall() {
  detect_docker
  if ${DOCKER_CMD} ps -a --format '{{.Names}}' | grep -qx "${CONTAINER_NAME}"; then
    info "Stopping and removing ${CONTAINER_NAME}..."
    ${DOCKER_CMD} rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
    ok "Dashboard container removed."
  else
    warn "Container ${CONTAINER_NAME} not found — nothing to do."
  fi
}

# ---------- pre-flight checks ----------
preflight() {
  detect_docker

  # 1. Check hiclaw-net exists
  if ! ${DOCKER_CMD} network inspect "${NETWORK_NAME}" >/dev/null 2>&1; then
    err "Docker network '${NETWORK_NAME}' not found."
    err "Please install AgentTeams (HiClaw) first: https://github.com/agentscope-ai/AgentTeams"
    exit 1
  fi
  ok "Network '${NETWORK_NAME}' found."

  # 2. Check controller is running
  if ! ${DOCKER_CMD} ps --format '{{.Names}}' | grep -q "hiclaw-controller\|hiclaw-manager"; then
    warn "No running hiclaw-controller or hiclaw-manager container found."
    warn "Dashboard will start but may not be able to reach the controller."
  else
    ok "HiClaw controller/manager container detected."
  fi
}

# ---------- prompts ----------
prompt_value() {
  local var_name="$1" prompt_text="$2" default="$3"
  if [ "${HICLAW_NON_INTERACTIVE:-0}" = "1" ]; then
    eval "${var_name}=\${${var_name}:-${default}}"
    return
  fi
  local current="${!var_name:-${default}}"
  read -rp "${prompt_text} [${current}]: " input
  eval "${var_name}=\${input:-${current}}"
}

prompt_yes_no() {
  local var_name="$1" prompt_text="$2" default="$3"
  if [ "${HICLAW_NON_INTERACTIVE:-0}" = "1" ]; then
    eval "${var_name}=\${${var_name}:-${default}}"
    return
  fi
  local hint="Y/n" current="${default}"
  [ "${default}" = "0" ] && hint="y/N"
  read -rp "${prompt_text} [${hint}]: " input
  case "${input:-}" in
    [yY1]) eval "${var_name}=1" ;;
    [nN0]) eval "${var_name}=0" ;;
    *)     eval "${var_name}=${current}" ;;
  esac
}

# ---------- wizard ----------
wizard() {
  echo ""
  echo -e "${CYAN}========================================${NC}"
  echo -e "${CYAN}  TaDashboard Installation Wizard${NC}"
  echo -e "${CYAN}========================================${NC}"
  echo ""

  prompt_yes_no HICLAW_DASHBOARD "Install TaDashboard?" "1"
  if [ "${HICLAW_DASHBOARD}" != "1" ]; then
    info "Dashboard installation skipped."
    exit 0
  fi

  prompt_value HICLAW_PORT_DASHBOARD "Dashboard port" "${DEFAULT_PORT}"
  prompt_value HICLAW_DASHBOARD_IMAGE "Dashboard Docker image" "${DEFAULT_IMAGE}"

  # Detect controller URL from running container
  local ctrl_url="http://hiclaw-controller:8090"
  if ${DOCKER_CMD} ps --format '{{.Names}}' | grep -q "hiclaw-manager"; then
    ctrl_url="http://hiclaw-manager:8090"
  fi
  prompt_value HICLAW_CONTROLLER_URL "HiClaw Controller URL" "${ctrl_url}"

  prompt_value NEXT_PUBLIC_MATRIX_API_URL "Matrix Homeserver URL" "http://matrix-local.hiclaw.io:6167"

  # Detect Higress Console URL from running container (for shared auth with Higress)
  # Higress Console is typically on port 8001, embedded in hiclaw-controller or standalone
  local higress_url=""
  for _ctr in "hiclaw-controller" "higress-console" "higress"; do
    if ${DOCKER_CMD} ps --format '{{.Names}}' | grep -q "^${_ctr}$"; then
      local higress_port
      higress_port=$(${DOCKER_CMD} port "${_ctr}" 8001 2>/dev/null | head -1 | cut -d: -f2 || true)
      if [ -n "${higress_port}" ]; then
        higress_url="http://127.0.0.1:${higress_port}"
        break
      fi
    fi
  done
  prompt_value HICLAW_AI_GATEWAY_ADMIN_URL "Higress Console URL (for shared login)" "${higress_url}"
}

# ---------- local-only binding ----------
resolve_port_prefix() {
  _port_prefix=""
  if [ "${HICLAW_LOCAL_ONLY:-0}" = "1" ]; then
    _port_prefix="127.0.0.1:"
  fi
}

# ---------- pull or build image ----------
ensure_image() {
  local image="$1"
  # Pull latest if image not present locally
  if ! ${DOCKER_CMD} image inspect "${image}" >/dev/null 2>&1; then
    info "Pulling image ${image}..."
    ${DOCKER_CMD} pull "${image}" || {
      warn "Pull failed — attempting to build from source..."
      local script_dir
      script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
      if [ -f "${script_dir}/../Dockerfile" ]; then
        ${DOCKER_CMD} build \
          --build-arg NEXT_PUBLIC_BASE_PATH="" \
          -t "${image}" "${script_dir}/.."
      else
        err "Cannot build: Dockerfile not found."; exit 1
      fi
    }
  fi
}

# ---------- recreate container ----------
recreate_container() {
  resolve_port_prefix

  # Remove existing container if present
  if ${DOCKER_CMD} ps -a --format '{{.Names}}' | grep -qx "${CONTAINER_NAME}"; then
    info "Removing existing ${CONTAINER_NAME} container..."
    ${DOCKER_CMD} rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  fi

  # Create data volume
  ${DOCKER_CMD} volume create "${DATA_VOLUME}" >/dev/null 2>&1 || true

  # Start container
  info "Starting ${CONTAINER_NAME}..."
  ${DOCKER_CMD} run -d \
    --name "${CONTAINER_NAME}" \
    --restart unless-stopped \
    --network "${NETWORK_NAME}" \
    -p "${_port_prefix}${HICLAW_PORT_DASHBOARD}:3000" \
    -e HICLAW_CONTROLLER_URL="${HICLAW_CONTROLLER_URL}" \
    -e NEXT_PUBLIC_MATRIX_API_URL="${NEXT_PUBLIC_MATRIX_API_URL}" \
    -e HICLAW_AI_GATEWAY_ADMIN_URL="${HICLAW_AI_GATEWAY_ADMIN_URL:-}" \
    -e MATRIX_HOMESERVER_ALLOWLIST="matrix-local.hiclaw.io,matrix.org" \
    -e DATABASE_URL="file:/app/db/dashboard.db" \
    -v "${DATA_VOLUME}:/app/db" \
    "${HICLAW_DASHBOARD_IMAGE}"

  # Wait for readiness
  info "Waiting for Dashboard to become ready..."
  local max_wait=60 elapsed=0
  while [ ${elapsed} -lt ${max_wait} ]; do
    if curl -sf "http://127.0.0.1:${HICLAW_PORT_DASHBOARD}/" >/dev/null 2>&1; then
      break
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done

  if [ ${elapsed} -ge ${max_wait} ]; then
    warn "Dashboard did not respond within ${max_wait}s. Check logs: ${DOCKER_CMD} logs ${CONTAINER_NAME}"
  else
    ok "Dashboard is ready!"
  fi
}

# ---------- print success ----------
print_success() {
  echo ""
  echo -e "${GREEN}========================================${NC}"
  echo -e "${GREEN}  TaDashboard ${1:-installed} successfully!${NC}"
  echo -e "${GREEN}========================================${NC}"
  echo ""
  local bind_host="0.0.0.0"
  [ "${HICLAW_LOCAL_ONLY:-0}" = "1" ] && bind_host="127.0.0.1"
  echo -e "  Access: ${CYAN}http://${bind_host}:${HICLAW_PORT_DASHBOARD}/${NC}"
  echo -e "  Logs:   ${DOCKER_CMD} logs -f ${CONTAINER_NAME}"
  echo -e "  Stop:   ${DOCKER_CMD} stop ${CONTAINER_NAME}"
  echo ""
}

# ---------- install (first time) ----------
do_install() {
  preflight
  wizard

  echo ""
  info "Configuration:"
  info "  Port:        ${HICLAW_PORT_DASHBOARD}"
  info "  Image:       ${HICLAW_DASHBOARD_IMAGE}"
  info "  Controller:  ${HICLAW_CONTROLLER_URL}"
  info "  Matrix:      ${NEXT_PUBLIC_MATRIX_API_URL}"
  info "  Higress:     ${HICLAW_AI_GATEWAY_ADMIN_URL:-<not configured>}"
  info "  LAN access:  $([ "${HICLAW_LOCAL_ONLY:-0}" = "1" ] && echo 'disabled (127.0.0.1 only)' || echo 'enabled (0.0.0.0)')"
  echo ""

  save_env
  ensure_image "${HICLAW_DASHBOARD_IMAGE}"
  recreate_container
  print_success "installed"
}

# ---------- update (upgrade existing) ----------
do_update() {
  preflight
  load_env

  echo ""
  info "Updating TaDashboard..."
  info "  Port:        ${HICLAW_PORT_DASHBOARD}"
  info "  Image:       ${HICLAW_DASHBOARD_IMAGE}"
  info "  Controller:  ${HICLAW_CONTROLLER_URL}"
  echo ""

  # Pull latest image (force re-pull to get updates)
  info "Pulling latest image ${HICLAW_DASHBOARD_IMAGE}..."
  ${DOCKER_CMD} pull "${HICLAW_DASHBOARD_IMAGE}" || {
    warn "Pull failed — attempting to rebuild from source..."
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [ -f "${script_dir}/../Dockerfile" ]; then
      ${DOCKER_CMD} build \
        --no-cache \
        --build-arg NEXT_PUBLIC_BASE_PATH="" \
        -t "${HICLAW_DASHBOARD_IMAGE}" "${script_dir}/.."
    else
      err "Cannot build: Dockerfile not found. Run without 'update' to install from scratch."
      exit 1
    fi
  }

  recreate_container
  print_success "updated"
}

# ---------- main ----------
case "${1:-}" in
  uninstall|remove|rm)
    do_uninstall
    ;;
  update|upgrade)
    do_update
    ;;
  *)
    do_install
    ;;
esac

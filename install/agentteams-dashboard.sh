#!/usr/bin/env bash
# ============================================================
# agentteams-dashboard.sh — Install / upgrade / uninstall AgentTeams-Dashboard
# as an optional component of an existing AgentTeams deployment.
#
# Usage:
#   bash agentteams-dashboard.sh              # interactive install (first time)
#   bash agentteams-dashboard.sh update       # pull latest image & recreate
#   bash agentteams-dashboard.sh uninstall    # remove dashboard container
#
# Non-interactive:
#   AGENTTEAMS_NON_INTERACTIVE=1 AGENTTEAMS_PORT_DASHBOARD=13000 bash agentteams-dashboard.sh
# ============================================================
set -euo pipefail

# ---------- constants ----------
CONTAINER_NAME="agentteams-dashboard"
NETWORK_NAME="agentteams-net"
DEFAULT_PORT=13000
# Must match the Makefile image coordinates (REGISTRY/REPO/name).
DEFAULT_IMAGE="higress-registry.cn-hangzhou.cr.aliyuncs.com/agentteams/agentteams-dashboard:v1.0.0"
DATA_VOLUME="agentteams-dashboard-data"
ENV_FILE="${HOME}/.agentteams-dashboard.env"

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
AGENTTEAMS_PORT_DASHBOARD=${AGENTTEAMS_PORT_DASHBOARD}
AGENTTEAMS_DASHBOARD_IMAGE=${AGENTTEAMS_DASHBOARD_IMAGE}
AGENTTEAMS_CONTROLLER_URL=${AGENTTEAMS_CONTROLLER_URL}
NEXT_PUBLIC_MATRIX_API_URL=${NEXT_PUBLIC_MATRIX_API_URL}
AGENTTEAMS_AI_GATEWAY_ADMIN_URL=${AGENTTEAMS_AI_GATEWAY_ADMIN_URL:-}
AGENTTEAMS_LOCAL_ONLY=${AGENTTEAMS_LOCAL_ONLY:-1}
AGENTTEAMS_FS_ENDPOINT=${AGENTTEAMS_FS_ENDPOINT:-}
AGENTTEAMS_FS_ACCESS_KEY=${AGENTTEAMS_FS_ACCESS_KEY:-}
AGENTTEAMS_FS_SECRET_KEY=${AGENTTEAMS_FS_SECRET_KEY:-}
AGENTTEAMS_FS_BUCKET=${AGENTTEAMS_FS_BUCKET:-}
AGENTTEAMS_LLM_PROVIDER=${AGENTTEAMS_LLM_PROVIDER:-}
AGENTTEAMS_LLM_API_KEY=${AGENTTEAMS_LLM_API_KEY:-}
AGENTTEAMS_OPENAI_BASE_URL=${AGENTTEAMS_OPENAI_BASE_URL:-}
AGENTTEAMS_DEFAULT_MODEL=${AGENTTEAMS_DEFAULT_MODEL:-}
AGENTTEAMS_AUTH_TOKEN=${AGENTTEAMS_AUTH_TOKEN:-}
AGENTTEAMS_ADMIN_USER=${AGENTTEAMS_ADMIN_USER:-}
AGENTTEAMS_ADMIN_PASSWORD=${AGENTTEAMS_ADMIN_PASSWORD:-}
EOF
  ok "Configuration saved to ${ENV_FILE}"
}

load_env() {
  if [ ! -f "${ENV_FILE}" ]; then
    err "No saved configuration found at ${ENV_FILE}"
    err "Run 'bash agentteams-dashboard.sh' (without arguments) to install first."
    exit 1
  fi
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  # Apply defaults for any missing values
  AGENTTEAMS_PORT_DASHBOARD="${AGENTTEAMS_PORT_DASHBOARD:-${DEFAULT_PORT}}"
  AGENTTEAMS_DASHBOARD_IMAGE="${AGENTTEAMS_DASHBOARD_IMAGE:-${DEFAULT_IMAGE}}"
  AGENTTEAMS_CONTROLLER_URL="${AGENTTEAMS_CONTROLLER_URL:-http://agentteams-controller:8090}"
  NEXT_PUBLIC_MATRIX_API_URL="${NEXT_PUBLIC_MATRIX_API_URL:-http://agentteams-controller:6167}"
  AGENTTEAMS_LOCAL_ONLY="${AGENTTEAMS_LOCAL_ONLY:-1}"
  AGENTTEAMS_FS_ENDPOINT="${AGENTTEAMS_FS_ENDPOINT:-}"
  AGENTTEAMS_FS_ACCESS_KEY="${AGENTTEAMS_FS_ACCESS_KEY:-}"
  AGENTTEAMS_FS_SECRET_KEY="${AGENTTEAMS_FS_SECRET_KEY:-}"
  AGENTTEAMS_FS_BUCKET="${AGENTTEAMS_FS_BUCKET:-}"
  AGENTTEAMS_LLM_PROVIDER="${AGENTTEAMS_LLM_PROVIDER:-}"
  AGENTTEAMS_LLM_API_KEY="${AGENTTEAMS_LLM_API_KEY:-}"
  AGENTTEAMS_OPENAI_BASE_URL="${AGENTTEAMS_OPENAI_BASE_URL:-}"
  AGENTTEAMS_DEFAULT_MODEL="${AGENTTEAMS_DEFAULT_MODEL:-}"
  AGENTTEAMS_AUTH_TOKEN="${AGENTTEAMS_AUTH_TOKEN:-}"
  AGENTTEAMS_ADMIN_USER="${AGENTTEAMS_ADMIN_USER:-}"
  AGENTTEAMS_ADMIN_PASSWORD="${AGENTTEAMS_ADMIN_PASSWORD:-}"
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

  # 1. Check agentteams-net exists
  if ! ${DOCKER_CMD} network inspect "${NETWORK_NAME}" >/dev/null 2>&1; then
    err "Docker network '${NETWORK_NAME}' not found."
    err "Please install AgentTeams first: https://github.com/agentscope-ai/AgentTeams"
    exit 1
  fi
  ok "Network '${NETWORK_NAME}' found."

  # 2. Check controller is running
  if ! ${DOCKER_CMD} ps --format '{{.Names}}' | grep -q "agentteams-controller\|agentteams-manager"; then
    warn "No running agentteams-controller or agentteams-manager container found."
    warn "Dashboard will start but may not be able to reach the controller."
  else
    ok "AgentTeams controller/manager container detected."
  fi
}

# ---------- prompts ----------
prompt_value() {
  local var_name="$1" prompt_text="$2" default="$3"
  if [ "${AGENTTEAMS_NON_INTERACTIVE:-0}" = "1" ]; then
    eval "${var_name}=\${${var_name}:-${default}}"
    return
  fi
  local current="${!var_name:-${default}}"
  read -rp "${prompt_text} [${current}]: " input
  eval "${var_name}=\${input:-${current}}"
}

prompt_yes_no() {
  local var_name="$1" prompt_text="$2" default="$3"
  if [ "${AGENTTEAMS_NON_INTERACTIVE:-0}" = "1" ]; then
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
  echo -e "${CYAN}  AgentTeams-Dashboard Installation Wizard${NC}"
  echo -e "${CYAN}========================================${NC}"
  echo ""

  prompt_yes_no AGENTTEAMS_DASHBOARD "Install AgentTeams-Dashboard?" "1"
  if [ "${AGENTTEAMS_DASHBOARD}" != "1" ]; then
    info "Dashboard installation skipped."
    exit 0
  fi

  prompt_value AGENTTEAMS_PORT_DASHBOARD "Dashboard port" "${DEFAULT_PORT}"
  prompt_value AGENTTEAMS_DASHBOARD_IMAGE "Dashboard Docker image" "${DEFAULT_IMAGE}"

  # Detect controller URL — in embedded mode the API is on agentteams-controller:8090.
  # The manager container does not expose the controller REST API, so we always
  # prefer agentteams-controller and only fall back to agentteams-manager as a last resort.
  local ctrl_url=""
  if ${DOCKER_CMD} ps --format '{{.Names}}' | grep -q "^agentteams-controller$"; then
    if ${DOCKER_CMD} exec agentteams-controller wget -q -O- --timeout=2 http://127.0.0.1:8090/healthz >/dev/null 2>&1; then
      ctrl_url="http://agentteams-controller:8090"
    fi
  fi
  if [ -z "${ctrl_url}" ] && ${DOCKER_CMD} ps --format '{{.Names}}' | grep -q "^agentteams-manager$"; then
    warn "agentteams-controller not available — falling back to agentteams-manager:8090"
    if ${DOCKER_CMD} exec agentteams-manager wget -q -O- --timeout=2 http://127.0.0.1:8090/healthz >/dev/null 2>&1; then
      ctrl_url="http://agentteams-manager:8090"
    fi
  fi
  [ -z "${ctrl_url}" ] && ctrl_url="http://agentteams-controller:8090"
  prompt_value AGENTTEAMS_CONTROLLER_URL "AgentTeams Controller URL" "${ctrl_url}"

  prompt_value NEXT_PUBLIC_MATRIX_API_URL "Matrix Homeserver URL" "http://agentteams-controller:6167"

  # Detect Higress Console URL from running container (for shared auth with Higress)
  # Use internal Docker network URL (container:port) — works for dashboard on the same network.
  local higress_url=""
  for _ctr in "agentteams-controller" "higress-console" "higress"; do
    if ${DOCKER_CMD} ps --format '{{.Names}}' | grep -q "^${_ctr}$"; then
      # Prefer internal port 8001 (Higress Console API)
      if ${DOCKER_CMD} exec "${_ctr}" wget -q -O- --timeout=2 http://127.0.0.1:8001/ >/dev/null 2>&1; then
        higress_url="http://${_ctr}:8001"
        break
      fi
    fi
  done
  prompt_value AGENTTEAMS_AI_GATEWAY_ADMIN_URL "Higress Console URL (for shared login)" "${higress_url}"
}

# ---------- local-only binding ----------
resolve_port_prefix() {
  _port_prefix=""
  if [ "${AGENTTEAMS_LOCAL_ONLY:-0}" = "1" ]; then
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

# ---------- runtime env detection from controller container ----------
detect_runtime_env() {
  # MinIO / LLM / auth credentials live on the controller container, even when the
  # dashboard talks to a manager or proxy. Prefer agentteams-controller, fall back to
  # the host derived from AGENTTEAMS_CONTROLLER_URL.
  if ${DOCKER_CMD} ps --format '{{.Names}}' | grep -qx "agentteams-controller"; then
    if echo "${AGENTTEAMS_CONTROLLER_URL}" | grep -q "agentteams-manager"; then
      warn "Controller URL points to agentteams-manager; switching to agentteams-controller:8090 for API access"
      AGENTTEAMS_CONTROLLER_URL="http://agentteams-controller:8090"
    fi
  fi

  local ctrl_container=""
  if ${DOCKER_CMD} ps --format '{{.Names}}' | grep -qx "agentteams-controller"; then
    ctrl_container="agentteams-controller"
  else
    ctrl_container=$(echo "${AGENTTEAMS_CONTROLLER_URL}" | sed -n 's|^http://\([^/:]*\).*|\1|p')
  fi

  if [ -z "${ctrl_container}" ]; then
    warn "Could not derive controller container name from ${AGENTTEAMS_CONTROLLER_URL}"
    return
  fi

  if ! ${DOCKER_CMD} ps --format '{{.Names}}' | grep -qx "${ctrl_container}"; then
    warn "Controller container '${ctrl_container}' not running — cannot auto-detect MinIO/LLM credentials"
    return
  fi

  info "Detecting runtime environment from ${ctrl_container}..."
  local env_out
  env_out=$(${DOCKER_CMD} inspect "${ctrl_container}" --format='{{range .Config.Env}}{{.}}{{"\n"}}{{end}}')

  AGENTTEAMS_FS_BUCKET=$(echo "${env_out}" | sed -n 's/^AGENTTEAMS_FS_BUCKET=//p')
  [ -z "${AGENTTEAMS_FS_BUCKET}" ] && AGENTTEAMS_FS_BUCKET=$(echo "${env_out}" | sed -n 's/^AGENTTEAMS_MINIO_BUCKET=//p')

  AGENTTEAMS_FS_ACCESS_KEY=$(echo "${env_out}" | sed -n 's/^AGENTTEAMS_FS_ACCESS_KEY=//p')
  [ -z "${AGENTTEAMS_FS_ACCESS_KEY}" ] && AGENTTEAMS_FS_ACCESS_KEY=$(echo "${env_out}" | sed -n 's/^AGENTTEAMS_MINIO_USER=//p')

  AGENTTEAMS_FS_SECRET_KEY=$(echo "${env_out}" | sed -n 's/^AGENTTEAMS_FS_SECRET_KEY=//p')
  [ -z "${AGENTTEAMS_FS_SECRET_KEY}" ] && AGENTTEAMS_FS_SECRET_KEY=$(echo "${env_out}" | sed -n 's/^AGENTTEAMS_MINIO_PASSWORD=//p')

  local fs_endpoint
  fs_endpoint=$(echo "${env_out}" | sed -n 's/^AGENTTEAMS_FS_ENDPOINT=//p')
  [ -z "${fs_endpoint}" ] && fs_endpoint=$(echo "${env_out}" | sed -n 's/^AGENTTEAMS_MINIO_ENDPOINT=//p')
  if [ -n "${fs_endpoint}" ]; then
    # Controller often advertises MinIO as 127.0.0.1, but Dashboard runs in a different container.
    AGENTTEAMS_FS_ENDPOINT=$(echo "${fs_endpoint}" | sed -e "s|127\\.0\\.0\\.1|${ctrl_container}|" -e "s|localhost|${ctrl_container}|")
  else
    AGENTTEAMS_FS_ENDPOINT="http://${ctrl_container}:9000"
  fi

  AGENTTEAMS_LLM_PROVIDER=$(echo "${env_out}" | sed -n 's/^AGENTTEAMS_LLM_PROVIDER=//p')
  AGENTTEAMS_LLM_API_KEY=$(echo "${env_out}" | sed -n 's/^AGENTTEAMS_LLM_API_KEY=//p')
  AGENTTEAMS_OPENAI_BASE_URL=$(echo "${env_out}" | sed -n 's/^AGENTTEAMS_OPENAI_BASE_URL=//p')
  AGENTTEAMS_DEFAULT_MODEL=$(echo "${env_out}" | sed -n 's/^AGENTTEAMS_DEFAULT_MODEL=//p')

  # The controller writes the CLI token to /var/run/hiclaw/cli-token.
  AGENTTEAMS_AUTH_TOKEN=$(${DOCKER_CMD} exec "${ctrl_container}" sh -c 'cat /var/run/hiclaw/cli-token 2>/dev/null' | tr -d '\n' || true)

  # Admin credentials are set on the controller container by the AgentTeams
  # installer; the dashboard needs them for the Higress ensure-ai bootstrap.
  AGENTTEAMS_ADMIN_USER=$(echo "${env_out}" | sed -n 's/^AGENTTEAMS_ADMIN_USER=//p')
  AGENTTEAMS_ADMIN_PASSWORD=$(echo "${env_out}" | sed -n 's/^AGENTTEAMS_ADMIN_PASSWORD=//p')

  # Always use the internal Docker-network Higress Console URL; a host IP saved
  # in an old env file is often unreachable from inside the dashboard container.
  if ${DOCKER_CMD} exec "${ctrl_container}" wget -q -O- --timeout=2 http://127.0.0.1:8001/ >/dev/null 2>&1; then
    AGENTTEAMS_AI_GATEWAY_ADMIN_URL="http://${ctrl_container}:8001"
  fi

  if [ -z "${AGENTTEAMS_AUTH_TOKEN}" ]; then
    warn "Could not read controller auth token (cli-token) from ${ctrl_container}."
    warn "Dashboard API calls will be UNAUTHENTICATED — workers/teams/rooms will appear empty."
  fi
  if [ -z "${AGENTTEAMS_FS_ACCESS_KEY}" ] || [ -z "${AGENTTEAMS_FS_SECRET_KEY}" ]; then
    warn "Could not auto-detect MinIO credentials from ${ctrl_container}"
  fi
  if [ -z "${AGENTTEAMS_LLM_API_KEY}" ]; then
    warn "Could not auto-detect LLM API key from ${ctrl_container}"
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

  # Auto-detect MinIO / LLM / auth from the controller container
  detect_runtime_env

  # Build environment argument list
  local env_args=()
  env_args+=(-e AGENTTEAMS_CONTROLLER_URL="${AGENTTEAMS_CONTROLLER_URL}")
  env_args+=(-e NEXT_PUBLIC_MATRIX_API_URL="${NEXT_PUBLIC_MATRIX_API_URL}")
  env_args+=(-e AGENTTEAMS_AI_GATEWAY_ADMIN_URL="${AGENTTEAMS_AI_GATEWAY_ADMIN_URL:-}")
  env_args+=(-e MATRIX_HOMESERVER_ALLOWLIST="agentteams-controller,matrix-local.agentteams.io,matrix.org")
  env_args+=(-e DATABASE_URL="file:/app/db/dashboard.db")
  [ -n "${AGENTTEAMS_AUTH_TOKEN:-}" ] && env_args+=(-e AGENTTEAMS_AUTH_TOKEN="${AGENTTEAMS_AUTH_TOKEN}")
  [ -n "${AGENTTEAMS_ADMIN_USER:-}" ] && env_args+=(-e AGENTTEAMS_ADMIN_USER="${AGENTTEAMS_ADMIN_USER}")
  [ -n "${AGENTTEAMS_ADMIN_PASSWORD:-}" ] && env_args+=(-e AGENTTEAMS_ADMIN_PASSWORD="${AGENTTEAMS_ADMIN_PASSWORD}")
  [ -n "${AGENTTEAMS_FS_ENDPOINT:-}" ] && env_args+=(-e AGENTTEAMS_FS_ENDPOINT="${AGENTTEAMS_FS_ENDPOINT}")
  [ -n "${AGENTTEAMS_FS_ACCESS_KEY:-}" ] && env_args+=(-e AGENTTEAMS_FS_ACCESS_KEY="${AGENTTEAMS_FS_ACCESS_KEY}")
  [ -n "${AGENTTEAMS_FS_SECRET_KEY:-}" ] && env_args+=(-e AGENTTEAMS_FS_SECRET_KEY="${AGENTTEAMS_FS_SECRET_KEY}")
  [ -n "${AGENTTEAMS_FS_BUCKET:-}" ] && env_args+=(-e AGENTTEAMS_FS_BUCKET="${AGENTTEAMS_FS_BUCKET}")
  [ -n "${AGENTTEAMS_LLM_PROVIDER:-}" ] && env_args+=(-e AGENTTEAMS_LLM_PROVIDER="${AGENTTEAMS_LLM_PROVIDER}")
  [ -n "${AGENTTEAMS_LLM_API_KEY:-}" ] && env_args+=(-e AGENTTEAMS_LLM_API_KEY="${AGENTTEAMS_LLM_API_KEY}")
  [ -n "${AGENTTEAMS_OPENAI_BASE_URL:-}" ] && env_args+=(-e AGENTTEAMS_OPENAI_BASE_URL="${AGENTTEAMS_OPENAI_BASE_URL}")
  [ -n "${AGENTTEAMS_DEFAULT_MODEL:-}" ] && env_args+=(-e AGENTTEAMS_DEFAULT_MODEL="${AGENTTEAMS_DEFAULT_MODEL}")

  # Persist the latest detected values
  save_env

  # Start container
  info "Starting ${CONTAINER_NAME}..."
  ${DOCKER_CMD} run -d \
    --name "${CONTAINER_NAME}" \
    --restart unless-stopped \
    --network "${NETWORK_NAME}" \
    -p "${_port_prefix}${AGENTTEAMS_PORT_DASHBOARD}:3000" \
    "${env_args[@]}" \
    -v "${DATA_VOLUME}:/app/db" \
    "${AGENTTEAMS_DASHBOARD_IMAGE}"

  # Wait for readiness
  info "Waiting for Dashboard to become ready..."
  local max_wait=60 elapsed=0
  while [ ${elapsed} -lt ${max_wait} ]; do
    if curl -sf "http://127.0.0.1:${AGENTTEAMS_PORT_DASHBOARD}/" >/dev/null 2>&1; then
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
  echo -e "${GREEN}  AgentTeams-Dashboard ${1:-installed} successfully!${NC}"
  echo -e "${GREEN}========================================${NC}"
  echo ""
  local bind_host="0.0.0.0"
  [ "${AGENTTEAMS_LOCAL_ONLY:-0}" = "1" ] && bind_host="127.0.0.1"
  echo -e "  Access: ${CYAN}http://${bind_host}:${AGENTTEAMS_PORT_DASHBOARD}/${NC}"
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
  info "  Port:        ${AGENTTEAMS_PORT_DASHBOARD}"
  info "  Image:       ${AGENTTEAMS_DASHBOARD_IMAGE}"
  info "  Controller:  ${AGENTTEAMS_CONTROLLER_URL}"
  info "  Matrix:      ${NEXT_PUBLIC_MATRIX_API_URL}"
  info "  Higress:     ${AGENTTEAMS_AI_GATEWAY_ADMIN_URL:-<not configured>}"
  info "  MinIO:       ${AGENTTEAMS_FS_ENDPOINT:-<not configured>} (bucket: ${AGENTTEAMS_FS_BUCKET:-<unknown>})"
  info "  LLM:         ${AGENTTEAMS_LLM_PROVIDER:-<unknown>} / ${AGENTTEAMS_DEFAULT_MODEL:-<unknown>}"
  info "  LAN access:  $([ "${AGENTTEAMS_LOCAL_ONLY:-0}" = "1" ] && echo 'disabled (127.0.0.1 only)' || echo 'enabled (0.0.0.0)')"
  echo ""

  save_env
  ensure_image "${AGENTTEAMS_DASHBOARD_IMAGE}"
  recreate_container
  print_success "installed"
}

# ---------- update (upgrade existing) ----------
do_update() {
  preflight
  load_env

  echo ""
  info "Updating AgentTeams-Dashboard..."
  info "  Port:        ${AGENTTEAMS_PORT_DASHBOARD}"
  info "  Image:       ${AGENTTEAMS_DASHBOARD_IMAGE}"
  info "  Controller:  ${AGENTTEAMS_CONTROLLER_URL}"
  info "  MinIO:       ${AGENTTEAMS_FS_ENDPOINT:-<not configured>} (bucket: ${AGENTTEAMS_FS_BUCKET:-<unknown>})"
  info "  LLM:         ${AGENTTEAMS_LLM_PROVIDER:-<unknown>} / ${AGENTTEAMS_DEFAULT_MODEL:-<unknown>}"
  echo ""

  # Pull latest image (force re-pull to get updates)
  info "Pulling latest image ${AGENTTEAMS_DASHBOARD_IMAGE}..."
  ${DOCKER_CMD} pull "${AGENTTEAMS_DASHBOARD_IMAGE}" || {
    warn "Pull failed — attempting to rebuild from source..."
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [ -f "${script_dir}/../Dockerfile" ]; then
      ${DOCKER_CMD} build \
        --no-cache \
        --build-arg NEXT_PUBLIC_BASE_PATH="" \
        -t "${AGENTTEAMS_DASHBOARD_IMAGE}" "${script_dir}/.."
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

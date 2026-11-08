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
DEFAULT_DASHBOARD_VERSION="v1.4.0"
# Must match the Makefile image coordinates (REGISTRY/REPO/name).
DEFAULT_REGISTRY="higress-registry.cn-hangzhou.cr.aliyuncs.com"
DEFAULT_IMAGE="${DEFAULT_REGISTRY}/agentteams/agentteams-dashboard:${DEFAULT_DASHBOARD_VERSION}"
DATA_VOLUME="agentteams-dashboard-data"
DATA_MOUNT="/data/agentteams-dashboard"
CONFIG_FILE="${DATA_MOUNT}/config.json"
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

# Normalize the Console URL and union its host into the SSRF allowlist.
# Must run after ADMIN_URL is resolved. Union, never replace.
_dashboard_merge_console_host() {
  if [ -z "${AGENTTEAMS_AI_GATEWAY_ADMIN_URL:-}" ]; then
    return 0
  fi
  case "${AGENTTEAMS_AI_GATEWAY_ADMIN_URL}" in
    http://*|https://*) ;;
    *) AGENTTEAMS_AI_GATEWAY_ADMIN_URL="http://${AGENTTEAMS_AI_GATEWAY_ADMIN_URL}" ;;
  esac
  local _gw_host
  _gw_host="$(printf '%s' "${AGENTTEAMS_AI_GATEWAY_ADMIN_URL}" | sed -E 's#^https?://##; s#/.*$##; s#:\[([0-9a-fA-F:]+)\]$#:\1#; s#:[0-9]+$##')"
  if [ -z "${_gw_host}" ]; then
    return 0
  fi
  case ",${AGENTTEAMS_AI_GATEWAY_ADMIN_ALLOWED_HOSTS:-}," in
    *,${_gw_host},*) ;;
    *)
      if [ -n "${AGENTTEAMS_AI_GATEWAY_ADMIN_ALLOWED_HOSTS:-}" ]; then
        AGENTTEAMS_AI_GATEWAY_ADMIN_ALLOWED_HOSTS="${AGENTTEAMS_AI_GATEWAY_ADMIN_ALLOWED_HOSTS},${_gw_host}"
      else
        AGENTTEAMS_AI_GATEWAY_ADMIN_ALLOWED_HOSTS="${_gw_host}"
      fi
      info "Console host '${_gw_host}' added to AGENTTEAMS_AI_GATEWAY_ADMIN_ALLOWED_HOSTS (required by the Dashboard login allowlist)"
      ;;
  esac
}

_dashboard_image_ids() {
  local _user
  _user=$(${DOCKER_CMD} image inspect "${AGENTTEAMS_DASHBOARD_IMAGE}" --format '{{.Config.User}}' 2>/dev/null || true)
  _user=$(printf '%s' "${_user}" | tr -d '\r')
  case "${_user}" in
    ""|nextjs|nextjs:nodejs) echo "1001:1001"; return 0 ;;
    [0-9]*:[0-9]*) echo "${_user}"; return 0 ;;
    [0-9]*) echo "${_user}:${_user}"; return 0 ;;
  esac
  local _uid _gid
  _uid=$(${DOCKER_CMD} run --rm --entrypoint id "${AGENTTEAMS_DASHBOARD_IMAGE}" -u 2>/dev/null || true)
  _gid=$(${DOCKER_CMD} run --rm --entrypoint id "${AGENTTEAMS_DASHBOARD_IMAGE}" -g 2>/dev/null || true)
  _uid=$(printf '%s' "${_uid}" | tr -d '[:space:]')
  _gid=$(printf '%s' "${_gid}" | tr -d '[:space:]')
  if [ -n "${_uid}" ] && [ -n "${_gid}" ]; then
    echo "${_uid}:${_gid}"
    return 0
  fi
  echo "1001:1001"
}

# Copy src_dir from a (possibly stopped) container onto the host.
# Sets the 4th flag file only after every required copy succeeded.
_dashboard_export_dir() {
  local _container="$1" _src="$2" _dest="$3" _exists_flag="$4"
  rm -f "${_exists_flag}" 2>/dev/null || true
  mkdir -p "${_dest}" || return 1
  if ${DOCKER_CMD} cp "${_container}:${_src}/." "${_dest}/" >/dev/null 2>&1; then
    : > "${_exists_flag}"
    return 0
  fi
  local _parent
  _parent=$(mktemp -d "${TMPDIR:-/tmp}/agentteams-dashboard-cp.XXXXXX") || return 1
  local _rc=1
  if ${DOCKER_CMD} cp "${_container}:${_src}" "${_parent}/" >/dev/null 2>&1; then
    local _copied
    _copied=$(ls -A "${_parent}" 2>/dev/null | head -1)
    if [ -n "${_copied}" ] && [ -d "${_parent}/${_copied}" ]; then
      if cp -a "${_parent}/${_copied}/." "${_dest}/" 2>/dev/null; then
        : > "${_exists_flag}"
        _rc=0
      fi
    fi
  fi
  rm -rf "${_parent}" 2>/dev/null || true
  return "${_rc}"
}

# Exit 0 = present, 1 = confirmed absent, 2 = unknown.
_dashboard_path_present() {
  local _container="$1" _src="$2"
  local _diff_ok=0 _mount_ok=0
  local _diff_out _mount_out
  if _diff_out=$(${DOCKER_CMD} diff "${_container}" 2>/dev/null); then
    _diff_ok=1
    if printf '%s\n' "${_diff_out}" | grep -F "${_src}" >/dev/null; then
      return 0
    fi
  fi
  if _mount_out=$(${DOCKER_CMD} inspect "${_container}" --format '{{range .Mounts}}{{.Destination}}{{"\n"}}{{end}}' 2>/dev/null); then
    _mount_ok=1
    local _dest
    while IFS= read -r _dest; do
      [ -z "${_dest}" ] && continue
      case "${_src}/" in
        "${_dest}/"*) return 0 ;;
      esac
    done < <(printf '%s\n' "${_mount_out}")
  fi
  if [ "${_diff_ok}" = "1" ] && [ "${_mount_ok}" = "1" ]; then
    return 1
  fi
  return 2
}

save_env() {
  # Write to temp file first, then atomically rename, and enforce owner-only permissions.
  #
  # f8-4: every value is written as a single-quoted literal (inner ' escaped as
  # '\'') so the `source`-based load_env can never break on spaces, $, backticks
  # or quotes: a bare value like `p@ss word $x` used to expand during sourcing
  # and abort update under set -euo pipefail ("command not found").
  local _tmp
  local _v_port _v_dashboard_version _v_dashboard_image _v_controller_url _v_matrix_url \
        _v_adapter_mode _v_gateway_url _v_gateway_admin_url _v_gateway_hosts _v_local_only \
        _v_fs_endpoint _v_fs_access _v_fs_secret _v_fs_bucket _v_llm_provider _v_llm_key \
        _v_llm_base _v_llm_model _v_auth_token _v_admin_user _v_admin_pw _v_session_secret \
        _v_config_file _v_deployment_mode
  _tmp="$(mktemp "${ENV_FILE}.XXXXXX")"
  _v_port=$(printf "'%s'" "$(printf "%s" "${AGENTTEAMS_PORT_DASHBOARD:-}" | sed "s/'/'\\\\''/g")")
  _v_dashboard_version=$(printf "'%s'" "$(printf "%s" "${AGENTTEAMS_DASHBOARD_VERSION:-}" | sed "s/'/'\\\\''/g")")
  _v_dashboard_image=$(printf "'%s'" "$(printf "%s" "${AGENTTEAMS_DASHBOARD_IMAGE:-}" | sed "s/'/'\\\\''/g")")
  _v_controller_url=$(printf "'%s'" "$(printf "%s" "${AGENTTEAMS_CONTROLLER_URL:-}" | sed "s/'/'\\\\''/g")")
  _v_matrix_url=$(printf "'%s'" "$(printf "%s" "${NEXT_PUBLIC_MATRIX_API_URL:-}" | sed "s/'/'\\\\''/g")")
  _v_adapter_mode=$(printf "'%s'" "$(printf "%s" "${AGENTTEAMS_HIGRESS_ADAPTER_MODE:-direct}" | sed "s/'/'\\\\''/g")")
  _v_gateway_url=$(printf "'%s'" "$(printf "%s" "${AGENTTEAMS_AI_GATEWAY_URL:-}" | sed "s/'/'\\\\''/g")")
  _v_gateway_admin_url=$(printf "'%s'" "$(printf "%s" "${AGENTTEAMS_AI_GATEWAY_ADMIN_URL:-}" | sed "s/'/'\\\\''/g")")
  _v_gateway_hosts=$(printf "'%s'" "$(printf "%s" "${AGENTTEAMS_AI_GATEWAY_ADMIN_ALLOWED_HOSTS:-}" | sed "s/'/'\\\\''/g")")
  _v_local_only=$(printf "'%s'" "$(printf "%s" "${AGENTTEAMS_LOCAL_ONLY:-1}" | sed "s/'/'\\\\''/g")")
  _v_fs_endpoint=$(printf "'%s'" "$(printf "%s" "${AGENTTEAMS_FS_ENDPOINT:-}" | sed "s/'/'\\\\''/g")")
  _v_fs_access=$(printf "'%s'" "$(printf "%s" "${AGENTTEAMS_FS_ACCESS_KEY:-}" | sed "s/'/'\\\\''/g")")
  _v_fs_secret=$(printf "'%s'" "$(printf "%s" "${AGENTTEAMS_FS_SECRET_KEY:-}" | sed "s/'/'\\\\''/g")")
  _v_fs_bucket=$(printf "'%s'" "$(printf "%s" "${AGENTTEAMS_FS_BUCKET:-}" | sed "s/'/'\\\\''/g")")
  _v_llm_provider=$(printf "'%s'" "$(printf "%s" "${AGENTTEAMS_LLM_PROVIDER:-}" | sed "s/'/'\\\\''/g")")
  _v_llm_key=$(printf "'%s'" "$(printf "%s" "${AGENTTEAMS_LLM_API_KEY:-}" | sed "s/'/'\\\\''/g")")
  _v_llm_base=$(printf "'%s'" "$(printf "%s" "${AGENTTEAMS_OPENAI_BASE_URL:-}" | sed "s/'/'\\\\''/g")")
  _v_llm_model=$(printf "'%s'" "$(printf "%s" "${AGENTTEAMS_DEFAULT_MODEL:-}" | sed "s/'/'\\\\''/g")")
  _v_auth_token=$(printf "'%s'" "$(printf "%s" "${AGENTTEAMS_AUTH_TOKEN:-}" | sed "s/'/'\\\\''/g")")
  _v_admin_user=$(printf "'%s'" "$(printf "%s" "${AGENTTEAMS_ADMIN_USER:-}" | sed "s/'/'\\\\''/g")")
  _v_admin_pw=$(printf "'%s'" "$(printf "%s" "${AGENTTEAMS_ADMIN_PASSWORD:-}" | sed "s/'/'\\\\''/g")")
  _v_session_secret=$(printf "'%s'" "$(printf "%s" "${DASHBOARD_SESSION_SECRET:-}" | sed "s/'/'\\\\''/g")")
  _v_config_file=$(printf "'%s'" "$(printf "%s" "${DASHBOARD_CONFIG_FILE:-${CONFIG_FILE}}" | sed "s/'/'\\\\''/g")")
  _v_deployment_mode=$(printf "'%s'" "$(printf "%s" "${AGENTTEAMS_DEPLOYMENT_MODE:-}" | sed "s/'/'\\\\''/g")")
  cat > "${_tmp}" <<EOF
AGENTTEAMS_PORT_DASHBOARD=${_v_port}
AGENTTEAMS_DASHBOARD_VERSION=${_v_dashboard_version}
AGENTTEAMS_DASHBOARD_IMAGE=${_v_dashboard_image}
AGENTTEAMS_CONTROLLER_URL=${_v_controller_url}
NEXT_PUBLIC_MATRIX_API_URL=${_v_matrix_url}
AGENTTEAMS_HIGRESS_ADAPTER_MODE=${_v_adapter_mode}
AGENTTEAMS_AI_GATEWAY_URL=${_v_gateway_url}
AGENTTEAMS_AI_GATEWAY_ADMIN_URL=${_v_gateway_admin_url}
AGENTTEAMS_AI_GATEWAY_ADMIN_ALLOWED_HOSTS=${_v_gateway_hosts}
AGENTTEAMS_LOCAL_ONLY=${_v_local_only}
AGENTTEAMS_FS_ENDPOINT=${_v_fs_endpoint}
AGENTTEAMS_FS_ACCESS_KEY=${_v_fs_access}
AGENTTEAMS_FS_SECRET_KEY=${_v_fs_secret}
AGENTTEAMS_FS_BUCKET=${_v_fs_bucket}
AGENTTEAMS_LLM_PROVIDER=${_v_llm_provider}
AGENTTEAMS_LLM_API_KEY=${_v_llm_key}
AGENTTEAMS_OPENAI_BASE_URL=${_v_llm_base}
AGENTTEAMS_DEFAULT_MODEL=${_v_llm_model}
AGENTTEAMS_AUTH_TOKEN=${_v_auth_token}
AGENTTEAMS_ADMIN_USER=${_v_admin_user}
AGENTTEAMS_ADMIN_PASSWORD=${_v_admin_pw}
DASHBOARD_SESSION_SECRET=${_v_session_secret}
DASHBOARD_CONFIG_FILE=${_v_config_file}
AGENTTEAMS_DEPLOYMENT_MODE=${_v_deployment_mode}
EOF
  chmod 600 "${_tmp}"
  mv -f "${_tmp}" "${ENV_FILE}"
  ok "Configuration saved to ${ENV_FILE} (mode 600)"
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
  AGENTTEAMS_DASHBOARD_VERSION="${AGENTTEAMS_DASHBOARD_VERSION:-${DEFAULT_DASHBOARD_VERSION}}"
  AGENTTEAMS_DASHBOARD_IMAGE="${AGENTTEAMS_DASHBOARD_IMAGE:-${DEFAULT_IMAGE}}"
  AGENTTEAMS_CONTROLLER_URL="${AGENTTEAMS_CONTROLLER_URL:-http://agentteams-controller:8090}"
  NEXT_PUBLIC_MATRIX_API_URL="${NEXT_PUBLIC_MATRIX_API_URL:-http://agentteams-controller:6167}"
  AGENTTEAMS_HIGRESS_ADAPTER_MODE="${AGENTTEAMS_HIGRESS_ADAPTER_MODE:-direct}"
  AGENTTEAMS_AI_GATEWAY_URL="${AGENTTEAMS_AI_GATEWAY_URL:-}"
  AGENTTEAMS_AI_GATEWAY_ADMIN_URL="${AGENTTEAMS_AI_GATEWAY_ADMIN_URL:-}"
  AGENTTEAMS_AI_GATEWAY_ADMIN_ALLOWED_HOSTS="${AGENTTEAMS_AI_GATEWAY_ADMIN_ALLOWED_HOSTS:-}"
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
DASHBOARD_SESSION_SECRET="${DASHBOARD_SESSION_SECRET:-}"
DASHBOARD_CONFIG_FILE="${DASHBOARD_CONFIG_FILE:-${CONFIG_FILE}}"
AGENTTEAMS_DEPLOYMENT_MODE="${AGENTTEAMS_DEPLOYMENT_MODE:-}"
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

  AGENTTEAMS_DASHBOARD_VERSION="${AGENTTEAMS_DASHBOARD_VERSION:-${DEFAULT_DASHBOARD_VERSION}}"
  prompt_value AGENTTEAMS_DASHBOARD_VERSION "Dashboard version" "${DEFAULT_DASHBOARD_VERSION}"

  # Derive default image from version if not explicitly set
  if [ -z "${AGENTTEAMS_DASHBOARD_IMAGE:-}" ]; then
    AGENTTEAMS_DASHBOARD_IMAGE="${DEFAULT_REGISTRY}/agentteams/agentteams-dashboard:${AGENTTEAMS_DASHBOARD_VERSION}"
  fi
  prompt_value AGENTTEAMS_PORT_DASHBOARD "Dashboard port" "${DEFAULT_PORT}"
  prompt_value AGENTTEAMS_DASHBOARD_IMAGE "Dashboard Docker image" "${AGENTTEAMS_DASHBOARD_IMAGE}"

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

  # Multi-user session secret (M19): generated once and persisted so container
  # rebuilds keep the same secret (a changed secret invalidates all sessions).
  if [ -z "${DASHBOARD_SESSION_SECRET:-}" ]; then
    DASHBOARD_SESSION_SECRET="$(openssl rand -hex 32)"
  fi
  info "DASHBOARD_SESSION_SECRET ready (persisted in ${ENV_FILE}, mode 600)."

  # Detect Higress Console URL from running container (for shared auth with Higress)
  # Use internal Docker network URL (container:port) — works for dashboard on the same network.
  local higress_url=""
  if [ "${AGENTTEAMS_HIGRESS_ADAPTER_MODE:-direct}" != "external" ]; then
    for _ctr in "agentteams-controller" "higress-console" "higress"; do
      if ${DOCKER_CMD} ps --format '{{.Names}}' | grep -q "^${_ctr}$"; then
        # Prefer internal port 8001 (Higress Console API)
        if ${DOCKER_CMD} exec "${_ctr}" wget -q -O- --timeout=2 http://127.0.0.1:8001/ >/dev/null 2>&1; then
          higress_url="http://${_ctr}:8001"
          break
        fi
      fi
    done
  fi
  prompt_value AGENTTEAMS_AI_GATEWAY_ADMIN_URL "Higress Console URL (for shared login)" "${higress_url}"

  # Embedded deployment marker: when the controller container lives on the
  # agentteams-net alongside the dashboard, set the deployment mode so the
  # process picks embedded defaults on first boot (F-1 / F-3). Only set when
  # the operator hasn't overridden it via AGENTTEAMS_DEPLOYMENT_MODE.
  if [ -z "${AGENTTEAMS_DEPLOYMENT_MODE:-}" ]; then
    if ${DOCKER_CMD} ps --format '{{.Names}}' | grep -q "^agentteams-controller$"; then
      if ${DOCKER_CMD} network inspect "${NETWORK_NAME}" >/dev/null 2>&1 \
         && ${DOCKER_CMD} exec agentteams-controller wget -q -O- --timeout=2 http://127.0.0.1:8090/healthz >/dev/null 2>&1; then
        AGENTTEAMS_DEPLOYMENT_MODE="embedded"
      fi
    fi
    [ -z "${AGENTTEAMS_DEPLOYMENT_MODE:-}" ] && AGENTTEAMS_DEPLOYMENT_MODE="external"
  fi
  info "AGENTTEAMS_DEPLOYMENT_MODE=${AGENTTEAMS_DEPLOYMENT_MODE}"
  _dashboard_merge_console_host
}

# ---------- local-only binding ----------
resolve_port_prefix() {
  _port_prefix=""
  # f8-5: LOCAL_ONLY defaults to 1 (localhost-only), matching save_env/load_env
  # and the upstream installer (_start_dashboard, agentteams-install.sh).
  if [ "${AGENTTEAMS_LOCAL_ONLY:-1}" = "1" ]; then
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

  # Credential detection chain (A7/B-C1): AGENTTEAMS_FS_* is the canonical
  # namespace, AGENTTEAMS_MINIO_* the long-standing alias, RUSTFS_* the
  # fallback for controllers that switched storage backends without keeping
  # the older exports (see tasklist B-C1 / AGENTTEAMS_PATCH.md).
  AGENTTEAMS_FS_BUCKET=$(echo "${env_out}" | sed -n 's/^AGENTTEAMS_FS_BUCKET=//p')
  [ -z "${AGENTTEAMS_FS_BUCKET}" ] && AGENTTEAMS_FS_BUCKET=$(echo "${env_out}" | sed -n 's/^AGENTTEAMS_MINIO_BUCKET=//p')
  [ -z "${AGENTTEAMS_FS_BUCKET}" ] && AGENTTEAMS_FS_BUCKET=$(echo "${env_out}" | sed -n 's/^RUSTFS_BUCKET=//p')

  AGENTTEAMS_FS_ACCESS_KEY=$(echo "${env_out}" | sed -n 's/^AGENTTEAMS_FS_ACCESS_KEY=//p')
  [ -z "${AGENTTEAMS_FS_ACCESS_KEY}" ] && AGENTTEAMS_FS_ACCESS_KEY=$(echo "${env_out}" | sed -n 's/^AGENTTEAMS_MINIO_USER=//p')
  [ -z "${AGENTTEAMS_FS_ACCESS_KEY}" ] && AGENTTEAMS_FS_ACCESS_KEY=$(echo "${env_out}" | sed -n 's/^RUSTFS_ACCESS_KEY=//p')

  AGENTTEAMS_FS_SECRET_KEY=$(echo "${env_out}" | sed -n 's/^AGENTTEAMS_FS_SECRET_KEY=//p')
  [ -z "${AGENTTEAMS_FS_SECRET_KEY}" ] && AGENTTEAMS_FS_SECRET_KEY=$(echo "${env_out}" | sed -n 's/^AGENTTEAMS_MINIO_PASSWORD=//p')
  [ -z "${AGENTTEAMS_FS_SECRET_KEY}" ] && AGENTTEAMS_FS_SECRET_KEY=$(echo "${env_out}" | sed -n 's/^RUSTFS_SECRET_KEY=//p')

  local fs_endpoint
  fs_endpoint=$(echo "${env_out}" | sed -n 's/^AGENTTEAMS_FS_ENDPOINT=//p')
  [ -z "${fs_endpoint}" ] && fs_endpoint=$(echo "${env_out}" | sed -n 's/^AGENTTEAMS_MINIO_ENDPOINT=//p')
  [ -z "${fs_endpoint}" ] && fs_endpoint=$(echo "${env_out}" | sed -n 's/^RUSTFS_ENDPOINT=//p')
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

  # The controller writes the CLI SA token to /var/run/agentteams/cli-token.
  # The token is generated asynchronously during the first reconcile loop,
  # so it may not be available immediately after the container starts.
  # We poll for up to 30s to handle both fresh installs (token not yet minted)
  # and older images that don't support cli-token at all.
  # For backward compatibility, also try the legacy /var/run/hiclaw/cli-token
  # path used by older HiClaw images.
  local _token_wait=0
  local _token_max_wait=30
  while [ ${_token_wait} -lt ${_token_max_wait} ]; do
    AGENTTEAMS_AUTH_TOKEN=$(${DOCKER_CMD} exec "${ctrl_container}" sh -c 'cat /var/run/agentteams/cli-token 2>/dev/null || cat /var/run/hiclaw/cli-token 2>/dev/null' | tr -d '\n' || true)
    if [ -n "${AGENTTEAMS_AUTH_TOKEN}" ]; then
      break
    fi
    sleep 2
    _token_wait=$((_token_wait + 2))
  done

  # Admin credentials are set on the controller container by the AgentTeams
  # installer; the dashboard needs them for the Higress ensure-ai bootstrap.
  AGENTTEAMS_ADMIN_USER=$(echo "${env_out}" | sed -n 's/^AGENTTEAMS_ADMIN_USER=//p')
  AGENTTEAMS_ADMIN_PASSWORD=$(echo "${env_out}" | sed -n 's/^AGENTTEAMS_ADMIN_PASSWORD=//p')

  # Higress Console URL: explicit config takes priority, auto-detect as fallback.
  if [ "${AGENTTEAMS_HIGRESS_ADAPTER_MODE:-direct}" != "external" ] && [ -z "${AGENTTEAMS_AI_GATEWAY_ADMIN_URL:-}" ]; then
    if ${DOCKER_CMD} exec "${ctrl_container}" wget -q -O- --timeout=2 http://127.0.0.1:8001/ >/dev/null 2>&1; then
      AGENTTEAMS_AI_GATEWAY_ADMIN_URL="http://${ctrl_container}:8001"
    fi
  elif [ -n "${AGENTTEAMS_AI_GATEWAY_ADMIN_URL:-}" ]; then
    # Normalize URL: add http:// prefix if missing
    case "${AGENTTEAMS_AI_GATEWAY_ADMIN_URL}" in
      http://*|https://*) ;;
      *) AGENTTEAMS_AI_GATEWAY_ADMIN_URL="http://${AGENTTEAMS_AI_GATEWAY_ADMIN_URL}" ;;
    esac
  fi

  _dashboard_merge_console_host

  if [ -z "${AGENTTEAMS_AUTH_TOKEN}" ]; then
    warn "Could not read controller auth token (cli-token) from ${ctrl_container} (timed out after ${_token_max_wait}s)."
    warn "  This can happen with older AgentTeams/HiClaw images or if the controller is still starting."
    warn "  Dashboard will still work but some API calls may fail until you log in via Higress Console."
    warn "  To fix: upgrade AgentTeams to v1.2.0-beta.1+ or set AGENTTEAMS_AUTH_TOKEN manually."
  fi
  if [ -z "${AGENTTEAMS_FS_ACCESS_KEY}" ] || [ -z "${AGENTTEAMS_FS_SECRET_KEY}" ]; then
    warn "Could not auto-detect storage credentials from ${ctrl_container}"
    warn "  Detection chain tried: AGENTTEAMS_FS_* -> AGENTTEAMS_MINIO_* -> RUSTFS_*"
    warn "  Set AGENTTEAMS_FS_ENDPOINT / AGENTTEAMS_FS_ACCESS_KEY / AGENTTEAMS_FS_SECRET_KEY manually to fix."
  fi
  if [ -z "${AGENTTEAMS_LLM_API_KEY}" ]; then
    warn "Could not auto-detect LLM API key from ${ctrl_container}"
  fi

  # Verify Higress Console URL reachability (best-effort warning)
  if [ -n "${AGENTTEAMS_AI_GATEWAY_ADMIN_URL:-}" ]; then
    local _gw_reachable=0
    if echo "${AGENTTEAMS_AI_GATEWAY_ADMIN_URL}" | grep -qE "(agentteams-controller|hiclaw-controller|127\.0\.0\.1|localhost)"; then
      if ${DOCKER_CMD} exec "${ctrl_container}" curl -sf --max-time 3 "${AGENTTEAMS_AI_GATEWAY_ADMIN_URL}/" >/dev/null 2>&1; then
        _gw_reachable=1
      fi
    else
      if curl -sf --max-time 3 "${AGENTTEAMS_AI_GATEWAY_ADMIN_URL}/" >/dev/null 2>&1; then
        _gw_reachable=1
      fi
    fi
    if [ "${_gw_reachable}" = "0" ]; then
      warn "Higress Console URL may not be reachable: ${AGENTTEAMS_AI_GATEWAY_ADMIN_URL}"
      warn "  Dashboard will still work, but shared login via Higress Console may fail."
      warn "  To fix: verify the URL is correct and the Higress Console service is running."
    fi
  fi
}

# ---------- recreate container ----------
recreate_container() {
  resolve_port_prefix

  # Remember whether an old container exists so we can export its writable
  # layer before removal. Do not rm yet.
  local _old_dashboard_present=0
  if ${DOCKER_CMD} ps -a --format '{{.Names}}' | grep -qx "${CONTAINER_NAME}"; then
    _old_dashboard_present=1
  fi

  # Auto-detect MinIO / LLM / auth from the controller container
  detect_runtime_env
  # detect_runtime_env returns early when the controller is down; still
  # union a wizard/env Console host into the allowlist before env_args.
  _dashboard_merge_console_host

  # Build environment argument list
  local env_args=()
  env_args+=(-e AGENTTEAMS_CONTROLLER_URL="${AGENTTEAMS_CONTROLLER_URL}")
  env_args+=(-e NEXT_PUBLIC_MATRIX_API_URL="${NEXT_PUBLIC_MATRIX_API_URL}")
  env_args+=(-e AGENTTEAMS_HIGRESS_ADAPTER_MODE="${AGENTTEAMS_HIGRESS_ADAPTER_MODE:-direct}")
  env_args+=(-e AGENTTEAMS_AI_GATEWAY_URL="${AGENTTEAMS_AI_GATEWAY_URL:-}")
  env_args+=(-e AGENTTEAMS_AI_GATEWAY_ADMIN_URL="${AGENTTEAMS_AI_GATEWAY_ADMIN_URL:-}")
  env_args+=(-e AGENTTEAMS_AI_GATEWAY_ADMIN_ALLOWED_HOSTS="${AGENTTEAMS_AI_GATEWAY_ADMIN_ALLOWED_HOSTS:-}")
  env_args+=(-e MATRIX_HOMESERVER_ALLOWLIST="agentteams-controller,matrix-local.agentteams.io,matrix.org")
  [ -n "${AGENTTEAMS_AUTH_TOKEN:-}" ] && env_args+=(-e AGENTTEAMS_AUTH_TOKEN="${AGENTTEAMS_AUTH_TOKEN}")
  env_args+=(-e DASHBOARD_SESSION_SECRET="${DASHBOARD_SESSION_SECRET:-}")
  env_args+=(-e DASHBOARD_CONFIG_FILE="${DASHBOARD_CONFIG_FILE:-${CONFIG_FILE}}")
  env_args+=(-e AGENTTEAMS_DEPLOYMENT_MODE="${AGENTTEAMS_DEPLOYMENT_MODE:-external}")
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
  ${DOCKER_CMD} volume create "${DATA_VOLUME}" >/dev/null 2>&1 || true
  local _vol_args=()
  _vol_args+=(-v "${DATA_VOLUME}:${DATA_MOUNT}")

  # Dashboard image runs as uid 1001. Export the old writable layer (including
  # legacy /app/db) into the volume, then chown so the process can write state.
  local _dash_ids
  _dash_ids=$(_dashboard_image_ids)

  if [ "${_old_dashboard_present}" = "1" ]; then
    ${DOCKER_CMD} stop "${CONTAINER_NAME}" >/dev/null 2>&1 || true
    local _export_dir
    _export_dir=$(mktemp -d "${TMPDIR:-/tmp}/agentteams-dashboard-export.XXXXXX")
    local _overlay_dir="${_export_dir}/overlay"
    local _legacy_dir="${_export_dir}/legacy"
    local _overlay_exists="${_export_dir}/overlay.exists"
    local _legacy_exists="${_export_dir}/legacy.exists"
    _dashboard_export_dir "${CONTAINER_NAME}" "${DATA_MOUNT}" "${_overlay_dir}" "${_overlay_exists}" || true
    _dashboard_export_dir "${CONTAINER_NAME}" "/app/db" "${_legacy_dir}" "${_legacy_exists}" || true

    local _keep_old=0
    local _keep_where=""
    if [ ! -f "${_overlay_exists}" ]; then
      local _overlay_state=0
      _dashboard_path_present "${CONTAINER_NAME}" "${DATA_MOUNT}" || _overlay_state=$?
      if [ "${_overlay_state}" != "1" ]; then
        _keep_old=1
        _keep_where="${DATA_MOUNT}"
      fi
    fi
    if [ "${_keep_old}" = "0" ] && [ ! -f "${_legacy_exists}" ]; then
      local _legacy_state=0
      _dashboard_path_present "${CONTAINER_NAME}" "/app/db" || _legacy_state=$?
      if [ "${_legacy_state}" != "1" ]; then
        _keep_old=1
        _keep_where="/app/db"
      fi
    fi
    if [ "${_keep_old}" = "1" ]; then
      warn "existing Dashboard config under ${_keep_where} could not be exported; leaving the old container in place"
      ${DOCKER_CMD} start "${CONTAINER_NAME}" >/dev/null 2>&1 || true
      rm -rf "${_export_dir}" 2>/dev/null || true
      return 0
    fi

    local _import_vols=()
    _import_vols+=(-v "${DATA_VOLUME}:/dest")
    if [ -f "${_overlay_exists}" ] && [ -n "$(ls -A "${_overlay_dir}" 2>/dev/null)" ]; then
      _import_vols+=(-v "${_overlay_dir}:/overlay:ro")
    fi
    if [ -f "${_legacy_exists}" ] && [ -n "$(ls -A "${_legacy_dir}" 2>/dev/null)" ]; then
      _import_vols+=(-v "${_legacy_dir}:/legacy:ro")
    fi
    local _import_script="mkdir -p /dest || exit 1; if [ -d /legacy ]; then cp -a /legacy/. /dest/ || exit 1; fi; if [ -d /overlay ]; then cp -a /overlay/. /dest/ || exit 1; fi; chown -R ${_dash_ids} /dest || exit 1"

    if ! ${DOCKER_CMD} run --rm "${_import_vols[@]}" alpine:latest sh -c "${_import_script}" >/dev/null 2>&1; then
      warn "failed to import exported Dashboard configuration into ${DATA_VOLUME}; leaving the old container in place"
      ${DOCKER_CMD} start "${CONTAINER_NAME}" >/dev/null 2>&1 || true
      rm -rf "${_export_dir}" 2>/dev/null || true
      return 0
    fi

    ${DOCKER_CMD} rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
    rm -rf "${_export_dir}" 2>/dev/null || true
  else
    if ! ${DOCKER_CMD} run --rm -v "${DATA_VOLUME}:/dest" alpine:latest sh -c "mkdir -p /dest && chown -R ${_dash_ids} /dest" >/dev/null 2>&1; then
      warn "could not chown ${DATA_VOLUME} to ${_dash_ids}; Dashboard may be unable to write config/session/setup state"
    fi
  fi

  ${DOCKER_CMD} run -d \
    --name "${CONTAINER_NAME}" \
    --restart unless-stopped \
    --network "${NETWORK_NAME}" \
    -p "${_port_prefix}${AGENTTEAMS_PORT_DASHBOARD}:3000" \
    "${_vol_args[@]}" \
    "${env_args[@]}" \
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
  # f8-5: LOCAL_ONLY defaults to 1 (localhost-only), matching save_env/load_env
  # and the upstream installer (_start_dashboard, agentteams-install.sh).
  [ "${AGENTTEAMS_LOCAL_ONLY:-1}" = "1" ] && bind_host="127.0.0.1"
  echo -e "  Access: ${CYAN}http://${bind_host}:${AGENTTEAMS_PORT_DASHBOARD}/${NC}"
  echo -e "  Logs:   ${DOCKER_CMD} logs -f ${CONTAINER_NAME}"
  echo -e "  Stop:   ${DOCKER_CMD} stop ${CONTAINER_NAME}"
  echo -e "  LAN:    disabled by default (127.0.0.1 only) — export AGENTTEAMS_LOCAL_ONLY=0 before install/update to expose 0.0.0.0"
  echo ""
}

# ---------- install (first time) ----------
do_install() {
  preflight
  wizard

  echo ""
  info "Configuration:"
  info "  Version:     ${AGENTTEAMS_DASHBOARD_VERSION}"
  info "  Port:        ${AGENTTEAMS_PORT_DASHBOARD}"
  info "  Image:       ${AGENTTEAMS_DASHBOARD_IMAGE}"
  info "  Controller:  ${AGENTTEAMS_CONTROLLER_URL}"
  info "  Matrix:      ${NEXT_PUBLIC_MATRIX_API_URL}"
  info "  Higress:     ${AGENTTEAMS_AI_GATEWAY_ADMIN_URL:-<not configured>}"
  info "  MinIO:       ${AGENTTEAMS_FS_ENDPOINT:-<not configured>} (bucket: ${AGENTTEAMS_FS_BUCKET:-<unknown>})"
  info "  LLM:         ${AGENTTEAMS_LLM_PROVIDER:-<unknown>} / ${AGENTTEAMS_DEFAULT_MODEL:-<unknown>}"
  info "  LAN access:  $([ "${AGENTTEAMS_LOCAL_ONLY:-1}" = "1" ] && echo 'disabled (127.0.0.1 only)' || echo 'enabled (0.0.0.0)')"
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

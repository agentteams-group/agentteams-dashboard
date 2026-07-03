# AgentTeams Integration Patches

This document describes how to integrate TaDashboard into the AgentTeams (HiClaw) installation scripts.

## Option A: Standalone Install (Recommended for existing installations)

Run directly against an existing AgentTeams deployment:

```bash
bash install/hiclaw-dashboard.sh          # install (first time)
bash install/hiclaw-dashboard.sh update   # pull latest & recreate
bash install/hiclaw-dashboard.sh uninstall
```

## Option B: Patch into AgentTeams Install Script

Apply the patches in `install/patches/` to the AgentTeams repository, or follow the manual steps below.

### Quick Apply (using the patch files)

```bash
cd /path/to/AgentTeams
git apply /path/to/TaDashboard/install/patches/0001-hiclaw-install-dashboard.patch
git apply /path/to/TaDashboard/install/patches/0002-hiclaw-verify-dashboard.patch
git apply /path/to/TaDashboard/install/patches/0003-Makefile-dashboard.patch
```

### Manual Integration

#### 1. `install/hiclaw-install.sh`

##### Add environment variable block (near the top, with other `HICLAW_` vars, around line 45):

```bash
# TaDashboard (optional web management UI)
HICLAW_DASHBOARD="${HICLAW_DASHBOARD:-1}"           # 1=install, 0=skip
HICLAW_PORT_DASHBOARD="${HICLAW_PORT_DASHBOARD:-13000}"
HICLAW_DASHBOARD_IMAGE="${HICLAW_DASHBOARD_IMAGE:-hiclaw-dashboard:latest}"
HICLAW_AI_GATEWAY_ADMIN_URL="${HICLAW_AI_GATEWAY_ADMIN_URL:-}"  # Higress Console URL for shared auth
```

##### Add message dictionary entries (in the `case` block for i18n, after `success.dashboard`):

```bash
# --- Dashboard wizard ---
"dash.prompt.zh")        text="是否安装 TaDashboard 管理面板?" ;;
"dash.prompt.en")        text="Install TaDashboard management UI?" ;;
"dash.port_prompt.zh")   text="Dashboard 端口号" ;;
"dash.port_prompt.en")   text="Dashboard port" ;;
"dash.image_prompt.zh")  text="Dashboard 镜像" ;;
"dash.image_prompt.en")  text="Dashboard image" ;;
"dash.higress_prompt.zh") text="Higress Console URL（共用登录，留空跳过）" ;;
"dash.higress_prompt.en") text="Higress Console URL (shared login, empty to skip)" ;;
"dash.starting.zh")      text="正在启动 TaDashboard..." ;;
"dash.starting.en")      text="Starting TaDashboard..." ;;
"dash.ready.zh")         text="TaDashboard 已就绪" ;;
"dash.ready.en")         text="TaDashboard is ready" ;;
"dash.failed.zh")        text="TaDashboard 启动失败" ;;
"dash.failed.en")        text="TaDashboard failed to start" ;;
"dash.skipped.zh")       text="跳过 TaDashboard 安装" ;;
"dash.skipped.en")       text="Skipping TaDashboard installation" ;;
```

##### Update the `success.dashboard` message (remove `/dashboard` suffix since basePath is now empty):

```bash
"success.dashboard.zh") text="  管理面板 (Dashboard): http://localhost:%s/" ;;
"success.dashboard.en") text="  Management Dashboard: http://localhost:%s/" ;;
```

##### Add wizard step function (after `step_workspace`):

```bash
step_dashboard() {
    log "$(msg dash.prompt)"
    prompt_yes_no HICLAW_DASHBOARD "$(msg dash.prompt)" "1"
    if [ "${HICLAW_DASHBOARD}" != "1" ]; then
        log "$(msg dash.skipped)"
        return 0
    fi
    prompt HICLAW_PORT_DASHBOARD "$(msg dash.port_prompt)" "13000"
    prompt HICLAW_DASHBOARD_IMAGE "$(msg dash.image_prompt)" "hiclaw-dashboard:latest"
    # Auto-detect Higress Console URL for shared authentication
    local _higress_url=""
    local _higress_ctr
    _higress_ctr=$(${DOCKER_CMD} ps --format '{{.Names}}' | grep -E "higress-console|higress" | head -1 || true)
    if [ -n "${_higress_ctr}" ]; then
        local _higress_port
        _higress_port=$(${DOCKER_CMD} port "${_higress_ctr}" 8001 2>/dev/null | head -1 | cut -d: -f2 || true)
        if [ -n "${_higress_port}" ]; then
            _higress_url="http://127.0.0.1:${_higress_port}"
        else
            _higress_url="http://${_higress_ctr}:8001"
        fi
    fi
    prompt HICLAW_AI_GATEWAY_ADMIN_URL "$(msg dash.higress_prompt)" "${_higress_url}"
    export HICLAW_DASHBOARD HICLAW_PORT_DASHBOARD HICLAW_DASHBOARD_IMAGE HICLAW_AI_GATEWAY_ADMIN_URL
}
```

##### Add to the state machine `_STEPS` array (after `step_workspace`):

```bash
local _STEPS=( step_lang step_mode step_version step_existing step_llm step_manager_runtime step_runtime step_admin step_network
               step_ports step_domains step_github step_skills step_volume
               step_workspace step_dashboard step_e2ee step_docker_proxy step_idle step_hostshare step_podman_autostart )
```

##### Add to `should_skip_step` (around line 1611):

```bash
step_dashboard)
    [ "${HICLAW_DASHBOARD:-1}" != "1" ]
    ;;
```

##### Add to `clear_step_vars` (around line 1673):

```bash
step_dashboard) unset HICLAW_DASHBOARD HICLAW_PORT_DASHBOARD HICLAW_DASHBOARD_IMAGE HICLAW_AI_GATEWAY_ADMIN_URL ;;
```

##### Add dashboard container startup (after the embedded controller wait block, around line 3580):

```bash
# --- TaDashboard (optional) ---
if [ "${HICLAW_DASHBOARD:-1}" = "1" ]; then
    log "$(msg dash.starting)"

    local _dash_ctrl_url="http://hiclaw-controller:8090"
    ${DOCKER_CMD} run -d --name hiclaw-dashboard \
        --network "${NETWORK_NAME}" \
        --restart unless-stopped \
        -p "${_port_prefix}${HICLAW_PORT_DASHBOARD:-13000}:3000" \
        -e HICLAW_CONTROLLER_URL="${_dash_ctrl_url}" \
        -e NEXT_PUBLIC_MATRIX_API_URL="http://matrix-local.hiclaw.io:6167" \
        -e HICLAW_AI_GATEWAY_ADMIN_URL="${HICLAW_AI_GATEWAY_ADMIN_URL:-}" \
        -e DATABASE_URL="file:/app/db/dashboard.db" \
        -v "hiclaw-dashboard-data:/app/db" \
        "${DASHBOARD_IMAGE}"

    # Wait for readiness
    local _dash_wait=0 _dash_max=60
    while [ ${_dash_wait} -lt ${_dash_max} ]; do
        if curl -sf "http://127.0.0.1:${HICLAW_PORT_DASHBOARD:-13000}/" >/dev/null 2>&1; then
            break
        fi
        sleep 2
        _dash_wait=$((_dash_wait + 2))
    done

    if [ ${_dash_wait} -ge ${_dash_max} ]; then
        log "$(msg dash.failed)"
    else
        log "$(msg dash.ready)"
    fi
fi
```

##### Add to env file generation (near the end, with other env vars):

```bash
# Dashboard
echo "HICLAW_DASHBOARD=${HICLAW_DASHBOARD}" >> "${_env_file}"
echo "HICLAW_PORT_DASHBOARD=${HICLAW_PORT_DASHBOARD}" >> "${_env_file}"
echo "HICLAW_DASHBOARD_IMAGE=${HICLAW_DASHBOARD_IMAGE}" >> "${_env_file}"
echo "HICLAW_AI_GATEWAY_ADMIN_URL=${HICLAW_AI_GATEWAY_ADMIN_URL:-}" >> "${_env_file}"
```

#### 2. `install/hiclaw-verify.sh`

Add after the existing health checks (before the summary):

```bash
# 7. Dashboard accessible (if enabled)
if [ "${HICLAW_DASHBOARD:-1}" = "1" ]; then
    _port_dash="${HICLAW_PORT_DASHBOARD:-13000}"
    dash_status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
        "http://127.0.0.1:${_port_dash}/" 2>/dev/null) || dash_status="000"
    if [ "${dash_status}" = "200" ]; then
        check_pass "Dashboard accessible on port ${_port_dash}"
    else
        check_fail "Dashboard accessible on port ${_port_dash} (HTTP ${dash_status})"
    fi
else
    echo "  [SKIP] Dashboard disabled"
fi
```

#### 3. `Makefile`

Add these targets (after the existing `push-embedded` target):

```makefile
# --- TaDashboard standalone ---
DASHBOARD_CONTEXT ?= ./TaDashboard/

install-dashboard: build-dashboard ## Install TaDashboard standalone
	@bash $(DASHBOARD_CONTEXT)/install/hiclaw-dashboard.sh

update-dashboard: ## Update TaDashboard (pull latest & recreate)
	@bash $(DASHBOARD_CONTEXT)/install/hiclaw-dashboard.sh update

uninstall-dashboard: ## Uninstall TaDashboard
	@bash $(DASHBOARD_CONTEXT)/install/hiclaw-dashboard.sh uninstall
```

## Quick Reference

| Action | Command |
|--------|---------|
| Standalone install | `bash install/hiclaw-dashboard.sh` |
| Update (pull latest) | `bash install/hiclaw-dashboard.sh update` |
| Uninstall | `bash install/hiclaw-dashboard.sh uninstall` |
| Build image only | `docker build -t hiclaw-dashboard:latest .` |
| View logs | `docker logs -f hiclaw-dashboard` |
| Default port | `13000` |
| LAN access | Enabled by default (bind 0.0.0.0) |
| Auth mode | Higress shared auth (if URL configured) or local fallback |

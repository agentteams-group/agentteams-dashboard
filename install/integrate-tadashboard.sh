#!/usr/bin/env bash
# ============================================================
# integrate-tadashboard.sh — 直接修改 AgentTeams 安装脚本集成 TaDashboard
#
# 用法:
#   cd /path/to/AgentTeams
#   bash /path/to/TaDashboard/install/integrate-tadashboard.sh
#
# 说明:
#   这个脚本直接修改 AgentTeams 的 3 个文件，不依赖 patch 文件，
#   避免编码/换行符导致的 patch 损坏问题。
# ============================================================
set -euo pipefail

# ---------- 颜色定义 ----------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ---------- 检查文件 ----------
INSTALL_SH="install/hiclaw-install.sh"
VERIFY_SH="install/hiclaw-verify.sh"
MAKEFILE="Makefile"

for f in "${INSTALL_SH}" "${VERIFY_SH}" "${MAKEFILE}"; do
    if [ ! -f "$f" ]; then
        err "未找到文件: $f"
        err "请在 AgentTeams 仓库根目录运行此脚本"
        exit 1
    fi
done

ok "找到目标文件"

# ---------- 备份文件 ----------
BACKUP_SUFFIX=".bak.$(date +%Y%m%d%H%M%S)"
info "备份原文件..."
cp "${INSTALL_SH}" "${INSTALL_SH}${BACKUP_SUFFIX}"
cp "${VERIFY_SH}" "${VERIFY_SH}${BACKUP_SUFFIX}"
cp "${MAKEFILE}" "${MAKEFILE}${BACKUP_SUFFIX}"
ok "备份完成"

# ---------- 修改 install/hiclaw-install.sh ----------
info "修改 ${INSTALL_SH}..."

# 1. 添加环境变量注释
if ! grep -q "HICLAW_DASHBOARD" "${INSTALL_SH}"; then
    sed -i '/HICLAW_WORKER_IDLE_TIMEOUT/a\
#   HICLAW_DASHBOARD              Install TaDashboard management UI (default: 1)\
#   HICLAW_PORT_DASHBOARD         Dashboard host port (default: 13000)\
#   HICLAW_DASHBOARD_IMAGE        Override dashboard image\
#   HICLAW_AI_GATEWAY_ADMIN_URL   Higress Console URL for shared auth (auto-detected)' "${INSTALL_SH}"
    ok "添加环境变量注释"
fi

# 2. 修改 success.dashboard 消息
sed -i 's|http://localhost:%s/dashboard|http://localhost:%s/|g' "${INSTALL_SH}"
ok "更新 Dashboard URL"

# 3. 添加消息字典
if ! grep -q "dash.prompt.zh" "${INSTALL_SH}"; then
    # 找到 success.dashboard.en 行，在其后插入
    sed -i '/"success.dashboard.en") text=/a\
        # --- Dashboard wizard ---\
        "dash.prompt.zh")        text="是否安装 TaDashboard 管理面板?" ;;\
        "dash.prompt.en")        text="Install TaDashboard management UI?" ;;\
        "dash.port_prompt.zh")   text="Dashboard 端口号" ;;\
        "dash.port_prompt.en")   text="Dashboard port" ;;\
        "dash.image_prompt.zh")  text="Dashboard 镜像" ;;\
        "dash.image_prompt.en")  text="Dashboard image" ;;\
        "dash.higress_prompt.zh") text="Higress Console URL（共用登录，留空跳过）" ;;\
        "dash.higress_prompt.en") text="Higress Console URL (shared login, empty to skip)" ;;\
        "dash.starting.zh")      text="正在启动 TaDashboard..." ;;\
        "dash.starting.en")      text="Starting TaDashboard..." ;;\
        "dash.ready.zh")         text="TaDashboard 已就绪" ;;\
        "dash.ready.en")         text="TaDashboard is ready" ;;\
        "dash.failed.zh")        text="TaDashboard 启动失败" ;;\
        "dash.failed.en")        text="TaDashboard failed to start" ;;\
        "dash.skipped.zh")       text="跳过 TaDashboard 安装" ;;\
        "dash.skipped.en")       text="Skipping TaDashboard installation" ;;' "${INSTALL_SH}"
    ok "添加消息字典"
fi

# 4. 添加 HICLAW_AI_GATEWAY_ADMIN_URL 默认值
if ! grep -q 'HICLAW_AI_GATEWAY_ADMIN_URL="${HICLAW_AI_GATEWAY_ADMIN_URL:-}"' "${INSTALL_SH}"; then
    # 在 DASHBOARD_IMAGE= 行之后添加
    sed -i '/DASHBOARD_IMAGE=/a\    HICLAW_AI_GATEWAY_ADMIN_URL="${HICLAW_AI_GATEWAY_ADMIN_URL:-}"' "${INSTALL_SH}"
    ok "添加 HICLAW_AI_GATEWAY_ADMIN_URL 默认值"
fi

# 5. 添加 step_dashboard 函数
if ! grep -q "^step_dashboard()" "${INSTALL_SH}"; then
    cat >> "${INSTALL_SH}" <<'EOF'

step_dashboard() {
    log "$(msg dash.prompt)"
    # Non-interactive guard
    if [ "${HICLAW_NON_INTERACTIVE}" = "1" ]; then
        HICLAW_DASHBOARD="${HICLAW_DASHBOARD:-1}"
        if [ "${HICLAW_DASHBOARD}" != "1" ]; then
            log "$(msg dash.skipped)"
            return 0
        fi
        HICLAW_PORT_DASHBOARD="${HICLAW_PORT_DASHBOARD:-13000}"
        HICLAW_DASHBOARD_IMAGE="${HICLAW_DASHBOARD_IMAGE:-hiclaw-dashboard:latest}"
        HICLAW_AI_GATEWAY_ADMIN_URL="${HICLAW_AI_GATEWAY_ADMIN_URL:-}"
        return 0
    fi

    prompt_yes_no HICLAW_DASHBOARD "$(msg dash.prompt)" "1"
    if [ "${HICLAW_DASHBOARD}" != "1" ]; then
        log "$(msg dash.skipped)"
        return 0
    fi

    prompt HICLAW_PORT_DASHBOARD "$(msg dash.port_prompt)" "13000"
    prompt HICLAW_DASHBOARD_IMAGE "$(msg dash.image_prompt)" "hiclaw-dashboard:latest"

    # Auto-detect Higress Console URL
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
EOF
    ok "添加 step_dashboard 函数"
fi

# 6. 添加 step_dashboard 到 _STEPS 数组
if ! grep -q "step_dashboard" "${INSTALL_SH}" || ! grep -q "step_workspace step_dashboard" "${INSTALL_SH}"; then
    # 替换 step_workspace step_e2ee 为 step_workspace step_dashboard step_e2ee
    sed -i 's/step_workspace step_e2ee/step_workspace step_dashboard step_e2ee/g' "${INSTALL_SH}"
    ok "添加 step_dashboard 到安装步骤"
fi

# 7. 添加 should_skip_step 逻辑
if ! grep -q 'step_dashboard)' "${INSTALL_SH}"; then
    # 在 step_volume|step_workspace) 块后添加
    sed -i '/step_volume|step_workspace)/,/^        ;;/a\
        step_dashboard)\
            [ "${HICLAW_DASHBOARD:-1}" != "1" ]\
            ;;' "${INSTALL_SH}"
    ok "添加 should_skip_step 逻辑"
fi

# 8. 添加 clear_step_vars 逻辑
if ! grep -q 'unset HICLAW_DASHBOARD' "${INSTALL_SH}"; then
    sed -i '/step_volume)    unset HICLAW_DATA_DIR/a\        step_dashboard) unset HICLAW_DASHBOARD HICLAW_PORT_DASHBOARD HICLAW_DASHBOARD_IMAGE HICLAW_AI_GATEWAY_ADMIN_URL ;;' "${INSTALL_SH}"
    ok "添加 clear_step_vars 逻辑"
fi

# 9. 添加 Dashboard 容器启动
if ! grep -q "hiclaw-dashboard" "${INSTALL_SH}"; then
    cat >> "${INSTALL_SH}" <<'EOF'

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
        "${HICLAW_DASHBOARD_IMAGE}"

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
EOF
    ok "添加 Dashboard 容器启动逻辑"
fi

# 10. 添加环境变量到 env 文件
if ! grep -q "HICLAW_PORT_DASHBOARD" "${INSTALL_SH}"; then
    # 在生成 env 文件的地方添加，这里简化处理，追加到文件末尾
    sed -i '/^# End of env file generation/i\
    # Dashboard\
    echo "HICLAW_DASHBOARD=${HICLAW_DASHBOARD}" >> "${_env_file}"\
    echo "HICLAW_PORT_DASHBOARD=${HICLAW_PORT_DASHBOARD}" >> "${_env_file}"\
    echo "HICLAW_DASHBOARD_IMAGE=${HICLAW_DASHBOARD_IMAGE}" >> "${_env_file}"\
    echo "HICLAW_AI_GATEWAY_ADMIN_URL=${HICLAW_AI_GATEWAY_ADMIN_URL:-}" >> "${_env_file}"' "${INSTALL_SH}" || true
    ok "添加 env 文件变量"
fi

ok "${INSTALL_SH} 修改完成"

# ---------- 修改 install/hiclaw-verify.sh ----------
info "修改 ${VERIFY_SH}..."

if ! grep -q "Dashboard accessible" "${VERIFY_SH}"; then
    cat >> "${VERIFY_SH}" <<'EOF'

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
EOF
    ok "添加 Dashboard 验证检查"
fi

ok "${VERIFY_SH} 修改完成"

# ---------- 修改 Makefile ----------
info "修改 ${MAKEFILE}..."

if ! grep -q "install-dashboard" "${MAKEFILE}"; then
    cat >> "${MAKEFILE}" <<'EOF'

# --- TaDashboard standalone ---
DASHBOARD_CONTEXT ?= ./TaDashboard/

install-dashboard: build-dashboard ## Install TaDashboard standalone
	@bash $(DASHBOARD_CONTEXT)/install/hiclaw-dashboard.sh

update-dashboard: ## Update TaDashboard (pull latest & recreate)
	@bash $(DASHBOARD_CONTEXT)/install/hiclaw-dashboard.sh update

uninstall-dashboard: ## Uninstall TaDashboard
	@bash $(DASHBOARD_CONTEXT)/install/hiclaw-dashboard.sh uninstall
EOF
    ok "添加 Makefile 目标"
fi

ok "${MAKEFILE} 修改完成"

# ---------- 完成 ----------
echo ""
echo "=========================================="
ok "AgentTeams 集成 TaDashboard 完成！"
echo "=========================================="
echo ""
echo "修改的文件:"
echo "  - ${INSTALL_SH}"
echo "  - ${VERIFY_SH}"
echo "  - ${MAKEFILE}"
echo ""
echo "备份文件:"
echo "  - ${INSTALL_SH}${BACKUP_SUFFIX}"
echo "  - ${VERIFY_SH}${BACKUP_SUFFIX}"
echo "  - ${MAKEFILE}${BACKUP_SUFFIX}"
echo ""
echo "后续步骤:"
echo "  1. git diff 检查修改内容"
echo "  2. git add -A"
echo "  3. git commit -m \"feat(install): integrate TaDashboard as optional component\""
echo "  4. git push origin feat/integrate-tadashboard"
echo "  5. 在 GitHub 创建 PR"

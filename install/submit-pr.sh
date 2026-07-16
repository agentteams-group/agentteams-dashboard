#!/usr/bin/env bash
# ============================================================
# submit-pr.sh — 提交 AgentTeams 集成 PR
#
# 用法:
#   bash install/submit-pr.sh <你的GitHub用户名>
#
# 前置条件:
#   1. 已 Fork AgentTeams 仓库到你的 GitHub 账号
#   2. 已安装 git 并配置 SSH key 或 HTTPS token
#   3. 已安装 gh CLI (可选，用于自动创建 PR)
#
# 示例:
#   bash install/submit-pr.sh myusername
#   GITHUB_TOKEN=xxx bash install/submit-pr.sh myusername
# ============================================================
set -euo pipefail

# Resolve the patch directory to an ABSOLUTE path up front — later steps cd
# into the cloned AgentTeams repo, so a relative path would break.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH_DIR="${SCRIPT_DIR}/patches"

# ---------- 参数检查 ----------
if [ $# -lt 1 ]; then
    echo "用法: bash install/submit-pr.sh <你的GitHub用户名>"
    echo "示例: bash install/submit-pr.sh myusername"
    exit 1
fi

GITHUB_USER="$1"
REPO_NAME="AgentTeams"
FORK_URL="https://github.com/${GITHUB_USER}/${REPO_NAME}.git"
UPSTREAM_URL="https://github.com/agentscope-ai/${REPO_NAME}.git"
BRANCH_NAME="feat/integrate-tadashboard"
WORK_DIR="/tmp/agentteams-pr-${GITHUB_USER}"

# ---------- 颜色定义 ----------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ---------- 检查前置条件 ----------
check_prerequisites() {
    info "检查前置条件..."
    
    if ! command -v git &>/dev/null; then
        err "未安装 git"
        exit 1
    fi
    
    ok "git 已安装"
    
    if [ ! -d "${PATCH_DIR}" ] || ! ls "${PATCH_DIR}"/*.patch &>/dev/null; then
        err "未找到 Patch 目录或 Patch 文件: ${PATCH_DIR}"
        exit 1
    fi
    ok "Patch 目录: ${PATCH_DIR}"
    
    # 克隆与推送均走 HTTPS —— 只认 GITHUB_TOKEN；SSH key 帮不上 HTTPS 推送
    if [ -n "${GITHUB_TOKEN:-}" ]; then
        ok "检测到 GITHUB_TOKEN（将用于 HTTPS 推送，并导出为 GH_TOKEN 供 gh 使用）"
    else
        warn "未设置 GITHUB_TOKEN —— 推送时将使用 git 凭据管理器或交互输入"
    fi
}

# ---------- 克隆仓库 ----------
clone_repo() {
    info "克隆 AgentTeams 仓库..."
    
    if [ -d "${WORK_DIR}" ]; then
        warn "工作目录已存在，删除中..."
        rm -rf "${WORK_DIR}"
    fi
    
    git clone "${FORK_URL}" "${WORK_DIR}"
    cd "${WORK_DIR}"
    
    # 添加上游仓库
    git remote add upstream "${UPSTREAM_URL}"
    git fetch upstream
    
    ok "仓库克隆完成"
}

# ---------- 创建分支并应用 Patch ----------
apply_patches() {
    info "创建分支并应用 Patch..."
    
    # 基于上游 main 创建分支（补丁针对 v1.2.0-beta.1 生成，main 漂移时走 3way 合并）
    git checkout -b "${BRANCH_NAME}" upstream/main
    
    # 应用全部 Patch（git apply 单次生效，失败则尝试 3way，不再混用 git am）
    local patch_count=0
    for patch in "${PATCH_DIR}"/*.patch; do
        [ -f "${patch}" ] || continue
        info "应用 Patch: $(basename "${patch}")"
        if git apply --check "${patch}" 2>/dev/null; then
            git apply "${patch}"
        elif git apply --3way "${patch}" 2>/dev/null; then
            warn "上下文有偏移，已通过 3way 合并应用: $(basename "${patch}")"
        else
            err "Patch 应用失败: $(basename "${patch}")"
            err "上游文件已变动，请按 install/AGENTTEAMS_PATCH.md 的流程重新生成补丁"
            exit 1
        fi
        patch_count=$((patch_count + 1))
        ok "已应用: $(basename "${patch}")"
    done
    
    if [ ${patch_count} -eq 0 ]; then
        err "未找到任何 Patch 文件"
        exit 1
    fi
    
    ok "已应用 ${patch_count} 个 Patch"
}

# ---------- 提交更改 ----------
commit_changes() {
    info "提交更改..."
    
    git add -A
    
    # 检查是否有更改
    if git diff --cached --quiet; then
        warn "没有更改需要提交"
        return 0
    fi
    
    git commit -m "feat(install): integrate agentteams-dashboard as optional component

Add agentteams-dashboard as an optional component in the AgentTeams installation:
- Dashboard wizard step with port, image, and Higress Console URL config
- Auto-detect Higress Console URL for shared authentication
- Dashboard container startup after embedded controller
- Admin credentials forwarded for Higress ensure-ai bootstrap
- Dashboard container removed on uninstall
- Bilingual messages (zh/en)
- LAN-accessible by default (bind 0.0.0.0)
- Add verification check in hiclaw-verify.sh
- Add Makefile targets: build-dashboard, install-dashboard, update-dashboard, uninstall-dashboard

Environment variables:
- AGENTTEAMS_DASHBOARD (default: 1) - Enable/disable dashboard installation
- AGENTTEAMS_PORT_DASHBOARD (default: 13000) - Dashboard host port
- AGENTTEAMS_DASHBOARD_IMAGE (default: \${AGENTTEAMS_REGISTRY}/agentteams/agentteams-dashboard:\${AGENTTEAMS_VERSION}) - Dashboard image
- AGENTTEAMS_AI_GATEWAY_ADMIN_URL (auto-detected) - Higress Console URL

Co-authored-by: agentteams-dashboard <dashboard@agentteams.io>"
    
    ok "更改已提交"
}

# ---------- 推送分支 ----------
push_branch() {
    info "推送到远程仓库..."
    
    if [ -n "${GITHUB_TOKEN:-}" ]; then
        # 使用 token 推送（x-access-token 避免把用户名写进凭据）
        git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_USER}/${REPO_NAME}.git"
    fi
    
    # --force-with-lease：脚本可重入，重跑时安全覆盖同名分支
    git push --force-with-lease -u origin "${BRANCH_NAME}"
    
    # 推送完成后立刻清掉 remote URL 里的明文 token，避免残留在 .git/config
    if [ -n "${GITHUB_TOKEN:-}" ]; then
        git remote set-url origin "${FORK_URL}"
    fi
    
    ok "分支已推送到 ${FORK_URL}"
}

# ---------- 创建 PR ----------
create_pr() {
    info "创建 Pull Request..."
    
    local pr_body="## 描述

将 agentteams-dashboard 作为可选组件集成到 AgentTeams 安装脚本中。

agentteams-dashboard 是一个基于 Next.js 的 Web 管理面板，用于可视化管理 AgentTeams 集群中的 Worker、Team、Human、Manager 等资源，同时集成 Matrix 聊天能力。

## 变更内容

### 1. \`install/hiclaw-install.sh\`
- 添加 Dashboard 安装向导步骤 (\`step_dashboard\`)
- 支持配置端口号（默认 13000）、镜像名称、Higress Console URL
- 自动检测 Higress Console URL 实现共用登录
- 容器启动后自动等待就绪
- 支持中英文双语消息
- 默认绑定 0.0.0.0 支持局域网访问

### 2. \`install/hiclaw-verify.sh\`
- 添加 Dashboard 可访问性检查
- 验证 HTTP 200 响应

### 3. \`Makefile\`
- 添加 \`install-dashboard\` 目标
- 添加 \`update-dashboard\` 目标
- 添加 \`uninstall-dashboard\` 目标

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| \`AGENTTEAMS_DASHBOARD\` | \`1\` | 是否安装 Dashboard (1=是, 0=否) |
| \`AGENTTEAMS_PORT_DASHBOARD\` | \`13000\` | Dashboard 主机端口 |
| \`AGENTTEAMS_DASHBOARD_IMAGE\` | \`\${AGENTTEAMS_REGISTRY}/agentteams/agentteams-dashboard:\${AGENTTEAMS_VERSION}\` | Dashboard 镜像 |
| \`AGENTTEAMS_AI_GATEWAY_ADMIN_URL\` | 自动检测 | Higress Console URL (共用登录) |

## 测试步骤

\`\`\`bash
# 1. 安装 AgentTeams（包含 Dashboard）
bash install/hiclaw-install.sh

# 2. 验证 Dashboard 可访问
curl -s http://localhost:13000/ | head -5

# 3. 验证安装脚本
bash install/hiclaw-verify.sh

# 4. 使用 Makefile
make install-dashboard
make update-dashboard
make uninstall-dashboard
\`\`\`

## 检查清单

- [x] 支持非交互模式 (\`AGENTTEAMS_NON_INTERACTIVE=1\`)
- [x] 支持中英文双语
- [x] 容器使用 Docker 网络连接
- [x] 自动等待容器就绪
- [x] 添加验证检查
- [x] Makefile 目标可用

## 相关链接

- agentteams-dashboard 仓库: https://github.com/agentteams-group/agentteams-dashboard
- 安装脚本: https://github.com/agentteams-group/agentteams-dashboard/blob/main/install/agentteams-dashboard.sh
- 集成文档: https://github.com/agentteams-group/agentteams-dashboard/blob/main/install/AGENTTEAMS_PATCH.md"
    
    # gh CLI 使用 GH_TOKEN（从 GITHUB_TOKEN 导出）；未认证时回退到手动指引
    if [ -n "${GITHUB_TOKEN:-}" ]; then
        export GH_TOKEN="${GITHUB_TOKEN}"
    fi
    
    # 保存 PR 内容到文件（无论是否自动创建，都便于人工核对）
    echo "${pr_body}" > "${WORK_DIR}/pr-body.md"
    
    if command -v gh &>/dev/null && gh auth status &>/dev/null; then
        gh pr create \
            --repo "agentscope-ai/${REPO_NAME}" \
            --head "${GITHUB_USER}:${BRANCH_NAME}" \
            --base "main" \
            --title "feat(install): integrate agentteams-dashboard as optional component" \
            --body "${pr_body}"
        
        ok "PR 已创建"
    else
        if ! command -v gh &>/dev/null; then
            warn "未安装 gh CLI，请手动创建 PR"
        else
            warn "gh CLI 未登录（无 GITHUB_TOKEN/GH_TOKEN 且 gh auth status 失败），请手动创建 PR"
        fi
        echo ""
        echo "请访问以下链接创建 PR:"
        echo "https://github.com/agentscope-ai/${REPO_NAME}/compare/main...${GITHUB_USER}:${BRANCH_NAME}"
        echo ""
        echo "PR 标题:"
        echo "feat(install): integrate agentteams-dashboard as optional component"
        echo ""
        echo "PR 内容已保存到: ${WORK_DIR}/pr-body.md"
    fi
}

# ---------- 主流程 ----------
main() {
    echo "=========================================="
    echo "  AgentTeams 集成 agentteams-dashboard PR 提交工具"
    echo "=========================================="
    echo ""
    
    check_prerequisites
    clone_repo
    apply_patches
    commit_changes
    push_branch
    create_pr
    
    echo ""
    echo "=========================================="
    ok "完成！"
    echo "=========================================="
    echo ""
    echo "工作目录: ${WORK_DIR}"
    echo "分支: ${BRANCH_NAME}"
    echo "Fork: ${FORK_URL}"
}

main "$@"

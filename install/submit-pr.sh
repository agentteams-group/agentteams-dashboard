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
    
    # 检查是否有 GitHub token 或 SSH key
    if [ -n "${GITHUB_TOKEN:-}" ]; then
        ok "检测到 GITHUB_TOKEN"
    elif [ -f ~/.ssh/id_rsa ] || [ -f ~/.ssh/id_ed25519 ]; then
        ok "检测到 SSH key"
    else
        warn "未检测到 GITHUB_TOKEN 或 SSH key，推送时可能需要输入密码"
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
    
    # 基于上游 main 创建分支
    git checkout -b "${BRANCH_NAME}" upstream/main
    
    # Patch 文件路径
    PATCH_DIR="$(dirname "$0")/patches"
    
    if [ ! -d "${PATCH_DIR}" ]; then
        err "未找到 Patch 目录: ${PATCH_DIR}"
        exit 1
    fi
    
    # 应用 3 个 Patch
    local patch_count=0
    for patch in "${PATCH_DIR}"/*.patch; do
        if [ -f "${patch}" ]; then
            info "应用 Patch: $(basename "${patch}")"
            git apply --check "${patch}" 2>/dev/null || {
                err "Patch 应用失败: $(basename "${patch}")"
                err "尝试使用 git am..."
                git am --3way "${patch}" || {
                    warn "git am 失败，尝试 git apply..."
                    git apply "${patch}"
                }
            }
            git apply "${patch}"
            patch_count=$((patch_count + 1))
            ok "已应用: $(basename "${patch}")"
        fi
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
    
    git commit -m "feat(install): integrate TaDashboard as optional component

Add TaDashboard as an optional component in the AgentTeams installation:
- Dashboard wizard step with port, image, and Higress Console URL config
- Auto-detect Higress Console URL for shared authentication
- Dashboard container startup after embedded controller
- Bilingual messages (zh/en)
- LAN-accessible by default (bind 0.0.0.0)
- Add verification check in hiclaw-verify.sh
- Add Makefile targets: install-dashboard, update-dashboard, uninstall-dashboard

Environment variables:
- HICLAW_DASHBOARD (default: 1) - Enable/disable dashboard installation
- HICLAW_PORT_DASHBOARD (default: 13000) - Dashboard host port
- HICLAW_DASHBOARD_IMAGE (default: hiclaw-dashboard:latest) - Dashboard image
- HICLAW_AI_GATEWAY_ADMIN_URL (auto-detected) - Higress Console URL

Co-authored-by: TaDashboard <dashboard@hiclaw.io>"
    
    ok "更改已提交"
}

# ---------- 推送分支 ----------
push_branch() {
    info "推送到远程仓库..."
    
    if [ -n "${GITHUB_TOKEN:-}" ]; then
        # 使用 token 推送
        git remote set-url origin "https://${GITHUB_TOKEN}@github.com/${GITHUB_USER}/${REPO_NAME}.git"
    fi
    
    git push -u origin "${BRANCH_NAME}"
    
    ok "分支已推送到 ${FORK_URL}"
}

# ---------- 创建 PR ----------
create_pr() {
    info "创建 Pull Request..."
    
    local pr_body="## 描述

将 TaDashboard 作为可选组件集成到 AgentTeams 安装脚本中。

TaDashboard 是一个基于 Next.js 的 Web 管理面板，用于可视化管理 AgentTeams 集群中的 Worker、Team、Human、Manager 等资源，同时集成 Matrix 聊天能力。

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
| \`HICLAW_DASHBOARD\` | \`1\` | 是否安装 Dashboard (1=是, 0=否) |
| \`HICLAW_PORT_DASHBOARD\` | \`13000\` | Dashboard 主机端口 |
| \`HICLAW_DASHBOARD_IMAGE\` | \`hiclaw-dashboard:latest\` | Dashboard 镜像 |
| \`HICLAW_AI_GATEWAY_ADMIN_URL\` | 自动检测 | Higress Console URL (共用登录) |

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

- [x] 代码通过 shellcheck 检查
- [x] 支持非交互模式 (\`HICLAW_NON_INTERACTIVE=1\`)
- [x] 支持中英文双语
- [x] 容器使用 Docker 网络连接
- [x] 自动等待容器就绪
- [x] 添加验证检查
- [x] Makefile 目标可用

## 相关链接

- TaDashboard 仓库: https://github.com/higress-group/TaDashboard
- A2UI 协议: https://a2ui.org/
- 安装脚本: https://github.com/higress-group/TaDashboard/blob/main/install/hiclaw-dashboard.sh
- 集成文档: https://github.com/higress-group/TaDashboard/blob/main/install/AGENTTEAMS_PATCH.md"
    
    # 尝试使用 gh CLI 创建 PR
    if command -v gh &>/dev/null; then
        gh pr create \
            --repo "agentscope-ai/${REPO_NAME}" \
            --head "${GITHUB_USER}:${BRANCH_NAME}" \
            --base "main" \
            --title "feat(install): integrate TaDashboard as optional component" \
            --body "${pr_body}"
        
        ok "PR 已创建"
    else
        warn "未安装 gh CLI，请手动创建 PR"
        echo ""
        echo "请访问以下链接创建 PR:"
        echo "https://github.com/agentscope-ai/${REPO_NAME}/compare/main...${GITHUB_USER}:${BRANCH_NAME}"
        echo ""
        echo "PR 标题:"
        echo "feat(install): integrate TaDashboard as optional component"
        echo ""
        echo "PR 内容已保存到: ${WORK_DIR}/pr-body.md"
        
        # 保存 PR 内容到文件
        echo "${pr_body}" > "${WORK_DIR}/pr-body.md"
    fi
}

# ---------- 主流程 ----------
main() {
    echo "=========================================="
    echo "  AgentTeams 集成 TaDashboard PR 提交工具"
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

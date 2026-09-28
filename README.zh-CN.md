<div align="center">
  <img src="public/agentteams-logo.svg" alt="AgentTeams Logo" width="110" />

  # AgentTeams Dashboard

  **轻量级的 AgentTeams 集群 Web 管理面板 —— 可视化管理 Workers、Teams、Humans、Managers 与基础设施，并集成 Matrix 聊天能力。**

  [English](./README.md) | [简体中文](./README.zh-CN.md)

  [![Build Dashboard Image](https://github.com/agentteams-group/agentteams-dashboard/actions/workflows/build.yml/badge.svg)](https://github.com/agentteams-group/agentteams-dashboard/actions/workflows/build.yml)
  [![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
  [![React](https://img.shields.io/badge/React-19-149eca?logo=react)](https://react.dev/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38bdf8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
  [![Docker](https://img.shields.io/badge/Docker-ready-2496ed?logo=docker&logoColor=white)](./Dockerfile)
</div>

---

## ✨ 简介

AgentTeams Dashboard 是一个基于 **Next.js** 的 Web 界面，用于可视化管理 [AgentTeams](https://github.com/agentscope-ai/AgentTeams) 集群中的 Worker、Team、Human、Manager 等资源，内置 Matrix 聊天、拓扑视图与 RBAC/审计工具。既可以独立部署，也可以通过一行脚本嵌入到已有的 AgentTeams 安装中。

## 🚀 功能模块

| 模块 | 说明 |
|------|------|
| **Overview** | 全局概览：活跃 Worker、Team、Matrix 房间数、资源状态 |
| **Workers** | Worker 全生命周期管理：查看、唤醒、休眠、确保就绪、删除 |
| **Teams** | Team 管理：成员、关联 Worker、Human、详情弹窗 |
| **Humans** | Human 资源 CRUD：卡片/表格视图、权限级别、房间关联 |
| **Managers** | Manager 管理：模型配置、欢迎消息、协调团队/Worker |
| **K8s** | Kubernetes CRD 资源卡片展示、YAML/JSON 预览 |
| **Infrastructure** | 基础设施状态：Controller、Matrix、各组件健康度 |
| **Chat** | Matrix 聊天工作区：房间与成员导航、虚拟时间线、线程、编辑和运行时富消息渲染 |
| **Security** | 权限矩阵、访问控制、安全策略展示 |
| **Skills** | Skill/MCP 资源管理 |
| **Debug Log** | 一键收集调试日志：容器诊断、Agent 会话、Matrix 消息打包成 ZIP 下载，默认 PII 脱敏 |
| **问天诊断** | 运行时诊断助手：集群健康概览、AI 深度诊断（结构化 Markdown 报告：根因分析/影响评估/修复建议）、日志分析（SSE 实时进度条），内置 AgentTeams SRE 专家 Prompt 模板 |
| **Architecture** | 架构图与组件关系说明 |
| **主题** | 内置亮色 / 暗色 / 高对比度主题，自定义主题编辑器（10+ 参数）支持 JSON 导入/导出，企业 `theme.config.json` 注入 |
| **插件** | 运行时插件系统：5 类扩展点、动态加载、插件级错误隔离、开发热更新、`create-dashboard-plugin` 脚手架 CLI |

## 🛠 技术栈

- **框架**：Next.js 16 + React 19 + TypeScript 5
- **样式**：Tailwind CSS v4 + shadcn/ui
- **状态管理**：Zustand + TanStack Query
- **运行时**：Node.js 22+
- **部署**：Docker，Next.js standalone 输出

## Matrix 聊天

聊天工作区提供 Matrix 房间的虚拟化历史消息、未读感知滚动、消息操作、已读回执与按需加载的线程面板。根消息保留在主时间线；`m.thread` 回复会计入根消息，并在对应线程面板中加载。

运行时消息支持 A2UI 标记、AgentScope runtime `Message` repr 正文、`agentteams.workflow`、Tool Guard 确认消息和 legacy 卡片格式。界面可呈现 Markdown、可折叠思考、工具调用、工作流、确认和 A2UI 块。`org.agentteams.run` 作为 runtime adapter 的可选兼容载荷；Dashboard 同时通过标准 Matrix `m.replace` 修订事件处理流式更新。

## 🎨 主题自定义

Dashboard 内置三套主题（亮色、暗色、高对比度），支持跟随系统偏好，并在刷新后保留选择。「设置 → 外观」中的主题编辑器提供 30+ 项视觉参数（颜色、圆角、字号、间距、字体风格）实时预览，并支持 JSON 导入/导出。运维可通过 `theme.config.json` 或环境变量下发企业主题。详见 [docs/theme-customization.zh-CN.md](docs/theme-customization.zh-CN.md)（中文）与 [docs/theme-customization.md](docs/theme-customization.md)（英文）。

## 🧩 插件开发

第三方可在不 fork 的前提下扩展 Dashboard。插件系统提供五类扩展点（侧边栏菜单、独立页面、仪表盘组件、详情面板区块、工具栏按钮）、运行时动态加载、插件级错误隔离、独立状态、事件总线与开发热更新。脚手架 CLI 可一键生成可运行的插件项目：

```bash
node tools/create-dashboard-plugin/bin/cli.js my-plugin
cd my-plugin && npm install && npm run dev
# 然后在「设置 → 插件」安装 http://localhost:5173/plugin.json
```

详见 [docs/plugin-development.zh-CN.md](docs/plugin-development.zh-CN.md)（中文）、[docs/plugin-development.md](docs/plugin-development.md)（英文）与设计文档 [docs/plugin-system-design.md](docs/plugin-system-design.md)。

## 📦 快速开始

### 作为 AgentTeams 组件安装（推荐）

Dashboard 已集成到 [AgentTeams](https://github.com/agentscope-ai/AgentTeams) 安装脚本中（通过补丁方式）。应用补丁后，安装向导会自动询问是否安装 Dashboard，容器会随 Controller/Manager 一起启动。

- **当前 Dashboard 发布标签**：`v1.2.4.9`（应用版本以 `package.json` 的 `version` 为准：`1.2.4.9`）
- **安装器默认版本**：`v1.2.2`；设置 `AGENTTEAMS_DASHBOARD_VERSION` 可覆盖
- **默认端口**：`13000`，绑定 `127.0.0.1`（设置 `AGENTTEAMS_LOCAL_ONLY=0` 可暴露到 `0.0.0.0`）
- **可用版本**：https://github.com/agentteams-group/agentteams-dashboard/tags
- **集成 PR**：https://github.com/agentscope-ai/AgentTeams/pull/1075
- **平台支持**：目前仅支持 Linux/macOS（Bash 安装器），PowerShell 支持开发中。

你也可以在已运行的 AgentTeams 集群上独立安装：

```bash
# Linux / macOS — 独立安装
bash install/agentteams-dashboard.sh

# Windows — PowerShell 安装
install/agentteams-dashboard.ps1

# 卸载
bash install/agentteams-dashboard.sh uninstall
```

安装后访问 `http://127.0.0.1:13000/`。

#### 集成环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `AGENTTEAMS_DASHBOARD` | 是否安装 Dashboard（`1`=安装，`0`=跳过） | `1` |
| `AGENTTEAMS_PORT_DASHBOARD` | Dashboard 主机端口 | `13000` |
| `AGENTTEAMS_DASHBOARD_VERSION` | Dashboard 镜像版本（独立发布） | `v1.2.2` |
| `AGENTTEAMS_DASHBOARD_IMAGE` | Dashboard 完整镜像名 | `${AGENTTEAMS_REGISTRY}/agentteams/agentteams-dashboard:${AGENTTEAMS_DASHBOARD_VERSION}` |
| `AGENTTEAMS_AI_GATEWAY_ADMIN_URL` | Higress Console URL（共享登录，显式配置优先） | 自动探测 |

**主要集成特性**：
- 独立版本号 — AgentTeams 和 Dashboard 可各自独立发布
- 完整配置持久化 — keep-all 升级时保留所有 Dashboard 设置
- 显式 URL 优先 — 显式配置的 `AGENTTEAMS_AI_GATEWAY_ADMIN_URL` 优先级高于自动探测
- URL 自动规范化 — 缺少协议时自动补 `http://`
- CLI Token 轮询 — 30 秒重试，超时后优雅降级
- 旧版 HiClaw 兼容 — 同时读取 `/var/run/hiclaw/cli-token`

非交互安装示例：

```bash
AGENTTEAMS_DASHBOARD=1 AGENTTEAMS_PORT_DASHBOARD=13000 AGENTTEAMS_DASHBOARD_VERSION=v1.2.2 \
  bash agentteams-install.sh --non-interactive
```

详细集成说明见 [`install/AGENTTEAMS_PATCH.md`](install/AGENTTEAMS_PATCH.md)（含补丁内容、Makefile 目标、验证方法和路线图）。

### 独立运行

```bash
# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 设置 AGENTTEAMS_CONTROLLER_URL 和 NEXT_PUBLIC_MATRIX_API_URL

# 开发模式
npm run dev

# 生产构建
npm run build
npm start
```

### Docker 构建

同一个镜像服务所有部署形态，形态由 `docker run` 时的 env 决定。

**单机单用户（默认）**：`docker run` 后打开 URL → 首启页填后端地址
（Controller / Matrix / MinIO / Higress / SGLang，各内网+外网）→ 保存 →
进入登录页。团队成员（L2）用**自己的 Matrix 账号+密码**登录即可——零
token、零管理凭据。

```bash
docker run -d -p 13000:3000 \
  --name agentteams-dashboard \
  --restart unless-stopped \
  -v agentteams-dashboard-data:/data/agentteams-dashboard \
  -e DASHBOARD_SESSION_SECRET="$(openssl rand -hex 32)" \
  -e DASHBOARD_SETUP_TOKEN_ENFORCE=0 \
  ghcr.io/agentteams-group/agentteams-dashboard:<tag>
```

- `DASHBOARD_SESSION_SECRET` **必填**——缺失时登录 fail closed。生成一次，
  容器重建时保持稳定。
- `DASHBOARD_SETUP_TOKEN_ENFORCE=0` = 安装者免 pre-login setup token（限
  可信 LAN；启动日志记录开放状态）；不设置则保留登录前 token 门——同一
  token 可重复用于 `?setup=1` 重配，直到数据卷重置（首启保存不会消费
  它）。
- 团队管理员（L1）登录时多一步验证：admin 密码（需下面的
  `AGENTTEAMS_AUTH_TOKEN`）或在登录表单粘贴 controller token。
- 网关 Console 功能（模型管理、共享登录）另需
  `-e AGENTTEAMS_AI_GATEWAY_ADMIN_ALLOWED_HOSTS=<console-host>`
  （Console 主机名白名单，防 SSRF）。**安装脚本会自动把交互输入的
  自定义 Console 地址主机名并入该白名单**（保留已有项，不覆盖）；
  直接 `docker run` 手配自定义 Console URL 时需自行追加该主机名，
  否则管理员登录会被拒绝（页面提示部署配置错误而非权限错误）。

**共享多用户（一台容器多人用）**，追加：

```bash
  -e DASHBOARD_SHARED_MODE=1 \
  -e DASHBOARD_SETUP_TOKEN="$(openssl rand -hex 16)" \
  -e AGENTTEAMS_AUTH_TOKEN=<controller cli-token>
```

效果：仅 L1 会话可保存后端配置（L2 保存返回 403）；setup token 只从 env
读取、永不落卷——缺 env token 时登录前配置路径关闭（fail-closed，
`?setup=1` 逃生口不可用；需要逃生口就设它）；每次配置写审计
actor+级别+变更字段。`AGENTTEAMS_AUTH_TOKEN`
启用 L1 admin 密码登录；不配则 L1 每次登录粘 controller token。

**嵌入部署**（`install/agentteams-install.sh` 安装）：地址来自 AgentTeams
拓扑 env；未配置时才出现首启页。

任何时刻重配置：登录页 →「无法登录？后端配置」（`?setup=1`）。

```bash
# 或从源码构建
docker build -t agentteams-dashboard:local .
```

## ⚙️ 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `AGENTTEAMS_CONTROLLER_URL` | AgentTeams Controller 地址（服务端代理用） | `http://agentteams-controller:8090` |
| `NEXT_PUBLIC_AGENTTEAMS_CONTROLLER_URL` | 浏览器端 Controller URL（可选） | — |
| `NEXT_PUBLIC_MATRIX_API_URL` | Matrix Homeserver 地址 | — |
| `MATRIX_HOMESERVER_ALLOWLIST` | Matrix 代理允许的 homeserver 主机名（逗号分隔，设置后排他生效）。**私网/LAN 部署必设**——默认 SSRF 防护会拒绝私有网段（如 `192.168.*`）的 homeserver URL，未声明会导致登录与全部 Matrix 流量不可用 | — |
| `AGENTTEAMS_AUTH_TOKEN` | Controller 认证 Token——启用 L1 admin 密码登录路径；`DASHBOARD_SHARED_MODE=1` 时是唯一的 admin 凭据来源 | — |
| `AGENTTEAMS_AUTH_TOKEN_FILE` | Token 文件路径（支持轮转） | — |
| `DASHBOARD_SESSION_SECRET` | 会话 cookie HMAC 密钥——登录**必填** | — |
| `DASHBOARD_CONFIG_FILE` | 首启 setup 页写入的后端配置文件（文件优先于 `AGENTTEAMS_*_URL` env） | `/data/agentteams-dashboard/config.json` |
| `DASHBOARD_SETUP_TOKEN` | Pre-login setup token。未设=自动生成并打一次日志（单机）；共享模式下 env 是唯一来源（缺=登录前路径关闭，fail-closed） | — |
| `DASHBOARD_SETUP_TOKEN_ENFORCE` | `0` = pre-login 保存配置免 token（限可信 LAN） | 未设（门生效） |
| `DASHBOARD_SHARED_MODE` | `1` = 多用户共享本实例（配置保存仅 L1、写操作审计） | 未设（一人一实例） |
| `DASHBOARD_ALLOWED_HOSTS` | setup「测试连接」探针的严格白名单（探针已 token/会话门控；metadata 哨兵 169.254.169.254 全模式拒绝） | 未设（对 session/token 持有者放行） |
| `DATABASE_URL` | SQLite 数据库路径 | `file:./db/dashboard.db` |
| `NEXT_PUBLIC_BASE_PATH` | URL 基础路径（嵌入部署时用） | `/dashboard` |

## 🏗 核心设计

前端不直接访问 AgentTeams Controller 或 Matrix Homeserver，所有请求都经过 Next.js API 路由代理层：

```
┌──────────────┐      ┌───────────────────────────┐      ┌────────────────────────┐
│   Browser    │─────▶│  Next.js API Routes       │─────▶│ AgentTeams Controller  │
│  (React UI)  │◀─────│  /api/agentteams/*        │◀─────│ (Workers/Teams/...)    │
└──────────────┘      │  /api/matrix/*            │      └────────────────────────┘
                      └────────────┬──────────────┘
                                   │
                                   ▼
                      ┌───────────────────────────┐
                      │   Matrix Homeserver       │
                      └───────────────────────────┘
```

- `proxy-helper.ts` 负责请求转发、认证头注入、超时与错误处理。
- **认证**：Dashboard 在 k3s 中通过 projected ServiceAccount Token 访问 Controller；Token 每次请求时重新读取，支持短时效 Token 自动轮转。
- **安全**：Matrix 访问 Token 由前端传入；homeserver 代理执行严格的主机名白名单，并拦截内网地址（SSRF 防护）。

## 📁 项目结构

```
├── src/
│   ├── app/
│   │   ├── api/              # 代理 API（agentteams + matrix）
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── dashboard/        # 面板业务组件
│   │   │   └── sections/     # 各功能区域
│   │   ├── ui/               # shadcn/ui 基础组件
│   │   ├── auth/             # 登录组件
│   │   └── setup/            # 初始化向导
│   ├── hooks/                # TanStack Query Hooks
│   └── lib/                  # 工具函数、API 客户端、Store
├── install/                  # AgentTeams 集成安装脚本
├── public/                   # 静态资源
├── Dockerfile
├── Makefile                  # 多架构 Docker 构建/推送
├── next.config.ts
├── vitest.config.ts
└── package.json
```

## 📜 可用脚本

| 脚本 | 说明 |
|------|------|
| `npm run dev` | 启动开发服务器（端口 3000） |
| `npm run build` | 构建 standalone 产物 |
| `npm start` | 启动生产服务器 |
| `npm run lint` | ESLint 检查 |
| `npm run lint:tone` | AI 味文案扫描（可见文案硬词门禁） |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm test` | 运行 vitest 测试套件 |

## 🧪 质量保障

- **单元测试**：vitest + Testing Library（80 个测试文件共 724 个用例，`npm test`）
- **代码规范**：ESLint 零问题（`npm run lint`）
- **类型安全**：strict TypeScript（`npm run typecheck`）
- **可复现构建**：`npm ci` + lockfile，多架构 Docker 镜像（`make help`）

## 🗺 路线图

- [Worker 卡片生动化改造 + Chat 流式渲染适配（任务书 v0.2）](docs/plans/2026-08-11-worker-card-v2-chat-runtime-ux.md) —— Worker 卡片活物条 / 状态叙述 / 运行时特征区，Chat 五种运行时的流式渲染归属与错误收尾统一，文案去 AI 味。

## 🤝 相关仓库

- [AgentTeams](https://github.com/agentscope-ai/AgentTeams) — 多智能体协作运行时
- [AgentTeams Controller](https://github.com/higress-group/agentteams) — Controller

## 📄 许可证

本项目属于 higress-group，具体许可证请参考仓库根目录授权文件。

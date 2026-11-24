<div align="center">
  <img src="public/agentteams-logo.svg" alt="AgentTeams Logo" width="110" />

  # AgentTeams Dashboard

  **多智能体团队的 Mission Control —— 按「工作进展」与「管理工具」两级工作区督导 Workers、Teams、Humans 与 Managers：任务看板与人工干预、产物与编码执行、资产中心、成员与团队、观测与治理，以及具备运行时感知渲染的 Matrix 聊天与 AI 诊断。**

  [English](./README.md) | [简体中文](./README.zh-CN.md)

  [![Build Dashboard Image](https://github.com/agentteams-group/agentteams-dashboard/actions/workflows/build.yml/badge.svg)](https://github.com/agentteams-group/agentteams-dashboard/actions/workflows/build.yml)
  [![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
  [![React](https://img.shields.io/badge/React-19-149eca?logo=react)](https://react.dev/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38bdf8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
  [![Docker](https://img.shields.io/badge/Docker-ready-2496ed?logo=docker&logoColor=white)](./Dockerfile)
</div>

---

聊天语音输入：点击麦克风录音，转写填入草稿后可编辑再发送。默认本地免费识别，可配置服务端 API Key 启用百炼付费识别。详见[语音输入配置](docs/voice-input.md)。

<!-- TODO(录制)：以下三张占位图替换为真实截图/动图——录制清单见
     docs/images/README.md（overview 拓扑 / 任务看板 HITL 干预 / Chat 回放）。 -->

<p align="center">
  <img alt="Task board with HITL interventions" width="85%" src="https://github.com/user-attachments/assets/e923d71c-b992-4174-8c14-be98afd95aef" />
</p>
<p align="center">
  <img src="docs/images/demo-chat.gif" alt="Matrix 聊天运行时感知渲染" width="85%" />
</p>

## ✨ 简介

AgentTeams Dashboard 是 [AgentTeams](https://github.com/agentscope-ai/AgentTeams) 的 **Mission Control**——基于 **Next.js** 的操作台，让操作者在一个控制台端到端督导多智能体团队。界面按「工作进展」与「管理工具」两级组织：前者承载日常协作（助手、我的团队、任务看板、产物、编码执行、自动化），后者承载平台治理（资产中心、成员与团队、观测与治理）。两者共享具备运行时感知渲染的 Matrix 聊天、HITL 人工干预、RBAC/审计治理、Tracing 链路追踪与 AI 诊断助手。既可以独立部署，也可以通过一行脚本嵌入到已有的 AgentTeams 安装中。

## 🚀 功能模块

侧栏与工作区信息架构一致——六个一级入口（`workspace-navigation.tsx`），各自带二级页面。标注 L1/L2 的入口受仪表盘等级门控（L1 = 管理员）。

| 区域 | 覆盖内容 |
|------|------|
| **首页** | WORKSPACE 基线总览：焦点任务卡与跳转、指标条（进行中 / 本周完成 / 协作成员 / 工作区资产）、HITL 待决策、命令编排器（一句指令直达 AT 助手会话）、今日焦点与插件卡片插槽 |
| **助手** | 平台 Manager 或当前账号所属团队的 Leader 私聊：团队跳转、草稿持久化、`@` 提及、文件引用、消息操作、线程与运行时感知渲染 |
| **我的团队** | 当前账号已加入的团队工作群，标注 **管理员** / **成员**，Team Admin 可返回自己的 Leader 助手 |
| **工作台** | 任务看板（DAG/loop 视图、attention/HITL 收件箱、暂停/恢复/重规划）、产物（项目 → 任务 → 产物文件树 + 预览/下载）、编码执行（只读的编码 CLI 执行记录与原始日志）、自动化（循环定义画布、模板、试运行、发布/回滚） |
| **资产中心** | 模型（别名路由、可用性、LLM 调优）、工具（MCP 注册表、连接测试、受管接入）、技能（custom / Nacos / builtin）、知识库（Worker 工作区文件 + 2D/3D wikilink 图谱）、文件（Human 文件区：上传、编辑、回收站、配额） |
| **成员与团队** | Agent（Worker）生命周期与详情面板（唤醒/休眠/确保就绪/删除、运行时配置、coding CLI、技能、遥测）、团队、用户。Manager / 平台助手设置位于「助手」菜单，UI 层 L1 可见；真实边界由 Controller 强制 |
| **观测与治理** | 运行时监控插件、Tracing（Langfuse 或阿里云 AgentLoop 查询后端）、操作审计（L2 自审 / L3 全审，可搜索分页事件列表 + 详情面板） |
| **总览 / 问天（设置 → 管理）** | 总览：集群资源计数、Worker 状态、Controller 版本、基础设施健康度。问天（WenTian）：基于日志、会话与 Matrix 消息的 AI 诊断——根因分析、影响评估、修复步骤——日志分析带 SSE 进度条，内置 AgentTeams SRE 专家 Prompt 模板 |
| **Debug Log** | 一键收集调试日志：容器诊断、Agent 会话、Matrix 消息打包成 ZIP 下载，默认 PII 脱敏 |
| **语音输入** | 点击麦克风录音，转写填入草稿后可编辑再发送。默认本地 Whisper 免费识别；可选百炼付费识别（服务端 API Key）。详见 [docs/voice-input.md](docs/voice-input.md) |
| **主题** | 内置亮色 / 暗色 / 高对比度主题，自定义主题编辑器（30+ 参数）支持 JSON 导入/导出，企业 `theme.config.json` 注入 |
| **插件** | 运行时插件系统：5 类扩展点、动态加载、插件级错误隔离、开发热更新、`create-dashboard-plugin` 脚手架 CLI |

## 🛠 技术栈

- **框架**：Next.js 16 + React 19 + TypeScript 5
- **样式**：Tailwind CSS v4 + shadcn/ui
- **状态管理**：Zustand + TanStack Query
- **运行时**：Node.js 22+
- **部署**：Docker，Next.js standalone 输出

## Matrix 聊天

聊天工作区提供 Matrix 房间的虚拟化历史消息、未读感知滚动、消息操作、已读回执与按需加载的线程面板。根消息保留在主时间线；`m.thread` 回复会计入根消息，并在对应线程面板中加载。

运行时消息支持 A2UI 标记、AgentScope runtime `Message` repr 正文、`agentteams.workflow`、Tool Guard 确认消息、HITL 收件箱协议和 legacy 卡片格式。界面可呈现 Markdown、可折叠思考、工具调用、工作流、确认和 A2UI 块。`org.agentteams.run` 作为 runtime adapter 的可选兼容载荷；Dashboard 同时通过标准 Matrix `m.replace` 修订事件处理流式更新。Tool Guard / HITL 确认以可操作卡片呈现，决定以普通 Matrix 回复回写；首页的 HITL 收件箱会跨房间聚合待审批项。

本控制台不实现也不承诺端到端加密：聊天正文经服务端代理明文转发，开启加密的房间在这里会显示为没有新消息。哪几跳是明文、凭据在谁手里、运营者需要确认什么，见 [docs/trust-boundary.md](docs/trust-boundary.md)。

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

## 🕸 MCP 治理

MCP 服务器在 Dashboard 里是治理面，不只是清单：

- **注册表 CRUD** —— MCP 配置存于存储面注册表（名字校验、重复拒绝），在资源中心与技能并列呈现。
- **部署目录** —— Controller 侧 catalog（`GET /api/v1/mcp-servers`，上游 #1250）回报每个 server 接线了哪些 Worker；旧版 Controller 自动降级隐藏该列。
- **受信默认接线** —— catalog 中标记 `trusted` 的 server 在新建 Worker 时默认勾选，新智能体开箱即得获批工具集（可逐 Worker 手动取消）。
- **审计线索** —— MCP 配置变更流入 Dashboard 审计日志（actor、级别、时间戳，追加式 JSONL）。
- **凭据卫生** —— 上游密钥（如 `Authorization` 头）永不回传浏览器；选择器只展示传输类型。

在「资产中心 → 技能 → 配置 Nacos」中填写注册中心、命名空间与凭据。Nacos 3.3 需开启 ARD；如果使用网关或自定义端口，可以填写独立的 ARD 服务地址。「发现 Nacos Skill」支持浏览与搜索已上线的完整包。选择一个 Skill 后可比较各 Worker 的运行时启用版本和工作区版本，再勾选要更新的 Worker。当前运行时版本回读支持本地嵌入式 QwenPaw，其他运行时和离线 Worker 会显示检测结果。

更新已安装的 Skill 时，请使用包含 `3231267` 修复的 QwenPaw Harness 镜像。旧镜像在 Worker 停机同步时可能把旧文件写回分发目录。[QwenPaw PR #18](https://github.com/agentteams-group/agentteams-harness-qwenpaw/pull/18)

选择「查看差异」可检查更新将新增、删除或修改的文件，并排查看工作区与上游的文本内容。如果 Worker 已启用内容一致的版本，勾选并应用即可登记来源，此操作无需重启 Worker。

自定义 Skill 可从「更多 → 发布到 Nacos」首次发布。已关联的 Worker Skill 可从「编辑并发布」编辑工作区包中的文本。填写版本号和变更说明后创建草稿，再点击「提交发布」。提交失败后重新打开面板即可继续同一份草稿。审核通过后可按需完成发布，页面会分别显示上线状态、ARD 发现结果及 Worker 实际启用版本。[接口说明](docs/INTERFACES.md)

## 📦 快速开始

### 作为 AgentTeams 组件安装（推荐）

Dashboard 已集成到 [AgentTeams](https://github.com/agentscope-ai/AgentTeams) 安装脚本中（通过补丁方式）。应用补丁后，安装向导会自动询问是否安装 Dashboard，容器会随 Controller/Manager 一起启动。

- **Dashboard 目标发布标签**：`v1.4.3`（应用版本以 `package.json` 的 `version` 为准：`1.4.3`）
- **安装器默认版本**：`v1.4.3`；设置 `AGENTTEAMS_DASHBOARD_VERSION` 可覆盖
- **默认端口**：`13000`，绑定 `127.0.0.1`（设置 `AGENTTEAMS_LOCAL_ONLY=0` 可暴露到 `0.0.0.0`）
- **可用版本**：https://github.com/agentteams-group/agentteams-dashboard/tags
- **集成 PR**：https://github.com/agentscope-ai/AgentTeams/pull/1075
- **平台支持**：Linux/macOS（Bash 安装器）与 Windows（PowerShell 安装器，经 CI 验证）。

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
| `AGENTTEAMS_DASHBOARD_VERSION` | Dashboard 镜像版本（独立发布） | `v1.4.3` |
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
AGENTTEAMS_DASHBOARD=1 AGENTTEAMS_PORT_DASHBOARD=13000 AGENTTEAMS_DASHBOARD_VERSION=v1.4.3 \
  AGENTTEAMS_NON_INTERACTIVE=1 bash agentteams-install.sh
```

详细集成说明见 [`install/AGENTTEAMS_PATCH.md`](install/AGENTTEAMS_PATCH.md)（含补丁内容、Makefile 目标、验证方法和路线图）。

### 独立运行

```bash
# 安装依赖（可复现安装；首次克隆与每次拉取后执行）
npm ci --no-audit --no-fund --legacy-peer-deps

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
| `NEXT_PUBLIC_BASE_PATH` | URL 基础路径（嵌入部署时用） | `/dashboard` |

### 可选的 Worker 链路追踪

AT 与 Dashboard 不依赖 Langfuse 也能启动。管理员在「控制台 → 治理 → Tracing」打开「可观测配置」，填写 Langfuse 项目查询凭据与已有的 OTLP/HTTP Collector 地址，测试连接、保存并应用到选定的托管 Worker。Collector 需已把数据导出到同一个 Langfuse 项目，且 Worker 能访问它。Collector 侧请使用仅具备写入权限的凭据，项目查询凭据只留在 Dashboard 服务端。

保存后无需重启 Dashboard。自 Worker 链路追踪改造起，可观测配置由 **Controller** 持有：保存在 Controller 命名空间的 `agentteams-observability` Secret（`data["config.json"]`），通过 `PUT /api/agentteams/observability` → `/api/v1/observability/config` 使用调用方自身凭据写入。Dashboard 会剥除客户端提交的 `controllerUrl`，不再读取本地 `observability.json`，也不再读取 `LANGFUSE_*` 环境变量。升级前保存过配置的部署需要管理员在页面重新保存一次；旧文件既不迁移也不删除。密钥字段在 API 投影中只写不读（`secretKeyConfigured` / `collectorHeadersConfigured`），留空表示保留已存值，`revision` 过期返回 `409`。

采集默认关闭。应用时只通过 Controller 既有的 Worker API 合并遥测相关环境变量；运行中的托管 Worker 会重建，休眠中的 Worker 在下次启动时生效。这要求 QwenPaw 或 Hermes 镜像已支持遥测，且 Controller 允许编辑 Worker 环境变量。关闭采集同样需要执行一次「应用」，已入库的 Trace 仍可查询。连接测试或配置写入成功都不代表 Worker 已就绪或已开始上报：请实际运行一个任务并查看对应的 Trace。

Team/Worker 过滤、Trace 列表/详情/会话导出都按当前账号在 Controller 的权限执行。选中 Worker 会同时锁定其运行时。每个 Controller 部署或组织应使用独立的 Langfuse 项目；跨组织复用 Worker 名称不构成租户隔离。Trace 详情包含瀑布图、会话跳转/导出、耗时、Token 总量与用量分布。实现面向 Langfuse v3 写入与 v1 查询 API。

#### 阿里云 AgentLoop

在 Tracing 的「可观测配置」中，将查询后端选为「阿里云 AgentLoop」，填写地域、CMS Workspace，以及通过该 Workspace 的 CMS EntityStore（`apm.trace_set.storage`）定位的原始 Trace SLS Project / Logstore。此处不是 AgentSpace 的 `agent-trajectory` 数据源；绑定关系由管理员显式提供，Dashboard 不自动发现或核实 CMS 绑定。

查询使用官方 `@alicloud/credentials` 服务端默认凭证链，支持 STS、RAM/OIDC 角色等，只授予目标 Trace 数据源的读取权限。浏览器和 Worker 不持有查询密钥。查询后端与四个源字段（地域、CMS Workspace、SLS Project、Logstore）在页面填写，与 Langfuse 配置一样存入 Controller Secret；`AGENTLOOP_SLS_ENDPOINT` 是唯一保留的服务端覆盖项，用于内网或协议测试时替换完整 Project 接入点。

Collector 需配置目标 Workspace 的 OTLP/HTTP 地址和采集鉴权头，也可同时上报 Langfuse。切换查询后端不修改 Collector 的出口。Worker 输出标准入口、Session/Turn、模型用量和模型/工具内容，并保留 Langfuse 兼容字段。查询按官方 raw Span 的纳秒 `startTime` / `duration` 读取；本轮不创建审计事件、轨迹 Pipeline、Dataset 或评估器。

查询逐页确认完整性，不完整页重试但不前进，超出 100000 行、32 MiB 或约 60 秒预算时明确报错，不返回伪完整会话。Session 查询不套最近 24 小时限制，仅覆盖实际保留的数据。列表不返回内容，详情/导出继续校验当前账号的 Worker/Team 权限；未知费用显示未计价。

实现依据[官方 AgentLoop 查询契约](https://help.aliyun.com/zh/agentloop/use-cases/agentloop-data-query-api-usage-guide)和[原始 Trace 格式](https://help.aliyun.com/zh/sls/raw-source-data-format-association-and-minimum-requirements)。已完成本机签名查询、OTLP 和页面夹具验收，云上入库及 AgentLoop 控制台识别留待提供测试端点后验证。

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
│   │   ├── api/              # 代理 API：agentteams、matrix、higress、auth、dashboard、self-update
│   │   ├── replay/           # 会话回放页
│   │   ├── tracing-demo/     # 隔离的 tracing 演示页（显式开启，无 Controller）
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── dashboard/        # 外壳、导航与业务组件
│   │   │   ├── sections/     # 各功能区（chat、tasks、artifacts、loops、files、knowledge 等）
│   │   │   └── settings/     # 设置弹窗页签（后端、主题、插件、更新、语音、管理）
│   │   ├── plugins/          # 插件宿主组件
│   │   ├── ui/               # shadcn/ui 基础组件
│   │   ├── auth/             # 登录组件
│   │   ├── setup/            # 首启配置向导
│   │   └── theme/            # 主题系统
│   ├── hooks/                # TanStack Query Hooks
│   ├── lib/                  # API 客户端、Store、协议解析、RBAC/审计、插件运行时
│   ├── middleware.ts         # 会话门控、身份/等级请求头注入
│   └── __tests__/integration/  # 集成测试（需要真实后端）
├── scripts/                  # dev/start 服务、语音资源、standalone 拷贝、文档一致性、热补丁打包
├── tools/
│   └── create-dashboard-plugin/  # 插件脚手架 CLI
├── install/                  # AgentTeams 集成安装脚本
├── deploy/                   # Docker Compose 部署示例
├── docs/                     # 文档
├── public/                   # 静态资源（含构建期生成的语音模型）
├── Dockerfile
├── Makefile                  # 多架构 Docker 构建/推送
├── next.config.ts
├── vitest.config.ts
└── package.json
```

## 📜 可用脚本

| 脚本 | 说明 |
|------|------|
| `npm run dev` | 准备语音资源后启动开发服务器（端口 3000，日志镜像到 `dev.log`） |
| `npm run prepare:speech` | 下载固定版本 Whisper tiny 模型 + WASM 到 `public/speech/` |
| `npm run build` | 准备语音资源、构建 standalone 产物、拷贝 standalone 资源 |
| `npm start` | 启动生产服务器（日志镜像到 `server.log`） |
| `npm run lint` | ESLint + 排版扫描（`scripts/typography-scan.mjs`） |
| `npm run lint:tone` | AI 味文案扫描（可见文案硬词门禁） |
| `npm run lint:typography` | 仅排版扫描 |
| `npm run typecheck` | TypeScript 类型检查（`tsc --noEmit`） |
| `npm test` | 运行 vitest 单元/组件测试 |
| `npm run test:watch` | Vitest watch 模式 |
| `npm run test:coverage` | Vitest 覆盖率 |
| `npm run test:integration` | 集成测试（需要真实后端 / 3000 端口） |

文档门禁不在 `package.json` 中：`bash scripts/check-docs-consistency.sh`（README/docs 陈旧字符串、安装器版本、链接检查）与 `bash install/agentteams-dashboard-tests.sh`（安装器断言）。

## 🧪 质量保障

- **单元测试**：vitest + Testing Library（470+ 个测试文件共 4000+ 个用例，`npm test`）
- **代码规范**：ESLint 零问题（`npm run lint`）
- **类型安全**：strict TypeScript（`npm run typecheck`）
- **可复现构建**：`npm ci` + lockfile，多架构 Docker 镜像（`make help`）

## 🤝 相关仓库

- [AgentTeams](https://github.com/agentscope-ai/AgentTeams) — 多智能体协作运行时（Controller 位于 [`agentteams-controller/`](https://github.com/agentscope-ai/AgentTeams/tree/main/agentteams-controller) 目录）

## 📄 许可证

本项目采用 Apache License 2.0 许可协议，完整文本见仓库根目录的 [LICENSE](LICENSE) 文件。

# 服务端 API 模块

## 边界与认证

`src/app/api/` 是浏览器与外部服务之间的服务端边界。浏览器不直连 Controller、Matrix 或 Higress，全部请求经服务端代理转发。

### 会话与身份

`src/lib/dashboard-session.ts` 定义三态会话凭据：`sa`（Higress Console 管理员密码登录）、`controller-token`（运维令牌）、`matrix`（Matrix 登录，映射到 L1/L2/L3 Human）。Matrix 登录时 Controller 的 CR 标尺（1=管理员）经 `MATRIX_CR_LEVEL_TO_DASH_LEVEL` 反转为 dashboard 标尺（3=管理员）。`AGENTTEAMS_AUTH_DISABLED=true` 是本地逃生门，合成 `local-admin` L3 身份。

`src/middleware.ts` 通过门禁后向路由注入 `x-agentteams-user` / `x-agentteams-user-level` 两个请求头，服务端 RBAC 与审计归属都以它们为准。matcher 覆盖 `/dashboard{,/*}` 与 `/api/agentteams/*`：`/dashboard` 是旧路径 301 重定向（应用已serve 在根路径），`/api/agentteams/*` 全部需要认证，仅 4 个公开路径例外——`setup/ensure-ai`、`setup/backends`、`mode`、`healthz`。`setup/status` 曾在豁免名单内，因 SEC-06（未认证调用者可借 `?controllerUrl=` 让 dashboard 中继 SA 凭据到任意内网地址）已移回门后。

### 无状态模式

`DASHBOARD_STATELESS=1` 关闭服务端会话，浏览器 Bearer token 成为唯一凭据。`src/lib/static-identity.ts` 逐 token 解析身份：探测 Controller `/api/v1/me`、`/api/v1/humans`、`/api/v1/teams`、`/api/v1/workers` 阶梯，缓存 5 分钟，产出 L3/L2/L1；身份不可达返回 `503`，token 无效返回 `401`。需要服务端凭据的路由族（`storage/`、`higress/ai-routes`、`higress/ai-providers`、`logs/`、`debug-log`、`agentspecs/`、`skills/nacos`、`models/probe`、`infrastructure`、`wen-tian/logs`）在零凭据部署下返回 `501 STATIC_MODE_UNAVAILABLE`（`src/lib/static-mode.ts`）。无状态下 `MATRIX_HOMESERVER_ALLOWLIST` 是硬性要求，未配置时登录与设备吊销路由直接返回 `403 allowlist-not-configured`。

### Controller 代理凭据优先级

`proxy-helper.ts` 的优先级链是：**会话凭据（matrix / controller-token 令牌）> SA 令牌（`AGENTTEAMS_AUTH_TOKEN`，否则逐请求读 `AGENTTEAMS_AUTH_TOKEN_FILE` 以支持轮转）> 浏览器 Authorization 兜底**。存在服务端凭据时永不信任浏览器传来的 `Authorization` 头（防令牌注入）；仅在无会话凭据时才退化为 env → file 顺序。

## RBAC 与审计

`src/lib/rbac-engine.ts` 用 3 级会话等级做纯等级判定（显式规则 deny 优先）：

| 等级 | 权限 |
|---|---|
| L1 | `view`（观察者） |
| L2 | `view` + `wake` / `sleep` / `ensure-ready`（操作者） |
| L3 | 全量 + `create` / `update` / `delete` / `manage`（管理员） |

`src/lib/server-auth.ts` 的 `enforceServerSideRbac` 对 workers / teams / managers / humans 的写操作路由做服务端细粒度校验，403 时自动写一条 warning 审计。

审计查询（`GET /api/agentteams/audit`）按等级分流：要求等级 ≥ 2（L1 返回 `403`，响应体带 `observedLevel` / `requiredLevel`，前端据此区分「身份头缺失」与「等级不足」）；L3 看全量（`scope: 'all'`）；L2 在本地日志路径被强制 `actor = identity.name` 只看自己（`scope: 'self'`），在 Controller 数据平面路径为 team 范围（`scope: 'team'`，`?team=` 必填，缺省自动解析首个可访问团队，跨团队读取被 Controller 以 404 隐藏）。审计写入（POST）为 L3-only。

## 路由分组

| 路径 | 目标 | 职责 |
|---|---|---|
| `/api/auth/{login,logout,session}` | Controller + Matrix | 三态登录、登出与会话探测 |
| `/api/agentteams/{workers,teams,humans,managers}` | Controller | 资源 CRUD |
| `/api/agentteams/workers/{name}/*` | Controller | 状态、唤醒、休眠、就绪、运行时配置、日志、技能、checkpoint |
| `/api/agentteams/{healthz,status,version,cluster-status,setup}` | Controller | 健康、版本、集群和初始化 |
| `/api/agentteams/mode`、`infrastructure`、`monitoring`、`monitoring/[kind]/[name]/logs`、`logs/[component]` | Controller / 容器 | 部署模式、组件健康、容器监控与日志 |
| `/api/agentteams/observability` | Controller Secret | 可观测配置读写（L3）；转发 `/api/v1/observability/config` 与 `/{action}` |
| `/api/agentteams/traces`、`traces/[traceId]` | Langfuse / AgentLoop | 双轨链路查询后端 |
| `/api/agentteams/audit`、`hitl/audit` | 本地 JSONL / Controller | 审计事件查询与写入 |
| `/api/agentteams/projects/*` | Controller | 项目列表、meta、workflow、事件、历史、pause/resume/replan、attention、spawns、产物与任务取消 |
| `/api/agentteams/tasks*`、`team-tasks` | Controller | 任务查询与操作 |
| `/api/agentteams/coding-runs*` | Controller | 编码执行只读记录与原始日志 |
| `/api/agentteams/storage/*` | MinIO SDK | bucket、对象、上传下载与预签名 |
| `/api/agentteams/skills`、`[name]`、`[name]/download` | MinIO SDK | 技能列表、搜索、分页、上传（含覆盖）与 ZIP 下载 |
| `/api/agentteams/skills/nacos/*` | Nacos + 本地文件 | 配置读写、同步、全量同步、SSE 事件、状态、按需下载 |
| `/api/agentteams/skills/nacos/[name]/download` | Nacos + MinIO | 按需拉取并缓存 Nacos 技能内容 |
| `/api/agentteams/mcps`、`mcps/[name]`、`mcps/manage`、`mcp-catalog` | MinIO + Higress + Controller | MCP 目录、受管接入、工具发现与调用 |
| `/api/agentteams/models*`、`models/probe`、`model-access-tables`、`sglang-models` | Controller / Higress | 模型别名、可用性探测与访问表 |
| `/api/agentteams/speech`、`speech/config` | DashScope / 本地 | 语音识别与配置（GET 任意级 / POST ≥ L2 / 配置 ≥ L3） |
| `/api/agentteams/wen-tian/logs` | 容器 + Matrix + LLM | 问天诊断 SSE 流 |
| `/api/agentteams/debug-log` | Controller + Matrix | 一键收集调试日志：容器诊断/日志、Agent 会话、Matrix 消息，脱敏后打包 ZIP 下载 |
| `/api/agentteams/replay/export` | Controller + Matrix | 会话回放导出（脱敏） |
| `/api/agentteams/humans/[name]/files`、`teams/[name]/files`、`workers/[name]/workspace-files` | MinIO / 工作区 | Human 私有文件、团队共享文件、Worker 工作区文件 |
| `/api/dashboard/plugins*` | 本地 `public/plugins/` | 插件包（zip）上传、列表、卸载 |
| `/api/dashboard-build` | 本地 | 只读 buildId + version + builtAt（免认证、`no-store`） |
| `/api/self-update` | GitHub Release | 热更新下载与校验 |
| `/api/dashboard/theme` | 本地文件 | 企业主题配置注入 |
| `/api/matrix/*` | Matrix Client-Server API | 登录、同步、房间、消息、媒体、检索和输入状态 |
| `/api/higress/*` | Controller 网关 API 为主，Higress Console 为回退 | Provider 和 AI Route 管理；`AGENTTEAMS_HIGRESS_ADAPTER_MODE=external` 时直连 Console |

`proxy-helper.ts` 是 Controller 路由公共出口：它验证可选 `controllerUrl`（SSRF 校验）、应用 10 秒超时、透传授权与上游响应，并给浏览器响应设置禁止缓存头。Matrix 路由校验 homeserver 允许列表；Higress 路由校验 Console 主机、转发会话 Cookie，并从 Provider 响应移除 Token 值。

## 外部模式

`AGENTTEAMS_HIGRESS_ADAPTER_MODE=external` 时，Worker 与 Manager 的创建、更新，以及 Worker 唤醒和就绪操作会检查请求模型别名是否能绑定到可用 Provider、AI Route 和目标模型。带遗留 `modelProvider` 的请求返回迁移错误。

## 错误语义

Controller 网络或超时错误返回 `502`，上游业务状态原样透传。Higress 路由将输入、会话、部署配置和代理错误分别映射为 `400`、`401`、`503`、`502`。MinIO 将参数、已存在 bucket 和不存在 bucket 分别映射为 `400`、`409`、`404`。无状态模式下不可用的服务端凭据路由返回 `501`。

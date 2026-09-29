# AgentTeams Dashboard 接口

## 前端数据层

`src/lib/agentteams-api.ts` 定义 Worker、Team、Human、Manager、基础设施和存储相关类型，并通过 `/api/agentteams/*` 调用 Controller。

`src/lib/higress-api.ts` 定义 `LlmProvider`、`LlmProviderResponse`、`AiRoute` 及对应的创建和更新请求。Provider 响应使用 `tokenCount` 表示凭据数量。

## Team workerMembers 契约

Controller 的 Team 创建/更新接收 `workerMembers: [{name, role}]`，必须恰好包含一个 `role=team_leader`，且每个被引用的 Worker 都必须是已存在的 Worker 资源（否则返回 `referenced Worker X does not exist`）。`buildWorkerMembers` 将 UI 的 `leader + workerNames` 映射为该数组：leader 以 `team_leader` 角色进入，名称去重。Controller 在创建团队时不会自动创建成员，因此 `ensureWorkersExist` 先列出已有 Worker，对缺失成员以 `{name, runtime}` 最小载荷创建后再提交团队（创建与编辑均适用）。

## Higress 数据面端点（对外接口）

以下是 Higress Gateway 暴露给 Manager/Worker/外部客户端的数据面端点，Dashboard 不直接代理这些端点，但其健康检查与模型绑定逻辑以其口径为准：

| 端点 | 方法 | 说明 |
|---|---|---|
| `/v1/chat/completions` | POST | 对话补全（支持流式），Controller 的就绪探测端点（`IsManagerLLMAuthReady`） |
| `/v1/embeddings` | POST | 向量化（配置 memorySearch 时使用） |
| `/v1/models` | GET | **不是**完整的 OpenAI 模型列表端点；ai-proxy 仅匹配 chat/completions 与 embeddings。`/v1/models` 仅作为认证/连通性探测（401/403=key 或 allowedConsumers 有误，404=非 ai-proxy 路由） |
| `/mcp-servers/{name}/mcp` | POST | MCP Server 端点（Streamable HTTP），name 为 MCP Server 名（内置 GitHub 为 `mcp-github`），按 `consumerAuthInfo` 做 per-consumer 授权 |
| `worker-{name}-{port}-local.agentteams.io` | * | 暴露的 Worker 端口（服务发布），**无认证**（公开访问），域名绑定在网关端口 |

AI 路由默认 `default-ai-route`，路径前缀 `/v1`，上游由 `AGENTTEAMS_LLM_PROVIDER` 决定。嵌入模式下容器内网关地址为 `http://aigw-local.agentteams.io:8080`（宿主机 `:18080`），Console 容器内 `http://agentteams-controller:8001`（宿主机 `:18001`）。

## Higress 认证方式汇总

| 接口 | 机制 | 凭据 |
|---|---|---|
| LLM AI 路由（`/v1/*`） | key-auth WASM（Bearer） | Consumer `GatewayKey`（`Authorization: Bearer <key>`），按 `authConfig.allowedConsumers` 隔离 |
| MCP 端点（`/mcp-servers/*`） | key-auth（Bearer），经 `consumerAuthInfo` | Consumer `GatewayKey` |
| 暴露的 Worker 端口 | 无（公开） | — |
| OpenClaw Console 路由 | basic-auth | `AGENTTEAMS_ADMIN_USER` / `AGENTTEAMS_ADMIN_PASSWORD` |
| Higress Console API | session cookie | `POST /session/login` |

## Higress 控制面 Console API（参照）

Dashboard 仅代理其中的 ai-providers 与 ai-routes 子集；完整控制面口径如下（路径前缀 `/v1`，session-cookie 认证，`POST /system/init` 初始化 admin、`POST /session/login` 获取 cookie）：

| 端点 | 方法 | 用途 | Dashboard 是否代理 |
|---|---|---|---|
| `/v1/ai/providers` + `/{name}` | GET/POST/PUT/DELETE | LLM Provider 管理 | 是（`/api/higress/ai-providers`） |
| `/v1/ai/routes` + `/{name}` | GET/POST/PUT/DELETE | AI 路由管理（含 `authConfig.allowedConsumers`） | 是（`/api/higress/ai-routes`） |
| `/v1/consumers` + `/{name}` | GET/POST/DELETE | key-auth Consumer 管理 | 否（经 Controller `/api/v1/gateway/consumers`） |
| `/v1/domains`、`/v1/service-sources`、`/v1/routes` | GET/POST/PUT/DELETE | 域名、服务源、经典路由 | 否 |
| `/v1/routes/{name}/plugin-instances/{plugin}` | PUT | 路由插件配置（如 basic-auth） | 否 |
| `/v1/mcpServer`、`/v1/mcpServer/consumers` | GET/PUT | MCP Server 与 Consumer 授权 | 否 |
| `/system/higress-config` | GET/PUT | 网关配置（如 stream idleTimeout） | 否 |

## 技能中心与 Nacos 集成契约

### 技能来源与元数据

`SkillEntry` 定义技能的核心属性：`name`、`description`、`source`（`custom`/`nacos`/`builtin`）、`sourceAlias`、`version`、`createdAt`、`updatedAt`、`fileCount`。MinIO `skills` bucket 中元数据结构为 `skills/{name}.json`，文件内容存储在 `{name}/` 前缀下。

### 技能上传与覆盖

`POST /api/agentteams/skills` 接受 multipart/form-data，包含 `file`（ZIP 包）和可选的 `overwrite=true` 字段：

- 技能不存在：直接创建，`source` 设为 `custom`，返回 201。
- 技能已存在（`overwrite=false`）：返回 409 与 `conflict: true`，附带现有技能元数据。
- 技能已存在（`overwrite=true`）：删除旧文件后覆盖。Nacos 来源技能不可覆盖（返回 403）。
- 覆盖时 `createdAt` 保留原始时间，`updatedAt` 更新为当前时间。

### Nacos 技能下载

`GET /api/agentteams/skills/nacos/{name}/download` 专用于 Nacos 来源技能的下载，支持 MinIO 缓存策略：

1. 检查 MinIO 中是否已有该技能的文件内容（`{name}/` 前缀下），有则直接打包返回。
2. 缓存未命中时，根据 Nacos 配置的 `mode` 从注册中心拉取：
   - `skills` 模式：调用 `/v3/console/ai/skills/detail`，解析 base64 编码的 ZIP。
   - `services` 模式：通过 `/v1/ns/catalog/services` 查找匹配服务，从 `homePageUrl` 下载 ZIP。
3. 拉取成功后将文件缓存到 MinIO 以加速后续请求。

### Worker 技能安装

Worker 创建或编辑时指定的 `skills` 数组为技能名称列表。Dashboard 的 `syncWorkerSkills` 函数逐一处理：调用通用 `downloadSkill`，403 时降级到 `downloadNacosSkill`，获取 ZIP 后通过 `POST /api/agentteams/workers/{name}/skills` 推送到 Worker。安装过程在 UI 中展示进度（每个技能显示加载中/成功/失败状态），失败技能不阻塞其他技能的安装。

## Higress matchType 契约

Higress SDK `RoutePredicateTypeEnum` 线上枚举值为 `EQUAL`/`PRE`/`REGULAR`；swagger 注释中的 `EXACT`/`PRE`/`REGEX` 是注解前缀而非线上值。序列化时 UI 的精确匹配 `EXACT` 映射为 `EQUAL`（`normalizeMatchTypeForApi`）；读取时 `EQUAL` 还原为 `EXACT`，并兼容旧版以 `^...$` 锚定的 `REGEX` 数据（`restoreMatchTypeFromApi`）。AI 路由强制 `pathPredicate.matchType === "PRE"`（否则返回 `pathPredicate must be of type PRE`），表单锁定为前缀；`modelPredicates` 仅允许 `EQUAL`/`PRE`（`AiModelPredicate` 拒绝正则）。`validateAiRoutePayload` 在提交前强制执行以上约束。

## MinIO Worker 名称约束

嵌入式模式下 Worker 名用作 MinIO 访问密钥，长度必须为 3-20 字符，否则 provisioning 报 `access key length should be between 3 and 20`。`src/lib/resource-name.ts` 的 `workerNameError` 在 Worker 创建、团队创建与团队编辑对话框执行该校验并阻止提交。

## Dashboard API 路由

| 路径前缀 | 目标系统 | 主要职责 |
|---|---|---|
| `/api/agentteams/*` | AgentTeams Controller | 集群资源、状态、安装、存储、日志和消费者管理 |
| `/api/matrix/*` | Matrix Homeserver | 登录、房间、消息、成员、上传和同步 |
| `/api/higress/ai-providers` | Higress Console | Provider 列表和创建 |
| `/api/higress/ai-providers/[name]` | Higress Console | 单个 Provider 读取、更新和删除 |
| `/api/higress/ai-routes` | Higress Console | AI Route 列表和创建 |
| `/api/higress/ai-routes/[name]` | Higress Console | 单个 AI Route 读取、更新和删除 |
| `/api/agentteams/skills` | MinIO | 技能列表（支持 source、search、分页）与上传（支持 overwrite 覆盖） |
| `/api/agentteams/skills/[name]` | MinIO | 单个技能元数据读取、更新与删除 |
| `/api/agentteams/skills/[name]/download` | MinIO | 下载技能 ZIP 包 |
| `/api/agentteams/skills/nacos/config` | 本地配置 | Nacos 注册中心配置的读取与写入 |
| `/api/agentteams/skills/nacos/sync` | Nacos + MinIO | 触发从 Nacos 同步技能元数据 |
| `/api/agentteams/skills/nacos/[name]/download` | Nacos + MinIO | 从 Nacos 拉取技能内容（支持 MinIO 缓存） |
| `/api/agentteams/workers/[name]/skills` | Controller | 向 Worker 推送技能包 |
| `/api/agentteams/debug-log` | Controller + Matrix | 一键收集调试日志：容器诊断/日志、Agent 会话、Matrix 消息，脱敏后打包 ZIP 下载 |
| `/api/auth/*` | 本地或 Higress 会话 | 登录与会话状态 |

## 外部配置契约

| 变量 | 作用 |
|---|---|
| `AGENTTEAMS_CONTROLLER_URL` | Dashboard 服务端访问 Controller 的地址 |
| `NEXT_PUBLIC_MATRIX_API_URL` | Matrix Homeserver 地址 |
| `AGENTTEAMS_AI_GATEWAY_URL` | Higress Gateway 数据平面地址 |
| `AGENTTEAMS_AI_GATEWAY_ADMIN_URL` | Higress Console 管理地址 |
| `AGENTTEAMS_AI_GATEWAY_ADMIN_ALLOWED_HOSTS` | Console 允许主机集合 |
| `AGENTTEAMS_HIGRESS_ADAPTER_MODE` | Higress 适配模式，规划值为 `direct` 或 `external` |

`GET /api/agentteams/infrastructure` 的 `higress` 字段包含 `mode`、`gateway` 与 `console`。每个外部服务状态通过 `configured`、`endpoint`、`state`、可选的 `httpStatus` 和 `error` 表示；`state` 取值为 `unconfigured`、`reachable` 或 `unreachable`。Console 管理地址使用 5 秒 `GET /` 探测，任何 HTTP 响应都标记为 `reachable`。Gateway 数据平面则按 Higress 就绪口径探测 `POST /v1/chat/completions`：仅 `404`（路径未被 ai-proxy 代理）判为 `unreachable`，`200`/`401`/`403` 均证明数据面已在服务 AI 流量而判为 `reachable`；网络错误/超时为 `unreachable`。

`AGENTTEAMS_AI_GATEWAY_ADMIN_ALLOWED_HOSTS` 是逗号分隔的精确 Console 主机名集合。`external` 模式要求同时设置该变量和 `AGENTTEAMS_AI_GATEWAY_ADMIN_URL`；地址、协议或主机校验失败会阻止 Console 代理请求，并返回部署配置错误。

外部模式的首次页面加载仅请求基础设施状态，`POST /api/agentteams/setup/ensure-ai` 返回 `409` 且不创建 Consumer 或 AI Route。Manager、Worker 的创建和模型更新，以及 Worker 的唤醒和就绪操作，都会检查请求模型别名是否已绑定到具备 Token 的 Provider 和目标模型；不可用绑定返回 `409`。

模型管理区在 Higress Console 已配置、连通且浏览器会话有效时才查询 Provider 和 AI Route。`POST`、`PUT`、`DELETE` `/api/higress/ai-providers/*` 与 `/api/higress/ai-routes/*` 同样验证部署配置和 Console 会话；配置错误返回 `503`，无有效会话返回 `401`。

Higress Console API 固定使用 `v1` 路径。`fallbackConfig` 接受 JSON 对象；`enabled`、`maxRetries`、`retryOn`、`retryStatusCodes` 和 `fallbacks` 执行受限类型校验，Console 返回的未知字段会保留并以摘要形式展示。

验证记录：`npm run lint`、`npm run typecheck` 与 `git diff --check` 已通过。完整 `npm test` 全量通过（58 个测试文件 445 个用例）。

## 运行时块协议（`org.agentteams.run` v1）

> 契约源码：`src/lib/a2ui/protocol.ts`（union 与归一化）；解析分流：`src/lib/a2ui/parser.ts` `parseAgentRunBlocks`；叙述背景见 `docs/ARCHITECTURE.md`「运行时消息协议」。本节是字段规范（B4）。

**信封**：Matrix 消息 `content['org.agentteams.run']`（opt-in 通道；无该键时 Dashboard 走 body 文本启发式）。

| 信封字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `version` | `"1"` \| `"0"` \| 缺省 | 否 | `"0"`/缺省 = 旧宽松形状；`"1"` = 归一化形状。其他值 = 未知版本 → 解析器返回 `undefined`，调用方回退文本启发式（**永不丢消息**） |
| `run_id` | string | 否 | 关联同一次执行的多条消息（v1 预留） |
| `step_id` | string | 否 | run 内当前步骤（v1 预留） |
| `blocks` | Block[] | 是 | 块数组，见下 |

**块 union**（`type` 判别）：

| type | 字段 | 说明 |
|---|---|---|
| `text` | `text: string`；`isStreaming?` | 正文片段 |
| `thinking` | `content: string`；`isStreaming?` | 思考片段（折叠卡片） |
| `tool_call` | `payload.tool_name: string`、`payload.arguments: object`、`payload.status: 'pending'\|'running'\|'succeeded'\|'failed'`；可选 `result`、`tool_call_id`（跨修订/重放去重的稳定 id）、`started_at`/`finished_at`（epoch ms） | 工具调用卡 |
| `confirmation` | `payload.tool_name: string`、`payload.confirmation_id: string`（必填，关联批准/拒绝回复）；可选 `parameters`、`external_files`、`expires_at` | Tool Guard 审批卡 |
| `error` | `payload.kind: 'cancelled'\|'failed'\|'quiet'`、`payload.title: string` | run 收尾哨兵（kind 之外的值被拒 → 回退文本启发式） |

**版本协商与回退语义**：

1. `resolveProtocolVersion`：`"1"` → v1；缺省/`null`/`"0"` → legacy；其余 → 未知（解析器整体返回 `undefined`）。
2. v1 归一化（`normalizeToolCallPayload` 等）：缺省可选字段补安全默认（如 `status` 缺省 `running`），未知字段剥除保证可序列化；`confirmation` 缺 `confirmation_id`、`error` 的 `kind` 非法 → 该块被拒，调用方回退 legacy 文本启发式（审批卡仍可见）。
3. 未知块类型静默跳过；未知**信封版本**整体回退——前向兼容承诺：新版本字段对旧 Dashboard 表现为纯文本启发式渲染，不炸、不丢。
4. 回退链路有测试钉住：`parser-agent-run.test.ts`（解析层返回 `undefined`）+ `normalize.test.ts`「falls back to the body-text heuristics when the protocol version is unknown」（normalize 链路落到 legacy 块）。

## 上游版本对照记录

> B3（2026-09-29 起）：Dashboard 依赖的 Controller 契约随上游 `agentscope-ai/AgentTeams` minor 版本演进。每条契约记录「Dashboard 依赖 → 上游落点 → 版本/PR」。上游 minor 发布后按 CONTRIBUTING 的流程过一遍 proxy 层端点；安装器漂移由 weekly cron（`.github/workflows/upstream-drift.yml`）告警。

### v1.2.4 口径（2026-09-29 落定）

| 契约点 | Dashboard 依赖 | 上游落点 | 复核方式 |
|---|---|---|---|
| 项目事件流分页 | `GET /api/agentteams/projects/{id}/events` 透传 `limit`（1..200，控制器默认 50）与不透明 `cursor`，翻页直到 `next_cursor` 耗尽（单次打开封顶 10 页 × 200 = 2000 条） | `GET /api/v1/projects/{id}/events`，上游 PR #1233（任务状态转换引擎：table + history + events + progress） | `src/app/api/agentteams/projects/[id]/events/route.ts` 注释 + `project-events-panel.tsx` 游标循环 |
| Worker env 编辑 | `PUT /api/v1/workers/{name}` 请求体新增 `env`（字面量 key/value，未变更整体省略）；响应含 `env` / `envEditable`，非管理员读响应被 Dashboard 剥除 | controller 侧 worker 配置接口（与 dashboard PR #135 同期的上游能力，见 `.monkeycode/specs/dashboard-optimization/b1-upstream-alignment.md` 复核要点） | `workers/environment-access.ts` + B1 对照清单 |
| gateway 身份探测 | `POST /api/agentteams/workers/{name}/gateway-probe` 纯透传至 `POST /api/v1/workers/{name}/gateway-probe`（RBAC `update` × `gateway.consumer`），错误语义原样返回 | 同上 | `workers/[name]/gateway-probe/route.ts` + route.test.ts |
| 审计字段 | Dashboard 自持 JSONL 审计日志（`AuditEventRecord`：id/timestamp/severity/actor/actor_level/entity_type/entity_name/action/details/source_ip），**不依赖** controller 审计端点 | 无上游契约（dashboard-owned） | `src/lib/audit-log.ts` |
| 请求模型别名 | Manager/Worker 的 `model` 字段语义 = 请求模型别名（经 AI 网关路由），非 Higress Provider 名；存量非空值原样重提交 | `install/AGENTTEAMS_PATCH.md`「Request Model Alias Migration」 | `external-model-binding-guard` 路由守卫 |
| 安装器 dashboard 集成 | 本仓 `install/agentteams-install.sh` 为上游 `install/agentteams-install.sh` 的工作副本（PR #1075 已并入上游，后续 #1081/#1118/#1162/#1195） | `agentscope-ai/AgentTeams` main | weekly drift cron + `install/AGENTTEAMS_PATCH.md` |

## 安全边界

- Controller API 使用 Dashboard 服务端代理与授权令牌。
- Matrix 代理限制可访问的 homeserver 主机。
- Higress Provider 响应不会向浏览器返回 Token 值。
- Higress Console Cookie 仅由服务端代理转发。

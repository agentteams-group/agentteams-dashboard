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

验证记录：`npm run lint`、`npm run typecheck` 与 `git diff --check` 已通过。`npm test -- infrastructure` 通过 4 项测试，Higress 相关专项测试通过 20 项。完整 `npm test` 的其余 10 个 Hook 测试受全局 `node_modules` 引入的 React 双实例影响，相关功能代码未参与这些失败。

## 安全边界

- Controller API 使用 Dashboard 服务端代理与授权令牌。
- Matrix 代理限制可访问的 homeserver 主机。
- Higress Provider 响应不会向浏览器返回 Token 值。
- Higress Console Cookie 仅由服务端代理转发。

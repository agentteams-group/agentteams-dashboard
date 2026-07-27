# AgentTeams Dashboard 接口

## 前端数据层

`src/lib/agentteams-api.ts` 定义 Worker、Team、Human、Manager、基础设施和存储相关类型，并通过 `/api/agentteams/*` 调用 Controller。

`src/lib/higress-api.ts` 定义 `LlmProvider`、`LlmProviderResponse`、`AiRoute` 及对应的创建和更新请求。Provider 响应使用 `tokenCount` 表示凭据数量。

## Dashboard API 路由

| 路径前缀 | 目标系统 | 主要职责 |
|---|---|---|
| `/api/agentteams/*` | AgentTeams Controller | 集群资源、状态、安装、存储、日志和消费者管理 |
| `/api/matrix/*` | Matrix Homeserver | 登录、房间、消息、成员、上传和同步 |
| `/api/higress/ai-providers` | Higress Console | Provider 列表和创建 |
| `/api/higress/ai-providers/[name]` | Higress Console | 单个 Provider 读取、更新和删除 |
| `/api/higress/ai-routes` | Higress Console | AI Route 列表和创建 |
| `/api/higress/ai-routes/[name]` | Higress Console | 单个 AI Route 读取、更新和删除 |
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

`GET /api/agentteams/infrastructure` 的 `higress` 字段包含 `mode`、`gateway` 与 `console`。每个外部服务状态通过 `configured`、`endpoint`、`state`、可选的 `httpStatus` 和 `error` 表示；`state` 取值为 `unconfigured`、`reachable` 或 `unreachable`。已配置地址使用 5 秒 `GET /` 探测，任何 HTTP 响应都会标记为 `reachable`。

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

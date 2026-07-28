# 服务端 API 模块

## 边界与认证

`src/app/api/` 是浏览器与外部服务之间的服务端边界。`src/middleware.ts` 保护 `/dashboard/*` 和大多数 `/api/agentteams/*` 请求；setup 状态和 ensure 路由服务于启动流程。Controller 代理优先使用 `AGENTTEAMS_AUTH_TOKEN`，否则逐请求读取 `AGENTTEAMS_AUTH_TOKEN_FILE` 以支持令牌轮转。

## 路由分组

| 路径 | 目标 | 职责 |
|---|---|---|
| `/api/agentteams/{workers,teams,humans,managers}` | Controller | 资源 CRUD |
| `/api/agentteams/workers/{name}/*` | Controller | 状态、唤醒、休眠和就绪 |
| `/api/agentteams/{healthz,status,version,cluster-status,setup}` | Controller | 健康、版本、集群和初始化 |
| `/api/agentteams/storage/*` | MinIO SDK | bucket、对象、上传下载与预签名 |
| `/api/matrix/*` | Matrix Client-Server API | 登录、同步、房间、消息、媒体和输入状态 |
| `/api/higress/*` | Higress Console | Provider 和 AI Route 管理 |

`proxy-helper.ts` 是 Controller 路由公共出口：它验证可选 `controllerUrl`、应用 10 秒超时、透传授权与上游响应，并给浏览器响应设置禁止缓存头。Matrix 路由校验 homeserver 允许列表；Higress 路由校验 Console 主机、转发会话 Cookie，并从 Provider 响应移除 Token 值。

## 外部模式

`AGENTTEAMS_HIGRESS_ADAPTER_MODE=external` 时，Worker 与 Manager 的创建、更新，以及 Worker 唤醒和就绪操作会检查请求模型别名是否能绑定到可用 Provider、AI Route 和目标模型。带遗留 `modelProvider` 的请求返回迁移错误。

## 错误语义

Controller 网络或超时错误返回 `502`，上游业务状态原样透传。Higress 路由将输入、会话、部署配置和代理错误分别映射为 `400`、`401`、`503`、`502`。MinIO 将参数、已存在 bucket 和不存在 bucket 分别映射为 `400`、`409`、`404`。

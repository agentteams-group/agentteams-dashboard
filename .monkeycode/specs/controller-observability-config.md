# Controller 可观测配置与查询对照

本次依赖 [AgentTeams PR #1597](https://github.com/agentscope-ai/AgentTeams/pull/1597) 的 Controller 可观测 API，基于 main `fb7fffde`，配套任务为 agentscope-ai/AgentTeams#1531。先部署支持这些端点的 Controller，再更新 Dashboard。

| 浏览器请求 | Controller 端点 | 字段与错误语义 |
|---|---|---|
| GET/PUT /api/agentteams/observability | GET/PUT /api/v1/observability/config | backend、agentloop、enabled、captureContent、mode、Langfuse 地址/项目/凭据、Collector 地址/headers、revision；凭据只写，响应为 *Configured 标志；409 表示并发配置变化 |
| POST action=test | POST /api/v1/observability/test | settings 草稿；空密码保留已存值；失败不回传后端原始错误或密钥 |
| POST action=apply | POST /api/v1/observability/apply | workers、revision；逐 Worker results；保留无关 env，重建后生效 |
| GET /api/agentteams/traces | GET /api/v1/traces | worker/team/runtime/task/session/room/project/hours/page；沿用 TraceList 形状 |
| GET /api/agentteams/traces/{traceId} | GET /api/v1/traces/{traceId} | 32 位 hex ID；授权后读取完整 observations；沿用 TraceDetail 形状 |

所有代理使用调用方凭据和固定部署 Controller，移除 controllerUrl 覆盖参数。Controller 配置保存在 agentteams-observability Secret；Langfuse 密钥不返回 Dashboard，Worker 只接收采集配置。管理员写入，Manager/Leader 按 Controller 的团队和资源权限查询。

AgentLoop 保留 Dashboard 现有云凭据查询链，但后端选择和源字段同样读取 Controller。升级时管理员重新录入旧 Dashboard 本地文件中的配置；不自动读取、删除旧私有文件，也不回退到旧环境变量。

验证覆盖配置/测试/应用代理、凭据转发、固定 Controller、错误透传、Langfuse 列表详情及 AgentLoop 兼容；原生采集与 Manager/Leader 分析由配套 AgentTeams 集成验收负责。

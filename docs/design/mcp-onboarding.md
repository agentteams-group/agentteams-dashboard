# MCP 接入、验证与授权

## 用户流程

列表的主要操作是「接入 MCP」。弹窗分三步：选择已有 MCP、HTTP API 或数据库；填写连接；保存网关配置并发现工具。Header、Query 和超时默认折叠，认证字段按方式出现。复杂 HTTP API 可导入 OpenAPI，或编辑工具 YAML。

接入后进入详情，包含工具与调试、连接配置、Agent 授权三个页签。发现工具只执行 initialize、notifications/initialized、tools/list；只有点击「运行工具」才调用业务工具。工具参数从实际 inputSchema 生成。

默认不授权业务 Agent。选择 Agent 并保存时，更新它原有 MCP 列表中的当前服务条目，并向网关提交该 Consumer 的授权。其他 MCP 条目保留。撤销时先撤销网关权限，再移除 Agent 的配置。授权提交与实际生效分开；验证权限使用 Controller 的真实 Worker Consumer 探测接口。

旧地址登记保留在列表更多菜单，单独标为「地址登记」。原有接口只管理登记，不创建网关服务，也不能覆盖或删除受管记录。

## 请求与凭证

```text
Agent -- Consumer Bearer --> Higress -- 后端凭证、Header、Query --> MCP / API
```

- 已有 MCP 使用 DIRECT_ROUTE；后端可选 Streamable HTTP 或 SSE。Agent 的地址始终使用部署配置的网关数据面。
- HTTP API 使用 OPEN_API。可视化参数生成 `args[].position`，由网关映射 Path、Query、Header、Body；JSON 请求体使用网关原生 `argsToJsonBody`，保留对象、数组和标量类型，不手动拼 JSON。
- 数据库使用 DATABASE，支持 MySQL、PostgreSQL、ClickHouse。数据库地址必须能从网关访问；部署还需要开启 Higress 数据库 MCP 数据面。页面不会擅自切换全局开关。

原生代理的固定参数使用独立的 `agentteams-mcp-headers` 插件注册项，复用已安装 transformer 的镜像，执行于 AUTHZ / priority 10。实例只绑定到该受管 MCP 的内部路由。Higress 自带 transformer 在 AUTHN 中早于 key-auth 执行，不能直接用它替换 Authorization，否则会先覆盖 Agent 凭证，导致网关认证失败。此实现不修改共享 transformer 的执行顺序。

网关身份验证通过后移除 Agent 的 Authorization，再注入后端认证；无需认证的后端也不会收到 Consumer 凭证。固定 Query 不覆盖 SSE 自身的会话参数。工具 Body 仍遵循原生 MCP JSON-RPC，不提供随意改写协议消息的表单。

每个受管服务有一个随机命名的内部验证 Consumer，只获准访问该 MCP；不授予模型路由或其他 MCP 权限。验证凭证与后端凭证存于服务端 MinIO 记录，不返回浏览器。读取时遮罩敏感字段；编辑留空保留原值，删除参数行移除该参数，切换「无需认证」清除认证。工具结果中已知的凭证也会脱敏。

## 服务端边界

`/api/agentteams/mcps/manage` 的全部操作先检查管理员身份。Console 调用复用已有的部署地址校验和会话客户端；没有可用会话时，只能使用部署已配置的服务端管理员凭证重新登录。Controller token 不会被当作 Console token 使用。

受管配置仍保存在现有 `mcp-servers/` 目录，增加 connection、网关写入状态、验证结果与授权关系。先保存重试所需的数据，再操作网关；远端写入失败的记录保留为「接入失败」，不能显示验证成功。修改配置清除旧验证结论。

连接验证支持有会话的 Streamable HTTP 和旧 SSE、分块事件、JSON-RPC ID 匹配、工具分页、超时及禁止重定向。SSE 的消息端点必须与连接地址同源。工具调试重新发现工具，不允许调用列表之外的工具。

删除有 Agent 使用的服务会被拒绝。删除空服务时移除网关 MCP、内部验证 Consumer 与目录记录；404 可重试。DNS 服务来源保留，因为网关其他路由可能引用它。

## 验证

- 定向测试覆盖认证边界、凭证遮罩与留空保留、参数编译、分块 SSE、工具分页、表单分步与失败重试、工具参数类型、授权失败展示。
- 本地网关实际验证 Streamable HTTP、SSE、Bearer 与多个 Header、Query；HTTP API 使用中文路径、特殊字符、动态 Header、嵌套 JSON；PostgreSQL 用隔离的只读账号查询测试表。
- 使用 Worker 身份验证授权，检查原 MCP 配置保留、使用中删除拦截、撤销后配置恢复。
- 检查桌面和 390px 视口下的表单布局，构建、TypeScript、ESLint 与字号扫描。

数据库全局开关、Redis、数据库 TLS 和网络由部署管理；网关接受配置并不代表这些前提已满足。SSE 的 Agent 身份验证受当前 Controller 接口限制，详情会提示；SSE 的网关发现与工具调试仍可使用。

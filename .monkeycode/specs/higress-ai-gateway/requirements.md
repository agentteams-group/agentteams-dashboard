# Higress AI 网关适配需求

## 简介

AgentTeams Dashboard 需要提供 Higress AI 网关的统一配置界面，覆盖模型厂商、模型名称适配与 AI 路由策略。Dashboard 通过服务端代理调用 Higress Console，并将凭据仅提交给 Higress。

## 术语

- **Dashboard**：AgentTeams Dashboard 的 Web 管理界面和 Next.js API 路由。
- **Higress Console**：Higress 提供的 AI 厂商与 AI 路由配置服务。
- **模型厂商**：承载 API 凭据、协议、服务地址和模型映射的 Higress Provider。
- **模型映射**：请求模型名称与厂商实际模型名称之间的匹配规则。
- **AI 路由**：将匹配的 AI 请求转发到一个或多个模型厂商的 Higress 路由。
- **上游**：AI 路由中的单个目标模型厂商及其权重和模型映射。
- **凭据**：模型厂商访问令牌或网关消费者认证信息。
- **请求模型别名**：AgentTeams 写入 Manager 或 Worker `model` 字段，并随模型请求发送给 Higress 的稳定模型名称。
- **模型提供方**：AgentTeams `modelProvider` 字段引用的平台模型提供方；上游 Controller 可将该引用解析为内网模型 API 地址。

## 范围

本期覆盖 AgentTeams 与已提供 Higress 实例之间的适配能力，包含模型厂商、模型映射、AI 路由的读取、配置校验和对 AgentTeams 模型值的绑定。运行时请求转发、计费统计、模型目录自动发现与跨集群配置同步留在后续阶段。

Higress 的部署、安装、升级、Console 管理员初始化和默认路由创建不在本期范围。部署管理员通过 AgentTeams 部署环境提供 `AGENTTEAMS_HIGRESS_ADAPTER_MODE=external` 和 `AGENTTEAMS_AI_GATEWAY_URL`，该地址必须透传到 Controller、Manager 和 Worker 的运行时配置；部署管理员可选提供 `AGENTTEAMS_AI_GATEWAY_ADMIN_URL` 和 `AGENTTEAMS_AI_GATEWAY_ADMIN_ALLOWED_HOSTS` 作为 Dashboard 的 Console 管理配置。`AGENTTEAMS_HIGRESS_ADAPTER_MODE` 的默认值为 `direct`。AgentTeams Controller 继续负责 Manager、Worker 的运行时模型消费；Dashboard 负责外部 Higress 的兼容性状态、配置管理和模型绑定呈现。

## 需求

### 需求 1：模型厂商目录与配置

**用户故事：** 作为平台管理员，我希望创建和维护模型厂商，使网关能够使用不同模型服务。

#### 验收标准

1. Dashboard SHALL 展示 Higress Console 返回的模型厂商名称、厂商类型、协议、令牌数量和可公开展示的高级配置。
2. WHEN 管理员提交名称、厂商类型和至少一个凭据，Dashboard SHALL 创建对应的模型厂商。
3. WHEN 管理员打开已有模型厂商，Dashboard SHALL 提供厂商类型、协议、服务地址、凭据轮换策略和模型映射的编辑入口。
4. WHEN 管理员提交模型厂商更新，Dashboard SHALL 将更新后的配置提交给 Higress Console 并刷新厂商列表。
5. IF Higress Console 返回厂商配置错误，Dashboard SHALL 显示该错误并保留管理员当前输入。

### 需求 2：厂商类型与协议适配

**用户故事：** 作为平台管理员，我希望按照厂商要求填写配置，使 Higress 能够使用对应协议访问模型服务。

#### 验收标准

1. Dashboard SHALL 提供 Higress 支持的厂商类型列表及其显示名称。
2. WHEN 管理员选择需要自定义服务地址的厂商类型，Dashboard SHALL 显示服务地址输入字段。
3. WHEN 管理员选择协议，Dashboard SHALL 提供 `openai/v1` 和 `original` 选项。
4. WHEN 管理员启用令牌故障转移，Dashboard SHALL 收集启用状态、失败阈值、成功阈值、健康检查间隔和健康检查模型。
5. IF 数值阈值小于 1 或健康检查间隔小于 1 秒，Dashboard SHALL 阻止提交并指出无效字段。

### 需求 3：模型映射管理

**用户故事：** 作为平台管理员，我希望定义请求模型名称和实际模型名称的映射，使应用能够使用统一模型名称调用不同厂商。

#### 验收标准

1. Dashboard SHALL 支持为模型厂商维护零条或多条模型映射规则。
2. WHEN 管理员新增模型映射规则，Dashboard SHALL 收集匹配模式和目标模型名称。
3. Dashboard SHALL 接受精确匹配、前缀通配符匹配、全局通配符匹配和以 `~` 开头的正则匹配。
4. WHEN 管理员保存模型映射，Dashboard SHALL 将模型映射序列化为 Higress Console 所需的键值结构。
5. IF 同一厂商配置重复的精确匹配键，Dashboard SHALL 阻止提交并标记重复规则。

### 需求 4：AI 路由配置

**用户故事：** 作为平台管理员，我希望维护 AI 路由，使模型请求通过指定路径和策略发送到模型厂商。

#### 验收标准

1. Dashboard SHALL 展示 AI 路由的名称、请求路径、上游厂商、权重、模型匹配条件和认证状态。
2. WHEN 管理员创建 AI 路由，Dashboard SHALL 要求路由名称、路径匹配规则和至少一个上游。
3. WHEN 管理员编辑 AI 路由，Dashboard SHALL 支持添加、修改和移除上游。
4. WHEN AI 路由包含多个上游，Dashboard SHALL 要求所有上游权重的总和为 100。
5. WHEN 管理员为上游配置模型映射，Dashboard SHALL 将上游映射提交给 Higress Console。
6. IF AI 路由引用已移除的模型厂商，Dashboard SHALL 标记该上游并阻止保存。

### 需求 5：路由认证与故障策略

**用户故事：** 作为平台管理员，我希望配置路由访问控制和故障策略，使网关调用遵循组织的访问要求。

#### 验收标准

1. Dashboard SHALL 提供 AI 路由认证启用状态和允许凭据类型的编辑能力。
2. WHEN 管理员启用路由认证，Dashboard SHALL 要求至少选择一种允许凭据类型。
3. Dashboard SHALL 显示 Higress Console 返回的路由回退配置摘要。
4. WHEN Higress Console 支持路由回退配置写入，Dashboard SHALL 将管理员提交的回退配置提交给 Higress Console。
5. IF 路由认证启用且允许凭据类型为空，Dashboard SHALL 阻止提交并显示配置要求。

### 需求 6：凭据与代理安全

**用户故事：** 作为平台管理员，我希望安全提交模型凭据，使浏览器和 Dashboard 存储层不保留敏感值。

#### 验收标准

1. Dashboard SHALL 通过 Next.js API 路由向 Higress Console 提交模型厂商凭据。
2. Dashboard SHALL 从模型厂商读取响应中移除凭据值，并仅向浏览器返回令牌数量。
3. WHEN 管理员编辑模型厂商且未填写新凭据，Dashboard SHALL 保留 Higress Console 中已有凭据。
4. Dashboard SHALL 将 Higress Console 会话 Cookie 转发给对应的 Console 请求。
5. IF Higress Console 地址不符合允许的主机规则，Dashboard SHALL 拒绝代理请求并显示部署配置错误。

### 需求 7：状态、错误与并发更新

**用户故事：** 作为平台管理员，我希望看到配置操作的明确结果，使我能够确认网关配置状态。

#### 验收标准

1. WHEN Dashboard 读取模型厂商或 AI 路由时，Dashboard SHALL 显示加载状态、空状态或错误状态。
2. WHEN 配置写入成功，Dashboard SHALL 刷新受影响的模型厂商和 AI 路由查询缓存。
3. WHILE 配置写入正在进行，Dashboard SHALL 禁用该配置表单的提交操作。
4. IF Higress Console 在 15 秒内未返回，Dashboard SHALL 将操作结果显示为超时错误。
5. WHEN 管理员请求删除模型厂商或 AI 路由，Dashboard SHALL 在确认操作后提交删除请求。

### 需求 8：AgentTeams 模型绑定

**用户故事：** 作为平台管理员，我希望将 AgentTeams 使用的模型名称绑定到 Higress 路由，使 Manager 和 Worker 调用一致的网关入口。

#### 验收标准

1. Dashboard SHALL 将 Manager 和 Worker 的 `model` 字段定义为请求模型别名。
2. WHEN 管理员选择 Manager 或 Worker 的模型，Dashboard SHALL 提交请求模型别名。
3. Dashboard SHALL 展示请求模型别名、路由名称、目标模型厂商和目标模型名称之间的绑定关系。
4. IF 请求模型别名未关联到可用 AI 路由和模型映射，Dashboard SHALL 标记该别名为不可用。
5. WHEN 管理员更新 AI 路由或模型映射，Dashboard SHALL 刷新受影响的请求模型别名状态。

### 需求 9：外部网关适配与兼容性

**用户故事：** 作为平台管理员，我希望将 AgentTeams 连接到已提供的 Higress 网关，使运行时调用和配置管理使用正确的外部地址。

#### 验收标准

1. Dashboard SHALL 分别展示 `AGENTTEAMS_AI_GATEWAY_URL` 和 `AGENTTEAMS_AI_GATEWAY_ADMIN_URL` 的用途与连通状态。
2. WHEN `AGENTTEAMS_AI_GATEWAY_URL` 可用，Dashboard SHALL 显示 AgentTeams 运行时将调用该 Gateway 数据平面地址。
3. WHEN `AGENTTEAMS_AI_GATEWAY_ADMIN_URL` 可用，Dashboard SHALL 提供模型厂商和 AI 路由管理功能。
4. WHILE `AGENTTEAMS_AI_GATEWAY_ADMIN_URL` 未配置，Dashboard SHALL 保留 AgentTeams 的非网关管理功能和 Gateway 运行时状态展示。
5. WHEN 部署使用外部 Higress Console，Dashboard SHALL 仅接受部署管理员配置的允许主机名。
6. WHEN AgentTeams 启动 Manager 或 Worker，AgentTeams SHALL 向运行时提供与 `AGENTTEAMS_AI_GATEWAY_URL` 相同的 Gateway 数据平面地址。
7. WHILE `AGENTTEAMS_HIGRESS_ADAPTER_MODE` 的值为 `external`，Dashboard SHALL 在页面加载和首次启动流程中执行只读状态检查。
8. WHEN `AGENTTEAMS_HIGRESS_ADAPTER_MODE` 的值为 `external`，Dashboard SHALL 排除 `ensure-ai` 配置写入流程。
9. WHILE `AGENTTEAMS_HIGRESS_ADAPTER_MODE` 的值为 `external`，AgentTeams Controller SHALL 使用 `AGENTTEAMS_AI_GATEWAY_URL` 作为 Manager 和 Worker 生成运行时配置的 Gateway 数据平面地址。
10. WHILE `AGENTTEAMS_HIGRESS_ADAPTER_MODE` 的值为 `external`，AgentTeams Controller SHALL 将 Manager 或 Worker 的 `modelProvider` 视为未设置，以保持 Gateway 数据平面地址一致。
11. WHEN 外部模式请求包含非空 `modelProvider`，Dashboard SHALL 返回 409 并说明外部 Higress 使用请求模型别名和 AI Route 绑定。
12. WHEN 外部模式下 Manager 或 Worker 已保存非空 `modelProvider`，Dashboard SHALL 在启动、唤醒和就绪操作前返回 409 并显示迁移要求。

## 非功能性约束

1. Dashboard SHALL 使用现有 `/api/higress/*` 服务端路由访问 Higress Console。
2. Dashboard SHALL 对 `AGENTTEAMS_AI_GATEWAY_ADMIN_URL` 使用部署管理员配置的受控主机校验规则。
3. Dashboard SHALL 为模型厂商、模型映射和 AI 路由的序列化逻辑提供单元测试。
4. Dashboard SHALL 将 Higress Console 管理地址与 Higress 网关数据平面地址作为不同的外部服务配置项。
5. Dashboard SHALL 校验 `AGENTTEAMS_AI_GATEWAY_ADMIN_URL` 与 `AGENTTEAMS_AI_GATEWAY_ADMIN_ALLOWED_HOSTS` 的匹配关系，并对未匹配地址返回部署配置错误。
6. Dashboard SHALL 从 AgentTeams 部署环境读取 `AGENTTEAMS_AI_GATEWAY_ADMIN_ALLOWED_HOSTS`，并将 Dashboard 设置页排除在该配置的写入路径外。

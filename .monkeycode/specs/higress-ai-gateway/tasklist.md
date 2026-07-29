# 需求实施计划

- [x] 1. 锁定外部 AgentTeams 运行时交付边界
  - [x] 1.1 锁定 `agentscope-ai/AgentTeams` 的目标提交，列出 Controller、Manager、Worker 中接收 Gateway 地址和请求模型别名的文件、接口及验收场景；记录到 `install/AGENTTEAMS_PATCH.md`。参见需求 8.1-8.2、需求 9.6、设计“拓扑与职责”。
  - [x] 1.2 更新 `install/patches/**` 与本仓库安装脚本，使 `AGENTTEAMS_AI_GATEWAY_URL` 和请求模型别名由部署环境传递到 Controller、Manager、Worker。参见需求 8.1-8.2、需求 9.6、设计“当前实现的实施门槛”第 1 项。
  - [x]* 1.3 在目标 AgentTeams 检出中对固定提交执行补丁 clean-apply 验证，并使用运行时夹具验证 Manager、Worker 接收 Gateway 地址与模型别名。参见设计实施顺序 1-2、设计测试策略“组件测试”。
  - [x] 1.4 更新 `install/patches/0004-agentteams-external-higress.patch`，在 Controller 的 Manager、Worker 与运行时配置生成链路中将 `external` 模式的 Gateway 地址固定为 `WorkerEnv.AIGatewayURL`，排除 `modelProvider.IntranetURL` 覆盖。参见需求 9.9-9.10、设计正确性属性 9、已确认决策 2。
  - [x] 1.5 在 `external-model-binding-guard.ts` 和 Manager、Worker API 路由中拒绝外部模式的新增、更新及遗留 `modelProvider` 引用，并返回可操作的 409 迁移错误。参见需求 9.11-9.12、设计“外部 Higress 适配”。
  - [x]* 1.6 在固定上游提交中验证外部模式下 Controller 生成的 Manager、Worker 与运行时 OpenClaw 配置保留 Gateway 数据平面地址，并覆盖 `modelProvider` 存在的场景。参见需求 9.9-9.10、设计测试策略“组件测试”。

- [ ] 2. 在外部模式启用前完成请求模型别名迁移
  - [x] 2.1 定义 Provider 名称遗留值到请求模型别名的迁移和回显策略，更新 `ModelSelector`、Manager、Worker 表单与 Controller API 契约，使 `model` 仅表示请求模型别名。参见需求 8.1-8.2、设计“当前实现的实施门槛”第 1 项。
  - [x] 2.2 基于 Provider 映射和 AI Route 计算别名绑定，展示路由、目标 Provider、目标模型和可用状态；对未绑定或不可用别名阻止外部模式启用。参见需求 8.3-8.5、设计正确性属性 7。
  - [ ]* 2.3 在固定版 AgentTeams 运行时夹具中验证 Manager、Worker 使用别名访问 Gateway 并命中预期 AI Route。参见设计实施顺序 2、设计测试策略“组件测试”。

- [x] 3. 建立外部 Higress 配置、状态与启动门禁
  - [x] 3.1 修改 `.env.example`、`install/agentteams-install.sh`、`install/agentteams-dashboard.sh` 和 Dashboard 运行时配置，统一读取 `AGENTTEAMS_HIGRESS_ADAPTER_MODE`，保留 `direct` 默认值，并注入 Gateway、Console 与 Console 允许主机配置。参见需求 9.1、9.5-9.8、非功能性约束 4-6。
  - [x] 3.2 扩展 `src/lib/agentteams-api.ts` 和 `src/app/api/agentteams/infrastructure/route.ts`，分别返回 Gateway、Console 的 `unconfigured`、`reachable`、`unreachable` 状态，并对已配置地址执行 5 秒 `GET /` 探测。参见需求 9.1-9.4、设计“外部 Higress 状态接口”。
  - [x] 3.3 重构 `src/app/api/higress/proxy-helper.ts`，以 `AGENTTEAMS_AI_GATEWAY_ADMIN_ALLOWED_HOSTS` 的精确主机集合校验 Console 地址，并针对缺失、非法或不匹配地址返回部署配置错误。参见需求 6.5、需求 9.5、非功能性约束 5-6。
  - [x] 3.4 调整 `useEnsureAiGateway`、`AgentTeamsDashboard` 与 `ensure-ai` 路由，使 `external` 模式只读取状态、仅在别名绑定可用时进入运行时流程，并排除 Consumer、Provider 与 AI Route 写入。参见需求 9.6-9.8、设计正确性属性 8。
  - [x] 3.5 将 Console 状态与共享登录会话传入模型管理区；Console 未配置、不可达或无会话时展示配置说明并禁用 Provider、Route 查询与写入，服务端 `/api/higress/*` 执行相同写入门禁。参见需求 9.3-9.5、设计“错误处理”。
  - [x]* 3.6 为状态组合、允许主机校验、会话门禁、外部模式只读初始化和别名启用门槛编写单元与路由处理测试。参见设计测试策略“路由处理测试”“组件测试”。

- [x] 4. 完善 Higress 客户端模型、序列化和 API 代理
  - [x] 4.1 在 `src/lib/higress-api.ts` 定义 Provider、Token 故障转移、模型映射、路由上游、认证、回退配置和请求模型别名的表单与 Console 请求类型，并实现纯序列化与校验函数。参见需求 2.3-2.5、需求 3.1-3.5、需求 4.2-4.6、需求 5.1-5.5、设计“数据模型”。
  - [x] 4.2 固定目标 Higress Console API 版本和 `fallbackConfig` 允许 schema，实现未知字段保留、JSON/schema 校验及 Console 不支持写入时的只读摘要。参见需求 5.3-5.4、设计“已确认决策”。
  - [x] 4.3 更新 `src/app/api/higress/ai-providers/**` 与 `src/app/api/higress/ai-routes/**`，验证请求负载、保留空 Token 更新中的既有凭据、脱敏读取响应、透传 Cookie，并统一 Console 错误和超时响应。参见需求 6.1-6.4、需求 7.4、非功能性约束 1。
  - [x] 4.4 扩展 `src/hooks/use-agentteams-models.ts`，使 Provider 变更失效 Provider、Route、模型绑定查询，使 Route 变更失效 Route、模型绑定查询，并保留 30 秒刷新策略。参见需求 7.2-7.3、需求 8.5。
  - [x]* 4.5 为 Provider 脱敏、空 Token 更新、Base URL、故障转移、模型映射、路由权重、认证与回退 JSON/schema 校验编写单元测试。参见设计正确性属性 1-6、设计测试策略“单元测试”。
  - [x]* 4.6 引入并配置属性测试工具，验证重复精确映射键、有效多上游权重集合和路由认证凭据约束。参见设计正确性属性 2-5。
  - [x]* 4.7 为 Provider 和 Route 集合及单资源路由的 GET、POST、PUT、DELETE、Cookie 透传、脱敏、Console 错误映射和 15 秒超时到 502 映射编写路由处理测试。参见需求 6.1-6.4、需求 7.4、设计测试策略“路由处理测试”。

- [x] 5. 重构模型厂商和 AI 路由管理体验
- [x] 5.1 将 `src/components/dashboard/sections/models-section.tsx` 的 Provider 管理拆分为创建、详情和编辑表单，展示类型、协议、Token 数量与可公开高级配置。参见需求 1.1-1.4、设计“ModelsSection”。
- [x] 5.2 实现协议、按厂商类型显示的 Base URL、Token 故障转移和模型映射编辑，并在本地校验数值与重复映射键、保留 Console 验证失败时的输入。参见需求 2.1-2.5、需求 3.1-3.5、需求 6.5、需求 7.1-7.3。
- [x] 5.3 为 Provider 删除提供确认、路由引用提示和请求期间禁用。参见需求 7.3、需求 7.5、设计“错误处理”。
- [x] 5.4 扩展 Route 表单以支持多上游、路径和模型匹配、上游映射、权重校验、认证、受限回退 JSON 编辑及不存在 Provider 的引用阻止。参见需求 4.1-4.6、需求 5.1-5.5、设计正确性属性 2-5。
- [x] 5.5 为 Route 创建、编辑和删除提供加载、空、错误和确认状态，并在 mutation 期间禁用表单。参见需求 7.1-7.5。
   - [x]* 5.6 为 Provider 和 Route 的创建、编辑、删除确认、即时校验、错误保留、回退编辑与模型绑定刷新编写组件测试。参见设计测试策略“组件测试”。

- [x] 6. 更新状态消费者并验证交付
  - [x] 6.1 更新基础设施、总览、安全与洞察组件，使其分别展示 Gateway 运行时状态与 Console 管理状态。参见需求 9.1-9.4、设计“错误处理”。
    - [x] 6.2 执行 `npm run lint`、`npm run typecheck` 和 `npm test`，记录每项命令的结果并修复本功能引入的失败。参见设计实施顺序 10。已于 2026-07-27 验证：lint、typecheck 通过；Vitest 27 个文件、209 项测试通过。

- [ ] 7. 实现统一别名路由运行时模型配置
  - [ ] 7.1 扩展 Higress Route 类型、读取转换和序列化逻辑，保留 `authConfig.allowedConsumers`，并防止 Dashboard Route 编辑覆盖已部署 Agent Consumer 授权。参见需求 10.2、设计“统一别名路由运行时闭环”。
  - [ ] 7.2 在 Manager 和 Worker 创建、编辑表单中提供已绑定请求模型别名的选择与绑定详情，并保留通配符别名输入能力。参见需求 10.3、设计“创建流程与模型生效”。
  - [ ] 7.3 在 Worker 与 Manager 模型更新完成后展示运行时生效说明；OpenClaw 提示重启，QwenPaw 提示轮询同步。参见需求 10.4-10.6。
  - [ ] 7.4 在团队创建表单中展示 Leader 和成员的模型配置边界及缺少模型的成员。参见需求 11。
  - [ ] 7.5 为模型别名选择、团队模型引导、模型更新生效提示和未绑定别名阻止启动编写单元、组件与路由测试。参见需求 10、需求 11。

- [ ] 8. 后续阶段：Controller Consumer 授权同步
  - [ ] 8.1 在 AgentTeams Controller 暴露受认证的授权同步接口，复用 `gateway.Client.AuthorizeAIRoutes` 将 Manager 与已部署 Worker Consumer 写入目标 Route。参见原需求 10.3 与设计“统一别名路由运行时闭环”。

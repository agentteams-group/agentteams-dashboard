# AgentTeams Dashboard 文档

本目录记录当前仓库的架构、接口和开发约定，面向 Dashboard 贡献者和集成人员。Dashboard 是一个 Next.js 控制台，浏览器通过其服务端 API 访问 AgentTeams Controller、Matrix、Higress Console 与 MinIO。

> 用户可见文档在 `docs/`；本目录是 Agent 内部知识源，与 `docs/` 同名文件保持同步（本次已同步 ARCHITECTURE / DEVELOPER_GUIDE）。

- [架构](./ARCHITECTURE.md)：组件、代理边界、外部服务关系、任务看板/HITL/知识库/链路追踪/插件/热更新子系统。
- [接口](./INTERFACES.md)：API 路由、数据类型和环境配置契约。
- [开发者指南](./DEVELOPER_GUIDE.md)：本地开发、测试、模块导览和 Higress 改造流程。
- [Dashboard 模块](./模块/Dashboard.md)：页面区块、导航、查询和客户端状态。
- [服务端 API 模块](./模块/服务端API.md)：App Router、认证和代理边界。
- [技能中心模块](./模块/技能中心.md)：技能存储、上传、Nacos 同步与分发。
- [部署与交付模块](./模块/部署与交付.md)：镜像、安装器、CI 和 AgentTeams 补丁。
- [部署模式](./专有概念/部署模式.md)：`embedded` 与 `k8s` 的识别和可见性规则。
- [模型别名绑定](./专有概念/模型别名绑定.md)：Higress external 模式的模型契约。
- [技能中心](./专有概念/技能中心.md)：技能来源、生命周期与 Nacos 集成机制。
- [AI 网关多服务商路由指南](./AI_GATEWAY_GUIDE.md)：Provider/AI Route 配置、Worker 运行时调用链路和多服务商路由机制。

用户向文档（新增功能说明、使用指南）请直接维护在 `docs/`，索引入口见 [`docs/INDEX.md`](../../docs/INDEX.md)。

当前功能规格位于 `.monkeycode/specs/`。Higress 外部适配的实现计划位于 `.monkeycode/specs/higress-ai-gateway/tasklist.md`。

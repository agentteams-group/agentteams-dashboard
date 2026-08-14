# Dashboard 模块

## 入口和编排

`src/app/page.tsx` 检查 `/api/auth/session` 与 `/api/agentteams/setup/status/`，按结果呈现登录、初始化向导或 Dashboard。Provider 顺序为 Theme、TanStack Query、搜索 Context 和 `AgentTeamsDashboard`。

`src/components/dashboard/agent-teams-dashboard.tsx` 是布局编排层。它组合侧栏、移动侧栏、Header、连接横幅、页面区块、设置对话框和页脚；常规页面带错误边界、面包屑和动画，聊天使用独立的全高布局。

## 页面和导航

`nav-items.ts` 定义五个可折叠组：总览、智能体、AI 网关、平台、治理，以及常驻文档入口。`use-active-section.ts` 使用 `#group/section` 深链接和 localStorage 保存当前页面与展开分组，并兼容旧式扁平 hash。`ops` 只在 `k8s` 模式显示。

区块位于 `src/components/dashboard/sections/`：概览汇总资源和基础设施；Workers、Teams、Managers、Humans 提供资源操作；Chat 组合 Matrix 房间；Topology 绘制资源关系；Gateway 管理 Consumer 和 Higress Route；Policies、Sandbox、Compliance 提供治理能力。

聊天区块位于 `src/components/dashboard/sections/chat/`。`ChatRoom` 组合房间侧栏、成员面板、`MessageList`、`ThreadPanel` 与输入框；`MessageBubble` 通过 `parseA2uiContent` 分发 A2UI、AgentScope runtime repr、`agentteams.workflow`、确认、思考、工具调用和 Markdown 块。`src/lib/a2ui/agent-repr.ts` 将 runtime `Message` repr 中的 reasoning、function call 和 function call output 映射为可折叠思考与工具调用卡片。`formatMatrixEvents` 合并 `m.replace` 修订，并将 `m.thread` 回复从主时间线收纳到由 `ThreadPanel` 按 relations API 加载的线程中。`org.agentteams.run` 仅作为 runtime adapter 的可选兼容载荷处理。

设置对话框（`settings-dialog.tsx`）包含四个页签：连接（连接参数与 Controller/Matrix 状态）、显示、外观、插件。原「日志收集」页签已迁移至问天诊断插件（见下），离线 ZIP 导出入口移至问天诊断页。

问天诊断插件（`src/plugins/wen-tian/`）是内置的诊断助手：页面顶部为集群健康概览（Workers/团队/Humans/部署模式），核心是合并后的「AI 日志分析诊断」卡片——填写症状描述、配置日志收集参数（时间范围/容器过滤/房间过滤/PII 脱敏，自设置对话框迁入）、选择诊断模型（服务器默认或「模型管理」中已配置的服务商模型别名），点击后经 `POST /api/agentteams/wen-tian/logs`（SSE）实时采集容器日志、Agent 会话与 Matrix 消息，把日志摘录、容器状态 facts、症状与环境快照一起交给 LLM，流式输出结构化诊断报告（诊断结论与严重程度、概要表、事件时间线、按置信度排序的根因分析、可执行修复命令、预防措施）。报告使用 react-markdown（GFM、代码块复制按钮）渲染，支持一键复制全文；「仅收集日志 ZIP」按钮复用 `POST /api/agentteams/debug-log` 做离线打包下载（详见 `docs/debug-log-collection.md`）。

## 状态和数据流

TanStack Query 保存服务端资源缓存。Worker、Team、Manager、Human 查询默认每 15 秒轮询，基础设施和模型查询默认每 30 秒轮询。`use-agentteams-mutations.ts` 负责缓存失效、部分 Worker 乐观更新、Toast、通知和审计事件分发。

Zustand 状态包括 Controller 连接、Matrix 会话、通知、策略和审计；`SearchContext` 保存 Header 传入的全局搜索词。策略、审计和通知是浏览器侧数据，不属于 Controller 资源。

```text
页面区块 -> React Query Hook -> src/lib API 客户端 -> Next.js API Route -> 外部服务
mutation 成功 -> 缓存失效或乐观更新 -> Toast / 通知 / 审计
```

## 测试

测试与源码同目录。导航测试覆盖分组、部署模式可见性、hash 与 localStorage；资源 selector 测试覆盖筛选、排序和分页；模型、聊天、A2UI、API 客户端和路由守卫均有专项测试。

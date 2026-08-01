# Dashboard 模块

## 入口和编排

`src/app/page.tsx` 检查 `/api/auth/session` 与 `/api/agentteams/setup/status/`，按结果呈现登录、初始化向导或 Dashboard。Provider 顺序为 Theme、TanStack Query、搜索 Context 和 `AgentTeamsDashboard`。

`src/components/dashboard/agent-teams-dashboard.tsx` 是布局编排层。它组合侧栏、移动侧栏、Header、连接横幅、页面区块、设置对话框和页脚；常规页面带错误边界、面包屑和动画，聊天使用独立的全高布局。

## 页面和导航

`nav-items.ts` 定义五个可折叠组：总览、智能体、AI 网关、平台、治理，以及常驻文档入口。`use-active-section.ts` 使用 `#group/section` 深链接和 localStorage 保存当前页面与展开分组，并兼容旧式扁平 hash。`ops` 只在 `k8s` 模式显示。

区块位于 `src/components/dashboard/sections/`：概览汇总资源和基础设施；Workers、Teams、Managers、Humans 提供资源操作；Chat 组合 Matrix 房间；Topology 绘制资源关系；Gateway 管理 Consumer 和 Higress Route；Policies、Sandbox、Compliance 提供治理能力。

聊天区块位于 `src/components/dashboard/sections/chat/`：`a2ui/a2ui-chat-content.tsx` 解析 Matrix 消息中的 A2UI 协议、agent repr 与 legacy 块，流式输出由 `IncrementalA2uiRenderer` 增量渲染思考、工具调用、确认卡片与 Markdown 文本；AI 诊断结果（`src/components/dashboard/settings/troubleshoot-tab.tsx`）使用 react-markdown（GFM、语法高亮与可复制代码块）呈现。

## 状态和数据流

TanStack Query 保存服务端资源缓存。Worker、Team、Manager、Human 查询默认每 15 秒轮询，基础设施和模型查询默认每 30 秒轮询。`use-agentteams-mutations.ts` 负责缓存失效、部分 Worker 乐观更新、Toast、通知和审计事件分发。

Zustand 状态包括 Controller 连接、Matrix 会话、通知、策略和审计；`SearchContext` 保存 Header 传入的全局搜索词。策略、审计和通知是浏览器侧数据，不属于 Controller 资源。

```text
页面区块 -> React Query Hook -> src/lib API 客户端 -> Next.js API Route -> 外部服务
mutation 成功 -> 缓存失效或乐观更新 -> Toast / 通知 / 审计
```

## 测试

测试与源码同目录。导航测试覆盖分组、部署模式可见性、hash 与 localStorage；资源 selector 测试覆盖筛选、排序和分页；模型、聊天、A2UI、API 客户端和路由守卫均有专项测试。

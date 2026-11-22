# Dashboard 模块

## 入口和编排

`src/app/page.tsx` 检查 `/api/auth/session` 与 `/api/agentteams/setup/status/`，按结果呈现登录、初始化向导或 Dashboard。Provider 顺序为 Theme、TanStack Query、搜索 Context 和 `AgentTeamsDashboard`。

`src/components/dashboard/agent-teams-dashboard.tsx` 是布局编排层。它组合侧栏、移动侧栏、Header、连接横幅、页面区块、设置对话框和页脚；常规页面带错误边界、面包屑和动画，聊天使用独立的全高布局。

## 页面和导航

一级入口在 `src/components/dashboard/workspace-navigation.tsx` 的 `workspaceMenus`：助手、我的团队、工作台、资产中心、成员与团队、观测与治理，共 6 项。每项各自持有二级页面；`nav-items.ts` 定义二级项、图标、等级门控（L1/L2）与插件贡献入口（`plugin-route:*`），`workspaceMenuFor()` 负责把二级项归属到一级菜单。

深链统一由 `src/lib/nav-hash.ts` 生成与解析：一级项为 `#workbench/*`，二级项与设置入口为 `#console/*`。业务代码不要手写哈希字符串，统一调用该模块；`use-active-section.ts` 消费它并兼容 localStorage 与旧式扁平 hash，缺省回退到 `chat`。

已注册区块见 `agent-teams-dashboard.tsx` 的 `sectionMap`：概览、任务看板、产物、编码执行、自动化（loops）、资源（Agents）、Worker、团队、Humans、平台助手设置、模型、工具（MCP）、技能、知识库、文件、审计、Tracing、聊天、我的团队，以及插件运行时通过 `usePluginRoutes()` 贡献的区块（如运行时监控面板、问天诊断）。

聊天区块位于 `src/components/dashboard/sections/chat/`。`ChatRoom` 组合房间侧栏、成员面板、`MessageList`、`ThreadPanel` 与输入框；`MessageBubble` 通过 `parseA2uiContent` 分发 A2UI、AgentScope runtime repr、`agentteams.workflow`、确认、思考、工具调用和 Markdown 块。`src/lib/a2ui/agent-repr.ts` 将 runtime `Message` repr 中的 reasoning、function call 和 function call output 映射为可折叠思考与工具调用卡片。`formatMatrixEvents` 合并 `m.replace` 修订，并将 `m.thread` 回复从主时间线收纳到由 `ThreadPanel` 按 relations API 加载的线程中。`org.agentteams.run` 是 runtime adapter 的可选兼容载荷（v1 协议字段见 `docs/INTERFACES.md`「运行时块协议」）。

设置对话框（`settings-dialog.tsx`）页签：管理、连接、客户端、后端、主题、Beta、插件、更新。管理页渲染「打开观测与治理」入口、未进入一级菜单的导航项（当前为总览）与插件贡献入口；后端页承载可观测配置（Controller Secret）、语音配置与热更新检查。

## 状态和数据流

TanStack Query 保存服务端资源缓存。Worker、Team、Human 等资源查询默认每 15 秒轮询，基础设施与模型查询默认每 30 秒，另有 5 秒 / 60 秒 / 300 秒等按场景配置。`use-agentteams-mutations.ts` 负责缓存失效、部分 Worker 乐观更新、Toast、通知和审计事件分发。

Zustand 状态包括 Controller 连接、Matrix 会话、通知、策略和审计；`SearchContext` 保存 Header 传入的全局搜索词。策略、审计和通知是浏览器侧数据，不属于 Controller 资源。

```text
页面区块 -> React Query Hook -> src/lib API 客户端 -> Next.js API Route -> 外部服务
mutation 成功 -> 缓存失效或乐观更新 -> Toast / 通知 / 审计
```

## 内置插件

`src/plugins/` 下的插件与普通业务代码共享渲染层，但通过插件运行时注册：运行时监控面板（`monitor-panel`）贡献「观测与治理」中的运行时监控区块，问天诊断（`wen-tian`）贡献设置 → 管理中的诊断页。问天页面顶部为集群健康概览，核心是「AI 日志分析诊断」卡片——症状描述、日志收集参数（时间范围/容器过滤/房间过滤/PII 脱敏）、诊断模型选择，点击后经 `POST /api/agentteams/wen-tian/logs`（SSE）实时采集容器日志、Agent 会话与 Matrix 消息并流式输出结构化诊断报告；「仅收集日志 ZIP」复用 `POST /api/agentteams/debug-log/` 离线打包下载（详见 [debug-log-collection.md](../debug-log-collection.md)）。

## 测试

测试与源码同目录。导航测试覆盖一级菜单、二级项、等级门控、hash 与 localStorage；资源 selector 测试覆盖筛选、排序和分页；模型、聊天、A2UI、API 客户端和路由守卫均有专项测试。

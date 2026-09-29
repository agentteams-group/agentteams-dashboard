# Dashboard 模块

## 入口和编排

`src/app/page.tsx` 检查 `/api/auth/session` 与 `/api/agentteams/setup/status/`，按结果呈现登录、初始化向导或 Dashboard。Provider 顺序为 Theme、TanStack Query、搜索 Context 和 `AgentTeamsDashboard`。

`src/components/dashboard/agent-teams-dashboard.tsx` 是布局编排层。它组合侧栏、移动侧栏、Header、连接横幅、页面区块、设置对话框和页脚；常规页面带错误边界、面包屑和动画，聊天使用独立的全高布局。

## 导航与路由

`nav-items.ts` 定义五个可折叠组：总览、智能体、AI 网关、平台、治理，以及常驻文档入口。`use-active-section.ts` 使用 `#group/section` 深链接和 localStorage 保存当前页面与展开分组，并兼容旧式扁平 hash；首启在没有用户偏好和 hash 时回退到 `chat`，与默认会话最小时共存。`ops` 只在 `k8s` 模式显示。

区块位于 `src/components/dashboard/sections/`：概览汇总资源和基础设施；Workers、Teams、Managers、Humans 提供资源操作；Chat 组合 Matrix 房间；Topology 绘制资源关系；Gateway 管理 Consumer 和 Higress Route；Policies、Sandbox、Compliance 提供治理能力。

聊天区块位于 `src/components/dashboard/sections/chat/`。`ChatRoomSidebar` 在已加入房间列表之上渲染 `InviteInbox`，列出当前 Matrix `rooms.invite`：每行展示房间名（缺省时回退到 roomId）、邀请者本地名（@user 形式），接受按钮 `POST /api/matrix/rooms/[roomId]/join`，拒绝按钮 `POST /api/matrix/rooms/[roomId]/leave`，4xx 时展示 `errcode` 摘要并保留邀请缓存（由 `use-global-matrix-sync.ts` 的下一次 sync 通过 `dropByRoomId` 清掉）。`ChatRoom` 组合房间侧栏、成员面板、`MessageList`、`ThreadPanel` 与输入框；`MessageBubble` 通过 `parseA2uiContent` 分发 A2UI、AgentScope runtime repr、`agentteams.workflow`、确认、思考、工具调用和 Markdown 块。`src/lib/a2ui/agent-repr.ts` 将 runtime `Message` repr 中的 reasoning、function call 和 function call output 映射为可折叠思考与工具调用卡片。`formatMatrixEvents` 合并 `m.replace` 修订，并将 `m.thread` 回复从主时间线收纳到由 `ThreadPanel` 按 relations API 加载的线程中。`org.agentteams.run` 仅作为 runtime adapter 的可选兼容载荷处理。AI 诊断结果（`src/components/dashboard/settings/troubleshoot-tab.tsx`）使用 react-markdown（GFM、语法高亮与可复制代码块）呈现。聊天 Markdown 的插件链为 `rehypeRaw → rehype-sanitize（schema 见 src/components/dashboard/sections/chat/sanitize-schema.ts）→ 语法高亮 → KaTeX`，AI 输出中的原始 HTML 经白名单过滤后渲染。知识库面板（`knowledge-section.tsx`）的数据面 `workspace-files` 是 QwenPaw 运行时专属能力，worker 下拉仅列出 `runtime === 'qwenpaw'` 的 Worker，全非 QwenPaw 时显示空态说明。

设置对话框（`settings-dialog.tsx`）包含三个页签：连接（连接参数与 Controller/Matrix 状态）、AI 诊断（`troubleshoot-tab.tsx`，AI 生成诊断结论）、日志收集（`debug-log-tab.tsx`）。日志收集页签通过 `POST /api/agentteams/debug-log` 一键采集容器诊断/日志、Agent 会话与 Matrix 消息，PII 脱敏后打包 ZIP 下载（详见 `docs/debug-log-collection.md`）。

### 嵌入式预填与会话密钥

`src/components/setup/backend-setup-page.tsx` 与 `backend-tab.tsx` 在首启（未保存任何 backend 地址）且 `embeddedHealthy===true` 时自动调用 `applyEmbeddedDefaults()`（`src/lib/backend-names.ts` 的 `EMBEDDED_DEFAULTS`）填入控制器、Matrix、MinIO 等探测到的内置地址，并在输入框旁加 `嵌入式探测` Badge，让操作者清楚这是自动填的。Setup token 走 `Authorization: Bearer` 头（`/api/agentteams/setup/backends` GET 优先读取 header，再回退 `?token=` 兼容）；服务端 `verifySetupToken` 为 timing-safe（`node:crypto.timingSafeEqual`）且在 shared mode 缺源时直接拒绝。

`src/lib/dashboard-session.ts` 的 `bootstrapSessionSecret()` 在 `instrumentation.ts` 中于 `bootstrapSetupToken()` 之后调用：Standalone 模式下若 `DASHBOARD_SESSION_SECRET` 缺失或短于 32 字节，自动生成 32 字节十六进制随机密钥，原子写入 `/data/agentteams-dashboard/.session-secret`（目录 mode 0700、文件 mode 0600），并在 stderr 输出 `BACKEND 后四位` 形式的提示（永不输出密钥本身）。Shared Mode 仍然 fail-closed —— 必须显式设置环境变量。`getSecret()` 在 Standalone 模式下回退到磁盘读取，使重启后 Cookie 仍然有效。

## 状态和数据流

TanStack Query 保存服务端资源缓存。Worker、Team、Manager、Human 查询默认每 15 秒轮询，基础设施和模型查询默认每 30 秒轮询。`use-agentteams-mutations.ts` 负责缓存失效、部分 Worker 乐观更新、Toast、通知和审计事件分发。

Zustand 状态包括 Controller 连接、Matrix 会话、通知、策略和审计；`SearchContext` 保存 Header 传入的全局搜索词。策略、审计和通知是浏览器侧数据，不属于 Controller 资源。

```text
页面区块 -> React Query Hook -> src/lib API 客户端 -> Next.js API Route -> 外部服务
mutation 成功 -> 缓存失效或乐观更新 -> Toast / 通知 / 审计
```

## 测试

测试与源码同目录。导航测试覆盖分组、部署模式可见性、hash 与 localStorage；资源 selector 测试覆盖筛选、排序和分页；模型、聊天、A2UI、API 客户端和路由守卫均有专项测试。

# 任务书：Worker 卡片生动化改造 + Chat 流式渲染适配

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v0.2（经代码核对修订） |
| 起草日期 | 2026-08-11 |
| 修订日期 | 2026-08-11 |
| 所属仓库 | `agentteams-dashboard` |
| 上游运行时仓库 | `AgentTeams` |
| 工作范围 | `src/components/dashboard/sections/workers/`、`src/components/dashboard/sections/workers-section.tsx`、`src/lib/a2ui/`、`src/components/dashboard/sections/chat/`、`src/components/dashboard/phase-badge.tsx`、`src/components/dashboard/status-dot.tsx`、`src/app/globals.css` |
| 当前基线 | vitest 603/603（72 个文件），`npm run typecheck` 0 错误 |
| 发布基线 | `v1.2.2` |

---

## 0. v0.1 审查结论与修订清单

> 审查方法：逐条对照仓库现状（`v1.2.2` tag 之后的 `main`）验证可行性。以下 19 条修订已全部合入本版正文，正文即最终口径。

| # | 位置 | v0.1 的问题 | v0.2 修订 |
| --- | --- | --- | --- |
| R1 | §6.2.1 | "从元数据 `org.matrix.room.avatar` 推断 runtime"不可行：房间头像与运行时无任何关联，也没有该元数据的生产者 | runtime 唯一可信来源：**发送者 MXID 反查 Worker 清单**（`WorkerResponse.matrixUserID → runtime`）。`ChatSection` 已调用 `useWorkers()`，在 section 层构建映射后随上下文下发；查不到记 `null` |
| R2 | §6.2.6 | openhuman 在 §6.1.1 有专属灰色徽章，§6.2.6 又说角标显示"未识别运行时"，自相矛盾 | openhuman 有专属角标（灰、User 图标），hover 说明"通用 Matrix 协议渲染，无运行时专属结构化键"；"未识别运行时"仅用于 MXID 反查失败（runtime = null） |
| R3 | AC-W6 / §10.2 | "点'恢复'看渐入"：现行删除流程是确认对话框 → Controller 删除 → 卡片移除，**不存在"恢复"操作** | 删除态 = 淡出呼吸 + 进度条 + 不可点遮罩；删除**失败**时卡片恢复原状并提示。AC-W6 与 QA 脚本删去"恢复"步骤 |
| R4 | AC-D2 | ①"紧凑 = 表格去 name 列"不可用：去掉 name 列后无法识别 Worker；②卡片/表格切换**已存在**（`workers-section.tsx` Tabs + `useViewMode`），任务书按"新增"写 | 紧凑 = 表格保留 选择/状态点/名称/运行时徽章/健康/操作，精简 模型/团队/消息 等次要列；本次新增"紧凑"档位 + `localStorage` 偏好持久化（现状 `useViewMode` 无持久化） |
| R5 | §5.4 | "卡片下方新增'最近 3 次工具调用'摘要列"要求 Worker 区订阅 Matrix timeline，违背 §1.2 非目标，且 50 张卡片 × 拉房间历史不可行 | 活物条仅保留"工具调用数"（Chat 侧渲染 tool_call 块时被动计数，localStorage 记录 24h 窗口）；调用明细仍在 Chat 内查看 |
| R6 | §6.3 / §6.4 | 后端三字段（`stateStartedAt`/`lastActivityAt`/`lastTaskSummary`）与 `/last-activity` 接口是硬依赖，落地时间不确定 | 全部软依赖：字段在 `WorkerResponse` 上声明为**可选**，缺数据显示"暂无"；前端**不主动调用** `/last-activity`（避免对未实现接口的 404 噪音），仅消费内联字段；后端落地后自动生效 |
| R7 | AC-P1 | "50 卡片首屏 < 200ms（React Profiler）"在 jsdom/vitest 下不可自动化 | 转为人工 QA 步骤（§10 已有）；自动化保障 = 卡片组件 `memo` + "渲染 50 卡片不抛错"用例 |
| R8 | AC-W1 | axe-core 的 color-contrast 规则依赖真实布局，jsdom 下结果不可靠 | CI 中 axe-core 只跑非对比度 critical 规则；WCAG AA 对比度以 light/dark token 设计审查 + Playwright 截图人工首肯（并入 AC-Q5） |
| R9 | AC-Q4 | Storybook 引入成本高，§9 已给退路但未拍板 | 明确**不引入 Storybook**，用 vitest 快照覆盖 5 runtime × 7 种事件序列共 35 个用例 |
| R10 | §6.2.7 | "已取消/处理异常/已处理"纯文本匹配不加约束会误伤人类用户消息 | 约束：仅 `isMine = false` 且**全文精确匹配**（trim 后完全等于三者之一）才产出收尾块；"已处理"渲染为 quiet 小字而非 error 卡 |
| R11 | §6.2.3 | hermes 关键词启发式会命中 qwenpaw 的 tool 子消息（§4.5 事件序列 [1] 的 body 就是 `tool call`） | 明确规则顺序：hermes 关键词规则在"m.notice → thinking 兜底"**之前**；命中后按发送者归属贴 runtime 角标，payload 带 `confidence: 'low'` |
| R12 | §6.1.1 | 活物条"每列最多 8 字符"对中文过紧（"正在处理工单"已 6 字） | 放宽为最多 12 字符 + ellipsis，`title` tooltip 显示全文 |
| R13 | AC-C8 | "72 个测试文件全部通过"会随本次新增测试文件变化 | 改为"全部测试文件通过（含新增），连续 3 次 0 flake" |
| R14 | AC-D1 | `docs-section.tsx` 是纯 TSX tab 组件，**没有 markdown 渲染管线**；"在 docs-section 展示"与"不需要新的 UI 控件"矛盾 | 任务书存入 `docs/plans/`，README 新增 Roadmap 段引用；Dashboard 内嵌 markdown 渲染列为可选后续项 |
| R15 | AC-T1 | 现状代码已有 3 处禁词命中（`security-section.tsx`、`workflow-card.tsx` 的"智能体"），脚本若上线即红 | 本次一并修复现存命中；扫描脚本排除测试文件与注释行 |
| R16 | §6.1.1 | `Ready` 相位的状态叙述未定义 | 补：Ready → "已就绪，等待任务" |
| R17 | §6.3 | `stateStartedAt` 被 Running（运行时长）与 Sleeping（空闲时长）两种文案共用，语义未定义 | 明确：`stateStartedAt` = **进入当前相位的时间戳**；叙述文案按 phase 解释该时长 |
| R18 | AC-C7 | "点击展开可看到 m.replace 链路 ID"：客户端合并（`use-matrix.ts`）只保留根事件 id + `isEdited`，**不留存完整编辑链路** | 客户端补 `revisionCount`（编辑次数）；卡片展开显示根事件 ID（截断）+ 编辑次数；完整链路审计列为后续项 |
| R19 | AC-T3 | `StatusDot` 是全局组件（worker/team/manager/human 共用），加图标不能改 API | 保持 `StatusDot` props 不变，内部升级为"颜色 + 图形"双编码（红 X / 黄三角 / 绿圆点 / 灰方块），动画按相位分频 |

---

## 1. 目标与边界

### 1.1 业务目标

- 让 Dashboard 上每一个 Worker 不再是一张"图标 + 名字 + 一行状态点"的扁平卡片，而是**一眼就能看出"它在干什么、状态卡在哪一步、距离上次活动多久"**的活物。
- 让 Chat 区对**每一种 AgentTeams 运行时**（`openclaw` / `copaw` / `hermes` / `qwenpaw` / `openhuman`）的流式输出都能稳定渲染：**思考过程、工具调用、确认弹卡、Workflow 进度、长消息附件、错误收尾**——每一种在每一类运行时上都要有一致且符合人类直觉的表现。
- 整套文案去"AI 味"，换成运维/工程师日常会说的话。

### 1.2 非目标（明确不做）

- 不改 Controller 协议层、不改 CRD 字段、不动 Matrix 服务端。
- 不引入新的运行时类型枚举。`openhuman` 已在 Dashboard 类型中存在，本次只是补齐视觉与解析覆盖。
- 不重做 Chat 的同步、虚拟滚动、未读管理。M3/M4 已完成，本任务在已有 `normalizeToBlocks` 入口上扩展。
- 不重写 Workflow 卡片组件（`workflow` 块渲染已存在），仅补齐各运行时下的样式一致性。
- 不引入 Storybook（见 R9）。
- 不在 Worker 区订阅 Matrix 消息流（见 R5）。

### 1.3 干系人与角色

- 前端：Worker 卡片重设计、Chat 渲染适配、文案改造。
- 后端（仅配合）：在 `WorkerResponse` 暴露三个**可选**字段（最近任务摘要、进入当前相位时间、最近活动时间），由前端提供查询字段名。
- 设计：动效与配色，提供 1 套 light + 1 套 dark 的 token 草案。
- QA：验收脚本与录像回放。

---

## 2. 背景与现状

### 2.1 当前 Worker 卡片（`worker-card.tsx`）

- 顶部：复选框 + `StatusDot` + `Bot` 图标 + 名字 + 健康环 + `PhaseBadge`。
- 中部：模型、运行时、团队三行只读字段。
- 底部：详情 / 编辑 + 唤醒 / 休眠 / Ensure Ready / 删除。
- 现状问题：
  1. 只看名字看不出"活的还是死的"。没有最近一次活动时间，没有当前正在执行的 task 摘要。
  2. "Runtime"只是 outline 徽章，没有体现该运行时的能力差异（openclaw 的 A2UI、copaw 的 Message repr、hermes 的原生 chat、qwenpaw 的 Thinking 流）。
  3. 阶段徽章颜色 + HealthRing 数字是抽象分，没有映射到人话（"健康分 78" ≠ "稳定运行，最近一次出错是 3 小时前"）。
  4. 删除中状态只在正文里塞一行小黄字，没有空间占位反馈。

### 2.2 当前 Chat 流式渲染入口（`src/lib/a2ui/normalize.ts`）

`normalizeToBlocks` 已按优先级串了 10 条规则，覆盖 workflow、org.agentteams.run、A2UI 标记、Tool Guard 确认、agentscope repr、`Thinking:` 前缀、长消息附件、`🔧 **tool**`、m.notice、legacy card。M4 已加入 A2UI 流式容错 + 长消息附件。

但是从运行时分发角度看，仍有三点不足：

1. **运行时特征未被前端感知。** 当前块类型只有 workflow / a2ui / confirmation / thinking / tool_call / attachment / text / card 8 种，没有"这是 openclaw 的 a2ui"还是"这是 qwenpaw 的 Thinking"。这导致同一种 thinking 卡对不同运行时没法贴运行时图标与说明。
2. **`copaw` 的 Message repr 解析很脆弱。** `parseEmbeddedAgentReprBlocks` 当前仅按字符串子串切分，遇到 qwenpaw 的 renderer 输出同样会撞上 `THINKING_PREFIX` 但来自不同运行时，前端无法分流。
3. **`hermes` 没有专用适配路径。** hermes 不实现 AgentTeams 专属结构化键，但它的 `m.notice` process 消息与 `🔧 **tool**` 约定现在被当作通用 legacy 处理，没有运行时归属。

### 2.3 运行时清单（来自 `agentteams-controller/api/v1beta1/types.go:181` + Dashboard 类型 `agentteams-api.ts:12`）

```ts
WorkerRuntime = 'openclaw' | 'copaw' | 'hermes' | 'openhuman' | 'qwenpaw'
```

CRD 注释里只列了 4 种（缺 `openhuman`），Dashboard 类型已经包含 5 种。本次任务按 5 种实现视觉与解析覆盖；后端需要在 controller 的 enum 注释里补齐 `openhuman`。

---

## 3. 仓库地址

| 用途 | URL |
| --- | --- |
| Dashboard 本仓库 | `https://github.com/agentteams-group/agentteams-dashboard` |
| 上游 AgentTeams | `https://github.com/agentscope-ai/AgentTeams` |
| Dashboard 集成 PR（上游） | `https://github.com/agentscope-ai/AgentTeams/pull/1075` |
| Dashboard Issue 列表 | `https://github.com/agentteams-group/agentteams-dashboard/issues` |
| 上游运行时规格（4 种运行时枚举） | `agentteams-controller/api/v1beta1/types.go:181` |
| 上游运行时配置契约 | `docs/design/member-runtime-config-contract.md` |
| qwenpaw Matrix 协议（最完整） | `plugins/agentteams-matrix-channel/agentteams_matrix/channel.py` |
| copaw Matrix 主实现 | `copaw/src/matrix/channel.py` |
| hermes Matrix 适配 | `hermes/src/hermes_matrix/overlay_adapter.py`、`policies.py` |
| workerflow 插件（`agentteams.workflow`） | `plugins/workerflow/mcp/server.py` |
| TeamHarness 自触发 | `plugins/teamharness/mcp/message_tool.py` |

---

## 4. 运行时流式输出调研结论

> 调研对象：`/tmp/opencode/AgentTeams` 浅克隆。重点是"每种运行时向 Matrix 房间发什么、什么时候发、流怎么结尾"。

### 4.1 对照表

| 维度 | openclaw（默认） | copaw | hermes | qwenpaw | openhuman |
| --- | --- | --- | --- | --- | --- |
| 流式载体 | 上游 m.replace（间接证据） | placeholder m.notice → m.thread 子项 → m.replace 编辑 placeholder | 继承自 hermes-agent 上游 | placeholder m.notice → m.thread "Thinking:\n\n..." → m.replace 编辑 placeholder | 未在仓库中找到独立实现（agentteams-controller 类型预留），运行时归属待确认 |
| placeholder 字面量 | 不明（推断使用 m.replace） | `"处理中..."` | 无 | `"处理中..."` | 暂无 |
| thinking 前缀 | 不明 | 无（renderer 直接渲染到 m.notice） | 无 | **`"Thinking:\n\n{text}"`** | 暂无 |
| tool_call 表达 | 不明 | m.notice 子消息，body 由 renderer 渲染 | 上游决定 | m.notice 子消息 + `🔧 **tool**` 正则过滤 | 暂无 |
| 最终答复流式 | m.replace（推断） | m.replace placeholder | 上游决定 | m.replace placeholder | 暂无 |
| mention 三层 | 必须（外层 + m.new_content + body） | 必须 | 仅 outbound m.mentions | 必须 | 暂无 |
| 长消息 fallback | 不明 | 无 | 上游决定 | `com.agentteams.long_message` + 附件 rel_type | 暂无 |
| 结构化键 | 不明 | 无 | 无 | `com.agentteams.long_message`、`m.teamharness.trigger` | 暂无 |
| Tool Guard Matrix 消息 | 无（库内决策） | 无 | 无 | 无（库内决策） | 暂无 |
| agentteams.workflow 推送 | 无 | 无 | 无 | **仅 workerflow mcp 进程发**，非 channel 直发 | 暂无 |

### 4.2 openclaw

- 源码本体在 `openclaw-base/Dockerfile`（空基础镜像），实际运行时在上游 `hiclaw-2026.4.14`（见 `changelog/v1.1.0.md:22`）。
- AgentTeams 端只通过 `agentteams-controller/internal/agentconfig/generator.go` 生成 `openclaw.json`，并把 worker 镜像跑在 openclaw-base 之上。
- mention 三层（`m.mentions` + `<a href="matrix.to">` + body 字面量）是 openclaw >= 2026.4.x 的硬要求，缺一项会被静默丢弃（`copaw/src/matrix/channel.py:2465-2486` 注释）。
- Dashboard 适配策略：**不假设 openclaw 一定发 A2UI**，先按通用 `m.replace` + `m.thread` 处理，遇到 A2UI 标记再升级到 a2ui 块；mention 渲染必须三层并列读取。

### 4.3 copaw（AgentScope 系）

- 主代码：`copaw/src/matrix/channel.py`（3136 行）。
- 流式三层：`_ensure_thread_root`（m.notice `"处理中..."`）→ `_send_or_queue_thread_parts`（reasoning / tool_call 子消息）→ `_edit_thread_root`（m.replace 编辑 placeholder）。
- 关键中间态：`MessageType.REASONING` / `FUNCTION_CALL` / `PLUGIN_CALL` / `MCP_TOOL_CALL` 由 `_thread_content_parts` 渲染成 m.notice。
- 错误收尾：m.replace body 为 `"已取消"`（Task cancelled）或 `"处理异常"`。
- 没有 `on_streaming_start/delta/end` 实现，**不会发出 `Thinking:` 前缀**。
- Dashboard 适配策略：识别 placeholder root（`body == "处理中..."` + `msgtype == "m.notice"`），其下 `m.thread` 子消息就是中间过程，`m.replace` 收尾读 `m.new_content.body` 与 `formatted_body`。

### 4.4 hermes

- 源码：`hermes/src/hermes_matrix/overlay_adapter.py`（239 行）、`policies.py`（222 行）。
- 注释明确（overlay_adapter.py:1-14）：所有传输能力（streaming edit、thread、typing、E2EE）保留在上游 hermes-agent，AgentTeams 只叠加策略层。
- Dashboard 适配策略：**不依赖任何 AgentTeams 专属结构化键**，仅靠通用 Matrix 协议（m.replace、m.thread、m.notice、m.mentions）渲染。tool_call 由上游决定格式，Dashboard 只按 `m.notice` 中是否含工具调用语义关键词启发式判断。
- mention 仅 outbound 注入（`overlay_adapter.py:109-132` `apply_outbound_mentions`），编辑事件 `m.new_content` 同步保留 m.mentions。

### 4.5 qwenpaw（AgentTeams 矩阵协议最完整）

- 核心：`plugins/agentteams-matrix-channel/agentteams_matrix/channel.py`（4605 行）。
- 完整事件序列（`qwenpaw/tests/test_matrix_overlay.py:527-547`）：
  ```
  [0] 处理中...                  (m.notice, body="处理中...")
  [1] tool: <name>               (m.notice, body="tool call", m.relates_to={m.thread, $sent1})
  [2] Thinking:\n\n<text>        (m.notice, body="Thinking:\n\n...", m.relates_to={m.thread, $sent1})
  [3] <final>                    (m.relates_to={m.replace, $sent1}, m.new_content={msgtype:m.text, body:"final answer"})
  ```
- 长消息：`com.agentteams.long_message` 顶层键携带 `mxc://` URL；同时间相邻的 `m.relates_to.rel_type == "com.agentteams.attachment"` 的 m.file 事件是同一内容的文件附件。
- 自触发：`m.teamharness.trigger.type == "PROJECT_REQUESTED"` 表示 Worker 跨会话自触发的项目请求。
- 错误收尾：m.replace body 为 `"已处理"`（NO_REPLY）、`"处理异常"` 或 `"已取消"`。
- Dashboard 适配策略：已通过 M4 完成 A2UI 流式容错 + 长消息附件。本次新增"qwenpaw 来源标识"贴纸（thinking 卡左上角小角标 + 运行时徽章联动）。

### 4.6 openhuman

- 当前仓库无独立实现，`agentteams-controller/api/v1beta1/types.go:181` 注释也只列 4 种；Dashboard 类型 `agentteams-api.ts:12` 已包含 5 种。
- 适配策略：本次仅做兜底渲染（与 hermes 同类的通用 Matrix 协议），但有专属灰色角标（见 R2），并向 controller 仓库提 issue / PR 补齐 enum 注释。

### 4.7 公共结构化键

- `agentteams.workflow`（workerflow MCP 推送）：payload 含 `type / runId / status / title / summary / ownerRole / ownerAgentId / coordinator / sharedPath / subagents[] / steps[]`，状态机 `spawning → ready → running → merging → done / failed`，全部通过 m.replace 编辑首条 m.notice 事件。
- `m.teamharness.trigger`：仅 teamharness message MCP 工具产生。
- `com.agentteams.long_message`：`{ version: 1, url: mxc://..., filename, mimetype }`，触发表 `_matrix_event_payload_size > 48 KB`。

---

## 5. 市面实现调研

> 调研方法：基于 LangSmith Studio、OpenHands、CrewAI、AutoGen Studio、Claude Code、Devin 等公开文档与产品观察。

### 5.1 主流产品的 Worker / Agent 卡片做法

| 产品 | 卡片信息密度 | 状态表达 | 视觉语言 |
| --- | --- | --- | --- |
| LangSmith Studio | 中：name + graph 节点 + run 状态 | 节点上有运行指示灯 + token/latency 小字 | 极简线条，单色 |
| OpenHands | 高：name + 模型 + 当前 task + 耗时 + 错误计数 | 状态点 + 进度条 + 报错浮层 | 卡片式，emoji 友好 |
| CrewAI Studio | 中：agent 角色 + 工具链 | 角色色 + tool 计数 | 拟人化（每个 agent 一个头像） |
| AutoGen Studio | 中：name + 模型 + 上下文长度 | 圆点状态 + 上下文用量条 | 偏专业 |
| Claude Code / ChatGPT Codex | 低：纯对话 | 不展示 agent 自身状态 | 极简对话式 |
| Devin | 高：name + session + ticket + 浏览器预览截图 | 状态点 + session timer | 类 IDE 截图 |
| Manus | 中：name + 任务摘要 + 文件树 | 状态点 + 进度条 + 文件树折叠 | 类 Jupyter |
| v0 / bolt.new | 低：纯对话 + 预览 | 不展示 agent 自身状态 | 极简 |

### 5.2 主流产品的流式渲染做法

| 产品 | 流式模型 | 思考过程呈现 | 工具调用呈现 |
| --- | --- | --- | --- |
| ChatGPT / Claude 对话 | token 级流式 + 终态渲染 | thinking 折叠 + 渐显光标 | 工具调用内联卡片 + 参数/返回折叠 |
| LangSmith Studio | 步骤级流式 + 节点高亮 | 整段 thinking 折叠在节点上 | 节点就是工具调用，可展开 |
| OpenHands | 步骤级流式 + 中间日志 | 思考合并到日志流，搜索可定位 | 工具调用独立日志条目 |
| Manus | token 级 + 文件树同步 | 思考合并到 narration | 工具调用右栏独立列表 |
| Devin | 步骤级 + 浏览器预览 | 思考合并到日志 | 工具调用右栏独立 |

### 5.3 借鉴与取舍

- **借鉴**：步骤级 + 中间过程可折叠（OpenHands / LangSmith），token 级流式渐显光标（ChatGPT）。
- **取舍**：Dashboard 是"运维视角"而非"创作视角"，比 Studio 严肃、比对话产品信息密度高。最终方向：
  - Worker 卡片：**OpenHands 的信息密度 + Devin 的状态点 + LangSmith 的极简线条**，结合 AgentTeams 自有的 HealthRing + 阶段徽章做差异化。
  - Chat 流式：**ChatGPT 的渐显光标（已实现） + LangSmith 的步骤级折叠（已实现）**，工具调用按运行时贴角标归属。
  - v0.1 中"Manus 工具独立列 / 卡片下方最近 3 次工具调用摘要"已按 R5 移出范围。

### 5.4 详细差异映射表（用于本次设计）

| Dashboard 现状 | 借鉴对象 | 本次改造 |
| --- | --- | --- |
| Worker 卡片只有名字 + 状态点 | OpenHands / Devin | 增加"最近任务摘要 + 最近活动时间 + 当前运行时特征图标" |
| RuntimeBadge 仅文字 | CrewAI | 增加运行时专属图标 + 配色（openclaw = 默认、copaw = 蓝、hermes = 紫、qwenpaw = 橙、openhuman = 灰） |
| HealthRing 抽象分 | LangSmith | 把 100 分制映射成"稳定运行 / 偶有异常 / 频繁出错"三档 |
| 删除中只一行黄字 | OpenHands | 卡片整体淡出 + 进度条 + 不可操作遮罩 |
| thinking 卡不可区分运行时 | LangSmith | 卡片左上角贴运行时小角标，展开可见根事件 ID 与编辑次数（R18） |
| tool_call 块无运行时归属 | LangSmith | 工具卡贴运行时角标；Worker 活物条显示 24h 工具调用数（R5） |

---

## 6. 设计方案

### 6.1 Worker 卡片重设计（`worker-card.tsx` v2）

#### 6.1.1 视觉结构（自上而下）

1. **Header**：复选框 + 状态点（v2：颜色 + 图形双编码，动效分频）+ 名字 + 运行时徽章（v2 含图标）+ 健康环 v2。
2. **活物条**（新增）：一行 4 列小数据——"最近任务 / 持续时长 / 最近活动 / 工具调用"。每列最多 12 字符，超出 ellipsis，`title` tooltip 显示全文（R12）。
3. **状态叙述行**（新增）：把人话翻译放这里——
   - Running："正在帮 {team} 处理 {task}"，task 来自 `lastTaskSummary` 或 `message`；两者皆空时显示"运行中，暂无任务摘要"
   - Ready："已就绪，等待任务"（R16）
   - Sleeping："空闲 {duration}"，duration = `now - stateStartedAt`；缺字段显示"休眠中"
   - Pending："等待 Controller 派发镜像，预计 < 2 分钟"
   - Stopped："已停机"
   - Failed："{失败次数信息}，最近一次：{message 首行，去堆栈}"
   - Updating："正在拉取新镜像"
4. **运行时特征区**（新增）：根据 `runtime` 渲染对应的小图标 + 一句话说明（hover tooltip）：
   - openclaw：默认基础运行时，支持 A2UI 协议
   - copaw：AgentScope 体系，思考/工具以子消息呈现
   - hermes：原生 chat 适配，依赖上游 streaming
   - qwenpaw：完整流式协议，思考以 "Thinking:" 前缀识别
   - openhuman：基础兜底渲染
5. **操作区**：保留 v1 的所有按钮，2 行——主操作（详情 / 编辑）+ 生命周期（唤醒 / 休眠 / Ensure Ready）+ 危险操作（删除，带二次确认，沿用现有确认对话框）。
6. **删除态**：整体卡片淡出 0.4 → 1.0 → 0.6 呼吸 + 进度条 + 不可点击遮罩，顶部追加"删除中，等待 Controller 完成任务"浮层；删除失败时卡片恢复原状（R3）。

#### 6.1.2 动效与可达性

- 状态点呼吸周期：Running 2s 慢呼吸、Sleeping 4s 微呼吸、Pending 1s 快闪、Failed 红色 0.8s 急促。
- 状态点图形编码（R19 / AC-T3）：绿色系 = 圆点、黄色系 = 三角、红色系 = X、灰色（Stopped）= 方块，色盲友好。
- prefers-reduced-motion：禁用所有动效（状态点脉冲、删除呼吸、卡片入场），保留即时切换。
- 颜色对比度：所有状态色在 light + dark 下满足 WCAG AA（验收方式见 R8）。

#### 6.1.3 文案去 AI 味规范

- 不写"智能体"，写"Worker"或具体名字。
- 不写"正在为您处理"，写"正在处理"。
- 不写"您好，我可以帮您"，写"已就绪 / 待机中"。
- 不写"健康评分 78/100"，写"稳定运行 / 偶有异常 / 频繁出错"。
- 失败原因用直白动词：tool_guard 拒绝 / 镜像拉取失败 / OOM Killed / Matrix 鉴权失败。

### 6.2 Chat 流式适配补齐（`normalize.ts` v2 + 渲染）

#### 6.2.1 运行时归属感知（R1）

- 在 `DisplayMessage` 上新增 `runtime: WorkerRuntime | null`：由发送者 MXID 反查 Worker 清单得到（`ChatSection` 已持有 `useWorkers()` 结果，构建 `matrixUserID → { runtime, workerName }` 映射下发）。
- `normalizeToBlocks` 接收 `runtime` 透传给各 parser；产出的 `thinking` / `tool_call` / `text` / `error` 块携带 `runtimeHint`。
- 渲染层（`MessageBubble`）：thinking / tool_call 卡左上角贴运行时小角标（与 Worker 卡 RuntimeBadge 共用同一组件）。

#### 6.2.2 copaw 强化

- `runtime === 'copaw'` 时**跳过** `THINKING_PREFIX` 兜底（copaw 不会发 `Thinking:` 前缀，避免误吞其 tool_call 文本）。
- m.replace 收尾 body 为 `"已取消"` / `"处理异常"` 时产出 `error` 块（见 6.2.7），而不是普通 text。

#### 6.2.3 hermes 兜底（R11）

- 任何非本人 m.notice 中若含工具调用语义关键词（"tool"、"calling"、"invoking"），启发式产 `tool_call` 块（payload 带 `confidence: 'low'` 标记，hover 显示"运行时未提供结构化协议，按通用模式识别"）。
- 该规则在"m.notice → thinking 兜底"**之前**执行；qwenpaw 的 `tool call` 子消息会被同一规则捕获并贴 qwenpaw 角标，属预期行为。

#### 6.2.4 qwenpaw 已就绪

- M4 已实现 A2UI 流式容错 + 长消息附件。
- 本次新增：thinking 卡左上角贴 qwenpaw 角标（标题如 "QwenPaw · 思考过程"），避免与 A2UI 思考混淆。

#### 6.2.5 openclaw 兜底

- 任何 `m.replace` 编辑事件，若父事件是 placeholder（`body == "处理中..."`），按 qwenpaw 同样逻辑收尾（合并逻辑已在 `use-matrix.ts` 实现，无需改动）。
- 任何 A2UI 标记（` ```a2ui ` fence 或 `<!--a2ui:-->`）按 a2ui 块渲染，与 runtime 无关（现状已满足）。

#### 6.2.6 openhuman 兜底（R2）

- 与 hermes 同：通用 Matrix 协议渲染；角标为 openhuman 专属灰色徽章，hover 说明"通用 Matrix 协议渲染，无运行时专属结构化键"。仅当 MXID 反查失败（runtime = null）时不贴角标。

#### 6.2.7 错误与结束态统一（R10）

仅对**非本人消息**且 trim 后**全文精确匹配**生效：

- `"已取消"` → `error` 块（warning 色，标题"任务已取消"）。
- `"处理异常"` → `error` 块（danger 色，标题"任务异常"）。
- `"已处理"`（NO_REPLY）→ `error` 块 quiet 变体，渲染为一行小字"已处理（无回复）"。

### 6.3 Worker 卡片"活物条"数据来源（R5 / R6 / R17）

| 字段 | 来源 | 频率 |
| --- | --- | --- |
| 最近任务摘要 | `WorkerResponse.lastTaskSummary`（可选新字段）→ 缺省回落 `WorkerResponse.message`（已有）→ 皆空显示"暂无" | 轮询 15s（沿用 useWorkers） |
| 持续时长 | `now - stateStartedAt`；`stateStartedAt` 为**进入当前相位的时间戳**（可选新字段），缺字段显示"暂无" | 卡片内 30s 本地计时 |
| 最近活动 | `WorkerResponse.lastActivityAt`（可选新字段）；缺字段显示"暂无"。**前端不主动调用 `/last-activity` 接口**（R6） | 轮询 15s（沿用 useWorkers） |
| 工具调用数 | Chat 内渲染 tool_call 块时按事件 ID 被动计数，localStorage 记录时间戳，卡片读 24h 窗口计数；无记录显示"暂无" | 被动更新 |

### 6.4 后端配合（最小集，全部软依赖）

- `WorkerResponse` 新增可选字段：
  - `stateStartedAt?: string`（ISO8601，进入当前相位的时间）
  - `lastActivityAt?: string`（ISO8601）
  - `lastTaskSummary?: string`（<= 32 字符）
- （可选，后续）`GET /api/agentteams/workers/{name}/last-activity`：返回 `{ at: string, kind: 'm.read' | 'm.message' | 'typing' }`。
- 在 Controller CRD enum 注释里补齐 `openhuman`（上游 PR）。

---

## 7. 验收标准（AC）

### 7.1 Worker 卡片

- **AC-W1** 卡片在 light + dark 两种主题下均符合 WCAG AA 对比度。验收 = CI 中 axe-core（jsdom）非对比度规则 0 critical + 设计 token 审查 + Playwright 截图人工首肯（R8）。
- **AC-W2** 卡片 Header 包含：复选框、状态点（颜色 + 图形双编码、分相位动效）、名字、运行时徽章（含图标）、健康环 v2。
- **AC-W3** 活物条 4 列均存在；缺数据时显示"暂无"，不出现空格。
- **AC-W4** 状态叙述行：
  - Running 时显示"正在帮 {team} 处理 {task}"，task 来自 `lastTaskSummary` 或 `message`。
  - Ready 时显示"已就绪，等待任务"。
  - Sleeping 时显示"空闲 {duration}"，duration 来自 `now - stateStartedAt`。
  - Pending 时显示"等待 Controller 派发镜像，预计 < 2 分钟"。
  - Failed 时显示错误摘要（不含栈）。
- **AC-W5** 运行时特征区：5 种 runtime 各有独立图标与配色，hover tooltip 显示一句话说明。
- **AC-W6** 删除中：整体淡出呼吸 + 进度条 + 不可点击遮罩；删除失败时恢复原状（R3）。
- **AC-W7** `prefers-reduced-motion: reduce` 下禁用所有动效。
- **AC-W8** 文案：所有可见文案通过"AI 味扫描脚本"（见 7.5），0 命中"智能体/为您/您好/我可以帮您"等模板词。

### 7.2 Chat 流式

- **AC-C1** 对每种 runtime 注入 5 种典型事件序列（placeholder / tool_call / thinking / final / error），每一种在 Chat 内均能正确折叠并显示运行时角标：
  - openclaw：用通用 m.replace 序列，事件序列与 placeholder 不强绑定，验证 fallback 路径
  - copaw：用 `m.notice "处理中..."` → m.thread 子项 → m.replace 编辑
  - hermes：用上游 hermes-agent 风格的 m.replace 流式
  - qwenpaw：用 `m.notice "处理中..."` → m.thread "Thinking:\n\n..." → m.replace 编辑
  - openhuman：用通用 fallback
- **AC-C2** 长消息附件：注入 1 条 60KB 文本，验证 `com.agentteams.long_message.url` 在 Chat 渲染下载按钮，点击可拉取内容。
- **AC-C3** A2UI 流式容错（M4 已实现）：注入半成品 ` ```a2ui ` fence（无闭合），验证 Chat 显示 Loader2 占位卡而非半成品 JSON。
- **AC-C4** Workflow 卡片：注入 workerflow mcp 的 `agentteams.workflow` payload，验证 m.replace 编辑链路 + 状态机（spawning → ready → running → merging → done / failed）。
- **AC-C5** Tool Guard：注入 body 含 "Tool Guard" 关键词的 m.notice，验证 confirmation 块正确渲染；该功能当前仅当 runtime 显式发出 Tool Guard 文本时触发，hermes / openclaw 暂不保证。
- **AC-C6** 错误收尾：非本人消息 body 全文为 `"已取消"` / `"处理异常"` / `"已处理"` 时，分别渲染 warning / danger / quiet 三种态；本人发送的同名文本保持普通文本（R10）。
- **AC-C7** thinking 卡 + tool_call 卡左上角均带运行时小角标（与 Worker 卡 RuntimeBadge 共用组件），展开可见根事件 ID（截断）与编辑次数（R18）。
- **AC-C8** 在 jsdom + vitest 下，全部测试文件通过（含本次新增，R13）；新增/修改测试覆盖：
  - 5 种 runtime × 7 种事件序列的渲染快照（35 个用例）
  - 长消息附件的 mxc → 下载 URL 转换
  - 错误收尾的三种态
  - runtime 角标的显隐

### 7.3 Dashboard 呈现

- **AC-D1** 任务书 Markdown 存放于 `docs/plans/`，README "Roadmap" 段引用（R14）。
- **AC-D2** Worker 区"显示模式切换"（卡片 / 表格 已有）新增"紧凑"档：表格保留 选择/状态点/名称/运行时徽章/健康/操作，精简次要列；三档偏好持久化到 localStorage（R4）。

### 7.4 性能

- **AC-P1** 50 个 Worker 同时渲染时，Worker 卡片首屏 < 200ms（React Profiler 人工测，R7）；自动化保障：卡片 memo 化 + "渲染 50 卡片不抛错"用例。
- **AC-P2** Chat 流式：thinking / tool_call 卡的更新不触发整条 timeline 重渲，diff 由 react-virtuoso 处理。
- **AC-P3** HealthRing 动画用 transform + opacity / stroke-dashoffset，不触发布局。

### 7.5 文案与可访问性

- **AC-T1** 全部可见文案在中文 + 英文各跑一遍"AI 味扫描"（`scripts/ai-tone-scan.mjs`，CI 可执行，扫描 src/ 下非测试文件，排除注释行，R15），命中以下词拒绝合并：
  - 中文：智能体、为您、您好、请问、我可以帮您、非常高兴、希望对您有帮助、如有任何问题、请随时告诉我、让我们一起、首先我们需要、综上所述、值得注意的是
  - 英文：I can help、I'd be happy to、Let me、Here's what I can do、As an AI、Feel free to ask、Hope this helps
- **AC-T2** 全部按钮、徽章、卡片有 `aria-label` 或可读 innerText（axe-core 0 critical）。
- **AC-T3** 状态点颜色不仅依赖颜色，附带图形（红 X / 黄三角 / 绿圆点 / 灰方块），色盲友好（R19）。

### 7.6 测试

- **AC-Q1** `npm test` 全量通过，新增测试 0 flake（连续 3 次）。
- **AC-Q2** `npm run typecheck` 0 错误。
- **AC-Q3** `npm run lint` 0 错误（既有非本任务错误维持原状）。
- **AC-Q4** （替代 Storybook，R9）vitest 快照覆盖 5 种 runtime × 7 种事件序列共 35 个用例。
- **AC-Q5** 视觉回归：Playwright screenshot 跑 Worker 卡片 v2 + Chat 流式渲染，对比基线（人工首肯）。

---

## 8. 实施拆解（建议）

> 不是死计划，是给"我接下来要干活"的人的导览。

1. **数据准备（0.5 天，纯前端）**：`WorkerResponse` 增加 3 个可选字段；后端按 §6.4 跟进（软依赖，不阻塞）。
2. **Worker 卡片 v2（3 天）**：
   - 6.1.1 视觉结构落地（Header / 活物条 / 状态叙述 / 运行时特征 / 操作区 / 删除态）。
   - 6.1.3 文案去 AI 味。
   - 7.5 AI 味扫描脚本 + 现存命中修复（R15）。
3. **Chat 流式适配（3 天）**：
   - 6.2.1 运行时归属感知（`DisplayMessage.runtime`、MXID 反查映射）。
   - 6.2.2–6.2.6 各 runtime parser 分流。
   - 6.2.7 错误与结束态统一。
4. **快照与视图（1 天）**：35 个 vitest 快照用例 + 显示模式紧凑档 + localStorage 持久化。
5. **文档与任务书（0.5 天）**：本任务书（v0.2）落盘 `docs/plans/`，README 增加 "Roadmap" 段引用。

总计 ~8 个工作日（较 v0.1 减少的部分来自 R5/R9 的范围收缩）。

---

## 9. 风险与未决问题

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| openclaw wire format 只能间接推断 | openclaw 行为假设可能与实际不符 | 与 openclaw 上游团队对齐；首版按通用 m.replace 实现，后续按真实事件迭代 |
| copaw Message repr 解析脆弱 | 误吞 qwenpaw thinking | 用 `runtime` 字段分流（6.2.2） |
| 后端字段落地时间不确定 | 活物条可能首版空数据 | 字段全部可选，缺数据降级为"暂无"（R6） |
| 文案去 AI 味规则主观 | 验收标准 7.5 可能漏判 | 脚本仅做硬词检测，主观判断由设计 + 工程联合 review |
| hermes 关键词启发式误报 | 普通含 "tool" 字样的 notice 变成工具卡 | `confidence: 'low'` 标记 + hover 说明；后续按真实 hermes 事件样本收敛关键词 |

---

## 10. 验收演示脚本（给 QA）

1. 起一个本地 Dashboard（`npm run dev`），连到一个包含多个不同 runtime Worker 的开发集群（覆盖不到的 runtime 以 vitest 快照为用例证据）。
2. Worker 卡片验收：
   - 切 light / dark，目视 + axe-core 各跑一遍。
   - 在卡片上点"删除"，验证淡出呼吸 + 进度条 + 遮罩；模拟一次删除失败（断开 API），验证卡片恢复原状并提示（R3）。
   - 系统设置开启 reduced motion，验证动效关闭。
   - 切换 卡片 / 表格 / 紧凑 三档，刷新页面验证偏好保持。
3. Chat 流式验收：
   - 在每个 runtime 的 Worker 私聊房触发一次完整对话。
   - 检查 thinking / tool_call / final / error 四种态的卡片与运行时角标。
   - 触发一次超过 48 KB 的输出，验证长消息附件下载。
   - 触发一次 workerflow，验证状态机。
4. 文案验收：跑 `npm run lint:tone`（AI 味扫描），0 命中。
5. 性能验收：React Profiler 看 Worker 区与 Chat 区，记录首屏耗时（AC-P1 人工）。
6. 任务书呈现验收：README Roadmap 段可点击跳转到本文件（AC-D1）。

---

## 11. 变更记录

- 2026-08-11 v0.1：初稿。
- 2026-08-11 v0.2：按仓库现状核对修订（R1–R19，见第 0 章）；范围收缩（R5/R9），工期 10 → 8 天。

# Worker 运行时能力对照表

> 底稿：`.monkeycode/specs/worker-card-v2-chat-runtime-ux/task-book.md` §4.1（2026-09 收尾入正式文档，B2/11.3）。维度定义与取证细节以底稿为准；本文档是运行时能力的权威口径，Runtime 区块卡片与创建表单以 `src/lib/runtime-options.ts` 为实现事实来源。

## 总表

| 维度 | OpenClaw | CoPaw（存量） | Hermes | QwenPaw | OpenHuman（存量） | DeepSeek Harness（实验） |
| --- | --- | --- | --- | --- | --- | --- |
| 可否新建 | ✅ | ❌ 已停止新建 | ✅ | ✅ | ❌ 已停止新建 | ✅（实验） |
| 流式载体 | 上游 m.replace（间接证据） | placeholder m.notice → m.thread 子项 → m.replace 编辑 placeholder | 继承自 hermes-agent 上游 | placeholder m.notice → m.thread "Thinking:\n\n..." → m.replace 编辑 placeholder | 未找到独立实现 | 思考与工具以结构化流呈现（chat 原生适配，依赖上游 streaming） |
| placeholder 字面量 | 不明（推断使用 m.replace） | `"处理中..."` | 无 | `"处理中..."` | 暂无 | — |
| thinking 表达 | 不明 | 无（renderer 直接渲染到 m.notice） | 无 | **`"Thinking:\n\n{text}"` 前缀** | 暂无 | 结构化思考流 |
| tool_call 表达 | 不明 | m.notice 子消息，body 由 renderer 渲染 | 上游决定 | m.notice 子消息 + `🔧 **tool**` 正则过滤 | 暂无 | 结构化工具流 |
| 最终答复流式 | m.replace（推断） | m.replace placeholder | 上游决定 | m.replace placeholder | 暂无 | 上游决定 |
| mention 三层 | 必须（外层 + m.new_content + body） | 必须 | 仅 outbound m.mentions | 必须 | 暂无 | — |
| 长消息 fallback | 不明 | 无 | 上游决定 | `com.agentteams.long_message` + 附件 rel_type | 暂无 | — |
| 结构化键 | 不明 | 无 | 无 | `com.agentteams.long_message`、`m.teamharness.trigger` | 暂无 | — |
| agentteams.workflow 推送 | 无 | 无 | 无 | 仅 workflow mcp 进程发送，非 channel 直发 | 暂无 | — |
| 模型接入 | 经 AI 网关按别名路由 | 经 AI 网关 | 经 AI 网关 | 经 AI 网关（千问生态优化） | — | DeepSeek 系（经 AI 网关） |
| 知识库数据面（workspace-files） | ❌ | ❌ | ❌ | ✅ 专属 | ❌ | ❌ |

## 阅读约定

- 「经 AI 网关」：模型不限定于运行时厂商列表——Dashboard 侧按模型别名经 Higress AI 网关路由（见 `docs/AI_GATEWAY_GUIDE.md`），「支持模型」以网关配置的服务商模型与内置别名为准。
- 「知识库数据面」：`/api/agentteams/workers/[name]/workspace-files/*`（MEMORY.md / memory/** / digest/**）按 QwenPaw 工作区布局实现；知识库面板的 Worker 下拉只列出 `runtime === 'qwenpaw'` 的实例，全非 QwenPaw 时面板给出说明性空态（FUNC-10，2026-09-20 确认口径）。
- 存量运行时（CoPaw / OpenHuman）保留实例的运行、编辑与删除，创建入口已关闭；CoPaw 的升级目标为 QwenPaw（`COPAW_MIGRATION_HINT`）。

## 各运行时适配要点（底稿 §4.2-§4.5 摘录）

### OpenClaw（默认）

- 源码本体在 `openclaw-base/Dockerfile`（空基础镜像），实际运行时在上游 hiclaw（版本随镜像）。
- Dashboard 适配策略：不假设一定发 A2UI，先按通用 `m.replace` + `m.thread` 处理，遇到 A2UI 标记再升级；mention 渲染必须三层并列读取（openclaw >= 2026.4.x 硬要求，缺一项被静默丢弃）。

### CoPaw（存量，AgentScope 系）

- 流式三层：m.notice `"处理中..."` 根 → reasoning / tool_call 子消息 → m.replace 编辑收尾。
- 没有 streaming 回调实现，不发 `Thinking:` 前缀；错误收尾为 `"已取消"` / `"处理异常"`。

### Hermes

- 传输能力（streaming edit、thread、typing、E2EE）保留在上游 hermes-agent，AgentTeams 只叠加策略层。
- Dashboard 适配策略：不依赖任何 AgentTeams 专属结构化键，仅按通用 Matrix 协议渲染；tool_call 由上游决定格式，按 m.notice 中工具调用语义关键词启发式判断。

### QwenPaw（AgentTeams 矩阵协议最完整）

- 完整事件序列：`处理中...`（notice）→ `tool: <name>` / `Thinking:\n\n<text>`（thread 子消息）→ 最终答复（m.replace 编辑 placeholder）。
- 长消息：`com.agentteams.long_message` 顶层键 + 相邻 `com.agentteams.attachment` 的 m.file 附件。
- 自触发：`m.teamharness.trigger` 表示跨会话自触发的项目请求；错误收尾 `"已处理"` / `"处理异常"` / `"已取消"`。
- 唯一支持知识库数据面（workspace-files）的运行时。

### DeepSeek Harness（实验）

- 实验性 DeepSeek 工具调用 Harness：思考与工具调用以结构化流呈现，chat 原生适配，依赖上游 streaming（`runtime-meta.ts`）。
- 矩阵协议维度尚未纳入 §4.1 取证矩阵（`normalize-runtime-matrix.test.ts` 刻意不覆盖——它走泛用渲染路径）；接入新专属行为前先补底稿取证。

## 生态兼容维护原则（D6）

1. **路径回退一个版本周期**：runtime 的会话目录、端点路径、导出布局变更时，Dashboard 侧保留旧路径的读取回退至少一个上游版本周期（新路径优先、旧路径兜底），升级说明中标注定弃时间。
2. **上游发版冒烟纳入 B3 对照流程**：上游 runtime（OpenClaw/QwenPaw/Hermes/DeepSeek Harness）发版后，按 `CONTRIBUTING.md` 的上游对齐流程过一遍 proxy 端点与本表维度；行为差异先记 `docs/INTERFACES.md` 对照记录再改代码。
3. **探测回退路径必须有测试**：安装器凭证探测链（`agentteams-dashboard-tests.sh` Test N）、KB 面按 runtime 过滤的空态（`knowledge-section.test.tsx` ⑩⑪）、协议未知版本回退（`parser-agent-run.test.ts` + `normalize.test.ts`）——改动任何回退逻辑时同步补断言。

## 维护

- 新增运行时：先在 `src/lib/agentteams-api.ts` 的 `WorkerRuntime` 联合类型登记 → `runtime-options.ts`（可创建性）→ `runtime-meta.ts`（徽标/描述）→ `runtime-section.tsx`（卡片与计数）→ 本表补列。
- 修改本文档前与 task-book 底稿对齐；底稿是取证记录，本文档是口径收敛。

# Runtime Block Protocol — Dashboard 侧契约与归一化

## 背景

Dashboard 当前通过 13 级文本启发式规则（src/lib/a2ui/normalize.ts:63）将 Matrix 消息归一化为块序列。该管线对未携带任何结构化字段的 runtime（Hermes / openhuman / qwenpaw）有效，但脆弱：每接入新 runtime 都需加规则，且无法携带跨消息的运行上下文。

`org.agentteams.run` 解析器（src/lib/a2ui/parser.ts:65 `parseAgentRunBlocks`）已实现为生产者提供者的接入点，但目前是 opt-in 兼容通道——上游无生产者，且协议字段定义薄弱（见 parser.ts:65 注释："AgentTeams itself does not define this Matrix event schema"）。

## 目标

将 `org.agentteams.run` 从"临时占位"升级为有版本号、有标准化字段、有测试覆盖的协议契约，使上游运行时开始发结构化块后 Dashboard 可平滑切换；同时为工具调用台账增加结构化 ID 的优先级读取，使 worker-card 的"24h 工具调用数"在多端可见。

## 非目标

- 不要求 Dashboard 重写 normalize 主循环。本任务只固化 `org.agentteams.run` 的契约与降级路径。
- 不动上游 AgentTeams runtime 发消息的代码（属另一仓库）。
- 不动 Tool Guard 文本协议（属 P0-2 范围）。

## 契约规范

`org.agentteams.run` 在 Matrix `content` 中存在时是单一对象：

```ts
{
  version: "1",
  run_id: string,        // 关联同一次执行的多条消息
  step_id?: string,      // 当前步骤；工具调用时填
  blocks: Array<
    | { type: "text"; text: string; isStreaming?: boolean }
    | { type: "thinking"; content: string; isStreaming?: boolean }
    | { type: "tool_call"; payload: { tool_name: string; arguments: Record<string, unknown>; result?: unknown; status: "pending" | "running" | "succeeded" | "failed"; tool_call_id?: string; started_at?: number; finished_at?: number } }
    | { type: "confirmation"; payload: { tool_name: string; parameters?: string; external_files?: string; confirmation_id: string; expires_at?: number } }
    | { type: "error"; payload: { kind: "cancelled" | "failed" | "quiet"; title: string } }
  >
}
```

- `version`：缺省 `"0"`（当前 opc-in 形态）；本任务规范引入 `"1"`。
- `run_id`：可选但强烈推荐；缺省时降级到事件 ID 派生。
- `confirmation_id`：未来 Tool Guard 协议化所需保留字段；本次仅透传不消费。
- 已知未实现但保留：每块独立 `isStreaming` 与顶层 `isStreaming` 协同（沿用 parser.ts:83 的现有规则）。

## 降级路径

- `version === "0"` 或缺省：保留当前 13 级文本规则归一化路径，仅用 `parseAgentRunBlocks` 现有的"按 blocks 数组里 type 字符串映射"逻辑。
- `version === "1"`：优先消费 blocks 数组；若某 block 字段不全（如 tool_call 缺 status），按缺省值填充并打 console.warn（仅开发态）。
- 解析失败：与现有"降级到文本"行为一致（normalize.ts 调用点不被破坏）。

## 验收

- [ ] `parseAgentRunBlocks` 新增 `version` 区分分支，v1 路径覆盖 text/thinking/tool_call/confirmation/error 五种块。
- [ ] tool_call 块 `tool_call_id` 字段被 `recordToolCalls` 优先采用为去重键。
- [ ] 新增单测覆盖：v0/v1 各类型块、字段缺失降级、版本不识别降级、tool_call_id 去重。
- [ ] `npm run typecheck` / `npm run lint` / `npm test` 全绿。
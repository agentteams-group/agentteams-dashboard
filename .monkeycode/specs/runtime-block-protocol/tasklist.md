# Runtime Block Protocol — Task List

## 任务列表

- [x] 1. 在 src/lib/a2ui/protocol.ts 新增 RuntimeBlock v0/v1 discriminated union 类型与版本探测函数 `resolveProtocolVersion`。无运行时副作用，便于上游未来直接复用。
- [x] 2. 在 src/lib/a2ui/parser.ts 改造 `parseAgentRunBlocks`：按 version 分流，v1 路径走规范化字段（tool_call.status、thinking.isStreaming 等），v0 保持现有透传语义。失败/未知版本一律返回 undefined 让上游走文本启发式。
- [x] 3. 在 src/lib/a2ui/protocol.ts 配套导出 `normalizeToolCallPayload(v1Block)` 与 `normalizeConfirmationPayload(v1Block)` 两个规范化工具，保证下游消费者（MessageBubble、tool-call-counter）拿到统一形态。
- [x] 4. 在 src/lib/tool-call-counter.ts 增加 `recordToolCalls` 对结构化 `tool_call_id` 的优先级读取：若 v1 block 含 `tool_call_id` 则按该键去重，否则保留现有 `(eventId, toolName, argsHash)` 复合键。
- [x] 5. 单测：parser.test.ts 新增 `describe('parseAgentRunBlocks v1')` 覆盖五类块、字段缺失降级、未知 version 降级；tool-call-counter.test.ts 新增结构化 id 去重用例。
- [x] 6. 跑 typecheck + lint + test 验证；记录改动到 CHANGELOG Unreleased "Improvements" 段。

## 范围外

- 不动 normalize.ts 的 13 级规则顺序。
- 不动 Tool Guard 文本识别（parser.ts:281 `parseToolGuardConfirmation`）。
- 不改 MessageBubble 渲染逻辑（结构化字段已通过 runtimeHint 透传）。

## 验证

- typecheck：`./node_modules/.bin/tsc --noEmit` 通过
- lint：`./node_modules/.bin/eslint <改动文件>` 通过
- test：`./node_modules/.bin/vitest run` 全量 131 文件 1167 用例通过
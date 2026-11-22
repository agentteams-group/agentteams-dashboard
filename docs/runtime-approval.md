# Runtime tool approvals

QwenPaw and the independent Codex Harness publish `org.agentteams.approval`
in Matrix `m.room.message` content. Dashboard reuses its tool confirmation
card and routes the decision back to the sending Agent as a normal Matrix reply.

```json
{
  "version": 1,
  "runtime": "codex",
  "request_id": "42",
  "context_id": "thread-1:turn-1",
  "status": "pending",
  "tool_name": "commandExecution",
  "parameters": "{\"command\":\"echo probe\"}"
}
```

- `runtime`: one of six adapters — `openclaw`, `qwenpaw`, `hermes`,
  `deepseek-harness`, `openhuman`, `codex`. `codex`, `hermes`,
  `deepseek-harness` and `openhuman` also require `context_id` to prevent reused
  request IDs from matching another turn (`openclaw` / `qwenpaw` do not).
- `request_id`: the runtime's exact ID, never inferred from tool arguments.
- `status`: `pending`, `approved`, `rejected`, `cancelled`, or `expired`.
- Pending requests require `tool_name`. Optional display fields are
  `parameters`, `severity`, `risk_details`, and `expires_at` (Unix milliseconds).
- Receipts carry the same runtime, request and context IDs and come from the
  same Agent in the same room. The Matrix request event ID identifies the card.

Reply commands differ per runtime:

| Runtime | Approve | Deny |
|---|---|---|
| `qwenpaw` | `/approval approve ID` | `/approval deny ID` |
| `codex` | `/approve ID CONTEXT` | `/reject ID CONTEXT` |
| `openclaw` | `/approve ID allow-once` | `/approve ID deny` |
| `hermes` / `deepseek-harness` / `openhuman` | `/agentteams-approval approve ID CONTEXT` | `/agentteams-approval deny ID CONTEXT` |

Codex checks the context before accepting the decision. Delivery to Matrix
displays “已提交，等待运行时确认”; a runtime receipt completes the card. Sending a
decision does not itself mean the tool ran or succeeded. Failed delivery remains
retryable.

QwenPaw needs the matching AgentTeams Matrix channel update. Codex needs the
matching independent Harness update; command/file approvals are supported, while
`requestUserInput` stays on `/answer` and is not converted to tool approval.
Codex must already use an approval policy that requests interactive decisions;
Dashboard does not change sandbox or approval policy.

Old QwenPaw text without an ID stays visible but cannot offer a precise button.
Legacy Tool Guard presentation is preserved. OpenClaw, Hermes, DeepSeek-Harness
and OpenHuman reuse the same `org.agentteams.approval` contract with the reply
commands listed above; receipts are matched on the
`(room, sender, request_id, context_id)` tuple, so all four runtime families
complete the same confirmation card.

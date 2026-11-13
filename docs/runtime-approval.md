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

- `runtime`: `qwenpaw` or `codex`. Codex also requires `context_id` to prevent
  reused App Server request IDs from matching another turn.
- `request_id`: the runtime's exact ID, never inferred from tool arguments.
- `status`: `pending`, `approved`, `rejected`, `cancelled`, or `expired`.
- Pending requests require `tool_name`. Optional display fields are
  `parameters`, `severity`, `risk_details`, and `expires_at` (Unix milliseconds).
- Receipts carry the same runtime, request and context IDs and come from the
  same Agent in the same room. The Matrix request event ID identifies the card.

QwenPaw buttons send `/approval approve ID` or `/approval deny ID`. Codex
buttons send `/approve ID` or `/reject ID`. Delivery to Matrix displays
“已提交，等待运行时确认”; a runtime receipt completes the card. Sending a decision
does not itself mean the tool ran or succeeded. Failed delivery remains retryable.

QwenPaw needs the matching AgentTeams Matrix channel update. Codex needs the
matching independent Harness update; command/file approvals are supported, while
`requestUserInput` stays on `/answer` and is not converted to tool approval.
Codex must already use an approval policy that requests interactive decisions;
Dashboard does not change sandbox or approval policy.

Old QwenPaw text without an ID stays visible but cannot offer a precise button.
Legacy Tool Guard presentation is preserved. This change adds no new CoPaw,
OpenClaw, Hermes, OpenHuman, or DeepSeek approval integration.

/** Matrix transport contract shared by the six Harness adapters. */
export const RUNTIME_APPROVAL_KEY = 'org.agentteams.approval';
export interface RuntimeApproval {
  version: 1;
  runtime: string;
  request_id: string;
  context_id?: string;
  reply_format?: 'com.agentteams.answer';
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired';
  tool_name?: string;
  parameters?: string;
  severity?: string;
  risk_details?: string;
  expires_at?: number;
}

export function parseRuntimeApproval(value: unknown): RuntimeApproval | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const data = value as RuntimeApproval;
  if (data.version !== 1 || typeof data.runtime !== 'string' || !data.runtime
    || (data.reply_format !== 'com.agentteams.answer' && !['openclaw', 'qwenpaw', 'hermes', 'deepseek-harness', 'openhuman', 'codex'].includes(data.runtime))
    || typeof data.request_id !== 'string' || !/^[\w.:-]+$/.test(data.request_id)
    || !['pending', 'approved', 'rejected', 'cancelled', 'expired'].includes(data.status)) return;
  if (data.status === 'pending' && (typeof data.tool_name !== 'string' || !data.tool_name)) return;
  if (data.reply_format === 'com.agentteams.answer') {
    if (typeof data.context_id !== 'string' || !/^[\w.:-]+$/.test(data.context_id)) return;
    return data;
  }
  if (data.runtime === 'codex' && (typeof data.context_id !== 'string' || !/^[\w.:-]+$/.test(data.context_id))) return;
  if (['hermes', 'deepseek-harness', 'openhuman'].includes(data.runtime)
    && (typeof data.context_id !== 'string' || !/^[\w.-]+$/.test(data.context_id))) return;
  return data;
}

export function runtimeApprovalPayload(data: RuntimeApproval): Record<string, unknown> {
  const id = data.request_id;
  const replies = data.reply_format === 'com.agentteams.answer'
    ? [`批准请求 ${id}`, `拒绝请求 ${id}`]
    : data.runtime === 'codex'
    ? [`/approve ${id} ${data.context_id}`, `/reject ${id} ${data.context_id}`]
    : data.runtime === 'openclaw'
      ? [`/approve ${id} allow-once`, `/approve ${id} deny`]
      : data.runtime === 'qwenpaw'
        ? [`/approval approve ${id}`, `/approval deny ${id}`]
        : [`/agentteams-approval approve ${id} ${data.context_id}`, `/agentteams-approval deny ${id} ${data.context_id}`];
  return {
    toolName: data.tool_name,
    requestId: id,
    runtimeApproval: true,
    contextId: data.context_id,
    structuredReply: data.reply_format === 'com.agentteams.answer',
    parameters: typeof data.parameters === 'string' ? data.parameters : undefined,
    severity: typeof data.severity === 'string' ? data.severity : undefined,
    riskDetails: typeof data.risk_details === 'string' ? data.risk_details : undefined,
    expiresAt: typeof data.expires_at === 'number' ? data.expires_at : undefined,
    approveReply: replies[0],
    rejectReply: replies[1],
  };
}

/** Matrix transport contract shared by QwenPaw and Codex adapters. */
export const RUNTIME_APPROVAL_KEY = 'org.agentteams.approval';
export interface RuntimeApproval {
  version: 1;
  runtime: 'qwenpaw' | 'codex';
  request_id: string;
  context_id?: string;
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
  if (data.version !== 1 || !['qwenpaw', 'codex'].includes(data.runtime)
    || typeof data.request_id !== 'string' || !/^[\w.-]+$/.test(data.request_id)
    || !['pending', 'approved', 'rejected', 'cancelled', 'expired'].includes(data.status)) return;
  if (data.status === 'pending' && (typeof data.tool_name !== 'string' || !data.tool_name)) return;
  if (data.runtime === 'codex' && (typeof data.context_id !== 'string' || !/^[\w.:-]+$/.test(data.context_id))) return;
  return data;
}

export function runtimeApprovalPayload(data: RuntimeApproval): Record<string, unknown> {
  const id = data.request_id;
  return {
    toolName: data.tool_name,
    requestId: id,
    runtimeApproval: true,
    contextId: data.context_id,
    parameters: typeof data.parameters === 'string' ? data.parameters : undefined,
    severity: typeof data.severity === 'string' ? data.severity : undefined,
    riskDetails: typeof data.risk_details === 'string' ? data.risk_details : undefined,
    expiresAt: typeof data.expires_at === 'number' ? data.expires_at : undefined,
    approveReply: data.runtime === 'codex' ? `/approve ${id} ${data.context_id}` : `/approval approve ${id}`,
    rejectReply: data.runtime === 'codex' ? `/reject ${id} ${data.context_id}` : `/approval deny ${id}`,
  };
}

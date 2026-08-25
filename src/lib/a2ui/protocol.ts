/**
 * Runtime block protocol — discriminated union for `org.agentteams.run` blocks.
 *
 * AgentTeams runtimes MAY emit a structured `content['org.agentteams.run']`
 * payload instead of relying on the body-text heuristics in `parser.ts`.
 * The schema is intentionally narrow: every block carries a `type` discriminator
 * and only fields that downstream consumers (Chat renderer, tool-call counter,
 * WenTian diagnosis) actually consume.
 *
 * Two versions are recognised:
 *   - "0" / undefined: legacy opt-in shape (see parser.parseAgentRunBlocks).
 *     The schema is loosely typed; consumers must tolerate missing fields.
 *   - "1": normalised shape. New fields (run_id, step_id, tool_call.status,
 *     confirmation.confirmation_id) are reserved. Field defaults are filled
 *     in by `normalizeRuntimeBlock` for forward compatibility.
 *
 * When an unknown version is seen or required fields are missing the parser
 * returns `undefined` so the caller can fall through to the legacy text
 * heuristics — never silently drop a message.
 */

export const RUNTIME_BLOCK_PROTOCOL_VERSION = '1';
export const RUNTIME_BLOCK_PROTOCOL_LEGACY = '0';

export type RuntimeProtocolVersion = typeof RUNTIME_BLOCK_PROTOCOL_VERSION | typeof RUNTIME_BLOCK_PROTOCOL_LEGACY;

/** Status of a single tool invocation, matching the existing Chat card states. */
export type RuntimeToolCallStatus = 'pending' | 'running' | 'succeeded' | 'failed';

/** Mirror of parser.RunEndingPayload, kept here so the protocol file is the source of truth. */
export type RuntimeRunEndingKind = 'cancelled' | 'failed' | 'quiet';

export interface RuntimeTextBlock {
  type: 'text';
  text: string;
  isStreaming?: boolean;
}

export interface RuntimeThinkingBlock {
  type: 'thinking';
  content: string;
  isStreaming?: boolean;
}

export interface RuntimeToolCallBlock {
  type: 'tool_call';
  payload: {
    tool_name: string;
    arguments: Record<string, unknown>;
    result?: unknown;
    status: RuntimeToolCallStatus;
    /** Stable id assigned by the runtime. Used to dedupe across revisions / replays. */
    tool_call_id?: string;
    started_at?: number;
    finished_at?: number;
  };
}

export interface RuntimeConfirmationBlock {
  type: 'confirmation';
  payload: {
    tool_name: string;
    parameters?: string;
    external_files?: string;
    /** Stable id used to correlate approve / deny replies. */
    confirmation_id: string;
    expires_at?: number;
  };
}

export interface RuntimeErrorBlock {
  type: 'error';
  payload: { kind: RuntimeRunEndingKind; title: string };
}

export type RuntimeBlock =
  | RuntimeTextBlock
  | RuntimeThinkingBlock
  | RuntimeToolCallBlock
  | RuntimeConfirmationBlock
  | RuntimeErrorBlock;

export interface RuntimeBlockEnvelope {
  version: RuntimeProtocolVersion;
  /** Correlation id joining multiple messages from the same execution. */
  run_id?: string;
  /** Current step id within the run. */
  step_id?: string;
  blocks: RuntimeBlock[];
}

export function resolveProtocolVersion(value: unknown): RuntimeProtocolVersion | undefined {
  if (value === RUNTIME_BLOCK_PROTOCOL_VERSION) return RUNTIME_BLOCK_PROTOCOL_VERSION;
  if (value === undefined || value === RUNTIME_BLOCK_PROTOCOL_LEGACY || value === null) {
    return RUNTIME_BLOCK_PROTOCOL_LEGACY;
  }
  return undefined;
}

/** True when a block carries a usable tool_call_id (non-empty string). */
export function hasToolCallId(block: RuntimeBlock): block is RuntimeToolCallBlock {
  return (
    block.type === 'tool_call' &&
    typeof block.payload.tool_call_id === 'string' &&
    block.payload.tool_call_id.length > 0
  );
}

/**
 * Normalise a v1 tool_call block: fill in missing optional fields with safe
 * defaults so downstream consumers do not have to null-check everything.
 * Unknown fields are stripped to keep the payload serialisable.
 */
export function normalizeToolCallPayload(raw: unknown): RuntimeToolCallBlock | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const source = raw as Record<string, unknown>;
  const toolName = source.tool_name;
  if (typeof toolName !== 'string' || toolName.length === 0) return undefined;

  const status = normalizeToolCallStatus(source.status);

  const args: Record<string, unknown> =
    source.arguments && typeof source.arguments === 'object' && !Array.isArray(source.arguments)
      ? (source.arguments as Record<string, unknown>)
      : {};

  const payload: RuntimeToolCallBlock['payload'] = { tool_name: toolName, arguments: args, status };
  if (typeof source.tool_call_id === 'string' && source.tool_call_id.length > 0) {
    payload.tool_call_id = source.tool_call_id;
  }
  if (typeof source.started_at === 'number') payload.started_at = source.started_at;
  if (typeof source.finished_at === 'number') payload.finished_at = source.finished_at;
  if ('result' in source) payload.result = source.result;
  return { type: 'tool_call', payload };
}

function normalizeToolCallStatus(value: unknown): RuntimeToolCallStatus {
  if (value === 'pending' || value === 'running' || value === 'succeeded' || value === 'failed') {
    return value;
  }
  return 'running';
}

/**
 * Normalise a v1 confirmation block. Requires confirmation_id; without it the
 * caller should fall back to the legacy text heuristic so the operator still
 * sees an approval card.
 */
export function normalizeConfirmationPayload(raw: unknown): RuntimeConfirmationBlock | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const source = raw as Record<string, unknown>;
  const toolName = source.tool_name;
  const confirmationId = source.confirmation_id;
  if (typeof toolName !== 'string' || toolName.length === 0) return undefined;
  if (typeof confirmationId !== 'string' || confirmationId.length === 0) return undefined;

  const payload: RuntimeConfirmationBlock['payload'] = {
    tool_name: toolName,
    confirmation_id: confirmationId,
  };
  if (typeof source.parameters === 'string') payload.parameters = source.parameters;
  if (typeof source.external_files === 'string') payload.external_files = source.external_files;
  if (typeof source.expires_at === 'number') payload.expires_at = source.expires_at;
  return { type: 'confirmation', payload };
}

/**
 * Normalise a v1 error block. The runtime run-ending sentinels stay narrow
 * (cancelled / failed / quiet) — anything else is rejected so the caller can
 * fall through to the existing parseRunEnding text heuristic.
 */
export function normalizeErrorPayload(raw: unknown): RuntimeErrorBlock | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const source = raw as Record<string, unknown>;
  if (source.kind !== 'cancelled' && source.kind !== 'failed' && source.kind !== 'quiet') return undefined;
  if (typeof source.title !== 'string') return undefined;
  return { type: 'error', payload: { kind: source.kind, title: source.title } };
}
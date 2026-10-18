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

/**
 * 选项式干预（PRD F2.1 / §7.3 org.agentteams.run v2 提案，消费侧先行）。
 * 上游 runtime 未发布 v2 时这些字段恒缺省 → 块回落为 v1 工具确认卡，
 * 前向兼容语义与既有未知字段处理一致（不丢消息、文本启发式兜底）。
 */
export interface RuntimeConfirmationOption {
  id: string;
  label: string;
  description?: string;
  /** Agent 标记的推荐项：置顶 + 默认选中（PRD F2.1）。 */
  recommended?: boolean;
}

export interface RuntimeConfirmationQuestion {
  id?: string;
  question: string;
  options?: RuntimeConfirmationOption[];
  multi_select?: boolean;
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
    /** v2 干预：问题文本（单问题形态）。 */
    question?: string;
    /** v2 干预：选项列表（与 question 配套）。 */
    options?: RuntimeConfirmationOption[];
    /** v2 干预：多选（默认单选）。 */
    multi_select?: boolean;
    /** v2 干预：多问题分页形态。 */
    questions?: RuntimeConfirmationQuestion[];
    /** v2 提案：答案回传 schema（上游消费约定，Dashboard 仅透传）。 */
    answer_schema?: Record<string, unknown>;
    /** v2 提案：被请求人 MXID；缺省 = 房间全员可答复（现状语义）。 */
    requested_of?: string;
  };
}

export interface RuntimeErrorBlock {
  type: 'error';
  payload: { kind: RuntimeRunEndingKind; title: string };
}

/** 问题分级（PRD F3.1：阻断 / 建议）。 */
export type ReviewIssueSeverity = 'blocker' | 'suggestion';

export interface RuntimeReviewIssue {
  id: string;
  severity: ReviewIssueSeverity;
  /** 位置描述（文件/段落/锚点）。 */
  anchor?: string;
  /** 复现步骤。 */
  repro?: string;
  /** 责任节点（对应项目 workflow 节点 id/名）。 */
  owner_node?: string;
}

export type ReviewVerdict = 'pass' | 'revision_needed' | 'blocked';

/**
 * 结构化审查报告块（PRD F3.1 / §7.3 v2 提案 `review.report`，消费侧先行）。
 * 上游未发布前恒缺省 → 消息按普通 Markdown 渲染（Outcome 语义已由
 * run-ending 卡覆盖），前向兼容不丢内容。
 */
export interface RuntimeReviewReportBlock {
  type: 'review.report';
  payload: {
    /** 审查轮次（F3.2 修复往返标注「第 N 轮」）。 */
    round: number;
    verdict: ReviewVerdict;
    title?: string;
    summary?: string;
    issues: RuntimeReviewIssue[];
    /** 报告所属项目（跳转任务中心用）。 */
    project_id?: string;
  };
}

export type RuntimeBlock =
  | RuntimeTextBlock
  | RuntimeThinkingBlock
  | RuntimeToolCallBlock
  | RuntimeConfirmationBlock
  | RuntimeReviewReportBlock
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

/** Loose normalizer for one v2 option entry: requires id + label. */
function normalizeConfirmationOption(raw: unknown): RuntimeConfirmationOption | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const source = raw as Record<string, unknown>;
  if (typeof source.id !== 'string' || source.id.length === 0) return undefined;
  if (typeof source.label !== 'string' || source.label.length === 0) return undefined;
  const option: RuntimeConfirmationOption = { id: source.id, label: source.label };
  if (typeof source.description === 'string' && source.description.length > 0) {
    option.description = source.description;
  }
  if (source.recommended === true) option.recommended = true;
  return option;
}

function normalizeConfirmationOptions(raw: unknown): RuntimeConfirmationOption[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const options = raw
    .map(normalizeConfirmationOption)
    .filter((o): o is RuntimeConfirmationOption => o !== undefined);
  return options.length > 0 ? options : undefined;
}

function normalizeConfirmationQuestions(raw: unknown): RuntimeConfirmationQuestion[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const questions: RuntimeConfirmationQuestion[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const source = entry as Record<string, unknown>;
    if (typeof source.question !== 'string' || source.question.length === 0) continue;
    const question: RuntimeConfirmationQuestion = { question: source.question };
    if (typeof source.id === 'string' && source.id.length > 0) question.id = source.id;
    const options = normalizeConfirmationOptions(source.options);
    if (options) question.options = options;
    if (source.multi_select === true) question.multi_select = true;
    questions.push(question);
  }
  return questions.length > 0 ? questions : undefined;
}

/**
 * True when a confirmation block carries the v2 structured question shape
 * (干预卡 F2.1). Without any question field the block renders as the legacy
 * two-button tool approval card. Accepts both runtime blocks and the wider
 * parsed-block union (ParsedA2uiBlock) so renderers can branch directly.
 */
export function isInterventionConfirmation(
  block: { type: unknown; payload?: unknown }
): boolean {
  if (block.type !== 'confirmation') return false;
  const payload = block.payload as RuntimeConfirmationBlock['payload'] | undefined;
  return Boolean(payload?.question || payload?.options || payload?.questions);
}

/**
 * Normalise a v1 confirmation block. Requires confirmation_id; without it the
 * caller should fall back to the legacy text heuristic so the operator still
 * sees an approval card. v2 intervention fields (question/options/questions…)
 * are carried through when well-formed — they are additive and the card
 * renderer decides which shape to draw.
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
  // ── v2 intervention fields (additive, forward compatible) ──
  if (typeof source.question === 'string' && source.question.length > 0) {
    payload.question = source.question;
  }
  const options = normalizeConfirmationOptions(source.options);
  if (options) payload.options = options;
  if (source.multi_select === true) payload.multi_select = true;
  const questions = normalizeConfirmationQuestions(source.questions);
  if (questions) payload.questions = questions;
  if (
    source.answer_schema &&
    typeof source.answer_schema === 'object' &&
    !Array.isArray(source.answer_schema)
  ) {
    payload.answer_schema = source.answer_schema as Record<string, unknown>;
  }
  if (typeof source.requested_of === 'string' && source.requested_of.length > 0) {
    payload.requested_of = source.requested_of;
  }
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

const REVIEW_VERDICTS: ReadonlySet<string> = new Set(['pass', 'revision_needed', 'blocked']);
const REVIEW_SEVERITIES: ReadonlySet<string> = new Set(['blocker', 'suggestion']);

function normalizeReviewIssues(raw: unknown): RuntimeReviewIssue[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const issues: RuntimeReviewIssue[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const source = entry as Record<string, unknown>;
    if (typeof source.id !== 'string' || source.id.length === 0) continue;
    if (typeof source.severity !== 'string' || !REVIEW_SEVERITIES.has(source.severity)) continue;
    const issue: RuntimeReviewIssue = {
      id: source.id,
      severity: source.severity as ReviewIssueSeverity,
    };
    if (typeof source.anchor === 'string' && source.anchor.length > 0) issue.anchor = source.anchor;
    if (typeof source.repro === 'string' && source.repro.length > 0) issue.repro = source.repro;
    if (typeof source.owner_node === 'string' && source.owner_node.length > 0) {
      issue.owner_node = source.owner_node;
    }
    issues.push(issue);
  }
  return issues.length > 0 ? issues : undefined;
}

/**
 * Normalise a v2 `review.report` block (审查报告卡 F3.1). Requires a numeric
 * round, a known verdict and at least one well-formed issue; anything else is
 * rejected so the caller falls through to plain Markdown rendering.
 */
export function normalizeReviewReportPayload(raw: unknown): RuntimeReviewReportBlock | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const source = raw as Record<string, unknown>;
  if (typeof source.round !== 'number' || !Number.isFinite(source.round) || source.round < 1) return undefined;
  if (typeof source.verdict !== 'string' || !REVIEW_VERDICTS.has(source.verdict)) return undefined;
  const issues = normalizeReviewIssues(source.issues);
  if (!issues) return undefined;
  const payload: RuntimeReviewReportBlock['payload'] = {
    round: source.round,
    verdict: source.verdict as ReviewVerdict,
    issues,
  };
  if (typeof source.title === 'string' && source.title.length > 0) payload.title = source.title;
  if (typeof source.summary === 'string' && source.summary.length > 0) payload.summary = source.summary;
  if (typeof source.project_id === 'string' && source.project_id.length > 0) {
    payload.project_id = source.project_id;
  }
  return { type: 'review.report', payload };
}
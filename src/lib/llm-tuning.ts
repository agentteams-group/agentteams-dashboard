// LLM 调优参数（#146 缺口 3）。
//
// 数据面：AgentTeams Controller 的 WorkerSpec / TeamSpec llm* 字段
// （agentteams-controller/api/v1beta1/types.go）。Dashboard 经
// PUT /api/v1/workers/{name} 与 POST|PUT /api/v1/teams 读写。
//
// 归属层级（回答 issue 验收标准 3）：Worker 覆盖 → 团队默认 → QwenPaw
// registry 兜底。Worker 侧值优先；未设置时继承团队默认；再未设置时用
// registry 默认。界面只在 Worker 与团队两处提供入口，避免多处重复配置。
//
// 两组语义：
//   · startup：QwenPaw 启动期读取，改后需重建容器才生效（spec-hash 驱动）。
//   · stream ：热更新，运行时每次流式请求重读，无需重启（QwenPaw >= 2.2.1）。
//
// 值语义（对齐上游指针语义）：空串 = 不设置（回退团队默认 / registry 默认）；
// 非空 = 覆盖。数值须为非负整数或小数。

export type LlmTuningGroup = 'startup' | 'stream';

export type LlmTuningKey =
  | 'llmMaxRetries'
  | 'llmBackoffBase'
  | 'llmBackoffCap'
  | 'llmMaxConcurrent'
  | 'llmMaxQpm'
  | 'llmRateLimitPause'
  | 'llmRateLimitJitter'
  | 'llmAcquireTimeout'
  | 'llmStreamFirstContentTimeout'
  | 'llmStreamIdleTimeout';

export interface LlmTuningField {
  key: LlmTuningKey;
  label: string;
  group: LlmTuningGroup;
  unit?: string;
  /** QwenPaw registry 默认值（来自上游字段注释；stream 组上游未给出固定默认）。 */
  registryDefault?: string;
}

export const LLM_TUNING_GROUP_LABELS: Record<LlmTuningGroup, string> = {
  startup: '重试与限流（启动期生效，保存后需重建容器）',
  stream: '流式超时（热更新，保存后立即生效）',
};

export const LLM_TUNING_FIELDS: readonly LlmTuningField[] = [
  { key: 'llmMaxRetries', label: '最大重试次数', group: 'startup', registryDefault: '3' },
  { key: 'llmBackoffBase', label: '退避基数', group: 'startup', unit: '秒', registryDefault: '1' },
  { key: 'llmBackoffCap', label: '退避上限', group: 'startup', unit: '秒', registryDefault: '10' },
  { key: 'llmMaxConcurrent', label: '最大并发请求数', group: 'startup', registryDefault: '10' },
  { key: 'llmMaxQpm', label: '每分钟最大请求数', group: 'startup', registryDefault: '600' },
  { key: 'llmRateLimitPause', label: '限流暂停', group: 'startup', unit: '秒', registryDefault: '5' },
  { key: 'llmRateLimitJitter', label: '限流抖动', group: 'startup', unit: '秒', registryDefault: '1' },
  { key: 'llmAcquireTimeout', label: '获取许可超时', group: 'startup', unit: '秒', registryDefault: '300' },
  { key: 'llmStreamFirstContentTimeout', label: '首段输出超时', group: 'stream', unit: '秒' },
  { key: 'llmStreamIdleTimeout', label: '输出中断超时', group: 'stream', unit: '秒' },
] as const;

export type LlmTuningValues = Partial<Record<LlmTuningKey, string>>;
export type LlmTuningRecord = Record<LlmTuningKey, string>;

const NON_NEGATIVE_NUMBER = /^\d+(\.\d+)?$/;

/** 空串合法（= 回退默认）；否则须为非负整数或小数。返回错误文案或 null。 */
export function validateLlmTuningValue(value: string): string | null {
  const v = value.trim();
  if (v === '') return null;
  if (!NON_NEGATIVE_NUMBER.test(v)) return '须为非负数字（整数或小数）';
  return null;
}

/** 从 Worker/Team 记录提取全部字段（缺省 / 非字符串 → 空串）。 */
export function pickLlmTuning(record: LlmTuningValues | null | undefined): LlmTuningRecord {
  const out = {} as LlmTuningRecord;
  for (const field of LLM_TUNING_FIELDS) {
    const value = record?.[field.key];
    out[field.key] = typeof value === 'string' ? value : '';
  }
  return out;
}

/** 只保留非空字段——用于「整对象覆盖」写路径（团队编辑），空串会被当作“清除”。 */
export function pickLlmTuningSet(record: LlmTuningValues | null | undefined): LlmTuningValues {
  const out: LlmTuningValues = {};
  for (const field of LLM_TUNING_FIELDS) {
    const value = record?.[field.key];
    if (typeof value === 'string' && value !== '') out[field.key] = value;
  }
  return out;
}

/** 字段级 diff：仅收集发生变化的键；清空（→ ''）同样计入。 */
export function diffLlmTuning(current: LlmTuningRecord, draft: LlmTuningRecord): LlmTuningValues {
  const diff: LlmTuningValues = {};
  for (const field of LLM_TUNING_FIELDS) {
    if (draft[field.key] !== current[field.key]) diff[field.key] = draft[field.key];
  }
  return diff;
}

/** 校验整组，返回第一个非法字段（按字段顺序）。 */
export function findLlmTuningError(
  draft: LlmTuningRecord,
): { key: LlmTuningKey; label: string; message: string } | null {
  for (const field of LLM_TUNING_FIELDS) {
    const message = validateLlmTuningValue(draft[field.key]);
    if (message) return { key: field.key, label: field.label, message };
  }
  return null;
}

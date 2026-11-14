// Official model specifications checked 2026-11-14. These are reference
// capabilities, not account entitlements or runtime context configuration.
export interface ModelCapabilities {
  contextWindow: number;
  maxOutputTokens?: number;
  outputLabel?: string;
  reasoningEfforts?: readonly string[];
}

export const MODEL_CAPABILITIES: Readonly<Record<string, ModelCapabilities>> = {
  // https://help.aliyun.com/zh/model-studio/qwen4-max-preview
  'qwen4-max-preview': { contextWindow: 1_000_000, maxOutputTokens: 393_216, reasoningEfforts: ['low', 'medium', 'xhigh'] },
  // https://help.aliyun.com/zh/model-studio/text-generation-model
  'qwen3.8-max': { contextWindow: 1_000_000, outputLabel: '128K' },
  'qwen3.8-flash': { contextWindow: 1_000_000, outputLabel: '128K' },
  'qwen3.7-plus': { contextWindow: 1_000_000, outputLabel: '128K' },
  // https://platform.minimax.cn/docs/guides/text-generation
  // https://help.aliyun.com/zh/model-studio/deep-thinking
  'MiniMax-M3.1-Flash': { contextWindow: 1_000_000, reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  'MiniMax-M3': { contextWindow: 1_000_000 },
  // https://platform.kimi.com/docs/guide/use-reasoning-effort
  'kimi-k3.1-pro': { contextWindow: 1_000_000, reasoningEfforts: ['low', 'high', 'max'] },
  'kimi-k3.1-pro-highspeed': { contextWindow: 1_000_000, reasoningEfforts: ['low', 'high', 'max'] },
  'kimi-k3': { contextWindow: 1_000_000, reasoningEfforts: ['low', 'high', 'max'] },
  // https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3
  'glm-5.3': { contextWindow: 1_000_000, outputLabel: '128K', reasoningEfforts: ['low', 'high', 'max'] },
  // https://developers.openai.com/api/docs/models/gpt-6.1-sol
  'gpt-6.1-sol': { contextWindow: 1_050_000, maxOutputTokens: 128_000, reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
};

export const REASONING_EFFORT_LABELS: Readonly<Record<string, string>> = {
  low: '低（low）', medium: '中（medium）', high: '高（high）',
  xhigh: '很高（xhigh）', max: '最高（max）',
};

export interface ModelRequestParameters {
  maxTokens: string;
  outputTokenParameter: 'max_tokens' | 'max_completion_tokens';
  reasoningEffort: string;
}

const MANAGED_PARAMETERS = new Set(['max_tokens', 'max_completion_tokens', 'reasoning_effort']);
const isSetting = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function readModelRequestParameters(settings: unknown, modelIds: string[]): ModelRequestParameters {
  const entries = Array.isArray(settings) ? settings.filter(isSetting) : [];
  const output = entries.findLast((setting) => setting.name === 'max_tokens' || setting.name === 'max_completion_tokens');
  const effort = entries.findLast((setting) => setting.name === 'reasoning_effort');
  return {
    maxTokens: output ? String(output.value) : '',
    outputTokenParameter: output?.name === 'max_completion_tokens' || (!output && modelIds.some((id) => /^gpt-(?:5|6)|^o[134](?:-|$)/.test(id))) ? 'max_completion_tokens' : 'max_tokens',
    reasoningEffort: effort ? String(effort.value) : '',
  };
}

export function commonReasoningEfforts(modelIds: string[]): string[] {
  if (!modelIds.length) return [];
  const first = MODEL_CAPABILITIES[modelIds[0]]?.reasoningEfforts ?? [];
  return first.filter((effort) => modelIds.every((id) => MODEL_CAPABILITIES[id]?.reasoningEfforts?.includes(effort)));
}

export function validateModelRequestParameters(parameters: ModelRequestParameters, modelIds: string[], protocol: string): string[] {
  const errors: string[] = [];
  if (protocol !== 'openai/v1' && (parameters.maxTokens.trim() || parameters.reasoningEffort)) errors.push('调用参数目前仅支持 OpenAI 兼容协议');
  if (parameters.maxTokens.trim()) {
    const value = Number(parameters.maxTokens.trim());
    if (!/^\d+$/.test(parameters.maxTokens.trim()) || !Number.isSafeInteger(value) || value <= 0) errors.push('输出 Token 上限必须是正整数');
    const limits = modelIds.map((id) => MODEL_CAPABILITIES[id]?.maxOutputTokens).filter((limit): limit is number => limit !== undefined);
    if (limits.length && value > Math.min(...limits)) errors.push(`输出 Token 上限不能超过所选模型的已知上限 ${Math.min(...limits).toLocaleString('en-US')}`);
  }
  if (parameters.reasoningEffort && !commonReasoningEfforts(modelIds).includes(parameters.reasoningEffort)) errors.push('所选模型不共同支持此思考强度，请调整档位或拆分模型连接');
  return errors;
}

export function serializeModelRequestParameters(settings: unknown, parameters: ModelRequestParameters): unknown[] {
  const preserved = Array.isArray(settings) ? settings.filter((setting) => !isSetting(setting) || !MANAGED_PARAMETERS.has(String(setting.name))) : [];
  return [
    ...preserved,
    ...(parameters.maxTokens.trim() ? [{ name: parameters.outputTokenParameter, value: Number(parameters.maxTokens.trim()), mode: 'raw', overwrite: true }] : []),
    ...(parameters.reasoningEffort ? [{ name: 'reasoning_effort', value: parameters.reasoningEffort, mode: 'raw', overwrite: true }] : []),
  ];
}

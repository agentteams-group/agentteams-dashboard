import { PROVIDER_BASE_URLS } from './higress-api';
import { MODEL_CAPABILITIES } from './model-parameters';

export interface ModelProbeInput {
  model: string;
  type?: string;
  protocol?: string;
  token?: string;
  baseUrl?: string;
  providerName?: string;
}

export interface ModelProbeResult {
  success: boolean;
  message: string;
  model?: string;
  latencyMs?: number;
}

export const MODEL_PROBE_BASES: Readonly<Record<string, string>> = {
  ...PROVIDER_BASE_URLS,
  claude: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  baichuan: 'https://api.baichuan-ai.com/v1',
  yi: 'https://api.lingyiwanwu.com/v1',
  baidu: 'https://qianfan.baidubce.com/v2',
  hunyuan: 'https://api.hunyuan.cloud.tencent.com/v1',
  stepfun: 'https://api.stepfun.com/v1',
  spark: 'https://spark-api-open.xf-yun.com/v1',
  mistral: 'https://api.mistral.ai/v1',
  cohere: 'https://api.cohere.com/v1',
  doubao: 'https://ark.cn-beijing.volces.com/api/v3',
  'together-ai': 'https://api.together.xyz/v1',
  github: 'https://models.inference.ai.azure.com',
};

export function buildModelProbe(input: ModelProbeInput & { token: string }) {
  const { model, token, type = 'openai', protocol = 'openai/v1' } = input;
  const nativeClaude = type === 'claude' && (!input.baseUrl || protocol === 'original');
  const nativeGemini = type === 'gemini' && protocol === 'original';
  const baseUrl = (input.baseUrl || (nativeGemini ? 'https://generativelanguage.googleapis.com/v1beta' : MODEL_PROBE_BASES[type]))?.trim().replace(/\/+$/, '');
  if (!baseUrl) throw new Error('请填写该平台的 API 地址');
  if (protocol === 'original' && !nativeClaude && !nativeGemini && type !== 'openai') throw new Error('该平台的原生协议暂不支持连接测试，请使用 OpenAI 兼容接口');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let url = baseUrl + '/chat/completions';
  let body: Record<string, unknown> = { model, messages: [{ role: 'user', content: 'Reply with only one word: OK' }], stream: false };
  if (nativeClaude) {
    url = baseUrl + '/messages';
    headers['x-api-key'] = token;
    headers['anthropic-version'] = '2023-06-01';
    body.max_tokens = 256;
  } else if (nativeGemini) {
    url = baseUrl + '/models/' + encodeURIComponent(model.replace(/^models\//, '')) + ':generateContent';
    headers['x-goog-api-key'] = token;
    body = { contents: [{ parts: [{ text: 'Reply with only one word: OK' }] }], generationConfig: { maxOutputTokens: 256 } };
  } else {
    headers[type === 'azure' ? 'api-key' : 'Authorization'] = type === 'azure' ? token : 'Bearer ' + token;
    body[/^(?:gpt-[56]|o[134](?:-|$)|MiniMax-)/.test(model) ? 'max_completion_tokens' : 'max_tokens'] = 256;
    if (model === 'MiniMax-M3') body.thinking = { type: 'disabled' };
    else if (MODEL_CAPABILITIES[model]?.reasoningEfforts?.includes('low')) body.reasoning_effort = 'low';
  }
  return { url, baseUrl, headers, body };
}

export function redactProbeError(message: string, secrets: string[]): string {
  let result = message;
  for (const secret of secrets) if (secret) result = result.split(secret).join('[已隐藏]');
  return result.replace(/Bearer\s+[A-Za-z0-9._~+\/=:-]+/gi, 'Bearer [已隐藏]').replace(/\bsk-[A-Za-z0-9_-]+/g, '[已隐藏]').slice(0, 300);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function evaluateModelProbe(status: number, value: unknown, secrets: string[]): Pick<ModelProbeResult, 'success' | 'message'> {
  const data = record(value);
  const error = data.error || (data.success === false ? data.message || '业务请求失败' : undefined);
  const code = data.code ?? record(data.base_resp).status_code;
  const businessFailure = code !== undefined && ![0, '0', 200, '200', 'OK', 'ok', 'Success', 'success'].includes(code as string | number);
  if (status < 200 || status >= 300 || error || businessFailure) {
    const errorObject = record(error);
    const detail = errorObject.message ?? error ?? data.message ?? record(data.base_resp).status_msg ?? code;
    const label = status === 401 ? 'API Key 认证失败' : status === 403 ? '模型访问被拒绝，请检查权限或额度' : status === 404 ? '接口或模型不存在，请检查 API 地址和模型 ID' : status === 429 ? '请求被限流或额度不足' : status >= 500 ? '模型服务异常' : '模型调用失败';
    return { success: false, message: label + `（HTTP ${status}）` + (typeof detail === 'string' || typeof detail === 'number' ? '：' + redactProbeError(String(detail), secrets) : '') };
  }
  const choices = Array.isArray(data.choices) ? data.choices : [];
  const message = record(record(choices[0]).message);
  const content = message.content ?? data.content;
  const hasText = typeof content === 'string' ? Boolean(content.trim()) : Array.isArray(content) && content.some((part) => typeof record(part).text === 'string' && String(record(part).text).trim());
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  const parts = record(record(candidates[0]).content).parts;
  const hasGeminiText = Array.isArray(parts) && parts.some((part) => typeof record(part).text === 'string' && String(record(part).text).trim());
  const hasReasoning = typeof message.reasoning_content === 'string' && Boolean(message.reasoning_content.trim());
  if (hasText || hasGeminiText || hasReasoning) return { success: true, message: hasText || hasGeminiText ? '模型已返回生成内容，连接可用' : '模型已返回思考内容，连接可用；本次短测试未生成最终回答' };
  return { success: false, message: '接口已响应，但未返回有效生成内容；请检查模型 ID、协议或思考预算' };
}

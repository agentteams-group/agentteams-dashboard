import { NextRequest, NextResponse } from 'next/server';
import { validateModelProbeBaseUrl, ModelProbeUrlError } from '@/lib/model-probe-url';

const PROVIDER_BASES: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  azure: 'https://{resource}.openai.azure.com',
  claude: 'https://api.anthropic.com/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  deepseek: 'https://api.deepseek.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  groq: 'https://api.groq.com/openai/v1',
  grok: 'https://api.x.ai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  ollama: 'http://localhost:11434/v1',
  vllm: 'http://localhost:8000/v1',
  moonshot: 'https://api.moonshot.cn/v1',
  baichuan: 'https://api.baichuan-ai.com/v1',
  yi: 'https://api.lingyiwanwu.com/v1',
  zhipuai: 'https://open.bigmodel.cn/api/paas/v4',
  baidu: 'https://qianfan.baidubce.com/v2',
  hunyuan: 'https://api.hunyuan.cloud.tencent.com/v1',
  stepfun: 'https://api.stepfun.com/v1',
  minimax: 'https://api.minimax.chat/v1',
  spark: 'https://spark-api-open.xf-yun.com/v1',
  mistral: 'https://api.mistral.ai/v1',
  cohere: 'https://api.cohere.com/v1',
  doubao: 'https://ark.cn-beijing.volces.com/api/v3',
  'together-ai': 'https://api.together.xyz/v1',
  github: 'https://models.inference.ai.azure.com',
  bedrock: 'https://bedrock-runtime.{region}.amazonaws.com',
  vertex: 'https://{region}-aiplatform.googleapis.com/v1',
  cloudflare: 'https://api.cloudflare.com/client/v4/accounts/{account}/ai/run',
  coze: 'https://api.coze.cn/v1',
};

interface ProbeTarget {
  url: string;
  method: 'GET' | 'POST';
  body?: string;
}

function buildProbe(type: string, protocol: string, baseUrl?: string): ProbeTarget {
  if (protocol === 'openai/v1') {
    const base = (baseUrl || PROVIDER_BASES[type])?.replace(/\/$/, '');
    if (!base) throw new Error(`不支持的提供商类型: ${type}，请提供自定义 Base URL`);
    return { url: `${base}/models`, method: 'GET' };
  }

  if (type === 'claude') {
    return {
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      body: JSON.stringify({ model: 'claude-3-haiku-20240307', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
    };
  }

  if (type === 'gemini') {
    return {
      url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
      method: 'POST',
      body: JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }] }),
    };
  }

  const base = (baseUrl || PROVIDER_BASES[type])?.replace(/\/$/, '');
  if (!base) throw new Error(`不支持的提供商类型: ${type}，请提供自定义 Base URL`);
  return { url: `${base}/models`, method: 'GET' };
}

function authHeader(type: string, token: string): Record<string, string> {
  if (type === 'azure') return { 'api-key': token };
  return { Authorization: `Bearer ${token}` };
}

export async function POST(request: NextRequest) {
  let body: { type?: string; protocol?: string; token?: string; baseUrl?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: '请求体格式错误' }, { status: 400 });
  }

  const { type = 'openai', protocol = 'openai/v1', token, baseUrl } = body;

  if (!token?.trim()) {
    return NextResponse.json({ success: false, message: '请先输入 API Key' }, { status: 400 });
  }

  // User-supplied base URLs become server-side fetch targets — guard against
  // SSRF (loopback/private/cluster-internal probing) before building the request.
  if (baseUrl?.trim()) {
    try {
      validateModelProbeBaseUrl(baseUrl.trim());
    } catch (err) {
      if (err instanceof ModelProbeUrlError) {
        return NextResponse.json({ success: false, message: err.message }, { status: 400 });
      }
      throw err;
    }
  }

  let target: ProbeTarget;
  try {
    target = buildProbe(type, protocol, baseUrl);
  } catch (err: unknown) {
    return NextResponse.json({ success: false, message: err instanceof Error ? err.message : '无法确定 API 端点' }, { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  const startedAt = Date.now();
  try {
    const res = await fetch(target.url, {
      method: target.method,
      headers: {
        'Content-Type': 'application/json',
        ...authHeader(type, token),
      },
      body: target.body,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const latencyMs = Date.now() - startedAt;

    const resText = await res.text().catch(() => '');

    if (res.ok) {
      return NextResponse.json({ success: true, message: `连接成功 (HTTP ${res.status})`, latencyMs });
    }

    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ success: false, message: `认证失败 (HTTP ${res.status})，请检查 API Key 是否正确`, latencyMs });
    }

    return NextResponse.json({
      success: false,
      message: `请求失败 HTTP ${res.status}: ${resText.slice(0, 120)}`,
      latencyMs,
    });
  } catch (err: unknown) {
    clearTimeout(timer);
    const latencyMs = Date.now() - startedAt;
    const message = err instanceof Error && err.name === 'AbortError'
      ? '连接超时 (15s)，请检查网络或 API 端点地址'
      : `连接失败: ${err instanceof Error ? err.message : '未知错误'}`;
    return NextResponse.json({ success: false, message, latencyMs });
  }
}

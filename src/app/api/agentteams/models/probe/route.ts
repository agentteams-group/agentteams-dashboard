import { NextRequest, NextResponse } from 'next/server';

const PROVIDER_ENDPOINTS: Record<string, string> = {
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

function getChatEndpoint(type: string, protocol: string, baseUrl?: string): string {
  if (protocol === 'original') {
    if (type === 'claude') return 'https://api.anthropic.com/v1/messages';
    if (type === 'gemini') return 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';
    // For non-openai protocols, fall back to a generic chat endpoint
    const base = baseUrl || PROVIDER_ENDPOINTS[type];
    if (!base) throw new Error(`不支持的提供商类型: ${type}，请提供自定义 Base URL`);
    return `${base.replace(/\/$/, '')}/chat/completions`;
  }
  const base = baseUrl || PROVIDER_ENDPOINTS[type];
  if (!base) throw new Error(`不支持的提供商类型: ${type}，请提供自定义 Base URL`);
  return `${base.replace(/\/$/, '')}/chat/completions`;
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

  let endpoint: string;
  try {
    endpoint = getChatEndpoint(type, protocol, baseUrl);
  } catch (err: unknown) {
    return NextResponse.json({ success: false, message: err instanceof Error ? err.message : '无法确定 API 端点' }, { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  const startedAt = Date.now();
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (type === 'doubao') {
      headers['Authorization'] = `Bearer ${token}`;
    } else if (type === 'azure') {
      headers['api-key'] = token;
    } else {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'ping',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const latencyMs = Date.now() - startedAt;

    const resText = await res.text().catch(() => '');

    if (res.ok) {
      return NextResponse.json({ success: true, message: `连接成功 (HTTP ${res.status})`, latencyMs });
    }

    const isAuthError = res.status === 401 || res.status === 403;
    if (isAuthError) {
      return NextResponse.json({ success: false, message: `认证失败 (HTTP ${res.status})，请检查 API Key 是否正确`, latencyMs });
    }

    return NextResponse.json({
      success: false,
      message: `请求失败 HTTP ${res.status}: ${resText.slice(0, 100)}`,
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

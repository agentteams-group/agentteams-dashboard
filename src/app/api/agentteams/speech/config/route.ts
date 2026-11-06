import { NextRequest, NextResponse } from 'next/server';
import { readServerIdentity } from '@/lib/server-auth';
import { readSpeechConfig, writeSpeechConfig, type SpeechConfig } from '@/lib/speech-config';

export const runtime = 'nodejs';

function requireAdmin(request: NextRequest): NextResponse | null {
  const identity = readServerIdentity(request);
  if (!identity) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (identity.level < 3) return NextResponse.json({ error: '仅管理员可配置语音服务' }, { status: 403 });
  return null;
}

function response(config: SpeechConfig): NextResponse {
  return NextResponse.json({ baseUrl: config.baseUrl, model: config.model, apiKeyConfigured: Boolean(config.apiKey) }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function GET(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    return response(await readSpeechConfig());
  } catch {
    return NextResponse.json({ error: '无法读取语音配置，请检查服务端存储' }, { status: 503 });
  }
}

export async function PUT(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.baseUrl !== 'string' || typeof body.model !== 'string'
    || (body.apiKey !== undefined && (typeof body.apiKey !== 'string' || body.apiKey.length > 4096))
    || (body.clearApiKey !== undefined && typeof body.clearApiKey !== 'boolean')
    || !body.model.trim() || body.model.length > 128) {
    return NextResponse.json({ error: '请填写有效的服务地址、模型和 API Key' }, { status: 400 });
  }
  let url: URL;
  try {
    url = new URL(body.baseUrl.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('invalid endpoint');
  } catch {
    return NextResponse.json({ error: '服务地址须为 HTTPS，不能包含账号、密码或查询参数' }, { status: 400 });
  }
  try {
    const current = await readSpeechConfig();
    const apiKey = body.apiKey?.trim();
    if (current.apiKey && new URL(current.baseUrl).origin !== url.origin && !apiKey && !body.clearApiKey) {
      return NextResponse.json({ error: '修改服务主机时，请重新填写对应的 API Key' }, { status: 400 });
    }
    const config = {
      baseUrl: url.href.replace(/\/$/, ''),
      model: body.model.trim(),
      apiKey: body.clearApiKey ? '' : apiKey || current.apiKey,
    };
    await writeSpeechConfig(config);
    return response(config);
  } catch {
    return NextResponse.json({ error: '语音配置保存失败，请检查服务端存储权限' }, { status: 503 });
  }
}

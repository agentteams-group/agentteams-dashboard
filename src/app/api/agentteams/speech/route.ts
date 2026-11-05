import { NextRequest, NextResponse } from 'next/server';
import { readServerIdentity } from '@/lib/server-auth';
import { MAX_SPEECH_BYTES, validateSpeechWav } from '@/lib/speech-audio';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  if (!readServerIdentity(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({
    dashscopeAvailable: Boolean(process.env.DASHBOARD_SPEECH_DASHSCOPE_API_KEY?.trim()),
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  // Middleware authenticates this route and overwrites the identity headers.
  const identity = readServerIdentity(request);
  if (!identity) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (identity.level < 2) return NextResponse.json({ error: '当前账号无权使用付费语音识别' }, { status: 403 });
  const apiKey = process.env.DASHBOARD_SPEECH_DASHSCOPE_API_KEY?.trim();
  if (!apiKey) return NextResponse.json({ error: '管理员尚未配置百炼语音识别，请使用本地免费识别' }, { status: 503 });
  const language = request.nextUrl.searchParams.get('language') || 'zh';
  if (!['zh', 'en', 'auto'].includes(language)) return NextResponse.json({ error: '不支持的识别语言' }, { status: 400 });
  if (request.headers.get('content-type')?.split(';')[0] !== 'audio/wav') {
    return NextResponse.json({ error: '请提交 WAV 录音' }, { status: 415 });
  }
  if (Number(request.headers.get('content-length')) > MAX_SPEECH_BYTES) {
    return NextResponse.json({ error: '录音超过 60 秒限制' }, { status: 413 });
  }
  // Bound chunked requests too; do not buffer an unbounded body before checking.
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({ error: '缺少录音' }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SPEECH_BYTES) {
        await reader.cancel();
        return NextResponse.json({ error: '录音超过 60 秒限制' }, { status: 413 });
      }
      chunks.push(value);
    }
    const audio = Buffer.concat(chunks);
    try {
      validateSpeechWav(audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer);
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: 400 });
    }
    const baseUrl = (process.env.DASHBOARD_SPEECH_DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(60000)]),
      body: JSON.stringify({
        model: process.env.DASHBOARD_SPEECH_DASHSCOPE_MODEL || 'qwen3-asr-flash',
        messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:audio/wav;base64,${audio.toString('base64')}` } }] }],
        stream: false,
        ...(language === 'auto' ? {} : { asr_options: { language } }),
      }),
    });
    if (!response.ok) {
      return NextResponse.json({ error: response.status === 429 ? '语音服务限流，请稍后重试' : '百炼语音识别失败，请管理员检查服务配置' }, { status: response.status === 429 ? 429 : 502 });
    }
    const result = await response.json();
    const text = result.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) return NextResponse.json({ error: '未识别到语音，请重试' }, { status: 422 });
    return NextResponse.json({ text: text.trim() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    return NextResponse.json({ error: timeout ? '语音识别超时，请重试' : '语音识别服务连接失败，请重试' }, { status: timeout ? 504 : 502 });
  } finally {
    reader.releaseLock();
  }
}

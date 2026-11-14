import { NextRequest, NextResponse } from 'next/server';
import { validateModelProbeBaseUrl } from '@/lib/model-probe-url';
import { buildModelProbe, evaluateModelProbe, redactProbeError, type ModelProbeInput } from '@/lib/model-connection-probe';
import { requireHigressConsoleAccess } from '../../../higress/access';
import { callHigressConsole } from '../../../higress/proxy-helper';
import { getSessionCookie, isRecord, unwrapData } from '../../../higress/helpers';

export async function POST(request: NextRequest) {
  const denied = await requireHigressConsoleAccess(request);
  if (denied) return denied;
  const value: unknown = await request.json().catch(() => null);
  if (!isRecord(value) || typeof value.model !== 'string' || !value.model.trim() ||
      ['type', 'protocol', 'token', 'baseUrl', 'providerName'].some((key) => value[key] !== undefined && typeof value[key] !== 'string')) {
    return NextResponse.json({ success: false, message: '请填写有效的模型 ID 和连接配置' }, { status: 400 });
  }
  const input = value as unknown as ModelProbeInput;
  const model = input.model.trim();
  const secrets: string[] = [];
  let target;
  try {
    let config = { ...input, model };
    if (input.providerName) {
      if (/[\/\\?#]/.test(input.providerName) || ['.', '..'].includes(input.providerName)) {
        return NextResponse.json({ success: false, message: '连接名称无效' }, { status: 400 });
      }
      // Read secrets only server-side, under the authenticated Console session.
      // Browser endpoint/type overrides MUST NOT accompany a stored credential.
      const saved = await callHigressConsole('/v1/ai/providers/' + encodeURIComponent(input.providerName), { cookie: getSessionCookie(request) });
      if (!saved.response.ok) return NextResponse.json({
        success: false, message: '无法使用已保存的密钥，请使用 Console 管理员会话登录，或在编辑连接时输入 API Key 后测试',
      }, { status: saved.response.status === 401 || saved.response.status === 403 ? 403 : 502 });
      const provider = unwrapData(saved.body);
      if (!isRecord(provider)) return NextResponse.json({ success: false, message: '未找到已保存的模型连接' }, { status: 404 });
      const raw = isRecord(provider.rawConfigs) ? provider.rawConfigs : {};
      const tokens = Array.isArray(provider.tokens) ? provider.tokens : Array.isArray(raw.apiTokens) ? raw.apiTokens : [];
      secrets.push(...tokens.filter((token): token is string => typeof token === 'string' && Boolean(token.trim())).map((token) => token.trim()));
      let baseUrl = typeof raw.openaiCustomUrl === 'string' ? raw.openaiCustomUrl : undefined;
      if (baseUrl && typeof raw.openaiCustomServicePort === 'number') {
        const url = new URL(baseUrl);
        if (!url.port) url.port = String(raw.openaiCustomServicePort);
        baseUrl = url.toString();
      }
      config = { model, type: typeof provider.type === 'string' ? provider.type : 'openai',
        protocol: provider.protocol === 'original' ? 'original' : 'openai/v1',
        baseUrl, token: secrets[0] };
    } else if (config.token?.trim()) secrets.push(config.token.trim());
    if (!config.token?.trim()) return NextResponse.json({ success: false, message: '请先输入 API Key，或选择已保存的模型连接' }, { status: 400 });
    target = buildModelProbe({ ...config, token: config.token.trim() });
    const url = validateModelProbeBaseUrl(target.baseUrl);
    if (url.username || url.password || url.search || url.hash) throw new Error('API 地址不能包含用户名、密码、查询参数或片段');
  } catch (err) {
    return NextResponse.json({ success: false, message: redactProbeError(err instanceof Error ? err.message : '无法读取连接配置', secrets) }, { status: 400 });
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(target.url, {
      method: 'POST', headers: target.headers, body: JSON.stringify(target.body),
      signal: controller.signal, redirect: 'error', cache: 'no-store',
    });
    const text = await response.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch {
      return NextResponse.json({ success: false, model, latencyMs: Date.now() - startedAt,
        message: response.status < 200 || response.status >= 300 ? evaluateModelProbe(response.status, null, secrets).message : '接口返回了非 JSON 内容（HTTP ' + response.status + '），请检查 API 地址和协议' });
    }
    return NextResponse.json({ ...evaluateModelProbe(response.status, data, secrets), model, latencyMs: Date.now() - startedAt });
  } catch (err) {
    const message = controller.signal.aborted || (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError'))
      ? '模型调用超时（30 秒），请检查网络或稍后重试'
      : '模型连接失败：' + redactProbeError(err instanceof Error ? err.message : '网络异常', secrets);
    return NextResponse.json({ success: false, model, message, latencyMs: Date.now() - startedAt });
  } finally {
    clearTimeout(timer);
  }
}

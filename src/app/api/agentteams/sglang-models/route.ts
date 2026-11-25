// GET /api/agentteams/sglang-models — list the models actually served by a
// local SGLang inference server (OpenAI-compatible /v1/models), if one is
// configured (setup page config file, then AGENTTEAMS_SGLANG_URL). Feeds the
// "SGLang" source layer of the model selector, so locally hosted models
// (e.g. a self-served qwen3.6-27b-fp8) are selectable without guessing the id.
//
// Response: { enabled: boolean, models: string[], error?: string }
//   - unconfigured         -> 200 { enabled: false, models: [] }
//   - server unreachable   -> 503 { enabled: true, models: [], error }
//   - server non-2xx       -> 502 { enabled: true, models: [], error }
// The client treats every non-200 as "hide the layer", so a broken SGLang can
// never break model selection.
import { NextRequest, NextResponse } from 'next/server';
import { backendAuthHeader, pickBackendUrl } from '@/lib/backend-config';

const TIMEOUT_MS = 5000;

interface SglangModelsResponse {
  enabled: boolean;
  models: string[];
  error?: string;
}

// 地址解析与其它后端同一条链：配置（内网/外网 + 失效切换工作缓存）> env。
// 旧实现只读 env，setup 页保存的 SGLang 地址在模型列表上不生效。
// 每次请求现读（不在模块加载时定值），测试可随时改 env / 配置文件。
function readSglangUrl(): string {
  return (pickBackendUrl('sglang') || '').trim();
}

function normalizeModelsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? `${trimmed}/models` : `${trimmed}/v1/models`;
}

// /v1/models returns { data: Array<{ id, object, ... }> }; be lenient and
// also accept plain-string entries so a future shape drift does not kill the
// whole layer.
function extractModelIds(payload: unknown): string[] {
  if (typeof payload !== 'object' || payload === null) return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const ids: string[] = [];
  for (const entry of data) {
    if (typeof entry === 'string') {
      ids.push(entry);
    } else if (
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as { id?: unknown }).id === 'string'
    ) {
      ids.push((entry as { id: string }).id);
    }
  }
  return [...new Set(ids.filter((id) => id.length > 0))];
}

export async function GET(_request: NextRequest) {
  const baseUrl = readSglangUrl();
  if (!baseUrl) {
    const body: SglangModelsResponse = { enabled: false, models: [] };
    return NextResponse.json(body);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(normalizeModelsUrl(baseUrl), {
      signal: controller.signal,
      // 逐地址覆盖凭据（SGLang 前的 Basic / Bearer 门）：命中保存的该地址才
      // 注入；地址不匹配 → 空头，绝不把凭据发到别处。
      headers: backendAuthHeader('sglang', baseUrl),
    });
    if (!res.ok) {
      const body: SglangModelsResponse = {
        enabled: true,
        models: [],
        error: `SGLang responded with HTTP ${res.status}`,
      };
      return NextResponse.json(body, { status: 502 });
    }
    const payload: unknown = await res.json().catch(() => null);
    const body: SglangModelsResponse = { enabled: true, models: extractModelIds(payload) };
    return NextResponse.json(body);
  } catch (err) {
    const body: SglangModelsResponse = {
      enabled: true,
      models: [],
      error: err instanceof Error ? err.message : 'Unknown error',
    };
    return NextResponse.json(body, { status: 503 });
  } finally {
    clearTimeout(timeout);
  }
}

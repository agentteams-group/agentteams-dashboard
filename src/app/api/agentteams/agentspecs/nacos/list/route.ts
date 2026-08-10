import { NextResponse } from 'next/server';
import { getNacosConfig } from '@/lib/skill-center-config';
import { getNacosAccessToken } from '@/lib/nacos-fetcher';

export const dynamic = 'force-dynamic';

export interface AgentSpecSummary {
  name: string;
  description: string;
  version: string;
  from: string;
  scope: string;
}

export async function GET() {
  const config = await getNacosConfig();
  if (!config) {
    return NextResponse.json({ error: 'Nacos 未配置' }, { status: 400 });
  }

  const protocol = config.protocol || 'https';
  const urlMatch = config.registryUrl.match(/^nacos:\/\/([^/]+)\/(.+)$/);
  if (!urlMatch) {
    return NextResponse.json({ error: 'Nacos URL 格式无效' }, { status: 400 });
  }
  const [, hostPort, namespace] = urlMatch;
  const apiBase = `${protocol}://${hostPort}`;

  const accessToken = await getNacosAccessToken(config);
  const tokenParam = accessToken ? `&accessToken=${encodeURIComponent(accessToken)}` : '';
  const nsParam = `namespaceId=${encodeURIComponent(namespace)}`;

  try {
    const listUrl = `${apiBase}/v3/console/ai/agentspecs/list?${nsParam}${tokenParam}`;
    const res = await fetch(listUrl, {
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return NextResponse.json({
        items: [],
        note: `AgentSpecs API 返回 HTTP ${res.status}: ${text.substring(0, 200)}`,
      });
    }

    const data = await res.json() as {
      code?: number;
      data?: { pageItems?: Array<{ name: string; description?: string; labels?: { latest?: string }; from?: string; scope?: string }> };
    };

    const items: AgentSpecSummary[] = (data.data?.pageItems ?? []).map((item) => ({
      name: item.name,
      description: item.description ?? '',
      version: item.labels?.latest ?? '',
      from: item.from ?? '',
      scope: item.scope ?? 'PUBLIC',
    }));

    return NextResponse.json({ items });
  } catch (err) {
    return NextResponse.json({
      items: [],
      note: `AgentSpecs API 不可用: ${err instanceof Error ? err.message : 'unknown'}`,
    });
  }
}

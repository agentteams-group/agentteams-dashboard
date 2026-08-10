import { NextResponse } from 'next/server';
import { getNacosConfig } from '@/lib/skill-center-config';
import { getNacosAccessToken } from '@/lib/nacos-fetcher';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 500;
const MAX_PAGES = 20;

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

  const items: AgentSpecSummary[] = [];
  try {
    // Fetch all pages; each page request carries a large pageSize so most
    // registries resolve in one request.
    for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
      const listUrl =
        `${apiBase}/v3/console/ai/agentspecs/list?${nsParam}${tokenParam}` +
        `&pageNo=${pageNo}&pageSize=${PAGE_SIZE}`;
      const res = await fetch(listUrl, {
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return NextResponse.json({
          items,
          note: `AgentSpecs API 返回 HTTP ${res.status}: ${text.substring(0, 200)}`,
        });
      }

      const data = (await res.json()) as {
        code?: number;
        data?: {
          totalCount?: number;
          pagesAvailable?: number;
          pageItems?: Array<{ name: string; description?: string; labels?: { latest?: string }; from?: string; scope?: string }>;
        };
      };

      const pageItems = data.data?.pageItems ?? [];
      items.push(
        ...pageItems.map((item) => ({
          name: item.name,
          description: item.description ?? '',
          version: item.labels?.latest ?? '',
          from: item.from ?? '',
          scope: item.scope ?? 'PUBLIC',
        })),
      );

      const pagesAvailable = data.data?.pagesAvailable ?? 1;
      if (pageNo >= pagesAvailable || pageItems.length === 0) break;
    }

    return NextResponse.json({ items });
  } catch (err) {
    return NextResponse.json({
      items,
      note: `AgentSpecs API 不可用: ${err instanceof Error ? err.message : 'unknown'}`,
    });
  }
}

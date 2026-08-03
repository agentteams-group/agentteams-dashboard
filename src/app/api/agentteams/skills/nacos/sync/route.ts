import { NextRequest, NextResponse } from 'next/server';
import { getNacosConfig, setNacosConfig } from '@/lib/skill-center-config';
import type { NacosConfig } from '@/lib/skill-center-config';
import { SkillEntry } from '@/lib/skill-center-types';

/**
 * Fetch skills from Nacos registry
 */
async function fetchNacosSkills(config: NacosConfig): Promise<SkillEntry[]> {
  // Parse nacos://host:port/namespace
  const urlMatch = config.registryUrl.match(/^nacos:\/\/([^/]+)\/(.+)$/);
  if (!urlMatch) return [];

  const [, hostPort, namespace] = urlMatch;

  // Build the Nacos API URL to list services/skills
  // Nacos typically uses /nacos/v1/ns/catalog/services for listing
  const apiBase = hostPort.startsWith('localhost') || hostPort.includes('127.0.0.1')
    ? `http://${hostPort}`
    : `http://${hostPort}`;

  const listUrl = `${apiBase}/nacos/v1/ns/catalog/services?pageNo=1&pageSize=100&namespaceId=${encodeURIComponent(namespace)}`;

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (config.username && config.password) {
      headers['Authorization'] = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`;
    }

    const response = await fetch(listUrl, { headers, signal: AbortSignal.timeout(10000) });
    if (!response.ok) return [];

    const data = await response.json() as { data: { groupName?: string; serviceName?: string; description?: string }[] };
    if (!data.data) return [];

    return data.data
      .filter((item): item is { serviceName: string; description?: string; groupName?: string } => !!item.serviceName)
      .map((item) => ({
        name: item.serviceName,
        description: item.description || '',
        source: 'nacos' as const,
        sourceAlias: config.registryUrl,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        fileCount: 0,
      }));
  } catch {
    return [];
  }
}

export async function POST(_request: NextRequest) {
  const config = getNacosConfig();
  if (!config) {
    return NextResponse.json({ error: 'Nacos 未配置' }, { status: 400 });
  }

  try {
    const nacosSkills = await fetchNacosSkills(config);

    const updatedConfig: NacosConfig = {
      ...config,
      lastSyncAt: new Date().toISOString(),
      lastSyncStatus: nacosSkills.length > 0 ? 'success' : 'error',
      lastSyncError: nacosSkills.length === 0 && config.registryUrl ? '未能从 Nacos 获取技能列表' : undefined,
    };
    setNacosConfig(updatedConfig);

    return NextResponse.json({ success: true, synced: nacosSkills.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';

    const updatedConfig: NacosConfig = {
      ...config,
      lastSyncAt: new Date().toISOString(),
      lastSyncStatus: 'error' as const,
      lastSyncError: message,
    };
    setNacosConfig(updatedConfig);

    return NextResponse.json({ error: message }, { status: 502 });
  }
}

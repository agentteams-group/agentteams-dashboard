import { NextResponse } from 'next/server';
import { nacosSyncEngine } from '@/lib/nacos-sync-engine';
import { getNacosConfig } from '@/lib/skill-center-config';

export const dynamic = 'force-dynamic';

export async function GET() {
  const config = await getNacosConfig();

  const versionCache = nacosSyncEngine.getVersionCache();
  const cacheEntries: Record<string, string> = {};
  for (const [name, version] of versionCache) {
    cacheEntries[name] = version;
  }

  return NextResponse.json({
    nacosConfigured: !!config,
    lastSyncAt: config?.lastSyncAt ?? null,
    lastSyncStatus: config?.lastSyncStatus ?? null,
    versionCacheSize: versionCache.size,
    versionCache: cacheEntries,
  });
}

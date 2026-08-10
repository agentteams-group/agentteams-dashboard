import { createMinioClient } from '@/lib/minio-client';
import { getNacosConfig } from '@/lib/skill-center-config';
import { fetchNacosSkillZip, cacheSkillContent, getNacosAccessToken } from '@/lib/nacos-fetcher';
import { unzipSync } from 'fflate';

export interface SyncEvent {
  type: 'skill-updated' | 'skill-unchanged' | 'skill-failed' | 'full-sync-start' | 'full-sync-end' | 'error';
  skillName?: string;
  version?: string;
  timestamp: number;
  message: string;
  synced?: number;
  failed?: number;
  skipped?: number;
}

type EventListener = (event: SyncEvent) => void;

class NacosSyncEngine {
  private versionCache: Map<string, string> = new Map();
  private listeners: Set<EventListener> = new Set();

  onEvent(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(event: SyncEvent): void {
    for (const fn of this.listeners) {
      try { fn(event); } catch { /* ignore */ }
    }
  }

  getVersionCache(): ReadonlyMap<string, string> {
    return this.versionCache;
  }

  /** Sync a single skill: compare versions, download if changed, write to MinIO. */
  async syncSkill(skillName: string, nacosVersion: string): Promise<boolean> {
    const cached = this.versionCache.get(skillName);
    if (cached === nacosVersion) {
      this.emit({
        type: 'skill-unchanged', skillName, version: nacosVersion,
        timestamp: Date.now(), message: `技能 "${skillName}" 无更新`,
      });
      return false;
    }

    try {
      const config = await getNacosConfig();
      if (!config) throw new Error('Nacos 未配置');

      const result = await fetchNacosSkillZip(skillName, config);

      const entries = unzipSync(result.zipBytes);
      const files = Object.entries(entries).map(([relativePath, data]) => ({
        relativePath,
        data: data as Uint8Array,
      }));

      if (files.length > 0) {
        const client = createMinioClient();
        await cacheSkillContent(client, result.resolvedName || skillName, files);
      }

      this.versionCache.set(skillName, nacosVersion);

      this.emit({
        type: 'skill-updated', skillName, version: nacosVersion,
        timestamp: Date.now(), message: `技能 "${skillName}" 已更新到 ${nacosVersion}`,
      });
      return true;
    } catch (err) {
      this.emit({
        type: 'skill-failed', skillName, version: nacosVersion,
        timestamp: Date.now(),
        message: `技能 "${skillName}" 同步失败: ${err instanceof Error ? err.message : 'unknown'}`,
      });
      throw err;
    }
  }

  /** Full sync: fetch all nacos skill metadata, download changed ones. */
  async fullSync(): Promise<{ downloaded: number; skipped: number; failed: number }> {
    this.emit({
      type: 'full-sync-start', timestamp: Date.now(),
      message: '开始全量同步',
    });

    const config = await getNacosConfig();
    if (!config) {
      this.emit({ type: 'error', timestamp: Date.now(), message: 'Nacos 未配置' });
      throw new Error('Nacos 未配置');
    }

    // Use syncNacosSkills from storage to get metadata, or do a direct API call
    const protocol = config.protocol || 'https';
    const urlMatch = config.registryUrl.match(/^nacos:\/\/([^/]+)\/(.+)$/);
    if (!urlMatch) throw new Error('Nacos URL 格式无效');
    const [, hostPort, namespace] = urlMatch;
    const apiBase = `${protocol}://${hostPort}`;

    const accessToken = await getNacosAccessToken(config);
    const tokenParam = accessToken
      ? `&accessToken=${encodeURIComponent(accessToken)}`
      : '';
    const nsParam = `namespaceId=${encodeURIComponent(namespace)}`;

    const listUrl = `${apiBase}/v3/console/ai/skills/list?filterableForm=true&pageNo=1&pageSize=500&${nsParam}${tokenParam}`;
    const listRes = await fetch(listUrl, {
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!listRes.ok) throw new Error(`获取技能列表失败: HTTP ${listRes.status}`);

    const listData = await listRes.json() as {
      code?: number;
      data?: { pageItems?: Array<{ name: string; labels?: { latest?: string } }> };
    };

    const skills = listData.data?.pageItems ?? [];
    let downloaded = 0;
    let skipped = 0;
    let failed = 0;

    // Process in batches of 3 to limit concurrency
    for (let i = 0; i < skills.length; i += 3) {
      const batch = skills.slice(i, i + 3);
      const results = await Promise.allSettled(
        batch.map((s) => {
          const version = s.labels?.latest;
          if (!version) return Promise.resolve(false);
          return this.syncSkill(s.name, version);
        })
      );
      for (const r of results) {
        if (r.status === 'fulfilled') {
          r.value ? downloaded++ : skipped++;
        } else {
          failed++;
        }
      }
    }

    this.emit({
      type: 'full-sync-end', timestamp: Date.now(),
      message: `全量同步完成`,
      synced: downloaded, skipped, failed,
    });

    return { downloaded, skipped, failed };
  }
}

export const nacosSyncEngine = new NacosSyncEngine();

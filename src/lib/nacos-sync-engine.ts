import { createMinioClient } from '@/lib/minio-client';
import { getNacosConfig } from '@/lib/skill-center-config';
import {
  fetchNacosSkillZip,
  cacheSkillContent,
  getNacosAccessToken,
  nacosFetch,
  readNacosJson,
  sanitizeNacosText,
  unzipNacosArtifact,
} from '@/lib/nacos-fetcher';

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

type EventListener = (_event: SyncEvent) => void;

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

    let accessToken = '';
    try {
      const config = await getNacosConfig();
      if (!config) throw new Error('Nacos 未配置');

      accessToken = await getNacosAccessToken(config);
      const result = await fetchNacosSkillZip(skillName, config, accessToken);

      const entries = unzipNacosArtifact(result.zipBytes);
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
      const message = sanitizeNacosText(err instanceof Error ? err.message : 'unknown', [accessToken]);
      this.emit({
        type: 'skill-failed', skillName, version: nacosVersion,
        timestamp: Date.now(),
        message: `技能 "${skillName}" 同步失败: ${message}`,
      });
      throw new Error(message);
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
    const params = new URLSearchParams({
      filterableForm: 'true',
      pageNo: '1',
      pageSize: '500',
      namespaceId: namespace,
    });

    const listUrl = `${apiBase}/v3/console/ai/skills/list?${params}`;
    let listData: {
      code?: number;
      data?: { pageItems?: Array<{ name: string; labels?: { latest?: string } }> };
    };
    try {
      const listRes = await nacosFetch(listUrl, {
        accessToken,
        headers: { 'Content-Type': 'application/json' },
      });
      if (!listRes.ok) throw new Error(`获取技能列表失败: HTTP ${listRes.status}`);
      listData = await readNacosJson<typeof listData>(listRes, accessToken);
    } catch (err) {
      const message = sanitizeNacosText(err instanceof Error ? err.message : '获取技能列表失败', [accessToken]);
      this.emit({ type: 'error', timestamp: Date.now(), message });
      throw new Error(message);
    }

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
          if (r.value) {
            downloaded++;
          } else {
            skipped++;
          }
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

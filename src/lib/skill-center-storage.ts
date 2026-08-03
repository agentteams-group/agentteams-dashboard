import { createMinioClient, getMinioBucket } from './minio-client';
import {
  SkillEntry,
  NacosConfig,
  SKILLS_BUCKET,
  SKILLS_METADATA_PREFIX,
  SKILL_NAME_PATTERN,
} from './skill-center-types';
import { isValidNameSegment } from './skill-package';

export { SKILLS_BUCKET, SKILLS_METADATA_PREFIX, SKILL_NAME_PATTERN };

/**
 * Ensure the skills bucket exists, creating it if necessary
 */
export async function ensureSkillsBucket(client: any): Promise<void> {
  const exists = await client.bucketExists(SKILLS_BUCKET);
  if (!exists) {
    await client.makeBucket(SKILLS_BUCKET);
  }
}

/**
 * Parse metadata from MinIO object or return null if not found
 */
export async function getSkillMetadata(client: any, skillName: string): Promise<SkillEntry | null> {
  const key = `${SKILLS_METADATA_PREFIX}${skillName}.json`;
  try {
    const stream = await client.getObject(SKILLS_BUCKET, key);
    const data = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
    return JSON.parse(data.toString('utf-8')) as SkillEntry;
  } catch {
    return null;
  }
}

/**
 * Save a SkillEntry metadata to MinIO
 */
export async function saveSkillMetadata(client: any, entry: SkillEntry): Promise<void> {
  const key = `${SKILLS_METADATA_PREFIX}${entry.name}.json`;
  const data = Buffer.from(JSON.stringify(entry, null, 2));
  await client.putObject(
    SKILLS_BUCKET,
    key,
    data,
    data.length,
    { 'Content-Type': 'application/json' }
  );
}

/**
 * List all skills (custom + nacos) from MinIO
 */
export async function listSkills(client: any): Promise<SkillEntry[]> {
  const skills: SkillEntry[] = [];
  const stream = client.listObjects(SKILLS_BUCKET, SKILLS_METADATA_PREFIX, true);

  for await (const obj of stream) {
    if (!obj.objectName.endsWith('.json')) continue;
    const name = obj.objectName.replace(SKILLS_METADATA_PREFIX, '').replace('.json', '');
    if (!isValidNameSegment(name) || !SKILL_NAME_PATTERN.test(name)) continue;

    const metadata = await getSkillMetadata(client, name);
    if (metadata) {
      skills.push(metadata);
    }
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Fetch Nacos skills from external registry, persist non-conflicting ones to MinIO,
 * and update lastSync info in config. Returns the Nacos skills that were saved.
 */
export async function syncNacosSkills(config: NacosConfig): Promise<{
  nacosSkills: SkillEntry[];
  updatedConfig: NacosConfig;
}> {
  const urlMatch = config.registryUrl.match(/^nacos:\/\/([^/]+)\/(.+)$/);
  if (!urlMatch) {
    return {
      nacosSkills: [],
      updatedConfig: { ...config, lastSyncAt: new Date().toISOString(), lastSyncStatus: 'error' as const, lastSyncError: '无效的 Nacos URL 格式' },
    };
  }

  const [, hostPort, namespace] = urlMatch;
  const apiBase = `http://${hostPort}`;
  const listUrl = `${apiBase}/nacos/v1/ns/catalog/services?pageNo=1&pageSize=100&namespaceId=${encodeURIComponent(namespace)}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.username && config.password) {
    headers['Authorization'] = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`;
  }

  let nacosSkills: SkillEntry[] = [];
  try {
    const response = await fetch(listUrl, { headers, signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      return {
        nacosSkills: [],
        updatedConfig: { ...config, lastSyncAt: new Date().toISOString(), lastSyncStatus: 'error' as const, lastSyncError: `Nacos 请求失败: ${response.status}` },
      };
    }

    const data = await response.json() as { data: { groupName?: string; serviceName?: string; description?: string }[] };
    if (data.data) {
      nacosSkills = data.data
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
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Nacos 连接失败';
    return {
      nacosSkills: [],
      updatedConfig: { ...config, lastSyncAt: new Date().toISOString(), lastSyncStatus: 'error' as const, lastSyncError: message },
    };
  }

  const bucket = getMinioBucket();
  if (!bucket) {
    return {
      nacosSkills: [],
      updatedConfig: { ...config, lastSyncAt: new Date().toISOString(), lastSyncStatus: 'error' as const, lastSyncError: 'MinIO 未配置' },
    };
  }

  const client = createMinioClient();
  await ensureSkillsBucket(client);

  const existingSkills = await listSkills(client);
  const existingNames = new Set(existingSkills.map((s) => s.name));

  // Persist Nacos skills that don't conflict with custom skills
  const saved: SkillEntry[] = [];
  for (const skill of nacosSkills) {
    if (existingNames.has(skill.name)) {
      // Custom skill takes precedence; update updatedAt
      const existing = existingSkills.find((s) => s.name === skill.name);
      if (existing) {
        existing.updatedAt = new Date().toISOString();
        await saveSkillMetadata(client, existing);
      }
      continue;
    }
    await saveSkillMetadata(client, skill);
    saved.push(skill);
  }

  const updatedConfig: NacosConfig = {
    ...config,
    lastSyncAt: new Date().toISOString(),
    lastSyncStatus: 'success' as const,
    lastSyncError: undefined,
  };

  return { nacosSkills: saved, updatedConfig };
}

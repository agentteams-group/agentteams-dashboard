import { createMinioClient, getMinioBucket } from './minio-client';
import {
  SkillEntry,
  NacosConfig,
  SKILLS_BUCKET,
  SKILLS_METADATA_PREFIX,
  SKILL_NAME_PATTERN,
  GLOBAL_SKILLS_PREFIX,
  CUSTOM_SKILL_MARKER,
} from './skill-center-types';
import { isValidNameSegment, parseSkillFrontmatter } from './skill-package';

export { SKILLS_BUCKET, SKILLS_METADATA_PREFIX, SKILL_NAME_PATTERN, GLOBAL_SKILLS_PREFIX, CUSTOM_SKILL_MARKER };

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
    if (!obj.name?.endsWith('.json')) continue;
    const name = obj.name.replace(SKILLS_METADATA_PREFIX, '').replace('.json', '');
    if (!isValidNameSegment(name) || !SKILL_NAME_PATTERN.test(name)) continue;

    const metadata = await getSkillMetadata(client, name);
    if (metadata) {
      skills.push(metadata);
    }
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Collects immediate "directory" prefixes under a base prefix. Returns a
 * unique sorted list of the first path segment after the base prefix.
 */
export async function collectFirstLevelPrefixes(
  client: any,
  bucket: string,
  basePrefix: string
): Promise<string[]> {
  const names = new Set<string>();
  const stream = client.listObjects(bucket, basePrefix, false);
  for await (const obj of stream) {
    if (typeof obj.prefix === 'string' && obj.prefix.startsWith(basePrefix)) {
      const remainder = obj.prefix.slice(basePrefix.length).replace(/\/+$/, '');
      const first = remainder.split('/')[0];
      if (first) names.add(first);
    }
  }
  return Array.from(names).sort();
}

/** Counts objects under a prefix by listing them. */
export async function countObjectsUnderPrefix(
  client: any,
  bucket: string,
  prefix: string
): Promise<number> {
  let count = 0;
  const stream = client.listObjects(bucket, prefix, true);
  for await (const _obj of stream) {
    count += 1;
  }
  return count;
}

async function readObjectText(
  client: any,
  bucket: string,
  key: string
): Promise<string | null> {
  try {
    const data = await client.getObject(bucket, key);
    const chunks: Buffer[] = [];
    for await (const chunk of data as AsyncIterable<Buffer>) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString('utf-8');
  } catch {
    return null;
  }
}

/** Returns true when the skill prefix carries the "uploaded by dashboard" marker. */
async function isCustomSkill(
  client: any,
  bucket: string,
  skillPrefix: string
): Promise<boolean> {
  try {
    const data = await client.getObject(bucket, `${skillPrefix}${CUSTOM_SKILL_MARKER}`);
    await data.resume?.();
    return true;
  } catch {
    return false;
  }
}

/** Reads description from a skill's SKILL.md if present, otherwise undefined. */
async function readSkillDescription(
  client: any,
  bucket: string,
  skillPrefix: string
): Promise<string> {
  const skillMd = await readObjectText(client, bucket, `${skillPrefix}SKILL.md`);
  if (!skillMd) return '';
  try {
    return parseSkillFrontmatter(skillMd).description ?? '';
  } catch {
    return '';
  }
}

/**
 * Lists globally-distributed skills stored under `agents/global/skills/` in
 * the main bucket. Each skill name is a first-level directory prefix. Skills
 * carrying the custom marker are tagged source='custom', otherwise 'builtin'.
 */
export async function listGlobalSkills(
  client: any,
  bucket: string
): Promise<SkillEntry[]> {
  const names = await collectFirstLevelPrefixes(client, bucket, GLOBAL_SKILLS_PREFIX);
  const now = new Date().toISOString();
  const entries: SkillEntry[] = [];
  for (const name of names) {
    if (!isValidNameSegment(name)) continue;
    const prefix = `${GLOBAL_SKILLS_PREFIX}${name}/`;
    const [description, fileCount, custom] = await Promise.all([
      readSkillDescription(client, bucket, prefix),
      countObjectsUnderPrefix(client, bucket, prefix),
      isCustomSkill(client, bucket, prefix),
    ]);
    entries.push({
      name,
      description,
      source: custom ? 'custom' : 'builtin',
      createdAt: now,
      updatedAt: now,
      fileCount,
    });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
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
  const protocol = config.protocol || 'http';
  const prefix = config.apiPrefix ?? '/nacos';
  const mode = config.mode || 'services';
  const apiBase = `${protocol}://${hostPort}`;

  // Login is always at /v1/auth/login regardless of mode
  let accessToken = '';
  let loginInfo = '';
  if (config.username && config.password) {
    try {
      const loginUrl = `${apiBase}/v1/auth/login`;
      const loginRes = await fetch(loginUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username: config.username, password: config.password }),
        signal: AbortSignal.timeout(10000),
      });
      if (loginRes.ok) {
        const loginData = await loginRes.json() as { accessToken?: string };
        accessToken = loginData.accessToken || '';
        loginInfo = accessToken ? '已认证' : '登录成功但无 token';
      } else {
        loginInfo = `登录失败 HTTP ${loginRes.status}`;
      }
    } catch (err) {
      loginInfo = `登录异常: ${err instanceof Error ? err.message : 'unknown'}`;
    }
  } else {
    loginInfo = '无凭据，跳过登录';
  }

  const tokenParam = accessToken ? `&accessToken=${encodeURIComponent(accessToken)}` : '';
  const nsParam = `namespaceId=${encodeURIComponent(namespace)}`;

  let listUrl: string;
  if (mode === 'skills') {
    // Nacos 3.2+ Skill Registry: /v3/console/ai/skills/list
    listUrl = `${apiBase}/v3/console/ai/skills/list?filterableForm=true&pageNo=1&pageSize=500&${nsParam}${tokenParam}`;
  } else {
    // Traditional service discovery: {prefix}/v1/ns/catalog/services
    listUrl = `${apiBase}${prefix}/v1/ns/catalog/services?pageNo=1&pageSize=500&${nsParam}${tokenParam}`;
  }

  let nacosSkills: SkillEntry[] = [];
  try {
    const response = await fetch(listUrl, { headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      let errorBody = '';
      try { errorBody = await response.text(); } catch { /* ignore */ }
      return {
        nacosSkills: [],
        updatedConfig: {
          ...config,
          lastSyncAt: new Date().toISOString(),
          lastSyncStatus: 'error' as const,
          lastSyncError: `Nacos 请求失败: HTTP ${response.status}\n模式: ${mode}\n登录: ${loginInfo}\nURL: ${listUrl}\n响应: ${errorBody.substring(0, 500)}`,
        },
      };
    }

    const data = await response.json();
    const allItems: Record<string, unknown>[] = [];

    if (mode === 'skills') {
      // Nacos 3.2 skill registry: { code: 0, data: { pageItems, pagesAvailable } }
      const body = data as { code?: number; data?: { pageItems?: Record<string, unknown>[]; pagesAvailable?: number } };
      if (body.code === 0 && body.data) {
        allItems.push(...(body.data.pageItems || []));
        // Fetch remaining pages
        for (let page = 2; page <= (body.data.pagesAvailable || 1); page++) {
          const pagedUrl = `${apiBase}/v3/console/ai/skills/list?filterableForm=true&pageNo=${page}&pageSize=500&${nsParam}${tokenParam}`;
          const pagedRes = await fetch(pagedUrl, { headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000) });
          if (pagedRes.ok) {
            const pagedData = await pagedRes.json() as { data?: { pageItems?: Record<string, unknown>[] } };
            if (pagedData.data?.pageItems) {
              allItems.push(...pagedData.data.pageItems);
            }
          }
        }
      }
    } else {
      // Traditional naming: { code: 200, data: { serviceList } }
      if (data?.code === 200 && data?.data) {
        const rawData = data.data as { count?: number; serviceList?: Record<string, unknown>[] };
        if (Array.isArray(rawData.serviceList)) {
          allItems.push(...rawData.serviceList);
        }
      }
    }

    nacosSkills = allItems
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item) => ({
        name: typeof item.name === 'string' ? item.name : (typeof item.serviceName === 'string' ? item.serviceName : ''),
        description: typeof item.description === 'string' ? item.description : '',
        source: 'nacos' as const,
        sourceAlias: config.alias || config.namespace || config.registryUrl.replace(/^nacos:\/\//, '').split('/').pop() || config.registryUrl,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        fileCount: 0,
      }))
      .filter((s) => !!s.name);
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

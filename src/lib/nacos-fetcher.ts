import { getNacosConfig } from '@/lib/skill-center-config';
import { SKILLS_BUCKET } from '@/lib/skill-center-types';
import { unzipSync, zipSync } from 'fflate';

export interface NacosZipResult {
  zipBytes: Uint8Array;
  /** The resolved skill name from SKILL.md (may differ from the Nacos registry name). */
  resolvedName: string;
  source: string;
}

export interface NacosFetchDiagnostics {
  mode: string;
  skillsDetailUrl?: string;
  skillsDetailStatus?: number;
  skillsDetailCode?: number;
  servicesListUrl?: string;
  servicesListStatus?: number;
  serviceFound?: boolean;
  hasHomePageUrl?: boolean;
  homePageUrl?: string;
  homePageStatus?: number;
  homePageContentType?: string;
}

export async function cacheSkillContent(
  client: any,
  skillName: string,
  files: { relativePath: string; data: Uint8Array }[]
): Promise<void> {
  // Clear existing cached files before writing new ones.
  await deleteSkillCache(client, skillName);
  for (const f of files) {
    const key = `${skillName}/${f.relativePath}`;
    await client.putObject(
      SKILLS_BUCKET,
      key,
      Buffer.from(f.data),
      f.data.byteLength,
      { 'Content-Type': 'application/octet-stream' }
    );
  }
}

async function deleteSkillCache(client: any, skillName: string): Promise<void> {
  const prefix = `${skillName}/`;
  try {
    const objs: string[] = [];
    const stream = client.listObjects(SKILLS_BUCKET, prefix, true);
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (obj: { name?: string }) => {
        if (obj.name) objs.push(obj.name);
      });
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    if (objs.length > 0) {
      await client.removeObjects(SKILLS_BUCKET, objs);
    }
  } catch {
    // If we can't clean old cache, write-through still works; stale files
    // will be orphaned but won't break anything.
  }
}

/** Extract the single skill matching requestedName from a monorepo-style ZIP. */
function extractSkillFromMonorepo(
  zipBytes: Uint8Array,
  requestedName: string
): { zipBytes: Uint8Array; resolvedName: string } {
  const entries: Record<string, Uint8Array> = unzipSync(zipBytes);
  const paths = Object.keys(entries);

  // Heuristic: strip the top-level archive directory (e.g. `marketingskills-main/`)
  let rootPrefix = '';
  for (const p of paths) {
    const slash = p.indexOf('/');
    if (slash > 0 && !p.startsWith('.github') && !p.startsWith('.claude-plugin')) {
      rootPrefix = p.substring(0, slash + 1);
      break;
    }
  }

  // Method 1: directory name match
  const dirPath = `${rootPrefix}skills/${requestedName}/`;
  if (paths.some((p) => p.startsWith(dirPath))) {
    return buildSingleSkillZip(entries, dirPath, requestedName);
  }

  // Method 2: search SKILL.md frontmatter `name` field
  for (const path of paths) {
    if (!path.includes('/skills/') || !path.endsWith('/SKILL.md')) continue;
    const content = new TextDecoder().decode(entries[path]);
    const nameMatch = content.match(/^name:\s*(.+)$/m);
    if (!nameMatch || nameMatch[1].trim() !== requestedName) continue;
    const skillsIdx = path.indexOf('/skills/') + 8;
    const skillDir = path.substring(0, path.indexOf('/', skillsIdx) + 1);
    return buildSingleSkillZip(entries, skillDir, nameMatch[1].trim());
  }

  // Method 3: try partial prefix match (e.g. "ab-test-setup" could be an
  // alias for "ab-testing" in the monorepo)
  for (const path of paths) {
    if (!path.includes('/skills/') || !path.endsWith('/SKILL.md')) continue;
    const skillsIdx = path.indexOf('/skills/') + 8;
    const dirName = path.substring(skillsIdx, path.indexOf('/', skillsIdx));
    const content = new TextDecoder().decode(entries[path]);
    const nameMatch = content.match(/^name:\s*(.+)$/m);
    const internalName = nameMatch?.[1]?.trim() || '';
    if (
      internalName &&
      (requestedName.includes(internalName) || internalName.includes(requestedName) ||
       requestedName.replace(/[_-]/g, '') === internalName.replace(/[_-]/g, ''))
    ) {
      const skillDir = path.substring(0, skillsIdx + dirName.length + 1);
      return buildSingleSkillZip(entries, skillDir, internalName);
    }
  }

  const available: string[] = [];
  for (const path of paths) {
    if (path.includes('/skills/') && path.endsWith('/SKILL.md')) {
      const parts = path.split('/');
      const skillsIdx = parts.indexOf('skills');
      if (skillsIdx >= 0 && skillsIdx + 1 < parts.length) {
        available.push(parts[skillsIdx + 1]);
      }
    }
  }
  throw new Error(
    `无法在技能仓库中找到 "${requestedName}"（仓库中可用的技能目录: ${[...new Set(available)].join(', ')}）。请检查 Nacos 中技能名称是否与仓库目录名一致。`
  );
}

function buildSingleSkillZip(
  entries: Record<string, Uint8Array>,
  dirPrefix: string,
  resolvedName: string
): { zipBytes: Uint8Array; resolvedName: string } {
  const skillFiles: Record<string, Uint8Array> = {};
  for (const [path, data] of Object.entries(entries)) {
    if (!path.startsWith(dirPrefix) || path === dirPrefix) continue;
    skillFiles[path.substring(dirPrefix.length)] = data;
  }
  if (Object.keys(skillFiles).length === 0) {
    throw new Error(`技能目录 "${dirPrefix}" 为空`);
  }
  return { zipBytes: zipSync(skillFiles), resolvedName };
}

export async function getNacosAccessToken(config: any): Promise<string> {
  const protocol = config.protocol || 'http';
  const urlMatch = config.registryUrl.match(/^nacos:\/\/([^/]+)\/(.+)$/);
  if (!urlMatch) return '';
  const [, hostPort] = urlMatch;

  if (!config.username || !config.password) return '';

  try {
    const loginUrl = `${protocol}://${hostPort}/v1/auth/login`;
    const loginRes = await fetch(loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: config.username, password: config.password }),
      signal: AbortSignal.timeout(10000),
    });
    if (loginRes.ok) {
      const loginData = await loginRes.json() as { accessToken?: string };
      return loginData.accessToken || '';
    }
  } catch {
    // auth failed, continue without token
  }
  return '';
}

/**
 * Download a single skill ZIP via Nacos Console API.
 * This is the preferred path — Nacos handles monorepo extraction server-side.
 * Returns null if the download failed (caller should fall back to GitHub).
 */
async function fetchNacosSkillZipByConsoleDownload(
  apiBase: string,
  namespace: string,
  skillName: string,
  version: string,
  accessToken: string
): Promise<NacosZipResult | null> {
  const params = new URLSearchParams({
    namespaceId: namespace,
    skillName,
    version,
  });
  if (accessToken) params.set('accessToken', accessToken);

  const downloadUrl = `${apiBase}/v3/console/ai/skills/version/download?${params.toString()}`;

  const res = await fetch(downloadUrl, {
    signal: AbortSignal.timeout(30000),
    headers: { 'Accept': 'application/zip' },
  });

  if (!res.ok) return null;

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('zip') && !contentType.includes('octet-stream')) return null;

  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length === 0) return null;

  // The ZIP from Console API has files prefixed with "{skillName}/".
  // Strip the prefix so the worker sees flat files like SKILL.md.
  const entries = unzipSync(buf);
  const stripped: Record<string, Uint8Array> = {};
  const prefix = `${skillName}/`;
  let resolvedName = skillName;

  for (const [path, data] of Object.entries(entries)) {
    if (!path.startsWith(prefix)) continue;
    const relative = path.substring(prefix.length);
    if (!relative) continue;
    stripped[relative] = data;

    // Extract resolved name from SKILL.md frontmatter
    if (relative === 'SKILL.md') {
      const content = new TextDecoder().decode(data);
      const nameMatch = content.match(/^name:\s*(.+)$/m);
      if (nameMatch) resolvedName = nameMatch[1].trim();
    }
  }

  if (Object.keys(stripped).length === 0) return null;

  return {
    zipBytes: zipSync(stripped),
    resolvedName,
    source: 'nacos-console',
  };
}

export async function fetchNacosSkillZip(
  skillName: string,
  config?: any
): Promise<NacosZipResult> {
  if (!config) {
    config = await getNacosConfig();
    if (!config) throw new Error('Nacos 未配置');
  }

  const protocol = config.protocol || 'http';
  const prefix = config.apiPrefix ?? '/nacos';
  const mode = config.mode || 'services';

  const urlMatch = config.registryUrl.match(/^nacos:\/\/([^/]+)\/(.+)$/);
  if (!urlMatch) throw new Error('Nacos URL 格式无效: ' + config.registryUrl);
  const [, hostPort, namespace] = urlMatch;

  const apiBase = `${protocol}://${hostPort}`;

  const accessToken = await getNacosAccessToken(config);
  const tokenParam = accessToken ? `&accessToken=${encodeURIComponent(accessToken)}` : '';
  const nsParam = `namespaceId=${encodeURIComponent(namespace)}`;

  const diag: NacosFetchDiagnostics = { mode };

  if (mode === 'skills') {
    // Nacos 3.x skill detail endpoint may not exist; use list to find skill metadata
    const listUrl = `${apiBase}/v3/console/ai/skills/list?filterableForm=true&pageNo=1&pageSize=500&${nsParam}${tokenParam}`;
    diag.skillsDetailUrl = listUrl;
    try {
      const listRes = await fetch(listUrl, {
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      diag.skillsDetailStatus = listRes.status;
      if (listRes.ok) {
        const listData = await listRes.json() as { code?: number; data?: { pageItems?: Array<{ name: string; from?: string; labels?: { latest?: string } }> } };
        diag.skillsDetailCode = listData.code;
        if (listData.code === 0 && listData.data?.pageItems) {
          const skill = listData.data.pageItems.find((s) => s.name === skillName);
          if (!skill) {
            throw new Error(`技能 "${skillName}" 未在 Nacos 中注册`);
          }

          // 1. Preferred: Console download (Nacos handles monorepo extraction server-side)
          const version = skill.labels?.latest;
          if (version) {
            try {
              const consoleResult = await fetchNacosSkillZipByConsoleDownload(
                apiBase, namespace, skillName, version, accessToken
              );
              if (consoleResult) return consoleResult;
            } catch {
              // fall through to GitHub archive
            }
          }

          // 2. Fallback: GitHub archive download
          if (skill.from) {
            const candidateUrls = [
              `https://${skill.from}/archive/refs/tags/${version}.zip`,
              `https://${skill.from}/archive/refs/heads/${version}.zip`,
              `https://${skill.from}/archive/refs/heads/main.zip`,
            ];
            for (const githubUrl of candidateUrls) {
              diag.homePageUrl = githubUrl;
              try {
                const zipRes = await fetch(githubUrl, {
                  signal: AbortSignal.timeout(30000),
                  headers: { 'User-Agent': 'agentteams-dashboard' },
                  redirect: 'follow',
                });
                diag.homePageStatus = zipRes.status;
                if (zipRes.ok) {
                  const buf = Buffer.from(await zipRes.arrayBuffer());
                  const extracted = extractSkillFromMonorepo(new Uint8Array(buf), skillName);
                  return { zipBytes: extracted.zipBytes, resolvedName: extracted.resolvedName, source: 'github-archive' };
                }
              } catch {
                diag.homePageStatus = -1;
              }
            }
          }
        }
      }
    } catch {
      diag.skillsDetailStatus = -1;
    }
  }

  if (mode === 'services') {
    const listUrl = `${apiBase}${prefix}/v1/ns/catalog/services?pageNo=1&pageSize=500&${nsParam}${tokenParam}`;
    diag.servicesListUrl = listUrl;
    try {
      const listRes = await fetch(listUrl, {
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      diag.servicesListStatus = listRes.status;
      if (listRes.ok) {
        const data = await listRes.json() as { code?: number; data?: { serviceList?: Record<string, unknown>[] } };
        if (data?.code === 200 && Array.isArray(data?.data?.serviceList)) {
          const service = data.data.serviceList.find(
            (s: Record<string, unknown>) => s.name === skillName || s.serviceName === skillName
          );
          diag.serviceFound = !!service;
          if (service) {
            const homePageUrl = typeof service.homePageUrl === 'string' ? service.homePageUrl : '';
            diag.hasHomePageUrl = !!homePageUrl;
            if (homePageUrl) {
              diag.homePageUrl = homePageUrl;
              const zipRes = await fetch(homePageUrl, {
                signal: AbortSignal.timeout(15000),
              });
              diag.homePageStatus = zipRes.status;
              diag.homePageContentType = zipRes.headers.get('content-type') || undefined;
              if (zipRes.ok && zipRes.headers.get('content-type')?.includes('zip')) {
                const buf = Buffer.from(await zipRes.arrayBuffer());
                // services mode typically returns a single-skill ZIP directly,
                // but we still extract in case it's a monorepo.
                const extracted = extractSkillFromMonorepo(new Uint8Array(buf), skillName);
                return { zipBytes: extracted.zipBytes, resolvedName: extracted.resolvedName, source: 'homePageUrl' };
              }
            }
          }
        }
      }
    } catch {
      diag.servicesListStatus = -1;
    }
  }

  throw new Error(`无法从 Nacos 获取技能 "${skillName}" 的内容。诊断: ${JSON.stringify(diag)}`);
}

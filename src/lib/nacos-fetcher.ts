import { getNacosConfig } from '@/lib/skill-center-config';
import { SKILLS_BUCKET } from '@/lib/skill-center-types';

export interface NacosZipResult {
  zipBytes: Uint8Array;
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

async function getNacosAccessToken(config: any): Promise<string> {
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

export async function fetchNacosSkillZip(
  skillName: string,
  config?: any
): Promise<NacosZipResult> {
  if (!config) {
    config = getNacosConfig();
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
          if (skill?.from) {
            const version = skill.labels?.latest;
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
                  return { zipBytes: new Uint8Array(buf), source: 'github-archive' };
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
                return { zipBytes: new Uint8Array(buf), source: 'homePageUrl' };
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

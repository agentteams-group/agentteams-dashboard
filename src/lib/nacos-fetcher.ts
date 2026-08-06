import { getNacosConfig } from '@/lib/skill-center-config';
import { SKILLS_BUCKET } from '@/lib/skill-center-types';

export interface NacosZipResult {
  zipBytes: Uint8Array;
  source: string;
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
  const urlMatch = config.registryUrl.match(/^([^/]+)\/(.+)$/);
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
): Promise<NacosZipResult | null> {
  if (!config) {
    config = getNacosConfig();
    if (!config) return null;
  }

  const protocol = config.protocol || 'http';
  const prefix = config.apiPrefix ?? '/nacos';
  const mode = config.mode || 'services';
  const apiBase = `${protocol}://${config.registryUrl}`;

  const urlMatch = config.registryUrl.match(/^([^/]+)\/(.+)$/);
  if (!urlMatch) return null;
  const [, _hostPort, namespace] = urlMatch;

  const accessToken = await getNacosAccessToken(config);
  const tokenParam = accessToken ? `&accessToken=${encodeURIComponent(accessToken)}` : '';
  const nsParam = `namespaceId=${encodeURIComponent(namespace)}`;

  if (mode === 'skills') {
    const detailUrl = `${apiBase}/v3/console/ai/skills/detail?skillName=${encodeURIComponent(skillName)}&${nsParam}${tokenParam}`;
    const res = await fetch(detailUrl, {
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const data = await res.json() as { code?: number; data?: { zip?: string; content?: string } };
      if (data.code === 0 && data.data) {
        const zipB64 = data.data.zip || data.data.content || '';
        if (zipB64) {
          return { zipBytes: Buffer.from(zipB64, 'base64'), source: 'skills-detail' };
        }
      }
    }
  }

  if (mode === 'services') {
    const listUrl = `${apiBase}${prefix}/v1/ns/catalog/services?pageNo=1&pageSize=500&${nsParam}${tokenParam}`;
    const listRes = await fetch(listUrl, {
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (listRes.ok) {
      const data = await listRes.json() as { code?: number; data?: { serviceList?: Record<string, unknown>[] } };
      if (data?.code === 200 && Array.isArray(data?.data?.serviceList)) {
        const service = data.data.serviceList.find(
          (s: Record<string, unknown>) => s.name === skillName || s.serviceName === skillName
        );
        if (service) {
          const homePageUrl = typeof service.homePageUrl === 'string' ? service.homePageUrl : '';
          if (homePageUrl) {
            const zipRes = await fetch(homePageUrl, {
              signal: AbortSignal.timeout(15000),
            });
            if (zipRes.ok && zipRes.headers.get('content-type')?.includes('zip')) {
              const buf = Buffer.from(await zipRes.arrayBuffer());
              return { zipBytes: new Uint8Array(buf), source: 'homePageUrl' };
            }
          }
        }
      }
    }
  }

  return null;
}

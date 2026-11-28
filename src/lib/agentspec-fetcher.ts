import { getNacosConfig } from '@/lib/skill-center-config';
import {
  getNacosAccessToken,
  nacosFetch,
  readNacosJson,
  sanitizeNacosText,
} from '@/lib/nacos-fetcher';
import type { NacosConfig } from '@/lib/skill-center-types';

export interface AgentSpecWorkerHint {
  suggested_name?: string;
  base_image?: string;
  apt_packages?: string[];
  pip_packages?: string[];
  npm_packages?: string[];
}

export interface AgentSpecContent {
  version?: string;
  source?: {
    repository?: string;
    commit?: string;
    original_path?: string;
    openclaw_mode?: boolean;
  };
  description?: string;
  tags?: string[];
  worker?: AgentSpecWorkerHint;
  proxy?: { suggested?: boolean; reason?: string };
}

export interface AgentSpecResource {
  name: string;
  type: string;
  content: string;
}

/** Mapped fields ready to pre-fill the worker create form. */
export interface AgentSpecMapping {
  name: string;
  image?: string;
  runtime: 'openclaw';
  soul?: string;
  description: string;
  version: string;
  from: string;
}

export function sanitizeWorkerName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 63);
}

function resourceByName(resources: Record<string, AgentSpecResource> | undefined, name: string): string {
  if (!resources) return '';
  for (const item of Object.values(resources)) {
    if (item?.name === name && typeof item.content === 'string') {
      return item.content;
    }
  }
  return '';
}

/**
 * Map a raw Nacos AgentSpec response onto worker create fields.
 *
 * - name  <- content.worker.suggested_name (sanitized), fallback to spec name
 * - image <- content.worker.base_image
 * - soul  <- resource SOUL.md, fallback IDENTITY.md, fallback description
 */
export function mapAgentSpecToWorker(input: {
  specName: string;
  version: string;
  from?: string;
  content: AgentSpecContent;
  resources?: Record<string, AgentSpecResource>;
}): AgentSpecMapping {
  const { content, resources } = input;
  const worker = content.worker ?? {};

  const soul =
    resourceByName(resources, 'SOUL.md') ||
    resourceByName(resources, 'IDENTITY.md') ||
    content.description ||
    input.specName;

  return {
    name: sanitizeWorkerName(worker.suggested_name || input.specName),
    image: worker.base_image || undefined,
    runtime: 'openclaw',
    soul,
    description: content.description || '',
    version: input.version,
    from: input.from ?? content.source?.repository ?? '',
  };
}

export interface AgentSpecFetchResult {
  ok: boolean;
  error?: string;
  mapping?: AgentSpecMapping;
}

async function resolveNacosApi(): Promise<
  { apiBase: string; namespace: string; accessToken: string; config: NacosConfig } | { error: string }
> {
  const config = await getNacosConfig();
  if (!config) return { error: 'Nacos 未配置' };

  const protocol = config.protocol || 'https';
  const urlMatch = config.registryUrl.match(/^nacos:\/\/([^/]+)\/(.+)$/);
  if (!urlMatch) return { error: 'Nacos URL 格式无效' };
  const [, hostPort, namespace] = urlMatch;

  const accessToken = await getNacosAccessToken(config);
  return { apiBase: `${protocol}://${hostPort}`, namespace, accessToken, config };
}

/** Fetch one AgentSpec version from the Nacos Console API and map it. */
export async function fetchAgentSpec(name: string, version: string): Promise<AgentSpecFetchResult> {
  const api = await resolveNacosApi();
  if ('error' in api) return { ok: false, error: api.error };

  const params = new URLSearchParams({
    agentSpecName: name,
    version,
    namespaceId: api.namespace,
  });
  const url = `${api.apiBase}/v3/console/ai/agentspecs/version?${params}`;

  let data: {
    code?: number;
    message?: string;
    data?: {
      name?: string;
      description?: string;
      from?: string;
      content?: string;
      resource?: Record<string, AgentSpecResource>;
    };
  };

  try {
    const res = await nacosFetch(url, {
      accessToken: api.accessToken,
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) return { ok: false, error: `AgentSpec API 返回 HTTP ${res.status}` };
    data = await readNacosJson<typeof data>(res, api.accessToken);
  } catch (err) {
    return {
      ok: false,
      error: sanitizeNacosText(err instanceof Error ? err.message : 'AgentSpec API 不可用', [api.accessToken]),
    };
  }

  if (data.code !== 0 || !data.data?.content) {
    return {
      ok: false,
      error: sanitizeNacosText(data.message || 'AgentSpec 内容为空', [api.accessToken]),
    };
  }

  let content: AgentSpecContent;
  try {
    content = JSON.parse(data.data.content) as AgentSpecContent;
  } catch {
    return { ok: false, error: 'AgentSpec content 不是合法 JSON' };
  }

  return {
    ok: true,
    mapping: mapAgentSpecToWorker({
      specName: data.data.name || name,
      version,
      from: data.data.from,
      content,
      resources: data.data.resource,
    }),
  };
}

export interface NacosAgentSpecSummary {
  name: string;
  description: string;
  version: string;
  from: string;
  scope: string;
}

export async function listNacosAgentSpecs(): Promise<{ items: NacosAgentSpecSummary[]; note?: string }> {
  const api = await resolveNacosApi();
  if ('error' in api) return { items: [], note: api.error };
  const items: NacosAgentSpecSummary[] = [];
  const pageSize = 500;
  const maxPages = 20;
  try {
    for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
      const params = new URLSearchParams({
        namespaceId: api.namespace,
        pageNo: String(pageNo),
        pageSize: String(pageSize),
      });
      const response = await nacosFetch(`${api.apiBase}/v3/console/ai/agentspecs/list?${params}`, {
        accessToken: api.accessToken,
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) return { items, note: `AgentSpecs API 返回 HTTP ${response.status}` };
      const data = await readNacosJson<{
        data?: {
          pagesAvailable?: number;
          pageItems?: Array<{ name: string; description?: string; labels?: { latest?: string }; from?: string; scope?: string }>;
        };
      }>(response, api.accessToken);
      const pageItems = data.data?.pageItems ?? [];
      items.push(...pageItems.map((item) => ({
        name: item.name,
        description: item.description ?? '',
        version: item.labels?.latest ?? '',
        from: item.from ?? '',
        scope: item.scope ?? 'PUBLIC',
      })));
      if (pageNo >= (data.data?.pagesAvailable ?? 1) || pageItems.length === 0) break;
    }
    return { items };
  } catch (err) {
    return {
      items,
      note: sanitizeNacosText(err instanceof Error ? err.message : 'AgentSpecs API 不可用', [api.accessToken]),
    };
  }
}

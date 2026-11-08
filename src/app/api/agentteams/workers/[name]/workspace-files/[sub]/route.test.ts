import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  createSession,
  sessionCookieHeader,
  __resetSessionStoreForTests,
} from '@/lib/dashboard-session';

// 凭据链测试开关（hoisted：vi.mock 工厂先于模块执行）。
const h = vi.hoisted(() => ({
  saToken: 'tok' as string | undefined,
  perAddressAuth: '',
}));

vi.mock('../../../../proxy-helper', () => ({
  getControllerUrl: () => 'http://c:8090',
  getAuthToken: async () => h.saToken,
}));

// 只覆盖 per-address 凭据查表，其余 backend-config 导出保持真实实现
// （dashboard-session 等同模块图消费方需要 configFilePath 等）。
vi.mock('@/lib/backend-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/backend-config')>();
  return {
    ...actual,
    backendAuthHeader: () => (h.perAddressAuth ? { Authorization: h.perAddressAuth } : {}),
  };
});

import { GET, PUT, __resetKbCacheForTests } from './route';

// ── 最小 ustar 构造（与 route.ts tarMembers 解析对齐）─────────────────────
function tarHeader(name: string, size: number, mtime: number, isdir = false): Buffer {
  const h = Buffer.alloc(512);
  h.write(name.slice(0, 100), 0, 'utf8');
  h.write('0000000 ', 100, 'utf8'); // mode
  h.write('0000000 ', 108, 'utf8');
  h.write('0000000 ', 116, 'utf8');
  h.write(`${size.toString(8).padStart(11, '0')} `, 124, 'utf8');
  h.write(`${mtime.toString(8).padStart(11, '0')} `, 136, 'utf8');
  h.fill(' ', 148, 156);
  h.write(isdir ? '5' : '0', 156, 'utf8');
  h.write('ustar\0', 257, 'utf8');
  h.write('00', 263, 'utf8');
  let sum = 0;
  for (let i = 0; i < 512; i += 1) sum += i >= 148 && i < 156 ? 32 : h[i];
  h.write(`${sum.toString(8).padStart(6, '0')} \0`, 148, 'utf8');
  return h;
}

type T = { name: string; content?: string; mtime?: number; isdir?: boolean };
function makeTar(entries: T[]): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    const data = e.content !== undefined ? Buffer.from(e.content, 'utf8') : Buffer.alloc(0);
    parts.push(tarHeader(e.name, data.length, e.mtime ?? 1750000000, !!e.isdir));
    if (data.length > 0) parts.push(data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad > 0) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(1024)); // 终止双零块
  return Buffer.concat(parts);
}

// Docker archive 真实形态（9/16 真机实测）：目录请求 = 所请求路径 basename
// 根前缀 + 根成员自身（如 'default/AGENTS.md' + 'default'）。
function dockerDirTar(entries: T[], baseName: string): Buffer {
  return makeTar([
    { name: baseName, isdir: true },
    ...entries.map((e) => ({ ...e, name: `${baseName}/${e.name}` })),
  ]);
}

// ── fetch 路由（Controller Docker 代理语义）────────────────────────────────
const WS = '/root/agentteams-fs/agents/w1/.qwenpaw/workspaces/default';
const WS_COPAW = '/root/agentteams-fs/agents/w1/.copaw/workspaces/default';

interface Fixtures {
  inspectStatus?: number;
  containerName?: string;
  /** 候选路径 HEAD 结果（默认第一个命中） */
  headStatuses?: number[];
  /** archive GET：相对 target 的 tar 条目（目录）或单文件（文件请求） */
  topTar?: T[];
  memoryTar?: T[];
  fileTar?: T[];
  /** true=个别 daemon 形态：目录 archive 直接返回相对名（无根前缀） */
  relativeNames?: boolean;
  /** archive GET（非 HEAD）强制状态码——401/403 透传用例 */
  archiveGetStatus?: number;
  /** 所有 fetch 抛网络错误——502 用例 */
  networkError?: boolean;
}
const fx: Fixtures = {};

function installFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
      if (fx.networkError) throw new TypeError('fetch failed');
      const u = url as string;
      const method = (init?.method ?? 'GET').toUpperCase();
      const json = (status: number, body?: unknown) =>
        ({ ok: status < 400, status, arrayBuffer: async () => new ArrayBuffer(0), json: async () => body }) as unknown as Response;
      const tar = (status: number, b: Buffer) =>
        ({ ok: status < 400, status, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }) as unknown as Response;

      if (u.endsWith(`/containers/${fx.containerName ?? 'agentteams-worker-w1'}/json`)) {
        return json(fx.inspectStatus ?? 200);
      }
      if (u.includes('/archive?path=')) {
        if (method === 'GET' && fx.archiveGetStatus !== undefined) {
          return json(fx.archiveGetStatus, { message: 'denied' });
        }
        const p = decodeURIComponent(u.slice(u.indexOf('/archive?path=') + '/archive?path='.length));
        const cands = [WS, WS_COPAW, '/root/agentteams-fs/agents/w1'];
        if (method === 'HEAD') {
          const i = cands.indexOf(p);
          const status = fx.headStatuses && i >= 0 && i < fx.headStatuses.length
            ? fx.headStatuses[i]
            : p === WS ? 200 : 404;
          return json(status);
        }
        const root = p.startsWith(WS_COPAW) ? WS_COPAW : WS; // 回退布局同样供数
        const dirTar = (entries: T[]) =>
          fx.relativeNames ? makeTar(entries) : dockerDirTar(entries, p.split('/').pop() ?? 'default');
        if (p === root) return tar(200, dirTar(fx.topTar ?? []));
        if (p === `${root}/memory`) return tar(200, dirTar(fx.memoryTar ?? []));
        if (p.startsWith(`${root}/memory/`)) {
          const rel = p.slice(`${root}/memory/`.length);
          const f = (fx.memoryTar ?? []).find((e) => e.name === rel && !e.isdir);
          return f ? tar(200, makeTar([{ name: f.name, content: f.content, mtime: f.mtime }])) : json(404);
        }
        if (p.startsWith(`${root}/`)) {
          const rel = p.slice(`${root}/`.length);
          const f = (fx.topTar ?? []).find((e) => e.name === rel && !e.isdir);
          return f ? tar(200, makeTar([{ name: f.name, content: f.content, mtime: f.mtime }])) : json(404);
        }
        return json(404);
      }
      return json(404, { error: `unrouted: ${u}` });
    }),
  );
}

function call(sub: string, query = '', name = 'w1', cookie?: string) {
  const url = `http://localhost/api/agentteams/workers/${encodeURIComponent(name)}/workspace-files/${sub}${query}`;
  return GET(
    new NextRequest(url, { method: 'GET', headers: cookie ? { cookie } : undefined }),
    { params: Promise.resolve({ name, sub }) },
  );
}

const TOP_TAR: T[] = [
  { name: 'MEMORY.md', content: '# mem', mtime: 1750000100 },
  { name: 'SOUL.md', content: 'soul' },
  { name: 'memory', isdir: true },
  { name: 'digest', isdir: true },
  { name: 'credentials', isdir: true },
  { name: 'openclaw.json', content: '{}' },
  { name: 'agent.json', content: '{}' },
  { name: 'foo.lock', content: 'x' },
];
const MEMORY_TAR: T[] = [
  { name: '2026-09-15.md', content: 'day', mtime: 1750000200 },
  { name: 'sub', isdir: true },
  { name: 'secret.lock', content: 'x' },
];

describe('/workers/[name]/workspace-files/[sub]（v2：Controller Docker 代理数据面）', () => {
  beforeEach(() => {
    Object.keys(fx).forEach((k) => delete fx[k as keyof Fixtures]);
    fx.topTar = TOP_TAR;
    fx.memoryTar = MEMORY_TAR;
    h.saToken = 'tok';
    h.perAddressAuth = '';
    __resetKbCacheForTests();
    __resetSessionStoreForTests();
    installFetch();
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('uses the configured resource prefix for inspect and archive requests', async () => {
    vi.stubEnv('AGENTTEAMS_RESOURCE_PREFIX', 'agt124fresh-');
    fx.containerName = 'agt124fresh-worker-w1';
    const res = await call('tree');
    expect(res.status).toBe(200);
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(urls.length).toBeGreaterThan(1);
    expect(urls.every((url) => url.includes('/containers/agt124fresh-worker-w1/'))).toBe(true);
  });

  it('tree 顶层：四分类条目 + 敏感过滤 + 目录优先排序', async () => {
    const res = await call('tree');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { directory: string; entries: { kind: string; name: string; path: string; preview_kind: string }[]; has_more: boolean };
    expect(body.directory).toBe('workspace');
    expect(body.has_more).toBe(false);
    const names = body.entries.map((e) => e.name);
    // 目录在前（digest/memory），文件按名排序
    expect(names).toEqual(['digest', 'memory', 'MEMORY.md', 'SOUL.md', 'agent.json']);
    // openclaw.json / foo.lock 被敏感过滤；credentials 目录本身同样过滤（插件同款）
    expect(names).not.toContain('openclaw.json');
    expect(names).not.toContain('foo.lock');
    expect(names).not.toContain('credentials');
    const md = body.entries.find((e) => e.name === 'MEMORY.md')!;
    expect(md.kind).toBe('file');
    expect(md.preview_kind).toBe('markdown');
    expect(body.entries.find((e) => e.name === 'memory')!.kind).toBe('directory');
  });

  it('tree?path=memory：相对路径拼回 memory/** + 子目录只列', async () => {
    const res = await call('tree', '?path=memory');
    const body = (await res.json()) as { entries: { kind: string; name: string; path: string }[] };
    expect(body.entries.map((e) => e.path).sort()).toEqual(['memory/2026-09-15.md', 'memory/sub']);
    expect(body.entries.find((e) => e.path === 'memory/sub')!.kind).toBe('directory');
    // secret.lock 过滤
    expect(body.entries.map((e) => e.name)).not.toContain('secret.lock');
  });

  it('tree?path=credentials → 400（仅 memory/**·digest/** 可展开）', async () => {
    const res = await call('tree', '?path=credentials');
    expect(res.status).toBe(400);
  });

  it('file-content?path=MEMORY.md：tar 单文件抽取（数据区偏移）', async () => {
    const res = await call('file-content', '?path=MEMORY.md');
    const body = (await res.json()) as { content: string; eof: boolean };
    expect(res.status).toBe(200);
    expect(body.content).toBe('# mem');
    expect(body.eof).toBe(true);
  });

  it('file-content?path=credentials/x.yaml → 400 敏感文件', async () => {
    const res = await call('file-content', `?path=${encodeURIComponent('credentials/x.yaml')}`);
    expect(res.status).toBe(400);
  });

  it('file-content?path=../etc/passwd → 400 非法路径', async () => {
    const res = await call('file-content', `?path=${encodeURIComponent('../etc/passwd')}`);
    expect(res.status).toBe(400);
  });

  it('file-content?path=memory/2026-09-15.md → 子树文件可读', async () => {
    const res = await call('file-content', '?path=memory/2026-09-15.md');
    const body = (await res.json()) as { content: string };
    expect(res.status).toBe(200);
    expect(body.content).toBe('day');
  });

  it('file-metadata?path=memory/2026-09-15.md：size/mtime/preview_kind', async () => {
    const res = await call('file-metadata', '?path=memory/2026-09-15.md');
    const body = (await res.json()) as { size: number; modified_at: string; preview_kind: string; path: string };
    expect(res.status).toBe(200);
    expect(body.size).toBe(3);
    expect(body.modified_at).toBe(new Date(1750000200 * 1000).toISOString());
    expect(body.preview_kind).toBe('markdown');
    expect(body.path).toBe('memory/2026-09-15.md');
  });

  it('file-content?path=missing.md → 404 文件不存在', async () => {
    const res = await call('file-content', '?path=missing.md');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('missing.md');
  });

  it('容器不存在（inspect 404）→ 404 带容器名', async () => {
    fx.inspectStatus = 404;
    const res = await call('tree');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('agentteams-worker-w1');
  });

  it('工作区探测：首候选 404 → 回退 copaw 布局（archive 打到 copaw 路径）', async () => {
    fx.headStatuses = [404, 200];
    const res = await call('tree', '?path=memory');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: { path: string }[] };
    expect(body.entries.some((e) => e.path === 'memory/2026-09-15.md')).toBe(true);
  });

  it('非法 Worker 名 / 未知子路径 → 400', async () => {
    expect((await call('tree', '', 'bad/../name')).status).toBe(400);
    expect((await call('delete')).status).toBe(400);
  });

  it('目录 archive 相对名形态（个别 daemon 无根前缀）→ 同款解析', async () => {
    fx.relativeNames = true;
    const res = await call('tree');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: { name: string }[] };
    expect(body.entries.map((e) => e.name).sort()).toEqual(
      ['MEMORY.md', 'SOUL.md', 'agent.json', 'digest', 'memory'].sort(),
    );
  });

  it('file-content?raw=1：原始字节直下（octet-stream + attachment）', async () => {
    const res = await call('file-content', `?path=MEMORY.md&raw=1`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/octet-stream');
    expect(res.headers.get('content-disposition') ?? '').toContain('attachment');
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.toString('utf8')).toBe('# mem');
  });

  it('file-content?raw=1 敏感文件 → 400（下载与预览同一道闸）', async () => {
    const res = await call('file-content', `?path=${encodeURIComponent('credentials/x.yaml')}&raw=1`);
    expect(res.status).toBe(400);
  });
});

// ── 凭据链（11/8 dashboard 502 修复）──────────────────────────────────────
describe('/workers/[name]/workspace-files/[sub] Docker 代理凭据链与状态透传', () => {
  const TOKEN_ENV_MESSAGE = '未配置 Controller 服务账号 token';

  beforeEach(() => {
    Object.keys(fx).forEach((k) => delete fx[k as keyof Fixtures]);
    fx.topTar = TOP_TAR;
    fx.memoryTar = MEMORY_TAR;
    h.saToken = 'tok';
    h.perAddressAuth = '';
    __resetKbCacheForTests();
    __resetSessionStoreForTests();
    installFetch();
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  function sessionCookie(credential:
    | { kind: 'sa' }
    | { kind: 'controller-token'; token: string }
    | { kind: 'matrix'; token: string }): string {
    vi.stubEnv('DASHBOARD_SESSION_SECRET', 'a'.repeat(64));
    const { cookieValue } = createSession({
      user: 'bob',
      crLevel: credential.kind === 'matrix' ? 2 : 1,
      credential,
    });
    return sessionCookieHeader(cookieValue);
  }

  function sentAuthHeaders(): string[] {
    return vi.mocked(fetch).mock.calls.map(([, init]) =>
      ((init?.headers ?? {}) as Record<string, string>).Authorization,
    );
  }

  it('无任何凭据 → 401（不再是 502）+ 前端可读文案，且不外呼 Docker 代理', async () => {
    h.saToken = undefined;
    const res = await call('tree');
    const body = (await res.json()) as { error: string };
    expect(res.status).toBe(401);
    expect(body.error).toContain(TOKEN_ENV_MESSAGE);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('SA env token → 每个 Docker 代理请求都带 Bearer SA', async () => {
    h.saToken = 'sa-env-token';
    expect((await call('tree')).status).toBe(200);
    const auths = sentAuthHeaders();
    expect(auths.length).toBeGreaterThan(0);
    expect(auths.every((value) => value === 'Bearer sa-env-token')).toBe(true);
  });

  it('per-address Basic 优先且不叠加 SA Bearer', async () => {
    h.perAddressAuth = 'Basic YWRtaW46cHc=';
    h.saToken = 'sa-env-token';
    expect((await call('tree')).status).toBe(200);
    const auths = sentAuthHeaders();
    expect(auths.length).toBeGreaterThan(0);
    expect(auths.every((value) => value === 'Basic YWRtaW46cHc=')).toBe(true);
  });

  it('controller-token session 回退 → Bearer 该 token', async () => {
    h.saToken = undefined;
    const res = await call('tree', '', 'w1', sessionCookie({ kind: 'controller-token', token: 'ctl-token' }));
    expect(res.status).toBe(200);
    expect(sentAuthHeaders().every((value) => value === 'Bearer ctl-token')).toBe(true);
  });

  it('Matrix session 回退 → Bearer Matrix token（Controller 放行）', async () => {
    h.saToken = undefined;
    const res = await call('tree', '', 'w1', sessionCookie({ kind: 'matrix', token: 'mx-token' }));
    expect(res.status).toBe(200);
    expect(sentAuthHeaders().every((value) => value === 'Bearer mx-token')).toBe(true);
  });

  it('Matrix session + Docker 403 → 403 原样（可读文案，不伪造 502）', async () => {
    h.saToken = undefined;
    fx.inspectStatus = 403;
    const res = await call('tree', '', 'w1', sessionCookie({ kind: 'matrix', token: 'mx-token' }));
    const body = (await res.json()) as { error: string };
    expect(res.status).toBe(403);
    expect(body.error).toContain('无 Docker 代理权限');
  });

  it('Docker inspect 401 → 401 原样（凭据不足文案）', async () => {
    fx.inspectStatus = 401;
    const res = await call('tree');
    const body = (await res.json()) as { error: string };
    expect(res.status).toBe(401);
    expect(body.error).toContain('无 Controller 管理凭据');
  });

  it('工作区候选 HEAD 全部 403 → 403（不退化成「未找到工作区」404）', async () => {
    fx.headStatuses = [403, 403, 403];
    const res = await call('tree');
    expect(res.status).toBe(403);
  });

  it('archive GET 403 → tree / file-content 均 403 原样', async () => {
    fx.archiveGetStatus = 403;
    expect((await call('tree')).status).toBe(403);
    const file = await call('file-content', '?path=MEMORY.md');
    expect(file.status).toBe(403);
    expect(((await file.json()) as { error: string }).error).toContain('无 Docker 代理权限');
  });

  it('网络错误 → 502 且文案明确「Docker 代理请求失败」', async () => {
    fx.networkError = true;
    const res = await call('tree');
    const body = (await res.json()) as { error: string };
    expect(res.status).toBe(502);
    expect(body.error).toContain('Docker 代理请求失败');
  });

  it('尾斜杠 /tree/?path= 与空 path、path=/、path=memory/ 均正常', async () => {
    expect((await call('tree', '?path=')).status).toBe(200);
    expect((await call('tree', '?path=%2F')).status).toBe(200);
    const memory = await call('tree', '?path=memory%2F');
    expect(memory.status).toBe(200);
    const body = (await memory.json()) as { entries: { path: string }[] };
    expect(body.entries.map((e) => e.path)).toContain('memory/2026-09-15.md');
  });
});

describe('/workers/[name]/workspace-files/[sub] PUT（Controller 写回）', () => {
  afterEach(() => vi.unstubAllGlobals());

  function callPut(
    path: string,
    content: string,
    sub = 'file-content',
  ) {
    const url = `http://localhost/api/agentteams/workers/w1/workspace-files/${sub}?path=${encodeURIComponent(path)}`;
    return PUT(
      new NextRequest(url, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content }),
      }),
      { params: Promise.resolve({ name: 'w1', sub }) },
    );
  }

  it('reads the ETag of an existing file and forwards If-Match on PUT', async () => {
    const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ url, method, headers: (init?.headers ?? {}) as Record<string, string> });
      if (method === 'GET') {
        return new Response(JSON.stringify({ content: 'old', etag: 'etag-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ etag: 'etag-2', path: 'MEMORY.md', size: 5 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }));

    const res = await callPut('MEMORY.md', 'hello');
    expect(res.status).toBe(200);
    expect(calls[0].method).toBe('GET');
    expect(calls[1].method).toBe('PUT');
    expect(calls[1].url).toContain('/api/v1/workers/w1/workspace-files/file-content?path=MEMORY.md');
    expect(calls[1].headers['If-Match']).toBe('etag-1');
  });

  it('passes 403 through so the panel can degrade to read-only', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'GET') {
        return new Response(JSON.stringify({ content: 'old', etag: 'etag-1' }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
    }));

    expect((await callPut('MEMORY.md', 'hello')).status).toBe(403);
  });

  it('rejects non file-content subpaths without touching the controller', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await callPut('MEMORY.md', 'hello', 'tree')).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

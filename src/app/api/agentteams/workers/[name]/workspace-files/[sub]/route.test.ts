import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('../../../../proxy-helper', () => ({
  getControllerUrl: () => 'http://c:8090',
  getAuthToken: async () => 'tok',
}));

import { GET, __resetKbCacheForTests } from './route';

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
  /** 候选路径 HEAD 结果（默认第一个命中） */
  headStatuses?: number[];
  /** archive GET：相对 target 的 tar 条目（目录）或单文件（文件请求） */
  topTar?: T[];
  memoryTar?: T[];
  fileTar?: T[];
  /** true=个别 daemon 形态：目录 archive 直接返回相对名（无根前缀） */
  relativeNames?: boolean;
}
const fx: Fixtures = {};

function installFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string }) => {
      const u = url as string;
      const method = (init?.method ?? 'GET').toUpperCase();
      const json = (status: number, body?: unknown) =>
        ({ ok: status < 400, status, arrayBuffer: async () => new ArrayBuffer(0), json: async () => body }) as unknown as Response;
      const tar = (status: number, b: Buffer) =>
        ({ ok: status < 400, status, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }) as unknown as Response;

      if (u.endsWith('/containers/agentteams-worker-w1/json')) {
        return json(fx.inspectStatus ?? 200);
      }
      if (u.includes('/archive?path=')) {
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

function call(sub: string, query = '', name = 'w1') {
  const url = `http://localhost/api/agentteams/workers/${encodeURIComponent(name)}/workspace-files/${sub}${query}`;
  return GET(new NextRequest(url, { method: 'GET' }), {
    params: Promise.resolve({ name, sub }),
  });
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
    Object.keys(fx).forEach((k) => delete fx[k]);
    fx.topTar = TOP_TAR;
    fx.memoryTar = MEMORY_TAR;
    __resetKbCacheForTests();
    installFetch();
  });
  afterEach(() => vi.unstubAllGlobals());

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

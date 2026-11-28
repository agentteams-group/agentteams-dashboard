import { Readable } from 'node:stream';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// 真实 RBAC 引擎（enforceServerSideRbac 不 mock），只替换 IO 边界：
// minio-client 与 audit-log。验证路由 + server-auth + rbac-engine 的
// 端到端门控行为（SEC-01/02/03 统一验收）。
const { listObjects, statObject, getObject } = vi.hoisted(() => ({
  listObjects: vi.fn(),
  statObject: vi.fn(),
  getObject: vi.fn(),
}));

vi.mock('@/lib/minio-client', () => ({
  createMinioClient: () => ({ listObjects, statObject, getObject }),
  getMinioBucket: () => 'agentteams-fs',
}));

const appendAudit = vi.hoisted(() => vi.fn());
vi.mock('@/lib/audit-log', () => ({ appendAuditEvent: appendAudit }));

const {
  SERVER_USER_HEADER,
  SERVER_USER_LEVEL_HEADER,
  SERVER_USER_TEAMS_HEADER,
  SERVER_USER_WORKERS_HEADER,
  SERVER_USER_SCOPE_HEADER,
} = await import('@/lib/server-auth');

type Identity = {
  level: number;
  teams?: string[];
  workers?: string[];
  scope: 'global' | 'scoped' | 'unknown';
};

function request(url: string, identity?: Identity): NextRequest {
  const headers: Record<string, string> = {};
  if (identity) {
    headers[SERVER_USER_HEADER] = `user-${identity.level}`;
    headers[SERVER_USER_LEVEL_HEADER] = String(identity.level);
    headers[SERVER_USER_SCOPE_HEADER] = identity.scope;
    if (identity.teams !== undefined) headers[SERVER_USER_TEAMS_HEADER] = JSON.stringify(identity.teams);
    if (identity.workers !== undefined) headers[SERVER_USER_WORKERS_HEADER] = JSON.stringify(identity.workers);
  }
  return new NextRequest(url, { headers });
}

const scopedObserver = (teams: string[] = ['t1']): Identity => ({ level: 1, teams, scope: 'scoped' });
const globalAdmin = (): Identity => ({ level: 3, scope: 'global' });

function makeListStream(items: Array<Record<string, unknown>>) {
  return {
    on: vi.fn(function on(this: unknown, event: string, cb: (..._args: unknown[]) => void) {
      if (event === 'data') {
        for (const item of items) setImmediate(() => cb(item));
      }
      if (event === 'end') setImmediate(() => cb());
      return this;
    }),
  } as never;
}

async function listFiles(name: string, identity?: Identity) {
  const { GET } = await import('./route');
  return GET(request('http://localhost/', identity), { params: Promise.resolve({ name }) });
}

async function download(name: string, key: string, identity?: Identity) {
  const { GET } = await import('./download/route');
  return GET(request(`http://localhost/?key=${encodeURIComponent(key)}`, identity), {
    params: Promise.resolve({ name }),
  });
}

describe('teams files 读路由 × 真实 RBAC 引擎（SEC-03 端到端）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('level 1 观察者（view 权限）可列出 team 文件', async () => {
    listObjects.mockImplementation(() =>
      makeListStream([{ name: 'teams/t1/shared/README.md', size: 5 }]),
    );
    const res = await listFiles('t1', scopedObserver());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.objects).toHaveLength(1);
  });

  it('level 3 管理员可列出 team 文件', async () => {
    const res = await listFiles('t1', globalAdmin());
    expect(res.status).toBe(200);
  });

  it('level 1 可下载非敏感文件', async () => {
    statObject.mockResolvedValue({ metaData: {}, size: 5 });
    getObject.mockResolvedValue(new Readable());
    const res = await download('t1', 'teams/t1/shared/README.md', scopedObserver());
    expect(res.status).toBe(200);
    expect(appendAudit).not.toHaveBeenCalled();
  });

  it('level 1 下载敏感文件 → 404，不触发审计（过滤先于存在性）', async () => {
    const res = await download('t1', 'teams/t1/shared/credentials.yaml', scopedObserver());
    expect(res.status).toBe(404);
    expect(statObject).not.toHaveBeenCalled();
  });

  it('level 1 下载 .ssh 嵌套敏感文件 → 404', async () => {
    const res = await download('t1', 'teams/t1/home/.ssh/id_rsa', scopedObserver());
    expect(res.status).toBe(404);
  });

  it('无身份头（middleware 之外）拒绝 list 和 download', async () => {
    expect((await listFiles('t1')).status).toBe(401);
    expect((await download('t1', 'teams/t1/shared/README.md')).status).toBe(401);
    expect(listObjects).not.toHaveBeenCalled();
    expect(statObject).not.toHaveBeenCalled();
  });

  it.each<[string, Identity]>([
    ['未知范围', { level: 1, scope: 'unknown' } as Identity],
    ['空范围', scopedObserver([])],
    ['跨团队范围', scopedObserver(['t2'])],
  ])('%s在读取存储前拒绝', async (_label, identity) => {
    expect((await listFiles('t1', identity)).status).toBe(403);
    expect((await download('t1', 'teams/t1/shared/README.md', identity)).status).toBe(403);
    expect(listObjects).not.toHaveBeenCalled();
    expect(statObject).not.toHaveBeenCalled();
    expect(getObject).not.toHaveBeenCalled();
    expect(appendAudit).toHaveBeenCalled();
  });

  it('范围外敏感文件先返回 403，不泄露文件是否存在', async () => {
    const res = await download('t1', 'teams/t1/shared/credentials.yaml', scopedObserver(['t2']));
    expect(res.status).toBe(403);
    expect(statObject).not.toHaveBeenCalled();
    expect(getObject).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { Readable } from 'node:stream';

// --- Mock minio-client ---
const mockStatObject = vi.fn();
const mockGetObject = vi.fn();
const mockPresignedGetObject = vi.fn();
const mockPresignedPutObject = vi.fn();
const mockListBuckets = vi.fn();

vi.mock('@/lib/minio-client', () => ({
  createMinioClient: () => ({
    statObject: mockStatObject,
    getObject: mockGetObject,
    presignedGetObject: mockPresignedGetObject,
    presignedPutObject: mockPresignedPutObject,
    listBuckets: mockListBuckets,
    listObjects: mockListObjects,
    putObject: vi.fn().mockResolvedValue(undefined),
    bucketExists: vi.fn().mockResolvedValue(true),
  }),
  getMinioBucket: () => 'agentteams-fs',
}));

function makeNodeStream(data: Buffer) {
  const s = new Readable({ read() {} });
  process.nextTick(() => {
    s.push(data);
    s.push(null);
  });
  return s;
}

// --- Mock listObjects（objects 路由用流式接口） ---
const mockListObjects = vi.fn();

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

// --- Mock audit-log（RBAC 拒绝时写审计） ---
const mockAppendAudit = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/audit-log', () => ({
  appendAuditEvent: mockAppendAudit,
}));

// Import after mocking
const downloadMod = () => import('./download/route');
const presignMod = () => import('./presign/route');
const bucketsMod = () => import('./buckets/route');
const objectsMod = () => import('./buckets/[bucket]/objects/route');

const { SERVER_USER_HEADER, SERVER_USER_LEVEL_HEADER } = await import('@/lib/server-auth');

function buildRequest(url: string, level?: number, body?: unknown): NextRequest {
  const headers: Record<string, string> = {};
  if (level !== undefined) {
    headers[SERVER_USER_HEADER] = `user-${level}`;
    headers[SERVER_USER_LEVEL_HEADER] = String(level);
  }
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    headers,
  });
}

describe('storage read routes RBAC + sensitive-file filtering (SEC-02)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockStatObject.mockResolvedValue({
      size: 10,
      metaData: { 'content-type': 'text/plain' },
    });
    mockGetObject.mockImplementation((_bucket: string, _key: string) =>
      Promise.resolve(makeNodeStream(Buffer.from('file-content'))),
    );
    mockPresignedGetObject.mockResolvedValue('https://minio.local/signed-url');
    mockPresignedPutObject.mockResolvedValue('https://minio.local/signed-url');
    mockListBuckets.mockResolvedValue([{ name: 'agentteams-fs' }]);
    mockListObjects.mockImplementation(() => makeListStream([]));
  });

  describe('GET /api/agentteams/storage/download', () => {
    it('level 1 观察者会话可下载普通文件（view 门放行）', async () => {
      const { GET } = await downloadMod();
      const res = await GET(
        buildRequest(
          'http://localhost/api/agentteams/storage/download?bucket=agentteams-fs&key=workers%2Fdemo%2FREADME.md',
          1,
        ),
      );
      expect(res.status).toBe(200);
      expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
    });

    it('level 3 管理员会话同样可下载普通文件', async () => {
      const { GET } = await downloadMod();
      const res = await GET(
        buildRequest(
          'http://localhost/api/agentteams/storage/download?bucket=agentteams-fs&key=workers%2Fdemo%2FREADME.md',
          3,
        ),
      );
      expect(res.status).toBe(200);
    });

    it('敏感文件（credentials.yaml）统一返回 404，不暴露存在性', async () => {
      const { GET } = await downloadMod();
      const res = await GET(
        buildRequest(
          'http://localhost/api/agentteams/storage/download?bucket=agentteams-fs&key=workers%2Fdemo%2Fcredentials.yaml',
          1,
        ),
      );
      expect(res.status).toBe(404);
      expect(mockGetObject).not.toHaveBeenCalled();
    });

    it('credentials/ 目录下文件同样返回 404', async () => {
      const { GET } = await downloadMod();
      const res = await GET(
        buildRequest(
          'http://localhost/api/agentteams/storage/download?bucket=agentteams-fs&key=teams%2Ft1%2Fcredentials%2Fapi-key.txt',
          3,
        ),
      );
      expect(res.status).toBe(404);
      expect(mockGetObject).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/agentteams/storage/presign', () => {
    it('普通对象签发预签名 URL', async () => {
      const { GET } = await presignMod();
      const res = await GET(
        buildRequest(
          'http://localhost/api/agentteams/storage/presign?bucket=agentteams-fs&key=workers%2Fdemo%2FREADME.md',
          1,
        ),
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.url).toBe('https://minio.local/signed-url');
    });

    it('敏感文件不签发预签名 URL（404）', async () => {
      const { GET } = await presignMod();
      const res = await GET(
        buildRequest(
          'http://localhost/api/agentteams/storage/presign?bucket=agentteams-fs&key=workers%2Fdemo%2F.openclaw%2Fopenclaw.json',
          3,
        ),
      );
      expect(res.status).toBe(404);
      expect(mockPresignedGetObject).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/agentteams/storage/presign', () => {
    it('level 1 观察者会话无写入预签名权限（create 门拒绝 → 403）', async () => {
      const { POST } = await presignMod();
      const res = await POST(
        buildRequest('http://localhost/api/agentteams/storage/presign', 1, {
          bucket: 'agentteams-fs',
          key: 'workers/demo/README.md',
        }),
      );
      expect(res.status).toBe(403);
      expect(mockPresignedPutObject).not.toHaveBeenCalled();
    });

    it('level 1 身份把 bucket/key 放在 query 上同样被拒（create 门先于参数解析 → 403）', async () => {
      const { POST } = await presignMod();
      const res = await POST(
        buildRequest(
          'http://localhost/api/agentteams/storage/presign?bucket=agentteams-fs&key=workers%2Fdemo%2FREADME.md',
          1,
          {},
        ),
      );
      expect(res.status).toBe(403);
      expect(mockPresignedPutObject).not.toHaveBeenCalled();
    });

    it('level 3 管理员会话可获取写 URL（返回 url，使用解码后的 bucket/key）', async () => {
      const { POST } = await presignMod();
      const res = await POST(
        buildRequest('http://localhost/api/agentteams/storage/presign', 3, {
          bucket: 'agentteams-fs',
          key: 'workers%2Fdemo%2FREADME.md',
        }),
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.url).toBe('https://minio.local/signed-url');
      expect(mockPresignedPutObject).toHaveBeenCalledWith(
        'agentteams-fs',
        'workers/demo/README.md',
        15 * 60,
      );
    });

    it('敏感文件（credentials.yaml）不签发写 URL（统一 404）', async () => {
      const { POST } = await presignMod();
      const res = await POST(
        buildRequest('http://localhost/api/agentteams/storage/presign', 3, {
          bucket: 'agentteams-fs',
          key: 'workers%2Fdemo%2Fcredentials.yaml',
        }),
      );
      expect(res.status).toBe(404);
      expect(mockPresignedPutObject).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/agentteams/storage/buckets', () => {
    it('level 1 会话可列出 bucket（view 门放行）', async () => {
      const { GET } = await bucketsMod();
      const res = await GET(buildRequest('http://localhost/api/agentteams/storage/buckets', 1));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.buckets).toEqual([{ name: 'agentteams-fs' }]);
    });
  });

  describe('GET /api/agentteams/storage/buckets/[bucket]/objects', () => {
    it('列出普通对象', async () => {
      mockListObjects.mockImplementation(() =>
        makeListStream([
          { name: 'workers/demo/README.md', size: 12 },
          { prefix: 'workers/demo/' },
        ]),
      );
      const { GET } = await objectsMod();
      const res = await GET(
        buildRequest('http://localhost/api/agentteams/storage/buckets/agentteams-fs/objects', 1),
        { params: Promise.resolve({ bucket: 'agentteams-fs' }) },
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.objects).toEqual([
        { key: 'workers/demo/README.md', size: 12, isPrefix: undefined },
        { key: 'workers/demo/', size: 0, isPrefix: true },
      ]);
    });

    it('敏感对象不进列表（不暴露存在性）', async () => {
      mockListObjects.mockImplementation(() =>
        makeListStream([
          { name: 'workers/demo/README.md', size: 12 },
          { name: 'workers/demo/credentials.yaml', size: 100 },
          { name: 'workers/demo/.ssh/id_rsa', size: 50 },
        ]),
      );
      const { GET } = await objectsMod();
      const res = await GET(
        buildRequest('http://localhost/api/agentteams/storage/buckets/agentteams-fs/objects', 1),
        { params: Promise.resolve({ bucket: 'agentteams-fs' }) },
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.objects).toHaveLength(1);
      expect(json.objects[0].key).toBe('workers/demo/README.md');
      expect(JSON.stringify(json)).not.toContain('credentials.yaml');
      expect(JSON.stringify(json)).not.toContain('id_rsa');
    });
  });
});

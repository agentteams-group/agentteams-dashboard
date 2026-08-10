import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

let fetchMock: ReturnType<typeof vi.fn>;
let originalFetch: typeof fetch;

vi.mock('@/lib/skill-center-config', () => ({
  getNacosConfig: vi.fn().mockResolvedValue({
    registryUrl: 'nacos://nacos.example.com:8848/public',
    protocol: 'https',
  }),
}));

vi.mock('@/lib/nacos-fetcher', () => ({
  getNacosAccessToken: vi.fn().mockResolvedValue('token-xyz'),
}));

function makeRequest(name: string | null, version: string | null) {
  const params = new URLSearchParams();
  if (name !== null) params.set('name', name);
  if (version !== null) params.set('version', version);
  return new NextRequest(
    `http://localhost/api/agentteams/agentspecs/nacos/detail?${params.toString()}`,
    { method: 'GET' },
  );
}

function mockAgentspecVersionResponse(specName: string, version: string) {
  return {
    code: 0,
    message: 'success',
    data: {
      namespaceId: 'public',
      name: specName,
      description: '知识库管家',
      from: 'github.com/example/repo',
      content: JSON.stringify({
        version: '1.0',
        source: { repository: 'https://github.com/example/repo', openclaw_mode: true },
        description: '知识库管家',
        worker: { suggested_name: specName, base_image: 'hiclaw/worker-agent:latest' },
      }),
      resource: {
        config_SOUL__md: {
          name: 'SOUL.md',
          type: 'config',
          content: '## 你的身份\n结构优先',
          metadata: {},
          resourceIdentifier: 'config::SOUL.md',
        },
      },
    },
  };
}

describe('GET /api/agentteams/agentspecs/nacos/detail', () => {
  beforeEach(() => {
    fetchMock = vi.fn();
    originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns 400 when name or version is missing', async () => {
    const r1 = await GET(makeRequest(null, '0.0.1'));
    expect(r1.status).toBe(400);
    const r2 = await GET(makeRequest('zk-steward', null));
    expect(r2.status).toBe(400);
  });

  it('returns 400 for invalid name characters', async () => {
    const r = await GET(makeRequest('bad/name', '0.0.1'));
    expect(r.status).toBe(400);
  });

  it('returns mapped fields on success', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockAgentspecVersionResponse('zk-steward', '0.0.1'),
    });

    const r = await GET(makeRequest('zk-steward', '0.0.1'));
    const body = await r.json();
    expect(r.status).toBe(200);
    expect(body.name).toBe('zk-steward');
    expect(body.image).toBe('hiclaw/worker-agent:latest');
    expect(body.runtime).toBe('openclaw');
    expect(body.soul).toContain('结构优先');
    expect(body.version).toBe('0.0.1');
    expect(body.from).toBe('github.com/example/repo');
  });

  it('returns 502 when the Nacos API is unreachable', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'boom',
    });

    const r = await GET(makeRequest('zk-steward', '0.0.1'));
    expect(r.status).toBe(502);
  });
});

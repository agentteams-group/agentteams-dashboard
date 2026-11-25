// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { GET } from './route';

let server: Server;
let sglangUrl: string;
let configDir: string;
const receivedPaths: string[] = [];
const receivedAuth: Array<string | undefined> = [];
let response: { status: number; body: string } = {
  status: 200,
  body: JSON.stringify({
    data: [
      { id: 'qwen3.6-27b-fp8', object: 'model' },
      { id: 'qwen3.6-27b-fp8', object: 'model' },
      'raw-string-model',
      { object: 'model' },
      { id: '', object: 'model' },
    ],
  }),
};

beforeAll(async () => {
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sglang-route-'));
  server = createServer((req, res) => {
    receivedPaths.push(req.url ?? '');
    receivedAuth.push(req.headers.authorization);
    res.writeHead(response.status, { 'content-type': 'application/json' });
    res.end(response.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no server address');
  sglangUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(configDir, { recursive: true, force: true });
});

afterEach(() => {
  receivedPaths.length = 0;
  receivedAuth.length = 0;
  response = { status: 200, body: '{}' };
  const file = path.join(configDir, 'config.json');
  if (fs.existsSync(file)) fs.rmSync(file);
  vi.unstubAllEnvs();
});

/** 写一份 setup 页保存的配置（逐地址凭据）并指过去。 */
function writeBackendConfig(backends: Record<string, unknown>): void {
  const file = path.join(configDir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, backends }));
  vi.stubEnv('DASHBOARD_CONFIG_FILE', file);
}

function makeRequest() {
  return new NextRequest('http://localhost/api/agentteams/sglang-models');
}

describe('GET /api/agentteams/sglang-models', () => {
  it('returns disabled and empty when AGENTTEAMS_SGLANG_URL is unset', async () => {
    delete process.env.AGENTTEAMS_SGLANG_URL;

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false, models: [] });
    expect(receivedPaths).toHaveLength(0);
  });

  it('lists served models on /v1/models, deduped and tolerant to mixed entry shapes', async () => {
    response = {
      status: 200,
      body: JSON.stringify({
        data: [
          { id: 'qwen3.6-27b-fp8', object: 'model' },
          { id: 'qwen3.6-27b-fp8', object: 'model' },
          'raw-string-model',
          { object: 'model' },
          { id: '', object: 'model' },
        ],
      }),
    };
    vi.stubEnv('AGENTTEAMS_SGLANG_URL', sglangUrl);

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    expect(receivedPaths).toEqual(['/v1/models']);
    expect(await res.json()).toEqual({
      enabled: true,
      models: ['qwen3.6-27b-fp8', 'raw-string-model'],
    });
  });

  it('accepts a base URL that already ends in /v1 (no /v1/v1 doubling)', async () => {
    response.body = JSON.stringify({ data: [{ id: 'a-model' }] });
    vi.stubEnv('AGENTTEAMS_SGLANG_URL', `${sglangUrl}/v1/`);

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    expect(receivedPaths).toEqual(['/v1/models']);
    expect(await res.json()).toEqual({ enabled: true, models: ['a-model'] });
  });

  it('maps a non-2xx SGLang answer to 502 with an empty list', async () => {
    response = { status: 500, body: '{"error":"boom"}' };
    vi.stubEnv('AGENTTEAMS_SGLANG_URL', sglangUrl);

    const res = await GET(makeRequest());

    expect(res.status).toBe(502);
    const body = (await res.json()) as { enabled: boolean; models: string[]; error: string };
    expect(body.enabled).toBe(true);
    expect(body.models).toEqual([]);
    expect(body.error).toContain('500');
  });

  it('tolerates a malformed SGLang body with an empty list', async () => {
    response = { status: 200, body: 'this is not json' };
    vi.stubEnv('AGENTTEAMS_SGLANG_URL', sglangUrl);

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: true, models: [] });
  });

  it('maps an unreachable SGLang to 503 with an empty list', async () => {
    vi.stubEnv('AGENTTEAMS_SGLANG_URL', 'http://127.0.0.1:1');

    const res = await GET(makeRequest());

    expect(res.status).toBe(503);
    const body = (await res.json()) as { enabled: boolean; models: string[]; error: string };
    expect(body.enabled).toBe(true);
    expect(body.models).toEqual([]);
    expect(body.error).toBeTruthy();
  });
});

describe('GET /api/agentteams/sglang-models: per-address auth', () => {
  it('sends the saved Bearer token to the configured sglang address', async () => {
    response.body = JSON.stringify({ data: [{ id: 'm1' }] });
    // 地址只来自配置（env 为空）：证明配置地址确实被采用，且凭据随之命中。
    vi.stubEnv('AGENTTEAMS_SGLANG_URL', '');
    writeBackendConfig({
      sglang: {
        internal: {
          url: sglangUrl,
          auth: { type: 'bearer', token: 'sglang-tok' },
        },
      },
    });

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: true, models: ['m1'] });
    expect(receivedPaths).toEqual(['/v1/models']);
    expect(receivedAuth).toEqual(['Bearer sglang-tok']);
  });

  it('sends no Authorization header when the address has no stored credential', async () => {
    response.body = JSON.stringify({ data: [{ id: 'm1' }] });
    vi.stubEnv('AGENTTEAMS_SGLANG_URL', sglangUrl);

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    expect(receivedPaths).toEqual(['/v1/models']);
    // 未配置覆盖凭据 → 空头（服务自身认证不加任何 Authorization）。
    expect(receivedAuth).toEqual([undefined]);
  });

  it('does not leak a credential to an address it was not saved for', async () => {
    response.body = JSON.stringify({ data: [] });
    vi.stubEnv('AGENTTEAMS_SGLANG_URL', sglangUrl);
    writeBackendConfig({
      sglang: {
        internal: {
          url: 'http://other-sglang.test:30000',
          auth: { type: 'bearer', token: 'secret-for-other' },
        },
      },
    });

    const res = await GET(makeRequest());

    // 配置地址优先 → 探测别的地址（不可达），关键断言：凭据没有发出去。
    expect(res.status).toBe(503);
    expect(receivedAuth).toEqual([]);
  });
});

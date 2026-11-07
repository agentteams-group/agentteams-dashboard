// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { BACKEND_NAMES, effectiveUrl, forgetWorking } from '@/lib/backend-config';
import { __resetBackendUrlResolutionForTests } from '@/lib/backend-url-resolve';
import { POST } from './route';

let workDir: string;
let server: Server;
let goodUrl: string;

const configFile = () => path.join(workDir, 'config.json');

beforeAll(async () => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backends-test-'));
  server = createServer((_req, res) => {
    serverHits += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const a = server.address();
  if (!a || typeof a === 'string') throw new Error('no server');
  goodUrl = `http://127.0.0.1:${a.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(workDir, { recursive: true, force: true });
});

let serverHits = 0;

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('DASHBOARD_CONFIG_FILE', configFile());
  // PR-91 review (Block 2): the probe is token-gated pre-login — these
  // tests exercise the probe semantics, so a valid env token is available.
  vi.stubEnv('DASHBOARD_SETUP_TOKEN', 'test-token-123');
  vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', '');
  vi.stubEnv('AGENTTEAMS_SGLANG_URL', '');
  serverHits = 0;
  __resetBackendUrlResolutionForTests();
  for (const name of BACKEND_NAMES) forgetWorking(name);
});

afterEach(() => {
  if (fs.existsSync(configFile())) fs.rmSync(configFile());
  vi.unstubAllEnvs();
});

function post(body: unknown): NextRequest {
  const payload =
    body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  // PR-91 review: carry the setup token — the pre-login door to the probe.
  return new NextRequest('http://localhost/api/agentteams/setup/backends/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'test-token-123', ...payload }),
  });
}

/** Raw request WITHOUT the token — for the gate tests themselves. */
function postRaw(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/agentteams/setup/backends/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

interface TestResponse {
  ok: boolean;
  results: Record<
    string,
    Array<{ url: string; ok: boolean; httpOk: boolean; ms: number | null; detail: string; resolvedFrom?: string }>
  >;
  effective: Record<string, string>;
  applied: boolean;
  switched: Record<string, boolean>;
}

describe('POST /api/agentteams/setup/backends/test (F1c plugin config_test semantics)', () => {
  it('a draft test returns rows but NEVER touches the effective cache (applied=false)', async () => {
    fs.writeFileSync(
      configFile(),
      JSON.stringify({ version: 1, backends: { controller: { internal: 'http://127.0.0.1:1' } } }),
    );
    const res = await POST(post({ backends: { controller: { internal: goodUrl } } }));
    const data = (await res.json()) as TestResponse;
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.results.controller[0].httpOk).toBe(true);
    expect(data.applied).toBe(false);
    expect(data.effective.controller).toBeUndefined();
    expect(effectiveUrl('controller')).toBeNull();
  });

  it('testing the saved list applies the election (draft == saved)', async () => {
    fs.writeFileSync(
      configFile(),
      JSON.stringify({
        version: 1,
        backends: { controller: { internal: 'http://127.0.0.1:1', external: goodUrl } },
      }),
    );
    const res = await POST(
      post({ backends: { controller: { internal: 'http://127.0.0.1:1', external: goodUrl } } }),
    );
    const data = (await res.json()) as TestResponse;
    expect(data.applied).toBe(true);
    expect(data.effective.controller).toBe(goodUrl);
    expect(effectiveUrl('controller')).toBe(goodUrl);
  });

  it('a failed test never clears the existing effective address', async () => {
    fs.writeFileSync(
      configFile(),
      JSON.stringify({ version: 1, backends: { controller: { internal: goodUrl } } }),
    );
    // first: test the saved list → effective cache is elected from a real probe
    await POST(post({ backends: { controller: { internal: goodUrl } } }));
    expect(effectiveUrl('controller')).toBe(goodUrl);

    // now test a draft pointing at a dead address — applied=false, cache untouched
    const res = await POST(post({ backends: { controller: { internal: 'http://127.0.0.1:1' } } }));
    const data = (await res.json()) as TestResponse;
    expect(data.results.controller[0].ok).toBe(false);
    expect(effectiveUrl('controller')).toBe(goodUrl);
  });

  it('no body → tests the currently configured candidates', async () => {
    fs.writeFileSync(
      configFile(),
      JSON.stringify({ version: 1, backends: { sglang: { internal: goodUrl } } }),
    );
    const res = await POST(post({}));
    const data = (await res.json()) as TestResponse;
    expect(res.status).toBe(200);
    expect(data.results.sglang).toHaveLength(1);
    expect(data.results.sglang[0].url).toBe(goodUrl);
  });

  it('rejects disallowed hosts (SSRF filter) with 403', async () => {
    vi.stubEnv('DASHBOARD_ALLOWED_HOSTS', 'allowed.example.com');
    const res = await POST(post({ backends: { controller: { internal: 'http://evil.example.com:8090' } } }));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('host-not-allowed');
  });

  it('rejects an invalid body with 400', async () => {
    const res = await POST(
      new NextRequest('http://localhost/api/agentteams/setup/backends/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"backends":"nope"}',
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe('无协议草稿地址（host:port）：测试前解析协议', () => {
  it('https 不通 → 回退 http 探测，行里带解析后的 url 与 resolvedFrom', async () => {
    const bare = goodUrl.replace(/^http:\/\//, '');
    const res = await POST(post({ backends: { controller: { internal: bare } } }));
    const data = (await res.json()) as TestResponse;
    expect(res.status).toBe(200);
    expect(data.results.controller).toHaveLength(1);
    expect(data.results.controller[0].url).toBe(goodUrl);
    expect(data.results.controller[0].resolvedFrom).toBe(bare);
    expect(data.results.controller[0].httpOk).toBe(true);
  });

  it('显式地址不带 resolvedFrom（原样采用，不探测）', async () => {
    const res = await POST(post({ backends: { controller: { internal: goodUrl } } }));
    const data = (await res.json()) as TestResponse;
    expect(data.results.controller[0].url).toBe(goodUrl);
    expect(data.results.controller[0].resolvedFrom).toBeUndefined();
  });

  it('无协议草稿也先过 SSRF 过滤（解析阶段会发请求，不能等到探测后）', async () => {
    const res = await POST(post({ backends: { controller: { internal: '169.254.169.254:80' } } }));
    expect(res.status).toBe(403);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe('host-not-allowed');
    expect(serverHits).toBe(0);
  });
});

describe('PR-91 review (Block 2): the probe is no longer unauthenticated', () => {
  it('pre-login probe without a token → 403 token-required, nothing probed', async () => {
    fs.writeFileSync(
      configFile(),
      JSON.stringify({ version: 1, backends: { controller: { internal: goodUrl } } }),
    );
    const res = await POST(postRaw({ backends: { controller: { internal: goodUrl } } }));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('token-required');
    expect(serverHits).toBe(0); // gate fires before any network I/O
  });

  it('pre-login probe with a wrong token → 403 invalid-token, nothing probed', async () => {
    const res = await POST(
      postRaw({ token: 'wrong-token', backends: { controller: { internal: goodUrl } } }),
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('invalid-token');
    expect(serverHits).toBe(0);
  });

  it('pre-login probe with the setup token works (same door as the config write)', async () => {
    fs.writeFileSync(
      configFile(),
      JSON.stringify({ version: 1, backends: { controller: { internal: goodUrl } } }),
    );
    const res = await POST(
      postRaw({ token: 'test-token-123', backends: { controller: { internal: goodUrl } } }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    expect(serverHits).toBeGreaterThan(0);
  });

  it('ENFORCE=0: pre-login probe without a token works (installer opt-out, trusted-LAN)', async () => {
    vi.stubEnv('DASHBOARD_SETUP_TOKEN_ENFORCE', '0');
    fs.writeFileSync(
      configFile(),
      JSON.stringify({ version: 1, backends: { controller: { internal: goodUrl } } }),
    );
    const res = await POST(postRaw({ backends: { controller: { internal: goodUrl } } }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });
});

describe('isTestTargetAllowed SSRF filter (PR-91 review)', () => {
  it('denies the cloud metadata sentinel in all modes', async () => {
    const { isTestTargetAllowed } = await import('@/lib/backend-config');
    vi.unstubAllEnvs();
    expect(isTestTargetAllowed('http://169.254.169.254/latest/meta-data/')).toBe(false);
    vi.stubEnv('DASHBOARD_ALLOWED_HOSTS', '169.254.169.254');
    expect(isTestTargetAllowed('http://169.254.169.254/latest/meta-data/')).toBe(false);
  });

  it('empty allowlist = allow for the (now gated) caller; loopback fine', async () => {
    const { isTestTargetAllowed } = await import('@/lib/backend-config');
    vi.unstubAllEnvs();
    expect(isTestTargetAllowed('http://127.0.0.1:8090')).toBe(true);
    expect(isTestTargetAllowed('http://192.168.1.107:8090')).toBe(true);
  });

  it('a set allowlist stays strict', async () => {
    const { isTestTargetAllowed } = await import('@/lib/backend-config');
    vi.unstubAllEnvs();
    vi.stubEnv('DASHBOARD_ALLOWED_HOSTS', 'allowed.example.com');
    expect(isTestTargetAllowed('http://allowed.example.com:8090')).toBe(true);
    expect(isTestTargetAllowed('http://evil.example.com:8090')).toBe(false);
  });
});

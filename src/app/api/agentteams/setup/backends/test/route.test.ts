// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { promises as dns } from 'node:dns';
import { BACKEND_NAMES, effectiveUrl, forgetWorking } from '@/lib/backend-config';
import { __resetBackendUrlResolutionForTests } from '@/lib/backend-url-resolve';
import {
  __resetSessionStoreForTests,
  createSession,
  sessionCookieHeader,
} from '@/lib/dashboard-session';
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
  vi.stubEnv('DASHBOARD_SETUP_TOKEN', 'test-token-123');
  vi.stubEnv('DASHBOARD_SESSION_SECRET', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
  vi.stubEnv('DASHBOARD_ALLOWED_HOSTS', '127.0.0.1,localhost');
  vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', '');
  vi.stubEnv('AGENTTEAMS_SGLANG_URL', '');
  vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
  serverHits = 0;
  __resetSessionStoreForTests();
  __resetBackendUrlResolutionForTests();
  for (const name of BACKEND_NAMES) forgetWorking(name);
});

afterEach(() => {
  if (fs.existsSync(configFile())) fs.rmSync(configFile());
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function sessionCookie(crLevel: 1 | 2 | 3): string {
  const { cookieValue } = createSession({
    user: `level-${crLevel}`,
    crLevel,
    credential: { kind: 'matrix', token: 'dummy-matrix-token' },
  });
  return sessionCookieHeader(cookieValue);
}

function post(body: unknown, cookie = sessionCookie(1)): NextRequest {
  const payload =
    body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  return new NextRequest('http://localhost/api/agentteams/setup/backends/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ ...payload }),
  });
}

/** Raw request WITHOUT the token or session — for the gate tests themselves. */
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
      JSON.stringify({ version: 1, backends: { controller: { internal: goodUrl } } }),
    );
    const res = await POST(post({}));
    const data = (await res.json()) as TestResponse;
    expect(res.status).toBe(200);
    expect(data.results.controller).toHaveLength(1);
    expect(data.results.controller[0].url).toBe(goodUrl);
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

describe('草稿凭据参与探测（门后地址「测试」401 修复）', () => {
  /** 起一个本地目标服务器，记录每次请求的 Authorization 头。 */
  async function startCaptureServer() {
    const seen: Array<string | undefined> = [];
    const srv = createServer((req, res) => {
      seen.push(req.headers.authorization);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
    await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
    const addr = srv.address();
    if (!addr || typeof addr === 'string') throw new Error('no server');
    return {
      url: `http://127.0.0.1:${addr.port}`,
      seen,
      close: () => new Promise<void>((resolve) => srv.close(() => resolve())),
    };
  }

  const basic = (username: string, password: string) =>
    `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

  it('草稿 Basic 凭据进入发往目标服务器的 Authorization 头', async () => {
    const gate = await startCaptureServer();
    try {
      const res = await POST(
        post({
          backends: {
            controller: {
              internal: { url: gate.url, auth: { type: 'basic', username: 'ops', password: 's3cret' } },
            },
          },
        }),
      );
      const data = (await res.json()) as TestResponse;
      expect(res.status).toBe(200);
      expect(data.results.controller[0].url).toBe(gate.url);
      expect(data.results.controller[0].httpOk).toBe(true);
      expect(gate.seen).toContain(basic('ops', 's3cret'));
    } finally {
      await gate.close();
    }
  });

  it('草稿凭据覆盖已存凭据头（测试量的是表单草稿）', async () => {
    const gate = await startCaptureServer();
    fs.writeFileSync(
      configFile(),
      JSON.stringify({
        version: 1,
        backends: {
          controller: {
            internal: {
              url: gate.url,
              auth: { type: 'basic', username: 'ops', password: 'stored' },
            },
          },
        },
      }),
    );
    try {
      await POST(
        post({
          backends: {
            controller: {
              internal: { url: gate.url, auth: { type: 'basic', username: 'ops', password: 'fresh' } },
            },
          },
        }),
      );
      expect(gate.seen).toContain(basic('ops', 'fresh'));
      expect(gate.seen).not.toContain(basic('ops', 'stored'));
    } finally {
      await gate.close();
    }
  });

  it('Bearer 草稿凭据同样参与探测', async () => {
    const gate = await startCaptureServer();
    try {
      await POST(
        post({
          backends: {
            controller: { internal: { url: gate.url, auth: { type: 'bearer', token: 'api-key-1' } } },
          },
        }),
      );
      expect(gate.seen).toContain('Bearer api-key-1');
    } finally {
      await gate.close();
    }
  });

  it('*** 占位不当密码发送：无已存凭据时探测不带 Authorization', async () => {
    const gate = await startCaptureServer();
    try {
      const res = await POST(
        post({
          backends: {
            controller: {
              internal: { url: gate.url, auth: { type: 'basic', username: 'ops', password: '***' } },
            },
          },
        }),
      );
      expect(res.status).toBe(200);
      expect(gate.seen.length).toBeGreaterThan(0);
      expect(gate.seen.every((value) => value === undefined)).toBe(true);
    } finally {
      await gate.close();
    }
  });

  it('*** 占位回落到已存凭据（回显 = 保持不变）', async () => {
    const gate = await startCaptureServer();
    fs.writeFileSync(
      configFile(),
      JSON.stringify({
        version: 1,
        backends: {
          controller: {
            internal: {
              url: gate.url,
              auth: { type: 'basic', username: 'ops', password: 'stored' },
            },
          },
        },
      }),
    );
    try {
      await POST(
        post({
          backends: {
            controller: {
              internal: { url: gate.url, auth: { type: 'basic', username: 'ops', password: '***' } },
            },
          },
        }),
      );
      expect(gate.seen).toContain(basic('ops', 'stored'));
    } finally {
      await gate.close();
    }
  });

  it('*** 不跨 origin 继承：端口变化后不发旧凭据', async () => {
    const oldGate = await startCaptureServer();
    const newGate = await startCaptureServer();
    fs.writeFileSync(
      configFile(),
      JSON.stringify({
        version: 1,
        backends: {
          controller: {
            internal: {
              url: oldGate.url,
              auth: { type: 'basic', username: 'ops', password: 'stored' },
            },
          },
        },
      }),
    );
    try {
      const res = await POST(
        post({
          backends: {
            controller: {
              internal: { url: newGate.url, auth: { type: 'basic', username: 'ops', password: '***' } },
            },
          },
        }),
      );
      expect(res.status).toBe(200);
      expect(oldGate.seen).toEqual([]);
      expect(newGate.seen.length).toBeGreaterThan(0);
      expect(newGate.seen.every((value) => value === undefined)).toBe(true);
    } finally {
      await oldGate.close();
      await newGate.close();
    }
  });
});

describe('SEC-03: backend probes require Admin after first configuration', () => {
  it.each([3, 2])('dashboard level %s receives 403 before DNS or network activity', async (crLevel) => {
    fs.writeFileSync(
      configFile(),
      JSON.stringify({ version: 1, backends: { controller: { internal: goodUrl } } }),
    );
    vi.mocked(dns.lookup).mockClear();
    const res = await POST(
      post({ backends: { controller: { internal: goodUrl } } }, sessionCookie(crLevel as 1 | 2 | 3)),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: 'only admin (L1) may test backend config' });
    expect(dns.lookup).not.toHaveBeenCalled();
    expect(serverHits).toBe(0);
  });

  it('an existing config closes pre-login probes even with the setup token', async () => {
    fs.writeFileSync(
      configFile(),
      JSON.stringify({ version: 1, backends: { controller: { internal: goodUrl } } }),
    );
    const res = await POST(
      postRaw({ token: 'test-token-123', backends: { controller: { internal: goodUrl } } }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: 'admin-required' });
    expect(dns.lookup).not.toHaveBeenCalled();
    expect(serverHits).toBe(0);
  });

  it('first-config bootstrap still accepts the setup token', async () => {
    const res = await POST(
      postRaw({ token: 'test-token-123', backends: { controller: { internal: goodUrl } } }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    expect(serverHits).toBeGreaterThan(0);
  });

  it('ENFORCE=0: bootstrap works, but existing config still requires Admin', async () => {
    vi.stubEnv('DASHBOARD_SETUP_TOKEN_ENFORCE', '0');
    const bootstrap = await POST(postRaw({ backends: { controller: { internal: goodUrl } } }));
    expect(bootstrap.status).toBe(200);
    expect(serverHits).toBeGreaterThan(0);

    fs.writeFileSync(
      configFile(),
      JSON.stringify({ version: 1, backends: { controller: { internal: goodUrl } } }),
    );
    serverHits = 0;
    const res = await POST(postRaw({ backends: { controller: { internal: goodUrl } } }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: 'admin-required' });
    expect(serverHits).toBe(0);
  });

  it('rejects a metadata target before connecting', async () => {
    vi.mocked(dns.lookup).mockClear();
    const res = await POST(
      post({ backends: { controller: { internal: 'http://169.254.169.254/latest/meta-data' } } }),
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('host-not-allowed');
    expect(dns.lookup).not.toHaveBeenCalled();
    expect(serverHits).toBe(0);
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

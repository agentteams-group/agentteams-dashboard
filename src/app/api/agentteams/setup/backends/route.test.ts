// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { NextRequest } from 'next/server';
import {
  __resetSessionStoreForTests,
  createSession,
  sessionCookieHeader,
} from '@/lib/dashboard-session';
import {
  BACKEND_NAMES,
  forgetWorking,
  readConfigSync,
  type BackendName,
  type BackendProbeFn,
} from '@/lib/backend-config';
import { listAuditEvents, resetAuditLogForTests } from '@/lib/audit-log';
import { GET, POST } from './route';

// CI determinism (A1, 2026-09-28): probeBackend performs a real network
// probe with one 500ms-delayed retry, so a dropped (non-RST) address costs
// up to 2×timeout+500ms per candidate — refreshEffective's 4000ms default
// can take ~10.5s per saved backend, blowing vitest's 5000ms testTimeout on
// machines whose firewall drops instead of rejecting. A whole-module mock
// of probeBackend alone does NOT fix that: refreshEffective calls it via a
// module-internal binding the mock cannot intercept. So we use the
// BackendProbeFn seam — the REAL refreshEffective (candidate election,
// hysteresis) runs with an instant-unreachable probe and a 1ms budget
// injected, keeping this file's assertions network-independent and fast.
vi.mock('@/lib/backend-config', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/backend-config')>();
  const unreachableProbe: BackendProbeFn = async () => ({
    ok: false,
    httpOk: false,
    latencyMs: -1,
    error: 'probe disabled in tests (network-independent)',
  });
  return {
    ...original,
    // Route-level probes (GET embedded auto-detect).
    probeBackend: vi.fn(unreachableProbe),
    // Post-save re-probe: delegate to the real implementation through the
    // seam, decoupling the probe cost from vitest's 5s test timeout.
    refreshEffective: (names: BackendName[] = original.BACKEND_NAMES) =>
      original.refreshEffective(names, 1, unreachableProbe),
  };
});

let workDir: string;

function configFile() {
  return path.join(workDir, 'config.json');
}

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-backends-'));
});

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('DASHBOARD_CONFIG_FILE', configFile());
  vi.stubEnv('DASHBOARD_SETUP_TOKEN', 'test-token-123');
  // ≥64 hex chars (32+ bytes) — the session store fails closed below that.
  vi.stubEnv('DASHBOARD_SESSION_SECRET', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
  // No env-configured backends by default (standalone first-launch scenario).
  vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', '');
  vi.stubEnv('AGENTTEAMS_API_URL', '');
  vi.stubEnv('AGENTTEAMS_MATRIX_URL', '');
  vi.stubEnv('NEXT_PUBLIC_MATRIX_API_URL', '');
  __resetSessionStoreForTests();
  for (const name of BACKEND_NAMES) forgetWorking(name);
});

afterEach(() => {
  for (const file of [configFile(), path.join(workDir, '.setup-token')]) {
    if (fs.existsSync(file)) fs.rmSync(file);
  }
  vi.unstubAllEnvs();
});

function makeRequest(
  init?: { method?: string; body?: string },
  cookie?: string,
  url = 'http://localhost/api/agentteams/setup/backends',
) {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  return new NextRequest(url, { method: init?.method, headers, body: init?.body });
}

function l1Cookie(): string {
  const { cookieValue } = createSession({
    user: 'admin',
    crLevel: 1, // CRD 1 -> dashboard level 3 (L1 admin)
    credential: { kind: 'controller-token', token: 'dummy-sa-token' },
  });
  return sessionCookieHeader(cookieValue);
}

function l2Cookie(): string {
  const { cookieValue } = createSession({
    user: 'bob',
    crLevel: 2, // CRD 2 -> dashboard level 2 (own-scope L2)
    credential: { kind: 'matrix', token: 'dummy-matrix-token' },
  });
  return sessionCookieHeader(cookieValue);
}

describe('GET /api/agentteams/setup/backends', () => {
  it('reports unconfigured standalone state with embedded auto-detect results (token holder)', async () => {
    const res = await GET(
      makeRequest(undefined, undefined, 'http://localhost/api/agentteams/setup/backends?token=test-token-123'),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      configured: boolean;
      backends: Record<string, { configured: boolean; candidates: string[] }>;
      embedded: { healthy: Record<string, boolean> | null };
    };
    expect(data.configured).toBe(false);
    expect(data.backends.controller.configured).toBe(false);
    expect(data.backends.sglang.configured).toBe(false);
    // unconfigured -> embedded defaults were probed (all unreachable in tests)
    expect(data.embedded.healthy?.controller).toBe(false);
  });

  it('reports configured when env provides the required backends (token holder)', async () => {
    vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', 'http://ctl:8090');
    vi.stubEnv('AGENTTEAMS_MATRIX_URL', 'http://mx:6167');
    const res = await GET(
      makeRequest(undefined, undefined, 'http://localhost/api/agentteams/setup/backends?token=test-token-123'),
    );
    const data = (await res.json()) as {
      configured: boolean;
      backends: Record<string, { candidates: string[] }>;
      embedded: { healthy: Record<string, boolean> | null };
    };
    expect(data.configured).toBe(true);
    expect(data.backends.controller.candidates).toEqual(['http://ctl:8090']);
    // configured -> no embedded probe (zero latency cost)
    expect(data.embedded.healthy).toBeNull();
  });

  it('file config overrides and extends env candidates (token holder)', async () => {
    fs.writeFileSync(
      configFile(),
      JSON.stringify({ version: 1, backends: { controller: { internal: 'http://in:8090' } } }),
    );
    vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', 'http://env:8090');
    vi.stubEnv('AGENTTEAMS_MATRIX_URL', 'http://mx:6167');
    const res = await GET(
      makeRequest(undefined, undefined, 'http://localhost/api/agentteams/setup/backends?token=test-token-123'),
    );
    const data = (await res.json()) as {
      backends: Record<string, { candidates: string[] }>;
    };
    expect(data.backends.controller.candidates).toEqual(['http://in:8090', 'http://env:8090']);
    expect(readConfigSync()?.backends.controller).toEqual({ internal: 'http://in:8090' });
  });

  // PR-91 review (Block 1): the saved topology is NOT public pre-login.
  it('anonymous GET reveals no saved topology (PR-91 Block 1)', async () => {
    fs.writeFileSync(
      configFile(),
      JSON.stringify({
        version: 1,
        backends: { controller: { internal: 'http://in:8090', external: 'http://out:8090' } },
      }),
    );
    vi.stubEnv('AGENTTEAMS_MATRIX_URL', 'http://mx:6167');
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      configured: boolean;
      setupTokenRequired?: boolean;
      embedded?: unknown;
      backends?: unknown;
      config?: unknown;
      effective?: unknown;
    };
    // gate shape only — the root page's first-launch check needs these
    expect(data.configured).toBe(true);
    expect(data.setupTokenRequired).toBe(true);
    expect(data.embedded).toBeDefined();
    // no saved topology, no effective URLs, no structured config
    expect(data.backends).toBeUndefined();
    expect(data.config).toBeUndefined();
    expect(data.effective).toBeUndefined();
  });

  it('pre-login ?token= holder sees candidates + effective (setup page prefill)', async () => {
    fs.writeFileSync(
      configFile(),
      JSON.stringify({
        version: 1,
        backends: { controller: { internal: 'http://in:8090', external: 'http://out:8090' } },
      }),
    );
    vi.stubEnv('AGENTTEAMS_MATRIX_URL', 'http://mx:6167');
    const res = await GET(
      makeRequest(undefined, undefined, 'http://localhost/api/agentteams/setup/backends?token=test-token-123'),
    );
    const data = (await res.json()) as {
      backends?: Record<string, { candidates: string[] }>;
      effective?: Record<string, string>;
      config?: unknown;
    };
    expect(data.backends?.controller?.candidates).toEqual(['http://in:8090', 'http://out:8090']);
    // the effective working cache is part of the owner view
    expect(data.effective).toBeDefined();
    // the structured `config` field stays session-only
    expect(data.config).toBeUndefined();
  });

  it('a wrong ?token= gets the minimal shape (no topology)', async () => {
    fs.writeFileSync(
      configFile(),
      JSON.stringify({ version: 1, backends: { controller: { internal: 'http://in:8090' } } }),
    );
    const res = await GET(
      makeRequest(undefined, undefined, 'http://localhost/api/agentteams/setup/backends?token=wrong-token'),
    );
    const data = (await res.json()) as { backends?: unknown; effective?: unknown };
    expect(data.backends).toBeUndefined();
    expect(data.effective).toBeUndefined();
  });

  it('exposes the structured file config to L1 and L2 alike, never to pre-login', async () => {
    fs.writeFileSync(
      configFile(),
      JSON.stringify({
        version: 1,
        backends: { controller: { internal: 'http://in:8090', external: 'http://out:8090' } },
      }),
    );
    const expected = { controller: { internal: 'http://in:8090', external: 'http://out:8090' } };

    const l1 = await GET(makeRequest(undefined, l1Cookie()));
    expect(((await l1.json()) as { config?: unknown }).config).toEqual(expected);

    // L2 (standalone instance owner via the Matrix track) sees it too —
    // the backend tab is visible to all logged-in users.
    const l2 = await GET(makeRequest(undefined, l2Cookie()));
    expect(((await l2.json()) as { config?: unknown }).config).toEqual(expected);

    const anon = await GET(makeRequest());
    expect(((await anon.json()) as { config?: unknown }).config).toBeUndefined();
  });
});

describe('POST /api/agentteams/setup/backends', () => {
  it('rejects a pre-login write without a token (403 token-required)', async () => {
    const res = await POST(
      makeRequest({ method: 'POST', body: JSON.stringify({ backends: { controller: { internal: 'http://a:8090' } } }) }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'token-required' });
  });

  it('rejects a wrong token (403 invalid-token) and leaves no file', async () => {
    const res = await POST(
      makeRequest({ method: 'POST', body: JSON.stringify({ token: 'nope', backends: { controller: { internal: 'http://a:8090' } } }) }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'invalid-token' });
    expect(fs.existsSync(configFile())).toBe(false);
  });

  // F1e: pre-login writes are token-gated and REPEATABLE (broken/changed
  // environment escape hatch — plugin config-first parity). The one-shot
  // "already-configured" 403 is retired: after first launch the same
  // token overwrites the config.
  it('pre-login: first launch creates, later token writes overwrite (mode update)', async () => {
    const first = await POST(
      makeRequest({
        method: 'POST',
        body: JSON.stringify({
          token: 'test-token-123',
          backends: { controller: { internal: 'http://a:8090' }, matrix: { external: 'http://mx:6167' } },
        }),
      }),
    );
    expect(first.status).toBe(200);
    const firstData = (await first.json()) as { ok: boolean; mode: string };
    expect(firstData.ok).toBe(true);
    expect(firstData.mode).toBe('first-launch');
    expect(fs.existsSync(configFile())).toBe(true);

    const second = await POST(
      makeRequest({
        method: 'POST',
        body: JSON.stringify({
          token: 'test-token-123',
          backends: { controller: { internal: 'http://c:8090' } },
        }),
      }),
    );
    expect(second.status).toBe(200);
    const secondData = (await second.json()) as { ok: boolean; mode: string };
    expect(secondData.ok).toBe(true);
    expect(secondData.mode).toBe('update');
    // F1f-E merge semantics: the sent backend (controller) is replaced,
    // the unsent backend (matrix) is preserved.
    expect(readConfigSync()?.backends.controller).toEqual({ internal: 'http://c:8090' });
    expect(readConfigSync()?.backends.matrix).toEqual({ external: 'http://mx:6167' });

    // without the token the pre-login path stays closed
    const third = await POST(
      makeRequest({
        method: 'POST',
        body: JSON.stringify({ backends: { controller: { internal: 'http://x:8090' } } }),
      }),
    );
    expect(third.status).toBe(403);
    expect(await third.json()).toEqual({ error: 'token-required' });
  });

  it('rejects malformed payloads with 400', async () => {
    const cases = [
      JSON.stringify({ token: 'test-token-123', backends: { nope: { internal: 'http://a' } } }),
      JSON.stringify({ token: 'test-token-123', backends: { controller: { internal: 'ftp://a' } } }),
      JSON.stringify({ token: 'test-token-123', backends: {} }),
    ];
    for (const body of cases) {
      const res = await POST(makeRequest({ method: 'POST', body }));
      expect(res.status).toBe(400);
    }
    expect(fs.existsSync(configFile())).toBe(false);
  });

  it('L1 session (level 3) can update the config repeatedly, no token needed', async () => {
    const cookie = l1Cookie();
    const first = await POST(
      makeRequest({ method: 'POST', body: JSON.stringify({ backends: { controller: { internal: 'http://a:8090' } } }) }, cookie),
    );
    expect(first.status).toBe(200);
    const firstData = (await first.json()) as { ok: boolean; mode: string };
    expect(firstData.ok).toBe(true);
    expect(firstData.mode).toBe('update');

    const second = await POST(
      makeRequest({ method: 'POST', body: JSON.stringify({ backends: { matrix: { internal: 'http://b:6167' } } }) }, cookie),
    );
    expect(second.status).toBe(200);
    // F1f-E merge semantics: the sent backend (matrix) replaces its
    // entry; the unsent backend (controller) is preserved — a partial
    // save must never wipe the rest of the config.
    expect(readConfigSync()?.backends.controller).toEqual({ internal: 'http://a:8090' });
    expect(readConfigSync()?.backends.matrix).toEqual({ internal: 'http://b:6167' });
  });

  // F1c (plugin parity, decided 9/9 — one instance per user, no shared
  // instances): an L2 session saves WITHOUT any token, exactly like the
  // plugin's config page is open to the user of this host.
  it('L2 session (level 2) can update the config directly, no token needed', async () => {
    const res = await POST(
      makeRequest(
        { method: 'POST', body: JSON.stringify({ backends: { controller: { internal: 'http://a:8090' } } }) },
        l2Cookie(),
      ),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; mode: string };
    expect(data.ok).toBe(true);
    expect(data.mode).toBe('update');
    expect(readConfigSync()?.backends.controller).toEqual({ internal: 'http://a:8090' });

    // repeatable — not one-shot like pre-login
    const again = await POST(
      makeRequest(
        { method: 'POST', body: JSON.stringify({ backends: { sglang: { internal: 'http://gpu:8000' } } }) },
        l2Cookie(),
      ),
    );
    expect(again.status).toBe(200);
    expect(readConfigSync()?.backends.sglang).toEqual({ internal: 'http://gpu:8000' });
  });

  it('a stale token in the body is ignored for logged-in sessions (no owner-credential path anymore)', async () => {
    fs.writeFileSync(
      configFile(),
      JSON.stringify({ version: 1, backends: { controller: { internal: 'http://old:8090' } } }),
    );
    const res = await POST(
      makeRequest(
        { method: 'POST', body: JSON.stringify({ token: 'nope', backends: { controller: { internal: 'http://b:8090' } } }) },
        l2Cookie(),
      ),
    );
    expect(res.status).toBe(200);
    // the session (not the token) authorized the save
    expect(readConfigSync()?.backends.controller).toEqual({ internal: 'http://b:8090' });
  });
});

describe('F1f shared mode (DASHBOARD_SHARED_MODE=1, e.g. a shared multi-user deployment)', () => {
  beforeEach(async () => {
    vi.stubEnv('DASHBOARD_SHARED_MODE', '1');
    vi.stubEnv('AGENTTEAMS_AUDIT_LOG_PATH', path.join(workDir, 'audit-shared.jsonl'));
    // audit log is append-only — reset per test so events don't leak across cases
    await resetAuditLogForTests();
  });

  it('A: L2 save is rejected (403), L1 save works', async () => {
    const l2 = await POST(
      makeRequest(
        { method: 'POST', body: JSON.stringify({ backends: { controller: { internal: 'http://a:8090' } } }) },
        l2Cookie(),
      ),
    );
    expect(l2.status).toBe(403);
    expect(await l2.json()).toEqual({ error: 'shared-mode: only admin (L1) may save backend config' });

    const l1 = await POST(
      makeRequest(
        { method: 'POST', body: JSON.stringify({ backends: { controller: { internal: 'http://a:8090' } } }) },
        l1Cookie(),
      ),
    );
    expect(l1.status).toBe(200);
    expect(readConfigSync()?.backends.controller).toEqual({ internal: 'http://a:8090' });
  });

  it('B: pre-login uses the env token only and never persists a token file', async () => {
    const res = await POST(
      makeRequest({
        method: 'POST',
        body: JSON.stringify({
          token: 'test-token-123',
          backends: { controller: { internal: 'http://a:8090' }, matrix: { external: 'http://mx:6167' } },
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { mode: string }).mode).toBe('first-launch');
    expect(fs.existsSync(path.join(workDir, '.setup-token'))).toBe(false);
  });

  it('B: with no env token the pre-login path fails closed', async () => {
    vi.stubEnv('DASHBOARD_SETUP_TOKEN', '');
    const res = await POST(
      makeRequest({
        method: 'POST',
        body: JSON.stringify({ token: 'test-token-123', backends: { controller: { internal: 'http://a:8090' } } }),
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'invalid-token' });
    expect(fs.existsSync(path.join(workDir, '.setup-token'))).toBe(false);
  });

  it('C: saves are audited with actor, level and changed fields', async () => {
    await POST(
      makeRequest(
        { method: 'POST', body: JSON.stringify({ backends: { controller: { internal: 'http://a:8090' } } }) },
        l1Cookie(),
      ),
    );
    const write = (await listAuditEvents({})).find((e) => e.action === 'config.write');
    expect(write).toBeDefined();
    expect(write?.actor).toBe('admin');
    expect(write?.actor_level).toBe(3);
    expect(write?.details).toContain('controller');
  });

  it('A+C: a rejected L2 save leaves no config and no audit write', async () => {
    const res = await POST(
      makeRequest(
        { method: 'POST', body: JSON.stringify({ backends: { controller: { internal: 'http://evil:8090' } } }) },
        l2Cookie(),
      ),
    );
    expect(res.status).toBe(403);
    expect(readConfigSync()).toBeNull();
    const writes = (await listAuditEvents({})).filter((e) => e.action === 'config.write');
    expect(writes).toHaveLength(0);
  });
});

// F1f3: the installer may disable the pre-login setup token gate with
// DASHBOARD_SETUP_TOKEN_ENFORCE=0 (trusted-LAN deployments): pre-login
// saves are plain, no token is generated/persisted, the UI field hides.
describe('F1f3: DASHBOARD_SETUP_TOKEN_ENFORCE=0 (installer opt-out)', () => {
  it('pre-login save without token succeeds (standalone)', async () => {
    vi.stubEnv('DASHBOARD_SETUP_TOKEN_ENFORCE', '0');
    const res = await POST(
      makeRequest({
        method: 'POST',
        body: JSON.stringify({ backends: { controller: { internal: 'http://a:8090' } } }),
      }),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; mode: string };
    expect(data.ok).toBe(true);
    expect(data.mode).toBe('first-launch');
    expect(fs.existsSync(configFile())).toBe(true);
  });

  it('pre-login save without token succeeds in shared mode too', async () => {
    vi.stubEnv('DASHBOARD_SHARED_MODE', '1');
    vi.stubEnv('DASHBOARD_SETUP_TOKEN', '');
    vi.stubEnv('DASHBOARD_SETUP_TOKEN_ENFORCE', '0');
    const res = await POST(
      makeRequest({
        method: 'POST',
        body: JSON.stringify({ backends: { controller: { internal: 'http://a:8090' } } }),
      }),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean };
    expect(data.ok).toBe(true);
  });

  it('ENFORCE=0 overrides a set DASHBOARD_SETUP_TOKEN (gate stays off)', async () => {
    vi.stubEnv('DASHBOARD_SETUP_TOKEN_ENFORCE', '0');
    // DASHBOARD_SETUP_TOKEN is still 'test-token-123' from beforeEach.
    const res = await POST(
      makeRequest({
        method: 'POST',
        body: JSON.stringify({ backends: { controller: { internal: 'http://a:8090' } } }),
      }),
    );
    expect(res.status).toBe(200);
  });

  it('no token is generated or persisted (standalone)', async () => {
    vi.stubEnv('DASHBOARD_SETUP_TOKEN', '');
    vi.stubEnv('DASHBOARD_SETUP_TOKEN_ENFORCE', '0');
    const { getSetupToken } = await import('@/lib/backend-config');
    expect(await getSetupToken()).toBe('');
    expect(fs.existsSync(path.join(workDir, '.setup-token'))).toBe(false);
  });

  it('GET reports setupTokenRequired=false (UI hides the token field)', async () => {
    vi.stubEnv('DASHBOARD_SETUP_TOKEN_ENFORCE', '0');
    const res = await GET(makeRequest());
    const data = (await res.json()) as { setupTokenRequired: boolean };
    expect(data.setupTokenRequired).toBe(false);
  });

  it('default (env unset) keeps the gate: GET reports required', async () => {
    const res = await GET(makeRequest());
    const data = (await res.json()) as { setupTokenRequired: boolean };
    expect(data.setupTokenRequired).toBe(true);
  });
});

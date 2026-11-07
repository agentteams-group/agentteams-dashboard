// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import {
  BACKEND_NAMES,
  EMBEDDED_DEFAULTS,
  authHeaderFor,
  backendAuthHeader,
  backendCandidates,
  backendCandidatesSync,
  bootstrapSetupToken,
  classifyProbeError,
  configExists,
  configFilePath,
  effectiveUrl,
  forgetWorking,
  getSetupToken,
  isHttpUrl,
  normalizeHttpUrl,
  normalizeConfig,
  isTestTargetAllowed,
  listMatchesSaved,
  markWorking,
  orderedCandidates,
  pickBackendUrl,
  probeBackend,
  readConfigSync,
  redactBackends,
  refreshEffective,
  saveConfigOneShot,
  selectAndMark,
  toProbeRow,
  updateConfig,
  type ProbeRow,
} from './backend-config';

let workDir: string;

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backend-config-'));
});

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('DASHBOARD_CONFIG_FILE', path.join(workDir, 'config.json'));
  vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', '');
  vi.stubEnv('DASHBOARD_SETUP_TOKEN', '');
  for (const name of BACKEND_NAMES) forgetWorking(name);
});

afterEach(() => {
  const file = path.join(workDir, 'config.json');
  if (fs.existsSync(file)) fs.rmSync(file);
  const token = path.join(workDir, '.setup-token');
  if (fs.existsSync(token)) fs.rmSync(token);
  vi.unstubAllEnvs();
});

describe('isHttpUrl', () => {
  it('accepts http/https only', () => {
    expect(isHttpUrl('http://a:8090')).toBe(true);
    expect(isHttpUrl('https://a.example.com')).toBe(true);
    expect(isHttpUrl('ftp://a')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
    expect(isHttpUrl('')).toBe(false);
    expect(isHttpUrl(undefined)).toBe(false);
  });
});

describe('normalizeHttpUrl', () => {
  it('prepends http:// when the scheme is missing', () => {
    expect(normalizeHttpUrl('192.168.54.107:6866')).toBe('http://192.168.54.107:6866');
    expect(normalizeHttpUrl('controller.local:8090/api')).toBe('http://controller.local:8090/api');
  });
  it('keeps http/https and strips trailing slashes', () => {
    expect(normalizeHttpUrl('http://h:1/')).toBe('http://h:1');
    expect(normalizeHttpUrl('https://h/path//')).toBe('https://h/path');
  });
  it('leaves other schemes for the validator to reject', () => {
    expect(normalizeHttpUrl('ws://h:1')).toBe('ws://h:1');
    expect(normalizeHttpUrl('javascript:alert(1)')).toBe('javascript:alert(1)');
  });
});

describe('addressMode candidates', () => {
  const cfg = (mode: 'auto' | 'lan' | 'wan') => ({
    version: 1,
    addressMode: mode,
    backends: {
      controller: { internal: 'http://lan:1', external: 'http://wan:1' },
    },
  });

  it('auto keeps internal then external', () => {
    expect(backendCandidates('controller', cfg('auto') as never)).toEqual([
      'http://lan:1',
      'http://wan:1',
    ]);
  });
  it('lan pins internal only', () => {
    expect(backendCandidates('controller', cfg('lan') as never)).toEqual([
      'http://lan:1',
    ]);
  });
  it('wan pins external only', () => {
    expect(backendCandidates('controller', cfg('wan') as never)).toEqual([
      'http://wan:1',
    ]);
  });
  it('normalizeConfig keeps a valid mode and defaults garbage to auto', () => {
    const ok = normalizeConfig({ version: 1, addressMode: 'wan', backends: {} });
    expect(ok?.addressMode).toBe('wan');
    const bad = normalizeConfig({ version: 1, addressMode: 'x', backends: {} });
    expect(bad?.addressMode).toBe('auto');
  });
});

describe('readConfigSync / normalization', () => {
  it('returns null when the file is missing or corrupt', () => {
    expect(readConfigSync()).toBeNull();
    fs.writeFileSync(configFilePath(), '{not json');
    expect(readConfigSync()).toBeNull();
  });

  it('drops malformed entries but keeps valid ones', () => {
    fs.writeFileSync(
      configFilePath(),
      JSON.stringify({
        version: 1,
        backends: {
          controller: { internal: 'http://ctl:8090', external: 'ftp://bad' },
          matrix: { internal: 42 },
          sglang: { external: 'http://s:8000' },
        },
      }),
    );
    const config = readConfigSync();
    expect(config?.backends.controller).toEqual({ internal: 'http://ctl:8090' });
    expect(config?.backends.matrix).toBeUndefined();
    expect(config?.backends.sglang).toEqual({ external: 'http://s:8000' });
  });
});

describe('backendCandidates (order: config internal > config external > env)', () => {
  it('orders and dedupes', () => {
    vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', 'http://env:8090');
    const config = readConfigSync();
    const from = backendCandidates('controller', {
      version: 1,
      backends: { controller: { internal: 'http://in:8090', external: 'http://out:8090' } },
    });
    expect(from).toEqual(['http://in:8090', 'http://out:8090', 'http://env:8090']);
    // duplicate between file and env collapses
    const dup = backendCandidates('controller', {
      version: 1,
      backends: { controller: { internal: 'http://env:8090' } },
    });
    expect(dup).toEqual(['http://env:8090']);
    expect(config).toBeNull();
  });

  it('sglang: full three-candidate order (config internal > external > env) with dedup', () => {
    vi.stubEnv('AGENTTEAMS_SGLANG_URL', 'http://env:8000');
    const from = backendCandidates('sglang', {
      version: 1,
      backends: { sglang: { internal: 'http://in:8000', external: 'http://out:8000' } },
    });
    expect(from).toEqual(['http://in:8000', 'http://out:8000', 'http://env:8000']);
    // duplicate between the two config slots and env collapses to one entry
    const dup = backendCandidates('sglang', {
      version: 1,
      backends: { sglang: { internal: 'http://env:8000', external: 'http://env:8000' } },
    });
    expect(dup).toEqual(['http://env:8000']);
  });

  it('backendCandidatesSync reads the file', () => {
    fs.writeFileSync(
      configFilePath(),
      JSON.stringify({ version: 1, backends: { sglang: { internal: 'http://file:8000' } } }),
    );
    vi.stubEnv('AGENTTEAMS_SGLANG_URL', 'http://env:8000');
    expect(backendCandidatesSync('sglang')).toEqual(['http://file:8000', 'http://env:8000']);
  });
});

describe('saveConfigOneShot / updateConfig', () => {
  it('one-shot: first write succeeds, second is rejected', async () => {
    expect(await saveConfigOneShot({ controller: { internal: 'http://a:8090' } })).toEqual({ ok: true });
    expect(await configExists()).toBe(true);
    expect(await saveConfigOneShot({ matrix: { internal: 'http://b:6167' } })).toEqual({
      ok: false,
      error: 'already-configured',
    });
    // file unchanged
    expect(readConfigSync()?.backends.matrix).toBeUndefined();
  });

  it('one-shot rejects an all-invalid payload', async () => {
    const result = await saveConfigOneShot({ controller: { external: 'ftp://nope' } });
    expect(result.ok).toBe(false);
    expect(await configExists()).toBe(false);
  });

  it('updateConfig creates and merges per-backend (F1f-E)', async () => {
    expect(await updateConfig({ controller: { internal: 'http://a:8090' } })).toEqual({ ok: true });
    expect(await updateConfig({ matrix: { internal: 'http://b:6167' } })).toEqual({ ok: true });
    const config = readConfigSync();
    // F1f-E merge semantics: the sent backend replaces its entry; unsent
    // backends are preserved — a partial save must never wipe the config.
    expect(config?.backends.controller).toEqual({ internal: 'http://a:8090' });
    expect(config?.backends.matrix).toEqual({ internal: 'http://b:6167' });
  });
});

describe('getSetupToken', () => {
  it('env token wins', async () => {
    vi.stubEnv('DASHBOARD_SETUP_TOKEN', 'env-token');
    expect(await getSetupToken()).toBe('env-token');
  });

  it('auto-generates, persists, and is stable across calls', async () => {
    const first = await getSetupToken();
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(await getSetupToken()).toBe(first);
    expect(fs.existsSync(path.join(workDir, '.setup-token'))).toBe(true);
  });

  it('shared mode: env is the only source, empty when unset, never persisted (F1f-B)', async () => {
    vi.stubEnv('DASHBOARD_SHARED_MODE', '1');
    vi.stubEnv('DASHBOARD_SETUP_TOKEN', 'shared-env-token');
    expect(await getSetupToken()).toBe('shared-env-token');
    vi.stubEnv('DASHBOARD_SETUP_TOKEN', '');
    expect(await getSetupToken()).toBe('');
    expect(fs.existsSync(path.join(workDir, '.setup-token'))).toBe(false);
  });
});

describe('bootstrapSetupToken (post-merge review Block 4: token in docker logs at process start)', () => {
  it('standalone + enforced + no env token: generates, persists, and logs at startup', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await bootstrapSetupToken();
    const file = path.join(workDir, '.setup-token');
    expect(fs.existsSync(file)).toBe(true);
    const token = fs.readFileSync(file, 'utf-8').trim();
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(spy).toHaveBeenCalledWith(`[dashboard] one-time backend setup token: ${token}`);
    spy.mockRestore();
  });

  it('restart (persisted token from file) logs the same token again', async () => {
    const first = await getSetupToken(); // first boot: generate + persist
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await bootstrapSetupToken();
    expect(spy).toHaveBeenCalledWith(`[dashboard] one-time backend setup token: ${first}`);
    spy.mockRestore();
  });

  it('shared mode and ENFORCE=0: no-op (no file, no log)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('DASHBOARD_SHARED_MODE', '1');
    await bootstrapSetupToken();
    expect(spy).not.toHaveBeenCalled();
    vi.stubEnv('DASHBOARD_SHARED_MODE', '');
    vi.stubEnv('DASHBOARD_SETUP_TOKEN_ENFORCE', '0');
    await bootstrapSetupToken();
    expect(spy).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(workDir, '.setup-token'))).toBe(false);
    spy.mockRestore();
  });

  it('env token: no extra log (the operator already holds it)', async () => {
    vi.stubEnv('DASHBOARD_SETUP_TOKEN', 'env-token');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await bootstrapSetupToken();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('pickBackendUrl + working cache', () => {
  it('falls back through the candidate list', () => {
    expect(pickBackendUrl('sglang')).toBeUndefined();
    vi.stubEnv('AGENTTEAMS_SGLANG_URL', 'http://env:8000');
    expect(pickBackendUrl('sglang')).toBe('http://env:8000');
  });

  it('recently probed working address wins over the candidate order', () => {
    fs.writeFileSync(
      configFilePath(),
      JSON.stringify({
        version: 1,
        backends: { sglang: { internal: 'http://in:8000', external: 'http://out:8000' } },
      }),
    );
    markWorking('sglang', 'http://out:8000');
    expect(pickBackendUrl('sglang')).toBe('http://out:8000');
    // a working address that is no longer a candidate is ignored
    markWorking('sglang', 'http://ghost:8000');
    expect(pickBackendUrl('sglang')).toBe('http://in:8000');
  });

  it('working entry wins while fresh, expires after the TTL', () => {
    vi.useFakeTimers();
    try {
      fs.writeFileSync(
        configFilePath(),
        JSON.stringify({ version: 1, backends: { sglang: { internal: 'http://in:8000' } } }),
      );
      vi.stubEnv('AGENTTEAMS_SGLANG_URL', 'http://env:8000');
      // candidates = [in:8000 (file), env:8000]; mark the second as working.
      markWorking('sglang', 'http://env:8000');
      expect(pickBackendUrl('sglang')).toBe('http://env:8000');
      vi.advanceTimersByTime(700_000);
      // expired → fall back to the first candidate.
      expect(pickBackendUrl('sglang')).toBe('http://in:8000');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('isTestTargetAllowed', () => {
  it('empty filter allows everything; configured filter is exclusive (exact or subdomain)', () => {
    vi.stubEnv('DASHBOARD_ALLOWED_HOSTS', '');
    expect(isTestTargetAllowed('http://anything.example.com:1234/x')).toBe(true);
    vi.stubEnv('DASHBOARD_ALLOWED_HOSTS', 'a.example.com');
    expect(isTestTargetAllowed('http://a.example.com/')).toBe(true);
    expect(isTestTargetAllowed('http://sub.a.example.com/')).toBe(true);
    expect(isTestTargetAllowed('http://evil-a.example.com/')).toBe(false);
    expect(isTestTargetAllowed('not-a-url')).toBe(false);
  });

  it('post-merge review: metadata sentinels are rejected in every form', () => {
    vi.stubEnv('DASHBOARD_ALLOWED_HOSTS', '');
    const denied = [
      'http://169.254.169.254/latest/meta-data/',
      'http://[::ffff:169.254.169.254]/latest/meta-data/', // IPv4-mapped IPv6
      'http://169.254.1.5/', // whole 169.254.0.0/16 range
      'http://[fe80::1]/', // IPv6 link-local
      'http://metadata.google.internal/computeMetadata/v1/',
      'http://metadata.google.com/',
      'http://metadata/latest/meta-data/',
    ];
    for (const url of denied) {
      expect(isTestTargetAllowed(url), url).toBe(false);
    }
    // Legitimate targets (incl. private LAN, which is the self-config posture)
    // are unaffected.
    expect(isTestTargetAllowed('http://192.168.1.107:8001/')).toBe(true);
    expect(isTestTargetAllowed('http://10.0.0.5:8900/')).toBe(true);
    expect(isTestTargetAllowed('http://localhost:8001/')).toBe(true);
  });

  it('post-merge review: an explicit DASHBOARD_ALLOWED_HOSTS entry cannot re-allow the sentinel', () => {
    vi.stubEnv('DASHBOARD_ALLOWED_HOSTS', '169.254.169.254');
    expect(isTestTargetAllowed('http://169.254.169.254/')).toBe(false);
    expect(isTestTargetAllowed('http://[::ffff:169.254.169.254]/')).toBe(false);
  });
});

describe('probeBackend', () => {
  let server: Server;
  let base: string;
  const paths: string[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      paths.push(`${req.method} ${req.url}`);
      if (req.url === '/ok' || req.url === '/healthz' || req.url === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      } else if (req.url === '/missing' || req.url === '/v1/chat/completions') {
        res.writeHead(404);
        res.end('nf');
      } else {
        res.writeHead(500);
        res.end('boom');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no server address');
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('maps health paths per backend kind and records latency', async () => {
    const result = await probeBackend('controller', base);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(paths[paths.length - 1]).toBe('GET /healthz');
  });

  it('sglang probes GET /v1/models (dual-address contract pin)', async () => {
    // The dual-address mechanism (candidate order, working-cache election,
    // hysteresis) is backend-generic; this pins that the sglang probe path is
    // the model-list endpoint, so a future change to the probe table fails
    // loudly instead of silently probing the wrong surface.
    const result = await probeBackend('sglang', base);
    expect(result.ok).toBe(true);
    expect(result.httpOk).toBe(true);
    expect(result.status).toBe(200);
    expect(paths[paths.length - 1]).toBe('GET /v1/models');
  });

  it('treats a higress 404 as "gateway up, route missing" (connected, not httpOk)', async () => {
    const result = await probeBackend('higress-gateway', base);
    expect(result.ok).toBe(true); // the gateway answered → network connected
    expect(result.httpOk).toBe(false);
    expect(result.status).toBe(404);
    expect(result.error).toContain('路由');
    expect(paths[paths.length - 1]).toBe('POST /v1/chat/completions');
  });

  it('401 is connected but not usable (two-layer model)', async () => {
    server.removeAllListeners('request');
    server.on('request', (_req, res) => {
      res.writeHead(401, { 'www-authenticate': 'Basic' });
      res.end('nope');
    });
    const result = await probeBackend('matrix', base);
    expect(result.ok).toBe(true);
    expect(result.httpOk).toBe(false);
    expect(result.status).toBe(401);
    expect(result.error).toBeUndefined();
    expect(toProbeRow(base, result).detail).toContain('需鉴权');
  });

  it('reports unreachable targets with an error', async () => {
    const result = await probeBackend('sglang', 'http://127.0.0.1:1');
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('post-merge review: refuses a redirect to a disallowed target (302 → metadata sentinel)', async () => {
    const redirectServer = createServer((_req, res) => {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
    });
    await new Promise<void>((resolve) => redirectServer.listen(0, '127.0.0.1', resolve));
    const addr = redirectServer.address();
    if (!addr || typeof addr === 'string') throw new Error('no address');
    const result = await probeBackend('matrix', `http://127.0.0.1:${addr.port}`, 3000);
    redirectServer.close();
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('post-merge review: follows a redirect to an allowed target', async () => {
    const redirectServer = createServer((req, res) => {
      if (req.url?.startsWith('/go')) {
        res.writeHead(302, { location: '/ok' });
        res.end();
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      }
    });
    await new Promise<void>((resolve) => redirectServer.listen(0, '127.0.0.1', resolve));
    const addr = redirectServer.address();
    if (!addr || typeof addr === 'string') throw new Error('no address');
    const result = await probeBackend('controller', `http://127.0.0.1:${addr.port}/go`, 3000);
    redirectServer.close();
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
  });

  it('embedded defaults are the documented embedded topology (no sglang)', () => {
    expect(EMBEDDED_DEFAULTS.controller).toBe('http://agentteams-controller:8090');
    expect(EMBEDDED_DEFAULTS.sglang).toBeUndefined();
  });
});

describe('probeBackend: per-address auth on probes', () => {
  let server: Server;
  let base: string;
  const receivedAuth: Array<string | undefined> = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      receivedAuth.push(req.headers.authorization);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no server address');
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    receivedAuth.length = 0;
  });

  it('a gated backend is probed with its saved Basic credential (so 200 ⇒ 可选举)', async () => {
    fs.writeFileSync(
      configFilePath(),
      JSON.stringify({
        version: 1,
        backends: {
          'higress-console': {
            internal: {
              url: base,
              auth: { type: 'basic', username: 'admin', password: 'pass' },
            },
          },
        },
      }),
    );

    const result = await probeBackend('higress-console', base);

    expect(result.httpOk).toBe(true);
    // base64("admin:pass") = YWRtaW46cGFzcw==
    expect(receivedAuth[receivedAuth.length - 1]).toBe('Basic YWRtaW46cGFzcw==');
  });

  it('minio probes stay credential-free (S3 uses Access Key/Secret Key, not Basic/Bearer)', async () => {
    fs.writeFileSync(
      configFilePath(),
      JSON.stringify({
        version: 1,
        backends: {
          minio: {
            internal: {
              url: base,
              auth: { type: 'basic', username: 'admin', password: 'pass' },
            },
          },
        },
      }),
    );

    await probeBackend('minio', base);

    expect(receivedAuth[receivedAuth.length - 1]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// F1c: plugin parity — election, error classification, candidate order,
// applied-only cache updates, refresh_effective
// ---------------------------------------------------------------------------

const row = (url: string, ms: number | null, ok = true, httpOk = true): ProbeRow => ({
  url,
  ok,
  httpOk,
  ms,
  detail: '',
});

describe('selectAndMark (port of plugin _select_and_mark)', () => {
  it('no current working → elects the fastest reachable', () => {
    const picked = selectAndMark('controller', [row('http://slow:8090', 208), row('http://fast:8090', 100)]);
    expect(picked).toBe('http://fast:8090');
    expect(effectiveUrl('controller')).toBe('http://fast:8090');
  });

  it('challenger 108ms faster (> max(100ms, 30%)) → switches', () => {
    markWorking('controller', 'http://slow:8090', 208);
    const picked = selectAndMark('controller', [row('http://slow:8090', 208), row('http://fast:8090', 100)]);
    expect(picked).toBe('http://fast:8090');
  });

  it('challenger 50ms faster (< 100ms floor) → hysteresis holds the current', () => {
    markWorking('controller', 'http://slow:8090', 208);
    const picked = selectAndMark('controller', [row('http://slow:8090', 208), row('http://fast:8090', 158)]);
    expect(picked).toBe('http://slow:8090');
    expect(effectiveUrl('controller')).toBe('http://slow:8090');
  });

  it('current unreachable → switches to the fastest immediately', () => {
    markWorking('controller', 'http://dead:8090', 120);
    const picked = selectAndMark('controller', [
      row('http://dead:8090', null, false, false),
      row('http://ok:8090', 300),
      row('http://ok2:8090', 180),
    ]);
    expect(picked).toBe('http://ok2:8090');
  });

  it('nobody reachable → working cache untouched', () => {
    markWorking('controller', 'http://keep:8090', 90);
    const picked = selectAndMark('controller', [
      row('http://a:8090', null, false, false),
      row('http://b:8090', null, false, false),
    ]);
    expect(picked).toBeNull();
    expect(effectiveUrl('controller')).toBe('http://keep:8090');
  });

  it('a connected-but-401 address is never elected', () => {
    const picked = selectAndMark('controller', [
      row('http://auth:8090', 10, true, false),
      row('http://plain:8090', 200),
    ]);
    expect(picked).toBe('http://plain:8090');
  });
});

describe('classifyProbeError (port of plugin _classify_error)', () => {
  const withCode = (code: string, message?: string) => {
    const err = new Error(message ?? `failed (${code})`);
    (err as { code?: string }).code = code;
    return err;
  };
  const wrapped = (cause: unknown) => {
    const err = new TypeError('fetch failed');
    (err as { cause?: unknown }).cause = cause;
    return err;
  };

  it('timeout (AbortError) → 连接超时', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    expect(classifyProbeError(err, true)).toContain('连接超时');
  });

  it('DNS failure (ENOTFOUND, undici-wrapped)', () => {
    expect(
      classifyProbeError(wrapped(withCode('ENOTFOUND', 'getaddrinfo ENOTFOUND badhost')), false),
    ).toContain('DNS 解析失败');
  });

  it('ECONNREFUSED → 连接被拒绝', () => {
    expect(classifyProbeError(wrapped(withCode('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:1')), false)).toContain(
      '连接被拒绝',
    );
  });

  it('ECONNRESET → 提示语含中间盒/DPI 嫌疑（sat 外网归因 2026-09-09）', () => {
    const out = classifyProbeError(wrapped(withCode('ECONNRESET', 'socket hang up')), false);
    expect(out).toContain('连接被重置');
    expect(out).toContain('中间盒/DPI');
  });

  it('certificate verification failure stays a certificate error', () => {
    expect(classifyProbeError(wrapped(new Error('unable to verify the first certificate')), false)).toContain('证书');
  });

  it('handshake interruption is a handshake error (NOT a certificate error)', () => {
    const out = classifyProbeError(wrapped(new Error('TLS handshake failed: wrong version number')), false);
    expect(out).toContain('握手');
    expect(out).not.toContain('证书校验失败');
  });

  it('unknown error → 连接失败 with the message preserved', () => {
    const out = classifyProbeError(wrapped(withCode('EACCES', 'permission denied')), false);
    expect(out).toContain('连接失败');
    expect(out).toContain('permission denied');
  });
});

describe('orderedCandidates (request-layer failover order)', () => {
  it('fresh working address first, then config internal → external → env, deduped', () => {
    fs.writeFileSync(
      configFilePath(),
      JSON.stringify({ version: 1, backends: { controller: { internal: 'http://in:8090', external: 'http://out:8090' } } }),
    );
    vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', 'http://env:8090');
    markWorking('controller', 'http://out:8090');
    expect(orderedCandidates('controller')).toEqual(['http://out:8090', 'http://in:8090', 'http://env:8090']);
  });

  it('no working entry → plain candidate order', () => {
    vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', 'http://env:8090');
    expect(orderedCandidates('controller')).toEqual(['http://env:8090']);
  });

  it('a working address that is no longer a candidate is excluded (ghost guard, same as pickBackendUrl)', () => {
    markWorking('controller', 'http://ghost:8090');
    vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', 'http://env:8090');
    expect(orderedCandidates('controller')).toEqual(['http://env:8090']);
  });
});

describe('listMatchesSaved (plugin config_test "applied" semantics)', () => {
  it('tested list equal to the saved config list (any slot order) → applies', () => {
    fs.writeFileSync(
      configFilePath(),
      JSON.stringify({ version: 1, backends: { controller: { internal: 'http://in:8090', external: 'http://out:8090' } } }),
    );
    expect(listMatchesSaved('controller', ['http://out:8090', 'http://in:8090'])).toBe(true);
  });

  it('draft differs from the saved list → does not apply', () => {
    fs.writeFileSync(
      configFilePath(),
      JSON.stringify({ version: 1, backends: { controller: { internal: 'http://in:8090' } } }),
    );
    expect(listMatchesSaved('controller', ['http://other:8090'])).toBe(false);
    expect(listMatchesSaved('controller', ['http://in:8090', 'http://extra:8090'])).toBe(false);
  });

  it('no saved config (env-only deployment) → never applies', () => {
    expect(listMatchesSaved('controller', ['http://env:8090'])).toBe(false);
  });
});

describe('refreshEffective (port of plugin refresh_effective)', () => {
  let fast: Server;
  let slow: Server;
  let fastUrl: string;
  let slowUrl: string;

  beforeAll(async () => {
    fast = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
    slow = createServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      }, 150);
    });
    await new Promise<void>((resolve) => fast.listen(0, '127.0.0.1', resolve));
    await new Promise<void>((resolve) => slow.listen(0, '127.0.0.1', resolve));
    const fa = fast.address();
    const sa = slow.address();
    if (!fa || typeof fa === 'string' || !sa || typeof sa === 'string') throw new Error('no server');
    fastUrl = `http://127.0.0.1:${fa.port}`;
    slowUrl = `http://127.0.0.1:${sa.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => fast.close(() => resolve()));
    await new Promise<void>((resolve) => slow.close(() => resolve()));
  });

  it('elects the fastest reachable candidate; re-runs switch across the hysteresis gap', async () => {
    fs.writeFileSync(
      configFilePath(),
      JSON.stringify({ version: 1, backends: { sglang: { internal: fastUrl, external: slowUrl } } }),
    );
    const first = await refreshEffective(['sglang']);
    expect(first.effective.sglang).toBe(fastUrl);
    expect(first.switched.sglang).toBeUndefined(); // no previous working address

    // Simulate a previous effective = the slow address; the ~150ms gap clears
    // max(100ms, 30%) → the re-probe switches back to the fast one.
    markWorking('sglang', slowUrl, 150);
    const second = await refreshEffective(['sglang']);
    expect(second.effective.sglang).toBe(fastUrl);
    expect(second.switched.sglang).toBe(true);
  });

  it('a failed round never clears the existing effective address', async () => {
    markWorking('sglang', fastUrl, 10);
    fs.writeFileSync(
      configFilePath(),
      JSON.stringify({
        version: 1,
        backends: { sglang: { internal: 'http://127.0.0.1:1', external: 'http://127.0.0.1:2' } },
      }),
    );
    const result = await refreshEffective(['sglang'], 1500);
    expect(result.effective.sglang).toBeUndefined();
    expect(effectiveUrl('sglang')).toBe(fastUrl);
  });
});

// ---------------------------------------------------------------------------
// 逐地址认证方式（对齐工作台插件 config_entries：AddressEntry =
// string | {url, auth?}，merge_address_entries / redact / headers_with_auth）
// ---------------------------------------------------------------------------

describe('per-address auth entries (plugin parity)', () => {
  it('① string 与对象条目同归一（缺省 scheme 补全，凭据不完整塌回字符串）', () => {
    fs.writeFileSync(
      configFilePath(),
      JSON.stringify({
        version: 1,
        backends: {
          controller: {
            internal: 'http://gw:8090/',
            external: {
              url: 'gw2:8090',
              auth: { type: 'basic', username: 'u', password: 'p' },
            },
          },
          matrix: {
            internal: { url: 'https://mx:6167', auth: { type: 'bearer', token: 'tok' } },
          },
          sglang: {
            // basic 只有用户名 = 凭据不完整 → 规范形态为纯 URL 条目
            internal: { url: 'http://s:8000', auth: { type: 'basic', username: 'u' } },
          },
        },
      }),
    );
    const cfg = readConfigSync();
    expect(cfg?.backends.controller).toEqual({
      internal: 'http://gw:8090',
      external: { url: 'http://gw2:8090', auth: { type: 'basic', username: 'u', password: 'p' } },
    });
    expect(cfg?.backends.matrix?.internal).toEqual({
      url: 'https://mx:6167',
      auth: { type: 'bearer', token: 'tok' },
    });
    expect(cfg?.backends.sglang?.internal).toBe('http://s:8000');
    // 候选解析 / listMatchesSaved 对两种形态一视同仁
    expect(backendCandidates('controller', cfg)).toEqual(['http://gw:8090', 'http://gw2:8090']);
    expect(listMatchesSaved('controller', ['http://gw:8090', 'http://gw2:8090'])).toBe(true);
  });

  it('② 保存时密码/token 为空或 *** → 沿用旧秘密（basic + bearer）', async () => {
    expect(
      await updateConfig({
        controller: {
          internal: {
            url: 'http://gw:8090',
            auth: { type: 'basic', username: 'u', password: 'old-pass' },
          },
        },
      }),
    ).toEqual({ ok: true });
    // '***' = 脱敏回传后的「保持不变」
    await updateConfig({
      controller: {
        internal: { url: 'http://gw:8090', auth: { type: 'basic', username: 'u', password: '***' } },
      },
    });
    expect(readConfigSync()?.backends.controller?.internal).toEqual({
      url: 'http://gw:8090',
      auth: { type: 'basic', username: 'u', password: 'old-pass' },
    });
    // 空串同义
    await updateConfig({
      controller: {
        internal: { url: 'http://gw:8090', auth: { type: 'basic', username: 'u', password: '' } },
      },
    });
    expect(readConfigSync()?.backends.controller?.internal).toEqual({
      url: 'http://gw:8090',
      auth: { type: 'basic', username: 'u', password: 'old-pass' },
    });
    // 新密码 → 覆盖
    await updateConfig({
      controller: {
        internal: { url: 'http://gw:8090', auth: { type: 'basic', username: 'u', password: 'new-pass' } },
      },
    });
    expect(
      (readConfigSync()?.backends.controller?.internal as { auth: { password: string } }).auth.password,
    ).toBe('new-pass');

    // bearer 同理
    await updateConfig({
      matrix: { external: { url: 'http://mx:6167', auth: { type: 'bearer', token: 'tok-1' } } },
    });
    await updateConfig({
      matrix: { external: { url: 'http://mx:6167', auth: { type: 'bearer', token: '***' } } },
    });
    expect(readConfigSync()?.backends.matrix?.external).toEqual({
      url: 'http://mx:6167',
      auth: { type: 'bearer', token: 'tok-1' },
    });
  });

  it('③ 显式切回服务自身认证 → 丢弃旧凭据（存字符串条目）', async () => {
    await updateConfig({
      controller: {
        internal: { url: 'http://gw:8090', auth: { type: 'basic', username: 'u', password: 'p' } },
      },
    });
    // 字符串条目 = 明确选择「服务自身认证」
    await updateConfig({ controller: { internal: 'http://gw:8090' } });
    expect(readConfigSync()?.backends.controller?.internal).toBe('http://gw:8090');

    // 对象形式但无 auth 也等价（同样清除）
    await updateConfig({
      controller: {
        internal: { url: 'http://gw:8090', auth: { type: 'basic', username: 'u', password: 'p' } },
      },
    });
    await updateConfig({ controller: { internal: { url: 'http://gw:8090' } } });
    expect(readConfigSync()?.backends.controller?.internal).toBe('http://gw:8090');
  });

  it('④ 读取脱敏：password/token → ***，username 保留，明文不回传', () => {
    fs.writeFileSync(
      configFilePath(),
      JSON.stringify({
        version: 1,
        backends: {
          controller: {
            internal: {
              url: 'http://gw:8090',
              auth: { type: 'basic', username: 'admin', password: 's3cret' },
            },
          },
          matrix: {
            external: { url: 'http://mx:6167', auth: { type: 'bearer', token: 'plain-token' } },
          },
          sglang: { internal: 'http://s:8000' },
        },
      }),
    );
    const redacted = redactBackends(readConfigSync()?.backends ?? {});
    expect(redacted.controller?.internal).toEqual({
      url: 'http://gw:8090',
      auth: { type: 'basic', username: 'admin', password: '***' },
    });
    expect(redacted.matrix?.external).toEqual({
      url: 'http://mx:6167',
      auth: { type: 'bearer', token: '***' },
    });
    expect(redacted.sglang?.internal).toBe('http://s:8000');
    // 明文绝不出现在脱敏结果里
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain('s3cret');
    expect(serialized).not.toContain('plain-token');
  });

  it('⑤ basic/bearer 生成 Authorization 头（按地址命中，含尾斜杠归一）', () => {
    fs.writeFileSync(
      configFilePath(),
      JSON.stringify({
        version: 1,
        backends: {
          controller: {
            internal: {
              url: 'http://gw:8090',
              auth: { type: 'basic', username: 'admin', password: 'pass' },
            },
          },
          matrix: {
            external: { url: 'http://mx:6167', auth: { type: 'bearer', token: 'tok' } },
          },
        },
      }),
    );
    // base64("admin:pass") = YWRtaW46cGFzcw==
    expect(backendAuthHeader('controller', 'http://gw:8090')).toEqual({
      Authorization: 'Basic YWRtaW46cGFzcw==',
    });
    expect(backendAuthHeader('matrix', 'http://mx:6167/')).toEqual({
      Authorization: 'Bearer tok',
    });
    // 候选 URL 的 http/https 变体命中同一条目（插件 X1c 归一）
    expect(backendAuthHeader('controller', 'https://gw:8090')).toEqual({
      Authorization: 'Basic YWRtaW46cGFzcw==',
    });
    // 地址不匹配 → 不带凭据（防凭据串到别的后端）
    expect(backendAuthHeader('controller', 'http://other:8090')).toEqual({});
    expect(authHeaderFor(null)).toEqual({});
  });

  it('⑥ 无覆写认证 → 空头（服务自身认证不加任何头）', () => {
    fs.writeFileSync(
      configFilePath(),
      JSON.stringify({ version: 1, backends: { controller: { internal: 'http://plain:8090' } } }),
    );
    expect(backendAuthHeader('controller', 'http://plain:8090')).toEqual({});
    // 未配置的后端也返回空头，不抛
    expect(backendAuthHeader('higress-gateway', 'http://gw:8080')).toEqual({});
    expect(backendAuthHeader('controller', '')).toEqual({});
  });
});

// @vitest-environment node
import { promises as dns } from 'node:dns';
import { createServer, type RequestListener, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  EgressPolicyError,
  egressFetch,
  isEgressPolicyError,
  isPrivateIp,
  validateEgressTarget,
} from './egress-policy';

const servers: Server[] = [];

type LookupAll = (
  _hostname: string,
  _options: { all: true; verbatim: true },
) => Promise<Array<{ address: string; family: number }>>;

function spyDnsLookup(): MockInstance<LookupAll> {
  return vi.spyOn(dns, 'lookup') as unknown as MockInstance<LookupAll>;
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('DASHBOARD_ALLOWED_HOSTS', '');
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
});

async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing test server address');
  return `http://127.0.0.1:${address.port}`;
}

describe('IP classification', () => {
  it.each([
    '0.0.0.0', '10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1',
    '192.168.1.1', '100.64.0.1', '198.18.0.1', '224.0.0.1', '::', '::1',
    '::ffff:127.0.0.1', '::ffff:169.254.169.254', 'fc00::1', 'fd00::1',
    'fe80::1', 'fec0::1', 'ff02::1', '2001:db8::1', '64:ff9b::7f00:1',
  ])('denies non-public literal %s', (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2001:4860:4860::8888'])(
    'allows public literal %s',
    (ip) => expect(isPrivateIp(ip)).toBe(false),
  );
});

describe('validateEgressTarget', () => {
  it('rejects dangerous literals, schemes and URL credentials before connecting', async () => {
    let hits = 0;
    const guarded = await listen((_req, res) => { hits += 1; res.end('no'); });
    const denied = [
      guarded,
      'http://10.0.0.1', 'http://172.31.255.255', 'http://192.168.1.1',
      'http://169.254.169.254/latest/meta-data', 'http://[::1]',
      'http://[::ffff:169.254.169.254]', 'http://[fe80::1]',
      'http://metadata.google.internal', 'file:///etc/passwd',
      'http://user:pass@8.8.8.8',
    ];
    for (const target of denied) {
      await expect(validateEgressTarget(target, 'controller')).rejects.toMatchObject({ code: 'egress-denied' });
    }
    expect(hits).toBe(0);
  });

  it('resolves every A and AAAA answer and rejects a mixed public/private answer', async () => {
    const lookup = spyDnsLookup().mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ]);
    await expect(validateEgressTarget('http://mixed.example', 'controller')).rejects.toMatchObject({ code: 'egress-denied' });
    expect(lookup).toHaveBeenCalledWith('mixed.example', { all: true, verbatim: true });
  });

  it('allows a private Controller only with an explicit operator hostname allowlist', async () => {
    spyDnsLookup().mockResolvedValue([{ address: '10.1.2.3', family: 4 }]);
    await expect(validateEgressTarget('http://controller.internal:8090', 'controller')).rejects.toMatchObject({ code: 'egress-denied' });
    vi.stubEnv('DASHBOARD_ALLOWED_HOSTS', 'controller.internal');
    await expect(validateEgressTarget('http://controller.internal:8090', 'controller')).resolves.toBeUndefined();
    await expect(validateEgressTarget('http://controller.internal:8090', 'matrix')).rejects.toMatchObject({ code: 'egress-denied' });
    await expect(validateEgressTarget('http://other.internal:8090', 'controller')).rejects.toMatchObject({ code: 'egress-denied' });
  });

  it('never lets the operator allowlist re-allow metadata', async () => {
    vi.stubEnv('DASHBOARD_ALLOWED_HOSTS', 'metadata.google.internal,169.254.169.254');
    await expect(validateEgressTarget('http://metadata.google.internal', 'controller')).rejects.toMatchObject({ code: 'egress-denied' });
    await expect(validateEgressTarget('http://169.254.169.254', 'controller')).rejects.toMatchObject({ code: 'egress-denied' });
  });

  it('enforces a strict hostname allowlist for public targets too', async () => {
    await expect(validateEgressTarget('http://8.8.8.8', 'controller')).resolves.toBeUndefined();
    vi.stubEnv('DASHBOARD_ALLOWED_HOSTS', 'allowed.example');
    await expect(validateEgressTarget('http://8.8.8.8', 'controller')).rejects.toMatchObject({ code: 'egress-denied' });
  });
});

describe('egressFetch connection and redirects', () => {
  it('connects to an allowlisted internal Controller and returns status/headers', async () => {
    const seen: Array<string | undefined> = [];
    const url = await listen((req, res) => {
      seen.push(req.headers.authorization);
      res.writeHead(401, { 'x-probe': 'yes' });
      res.end('no');
    });
    vi.stubEnv('DASHBOARD_ALLOWED_HOSTS', '127.0.0.1');
    const response = await egressFetch(`${url}/healthz`, {
      backend: 'controller', timeoutMs: 1000, headers: { Authorization: 'Bearer secret' },
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('x-probe')).toBe('yes');
    expect(seen).toEqual(['Bearer secret']);
  });

  it('rejects a dangerous target before opening a connection', async () => {
    let hits = 0;
    const url = await listen((_req, res) => { hits += 1; res.end('no'); });
    await expect(egressFetch(url, { backend: 'controller', timeoutMs: 1000 })).rejects.toBeInstanceOf(EgressPolicyError);
    expect(hits).toBe(0);
  });

  it('rejects a redirect to metadata without connecting to it', async () => {
    let hits = 0;
    const url = await listen((_req, res) => {
      hits += 1;
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
    });
    vi.stubEnv('DASHBOARD_ALLOWED_HOSTS', '127.0.0.1');
    await expect(egressFetch(url, { backend: 'controller', timeoutMs: 1000 })).rejects.toMatchObject({ code: 'egress-denied' });
    expect(hits).toBe(1);
  });

  it('keeps auth on a same-origin redirect but strips it cross-origin', async () => {
    const seen: Array<string | undefined> = [];
    const destination = await listen((req, res) => { seen.push(req.headers.authorization); res.end('ok'); });
    const source = await listen((req, res) => {
      seen.push(req.headers.authorization);
      if (req.url === '/same') {
        res.writeHead(302, { location: '/destination' });
        res.end();
      } else if (req.url === '/cross') {
        res.writeHead(302, { location: destination });
        res.end();
      } else {
        res.end('ok');
      }
    });
    vi.stubEnv('DASHBOARD_ALLOWED_HOSTS', '127.0.0.1');
    const options = { backend: 'controller' as const, timeoutMs: 1000, headers: { Authorization: 'Bearer secret' } };
    await egressFetch(`${source}/same`, options);
    await egressFetch(`${source}/cross`, options);
    expect(seen).toEqual(['Bearer secret', 'Bearer secret', 'Bearer secret', undefined]);
  });

  it('pins the vetted DNS answer instead of resolving again at connect time', async () => {
    let hits = 0;
    const url = await listen((_req, res) => { hits += 1; res.end('ok'); });
    const lookup = spyDnsLookup().mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    vi.stubEnv('DASHBOARD_ALLOWED_HOSTS', 'rebind.example');
    await egressFetch('http://rebind.example:1/healthz', { backend: 'controller', timeoutMs: 1000 }).catch(() => {});
    expect(lookup).toHaveBeenCalledTimes(1);
    // Point the pinned answer at the live fixture; a second DNS answer must not
    // be consulted when the socket is opened.
    lookup.mockResolvedValue([{ address: new URL(url).hostname, family: 4 }]);
    const port = new URL(url).port;
    const response = await egressFetch(`http://rebind.example:${port}/healthz`, { backend: 'controller', timeoutMs: 1000 });
    expect(response.status).toBe(200);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(hits).toBe(1);
  });

  it('enforces one total timeout across a stalled response', async () => {
    const url = await listen(() => {});
    vi.stubEnv('DASHBOARD_ALLOWED_HOSTS', '127.0.0.1');
    const started = Date.now();
    await expect(egressFetch(url, { backend: 'controller', timeoutMs: 80 })).rejects.toMatchObject({ name: 'AbortError' });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('classifies policy errors without exposing credentials', async () => {
    let err: unknown;
    try { await validateEgressTarget('http://user:pass@127.0.0.1', 'controller'); } catch (caught) { err = caught; }
    expect(isEgressPolicyError(err)).toBe(true);
    expect(String(err)).not.toContain('user:pass');
  });
});

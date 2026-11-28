// Shared outbound policy for backend setup saves, scheme probes and health
// probes. Every connection (including every redirect hop) resolves all A/AAAA
// records, rejects non-public addresses, and pins the vetted addresses into the
// socket lookup so a second DNS answer cannot redirect the connection.
//
// The only private-network exception is an internal Controller whose hostname
// is explicitly present in DASHBOARD_ALLOWED_HOSTS. That environment variable
// is operator-controlled; it is never read from a request or the config file.

import { promises as dns } from 'node:dns';
import { request } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';

export type EgressBackend = 'controller' | 'matrix' | 'minio' | 'higress-gateway' | 'higress-console' | 'sglang';

export class EgressPolicyError extends Error {
  readonly code = 'egress-denied';

  constructor(message: string) {
    super(message);
    this.name = 'EgressPolicyError';
  }
}

export function isEgressPolicyError(err: unknown): err is EgressPolicyError {
  return err instanceof EgressPolicyError;
}

export interface EgressResponse {
  status: number;
  headers: Headers;
}

export interface EgressFetchOptions {
  backend: EgressBackend;
  /** Total deadline for DNS, all redirects and response headers. */
  timeoutMs: number;
  maxRedirects?: number;
  method?: string;
  headers?: HeadersInit;
  body?: string;
  signal?: AbortSignal;
}

interface ResolvedTarget {
  url: URL;
  hostname: string;
  addresses: Array<{ address: string; family: number }>;
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function ipv4Number(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => n > 255)) return null;
  return ((nums[0]! << 24) | (nums[1]! << 16) | (nums[2]! << 8) | nums[3]!) >>> 0;
}

function ipv4Private(ip: string): boolean {
  const value = ipv4Number(ip);
  if (value === null) return true; // fail closed on an unexpected literal
  const a = (value >>> 24) & 255;
  const b = (value >>> 16) & 255;
  // RFC1918, loopback, link-local/metadata, CGNAT, unspecified, multicast,
  // reserved and documentation ranges. Metadata is denied even when allowlisted.
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 88) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}

function ipv6Bytes(ip: string): number[] | null {
  const zoneLess = ip.split('%')[0]!;
  if (zoneLess !== ip || isIP(zoneLess) !== 6) return null;
  const halves = zoneLess.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) return null;
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (halves.length === 2 && missing < 1) return null;
  const words = [...left, ...Array(missing).fill('0'), ...right].map((part) => Number.parseInt(part, 16));
  const bytes: number[] = [];
  for (const word of words) bytes.push(word >>> 8, word & 255);
  return bytes;
}

function embeddedIpv4(bytes: number[]): string | null {
  // IPv4-mapped (::ffff:a.b.c.d) and NAT64 well-known prefix (64:ff9b::/96).
  const mapped = bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 255 && bytes[11] === 255;
  const nat64 = bytes.slice(0, 12).every((b, i) => b === [0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0][i]);
  if (!mapped && !nat64) return null;
  return bytes.slice(12).join('.');
}

function ipv6Private(ip: string): boolean {
  const bytes = ipv6Bytes(ip);
  if (!bytes) return true;
  const mapped = embeddedIpv4(bytes);
  if (mapped) return ipv4Private(mapped);
  const word = (index: number) => (bytes[index * 2]! << 8) | bytes[index * 2 + 1]!;
  const first = word(0);
  // ::, ::1, IPv4-compatible, ULA, link-local, deprecated site-local,
  // multicast, documentation, special-use and local-use NAT64 ranges.
  const unspecifiedOrLoopback = bytes.slice(0, 15).every((b) => b === 0) && (bytes[15] === 0 || bytes[15] === 1);
  const compatible = bytes.slice(0, 12).every((b) => b === 0);
  return (
    unspecifiedOrLoopback || compatible ||
    (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 ||
    (first & 0xffc0) === 0xfec0 || (first & 0xff00) === 0xff00 ||
    first === 0x2001 && word(1) === 0x0db8 ||
    (first === 0x2001 && (word(1) === 0 || word(1) < 0x0200)) ||
    (first === 0x2001 && word(1) === 0x0010 && (word(2) & 0xfff0) === 0) ||
    (first === 0x2001 && word(1) === 0x0020 && (word(2) & 0xfff0) === 0) ||
    first === 0x2002 ||
    (first === 0x0064 && word(1) === 0xff9b && word(2) === 1)
  );
}

export function isPrivateIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return ipv4Private(ip);
  if (family === 6) return ipv6Private(ip);
  return true;
}

function operatorAllowlist(): string[] {
  return (process.env.DASHBOARD_ALLOWED_HOSTS || '')
    .split(',')
    .map((host) => normalizeHostname(host.trim()))
    .filter(Boolean);
}

function hostAllowed(hostname: string, allowed: string[]): boolean {
  return allowed.some((entry) => hostname === entry || hostname.endsWith(`.${entry}`));
}

const METADATA_NAMES = new Set(['metadata', 'metadata.google.internal', 'metadata.google.com', 'instance-data']);

function isMetadataAddress(hostname: string): boolean {
  const family = isIP(hostname);
  if (family === 4) {
    const value = ipv4Number(hostname);
    return value !== null && ((value >>> 24) & 255) === 169 && ((value >>> 16) & 255) === 254;
  }
  if (family !== 6) return false;
  const bytes = ipv6Bytes(hostname);
  if (!bytes) return true; // fail closed for an unexpected IPv6 literal
  const first = ((bytes[0]! << 8) | bytes[1]!);
  if ((first & 0xffc0) === 0xfe80) return true;
  const embedded = embeddedIpv4(bytes);
  if (embedded) return isMetadataAddress(embedded);
  // Alibaba Cloud instance metadata: fd00:ec2::254.
  return bytes[0] === 0xfd && bytes[1] === 0x00 && bytes[2] === 0xec && bytes[3] === 0x02 &&
    bytes.slice(4, 14).every((b) => b === 0) && bytes[14] === 0x02 && bytes[15] === 254;
}

function assertNotMetadata(hostname: string): void {
  if (METADATA_NAMES.has(hostname) || isMetadataAddress(hostname)) {
    throw new EgressPolicyError(`target host "${hostname}" is not allowed`);
  }
}

function authorizeTarget(url: URL, backend: EgressBackend, addresses: Array<{ address: string; family: number }>): void {
  const hostname = normalizeHostname(url.hostname);
  assertNotMetadata(hostname);
  if (addresses.some(({ address }) => isMetadataAddress(address))) {
    throw new EgressPolicyError(`target host "${hostname}" resolves to a metadata address`);
  }
  const allowed = operatorAllowlist();
  if (addresses.length === 0) {
    throw new EgressPolicyError(`target host "${hostname}" is not allowed`);
  }
  if (allowed.length > 0 && !hostAllowed(hostname, allowed)) {
    throw new EgressPolicyError(`target host "${hostname}" is not allowed`);
  }
  const privateAddresses = addresses.filter(({ address }) => isPrivateIp(address));
  if (privateAddresses.length === 0) return;
  // A private Controller is a supported deployment shape, but only an explicit
  // operator allowlist entry can authorize it. Other backends stay public-only.
  if (backend === 'controller' && hostAllowed(hostname, allowed)) return;
  throw new EgressPolicyError(`target host "${hostname}" resolves to a non-public address`);
}

async function resolveTarget(url: URL, backend: EgressBackend): Promise<ResolvedTarget> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new EgressPolicyError('only http(s) targets are allowed');
  }
  if (url.username || url.password) throw new EgressPolicyError('URL credentials are not allowed');
  const hostname = normalizeHostname(url.hostname);
  if (!hostname) throw new EgressPolicyError('target host is required');
  // Metadata names are denied before DNS so an environment resolver cannot
  // turn a sentinel into an ordinary connection attempt or obscure the policy
  // error behind a DNS failure.
  assertNotMetadata(hostname);
  let addresses: Array<{ address: string; family: number }>;
  const family = isIP(hostname);
  if (family !== 0) {
    addresses = [{ address: hostname, family }];
  } else {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    addresses = records.map(({ address, family: recordFamily }) => ({ address, family: recordFamily }));
  }
  authorizeTarget(url, backend, addresses);
  return { url, hostname, addresses };
}

/** Validate before any scheme probe, save or connection. Performs A/AAAA DNS. */
export async function validateEgressTarget(rawUrl: string, backend: EgressBackend): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new EgressPolicyError('invalid target URL');
  }
  await resolveTarget(url, backend);
}

function deadlineError(): Error {
  const err = new Error('egress request timed out');
  err.name = 'AbortError';
  return err;
}

async function beforeDeadline<T>(work: Promise<T>, deadline: number, signal: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectTimeout: (_err: Error) => void = () => {};
  const onAbort = () => rejectTimeout(deadlineError());
  const timeout = new Promise<never>((_resolve, reject) => {
    rejectTimeout = reject;
    timer = setTimeout(() => reject(deadlineError()), Math.max(1, deadline - Date.now()));
    if (signal.aborted) reject(deadlineError());
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

function pinnedLookup(target: ResolvedTarget): LookupFunction {
  return ((_hostname, options, callback) => {
    if (options.all) callback(null, target.addresses);
    else callback(null, target.addresses[0]!.address, target.addresses[0]!.family);
  }) as LookupFunction;
}

function connectOnce(target: ResolvedTarget, options: EgressFetchOptions, signal: AbortSignal): Promise<EgressResponse> {
  return new Promise((resolve, reject) => {
    const transport = target.url.protocol === 'https:' ? httpsRequest : request;
    const req = transport(target.url, {
      method: options.method ?? 'GET',
      headers: options.headers ? Object.fromEntries(new Headers(options.headers)) : undefined,
      lookup: pinnedLookup(target),
      agent: false,
      signal,
    }, (res) => {
      // Probe responses only need status/headers. Drain immediately so sockets
      // are released even when a backend streams a large health response.
      res.resume();
      const headers = new Headers();
      for (const [name, value] of Object.entries(res.headers)) {
        if (value !== undefined) {
          for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
        }
      }
      resolve({ status: res.statusCode ?? 0, headers });
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

function redirectMethod(status: number, method: string): { method: string; dropBody: boolean } {
  const upper = method.toUpperCase();
  if (status === 303 && upper !== 'GET' && upper !== 'HEAD') return { method: 'GET', dropBody: true };
  if ((status === 301 || status === 302) && upper === 'POST') return { method: 'GET', dropBody: true };
  return { method, dropBody: false };
}

/** Fetch with a single total deadline and policy checks on every redirect hop. */
export async function egressFetch(rawUrl: string, options: EgressFetchOptions): Promise<EgressResponse> {
  const deadline = Date.now() + Math.max(1, options.timeoutMs);
  const controller = new AbortController();
  const abort = () => controller.abort(deadlineError());
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener('abort', abort, { once: true });
  let current = rawUrl;
  let method = options.method ?? 'GET';
  let body = options.body;
  let previousOrigin: string | undefined;
  const maxRedirects = options.maxRedirects ?? 2;
  try {
    for (let hop = 0; ; hop += 1) {
      let parsed: URL;
      try {
        parsed = new URL(current);
      } catch {
        throw new EgressPolicyError('invalid target URL');
      }
      const target = await beforeDeadline(resolveTarget(parsed, options.backend), deadline, controller.signal);
      const headers = headersForHop(options.headers, previousOrigin, parsed.origin, hop);
      const response = await beforeDeadline(connectOnce(target, { ...options, method, headers, body }, controller.signal), deadline, controller.signal);
      const location = response.headers.get('location');
      const redirect = response.status >= 300 && response.status < 400 && [301, 302, 303, 307, 308].includes(response.status);
      if (!redirect || !location) return response;
      if (hop >= maxRedirects) return response;
      current = new URL(location, parsed).toString();
      previousOrigin = parsed.origin;
      const redirected = redirectMethod(response.status, method);
      method = redirected.method;
      if (redirected.dropBody) body = undefined;
    }
  } finally {
    options.signal?.removeEventListener('abort', abort);
  }
}

function headersForHop(
  init: HeadersInit | undefined,
  previousOrigin: string | undefined,
  nextOrigin: string,
  hop: number,
): HeadersInit | undefined {
  if (!init || hop === 0) return init;
  const headers = new Headers(init);
  // Never forward gateway credentials to a redirect target, even on a scheme
  // or port change. Same-origin redirects keep them; cross-origin ones do not.
  if (previousOrigin !== nextOrigin) {
    headers.delete('authorization');
    headers.delete('proxy-authorization');
    headers.delete('cookie');
  }
  return headers;
}

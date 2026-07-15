// Centralized Matrix homeserver URL validation.
// Prevents SSRF: a user-supplied homeserver must point to a public, approved host
// and must not target private, link-local or loopback ranges unless explicitly allowed.

const DEFAULT_ALLOWED_HOSTS = [
  'localhost',
  '127.0.0.1',
  '::1',
  'matrix-local.agentteams.io',
  'matrix.org',
  'client.matrix.org',
];

function getAllowedHosts(): string[] {
  const fromEnv = process.env.MATRIX_HOMESERVER_ALLOWLIST;
  if (!fromEnv) return DEFAULT_ALLOWED_HOSTS;
  return fromEnv
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

function getBlockedSuffixes(): string[] {
  const fromEnv = process.env.MATRIX_HOMESERVER_BLOCKED_SUFFIXES;
  if (fromEnv) {
    return fromEnv
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }
  return [
    '.svc',
    '.svc.cluster.local',
    '.cluster.local',
    '.local',
  ];
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4 || !parts.every((p) => /^\d+$/.test(p))) {
    return false;
  }
  const [a, b] = [Number(parts[0]), Number(parts[1])];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIpv6(hostname: string): boolean {
  if (hostname === '::' || hostname === '::1') return true;
  if (hostname.startsWith('fe80:') || hostname.startsWith('fe80')) return true;
  if (hostname.startsWith('fc') || hostname.startsWith('fd')) return true;
  if (hostname.startsWith('::ffff:')) {
    const v4 = hostname.slice(7);
    return isPrivateIpv4(v4);
  }
  return false;
}

export interface ValidateHomeserverOptions {
  allowPrivateNetwork?: boolean;
}

export class HomeserverValidationError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`Homeserver URL rejected: ${reason}`);
    this.name = 'HomeserverValidationError';
    this.reason = reason;
  }
}

export function validateHomeserverUrl(
  url: string,
  options: ValidateHomeserverOptions = {}
): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HomeserverValidationError('invalid URL format');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new HomeserverValidationError('protocol must be http or https');
  }

  // URL.hostname keeps the brackets on IPv6 literals — strip them so the
  // allowlist and private-range checks below see the bare address.
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (options.allowPrivateNetwork) {
    return parsed;
  }

  // Check allowlist first — explicitly allowed hosts bypass all other checks.
  const allowedHosts = getAllowedHosts();
  if (allowedHosts.length > 0 && allowedHosts.includes(hostname)) {
    return parsed;
  }

  if (isPrivateIpv4(hostname) || isPrivateIpv6(hostname)) {
    throw new HomeserverValidationError('private network addresses are not allowed');
  }

  const blockedSuffixes = getBlockedSuffixes();
  if (blockedSuffixes.some((suffix) => hostname.endsWith(suffix))) {
    throw new HomeserverValidationError('internal hostnames are not allowed');
  }

  // An explicitly configured allowlist is exclusive: anything not on it is rejected.
  if (process.env.MATRIX_HOMESERVER_ALLOWLIST) {
    throw new HomeserverValidationError('host is not in the allowlist');
  }

  return parsed;
}

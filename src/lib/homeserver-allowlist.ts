// Centralized Matrix homeserver URL validation.
// Prevents SSRF: a user-supplied homeserver must point to a public, approved host
// and must not target private, link-local or loopback ranges unless explicitly allowed.

const DEFAULT_ALLOWED_HOSTS = [
  'localhost',
  '127.0.0.1',
  '::1',
  // Embedded topology: Tuwunel runs inside the agentteams-controller container.
  'agentteams-controller',
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

/** Cloud-metadata link-local range (169.254.0.0/16 — the SSRF sentinel). */
function isMetadataIpv4(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4 || !parts.every((p) => /^\d+$/.test(p))) {
    return false;
  }
  return Number(parts[0]) === 169 && Number(parts[1]) === 254;
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
  if (isMetadataIpv4(hostname)) return true;
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

/**
 * Operator opt-in for self-hosted LAN deployments whose homeserver lives on a
 * private address (10/172.16/192.168/127 …) or an internal DNS name.
 *
 * Off by default: on a shared, multi-tenant deployment the proxy routes must
 * not be usable to reach the host's internal network, and the fallback is to
 * stay on loopback/allowlisted hosts. Single-operator LAN setups enable this
 * through MATRIX_ALLOW_PRIVATE_NETWORK=1. The cloud-metadata link-local range
 * (169.254.0.0/16) stays rejected either way.
 */
export function allowPrivateNetworkFromEnv(): boolean {
  const raw = process.env.MATRIX_ALLOW_PRIVATE_NETWORK?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

export interface ValidateHomeserverOptions {
  allowPrivateNetwork?: boolean;
  // When true the URL must match the allowlist (configured or built-in) even
  // when no MATRIX_HOMESERVER_ALLOWLIST env is set. Use this for routes that
  // forward the user's access token to the homeserver, so the token is never
  // sent to an arbitrary public host the operator has not approved.
  requireAllowlist?: boolean;
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

  const allowPrivateNetwork = options.allowPrivateNetwork || allowPrivateNetworkFromEnv();

  if (allowPrivateNetwork) {
    // SSRF sentinel: the cloud-metadata range is NEVER allowed, even with
    // allowPrivateNetwork — a LAN deployment needs 10/172.16/192.168, and
    // no legitimate homeserver lives on the link-local range. An explicit
    // "allow private" can never re-allow the instance metadata endpoint.
    if (isMetadataIpv4(hostname)) {
      throw new HomeserverValidationError('cloud metadata endpoints are not allowed');
    }
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
  // requireAllowlist makes the built-in allowlist exclusive too, so credentials
  // are only ever sent to an approved host.
  if (process.env.MATRIX_HOMESERVER_ALLOWLIST || options.requireAllowlist) {
    throw new HomeserverValidationError('host is not in the allowlist');
  }

  return parsed;
}

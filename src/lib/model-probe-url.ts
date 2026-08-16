// URL guard for user-supplied model provider Base URLs.
// Prevents SSRF: a browser-supplied baseUrl must not target loopback, private,
// link-local or cluster-internal hosts unless the operator explicitly opts in.

export class ModelProbeUrlError extends Error {
  constructor(reason: string) {
    super(`Base URL rejected: ${reason}`);
    this.name = 'ModelProbeUrlError';
  }
}

const BLOCKED_HOST_SUFFIXES = ['.svc', '.svc.cluster.local', '.cluster.local', '.local'];

function getAllowHosts(): string[] {
  const fromEnv = process.env.MODEL_PROBE_ALLOW_HOSTS;
  if (!fromEnv) return [];
  return fromEnv
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

function privateNetworkAllowed(): boolean {
  return process.env.MODEL_PROBE_ALLOW_PRIVATE_NETWORK === '1';
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
  if (hostname.startsWith('fe80:')) return true;
  if (hostname.startsWith('fc') || hostname.startsWith('fd')) return true;
  if (hostname.startsWith('::ffff:')) {
    return isPrivateIpv4(hostname.slice(7));
  }
  return false;
}

function isInternalHostname(hostname: string): boolean {
  if (hostname === 'localhost') return true;
  if (isPrivateIpv4(hostname) || isPrivateIpv6(hostname)) return true;
  return BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

/**
 * Validate a user-supplied provider Base URL. Returns the parsed URL when it
 * points at an approved target; throws ModelProbeUrlError otherwise.
 *
 * Private/loopback/cluster-internal targets are rejected unless:
 * - the hostname is listed in MODEL_PROBE_ALLOW_HOSTS, or
 * - MODEL_PROBE_ALLOW_PRIVATE_NETWORK=1 (operator opts into LAN probing,
 *   e.g. a local vLLM / ollama endpoint).
 */
export function validateModelProbeBaseUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ModelProbeUrlError('URL 格式无效');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ModelProbeUrlError('仅支持 http/https 协议');
  }

  // URL.hostname keeps brackets on IPv6 literals — strip them.
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (!isInternalHostname(hostname)) {
    return parsed;
  }

  if (getAllowHosts().includes(hostname)) {
    return parsed;
  }

  if (privateNetworkAllowed()) {
    return parsed;
  }

  throw new ModelProbeUrlError(
    '不允许探测内网或本地地址；如确需探测局域网模型服务（vLLM/Ollama 等），请设置 MODEL_PROBE_ALLOW_PRIVATE_NETWORK=1 或 MODEL_PROBE_ALLOW_HOSTS'
  );
}

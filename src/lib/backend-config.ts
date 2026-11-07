// Dashboard backend configuration (F1: first-launch backend setup).
//
// Every backend the dashboard talks to (controller, matrix, minio,
// higress gateway/console, sglang) supports two addresses — internal /
// external — mirroring the workbench plugin's dual-address model. The
// dashboard server resolves which address to use at request time:
//
//   resolution:  config file > env vars
//   failover:    last-known-working address (latency-probed; kept fresh by the
//                background re-rank loop and the post-save re-probe) wins, then
//                config internal, config external, env — in that order. The
//                request layer (proxy-helper) additionally walks the remaining
//                candidates with a same-address retry, so a dead first candidate
//                never 502s the data plane (plugin catch-all parity).
//
// Persistence: a small JSON file (DASHBOARD_CONFIG_FILE) on a mounted
// volume. It is written ONCE at first launch by the pre-login setup page
// (token-gated, one-shot) and may be updated afterwards only by a level-3
// (L1 admin) session. Read access is a plain synchronous file read per
// request (tiny file, local disk) — same pattern as the per-call token
// re-read in proxy-helper, which deliberately avoids stale caches.

// Node builtins are loaded LAZILY (dynamic import) so this module can be
// imported from non-Node environments (jsdom unit tests) without crashing —
// same convention as proxy-helper's token-file read. In Node the fs module
// is warmed at module init; the sync read path (readConfigSync) uses the
// warmed cache and degrades to "no config file" until it is available,
// which is the correct behavior in test environments.
import {
  BACKEND_NAMES,
  EMBEDDED_DEFAULTS,
  REQUIRED_BACKENDS,
  type BackendName,
} from './backend-names';

export { BACKEND_NAMES, EMBEDDED_DEFAULTS, REQUIRED_BACKENDS, type BackendName };

type FsModule = typeof import('node:fs');

let fsPromise: Promise<FsModule> | null = null;
let fsResolved: FsModule | null = null;

function loadFs(): Promise<FsModule> {
  if (!fsPromise) {
    fsPromise = import('node:fs')
      .then((mod) => {
        fsResolved = mod;
        return mod;
      })
      .catch((err) => {
        fsPromise = null; // non-Node environment: stay degraded, don't poison retries
        throw err;
      });
  }
  return fsPromise;
}

// Warm the fs cache at module init (Node server + node-env tests).
loadFs().catch(() => {
  /* jsdom etc.: readConfigSync returns null, async writers throw at call time */
});

/** 每地址覆盖凭据（对齐工作台插件 config_entries.AuthEntry）：
 * - basic → 公网网关 Basic 门（Caddy 等）
 * - bearer → 网关 API key 门（Higress 等），即 Bearer token
 * 无 auth 的条目 = 用服务自身认证（controller token / matrix token /
 * SGLang 无鉴权）。 */
export type BackendAuth =
  | { type: 'basic'; username: string; password: string }
  | { type: 'bearer'; token: string };

/** 地址条目：字符串（服务自身认证，内网默认形态）或 {url, auth?}（显式
 * 覆盖凭据）。与插件同构，语义不得简化成「只是一个 URL」。 */
export type AddressEntry = string | { url: string; auth?: BackendAuth };

/** 脱敏占位符（与插件 "***" 同源）：回传浏览器的秘密字段、以及用户留空
 * 提交时的「保持不变」信号。 */
export const REDACTED_SECRET = '***';

export interface BackendAddrs {
  internal?: AddressEntry;
  external?: AddressEntry;
}

const ADDRESS_SLOTS = ['internal', 'external'] as const;

/** 地址条目 → URL 字符串（str 原样；对象取 .url；其他 → ''）。所有按
 * 后端名解析 URL 的调用点都经这里，不各自读 .internal/.external。 */
export function addressUrl(entry: AddressEntry | undefined | null): string {
  if (typeof entry === 'string') return entry.trim();
  if (entry && typeof entry === 'object' && typeof entry.url === 'string') return entry.url.trim();
  return '';
}

/** 凭据归一（插件 _normalize_auth 语义）：basic 需 username+password，
 * bearer 需 token；空串与脱敏占位 '***' 视为未填（不写盘、不回填）。 */
function normalizeAuth(raw: unknown): BackendAuth | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const a = raw as Record<string, unknown>;
  const type = typeof a.type === 'string' ? a.type.trim().toLowerCase() : '';
  if (type === 'basic') {
    const username = typeof a.username === 'string' ? a.username.trim() : '';
    const password = typeof a.password === 'string' ? a.password.trim() : '';
    if (!username || !password || password === REDACTED_SECRET) return null;
    return { type: 'basic', username, password };
  }
  if (type === 'bearer') {
    const token = typeof a.token === 'string' ? a.token.trim() : '';
    if (!token || token === REDACTED_SECRET) return null;
    return { type: 'bearer', token };
  }
  return null;
}

/** 地址条目归一：string → 归一化 URL（原逻辑等价）；对象要求 url 通过
 * normalizeHttpUrl + isHttpUrl，凭据不完整则塌回纯 URL 条目（诚实：不落
 * 半个凭据，且配置文件的规范形态 = 服务自身认证就是字符串）。 */
function normalizeEntry(raw: unknown): AddressEntry | undefined {
  if (typeof raw === 'string') {
    const url = normalizeHttpUrl(raw);
    return isHttpUrl(url) ? url : undefined;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const obj = raw as { url?: unknown; auth?: unknown };
  const url = normalizeHttpUrl(typeof obj.url === 'string' ? obj.url : '');
  if (!isHttpUrl(url)) return undefined;
  const auth = normalizeAuth(obj.auth);
  return auth ? { url, auth } : url;
}

/** 保存合并（插件 merge_address_entries 语义，按槽位位置配对）：
 * - 新条目 = 字符串 → 原样（显式降级为服务自身认证，丢弃旧凭据）；
 * - 对象无 auth / type 非 basic|bearer → 同样丢弃旧凭据，存纯 URL；
 * - 秘密字段为空或 '***' → 继承旧条目同类型同名字段（脱敏回传 = 保持不变）；
 * - 继承后凭据仍不完整 → 降级为纯 URL 条目（插件同语义）。 */
export function mergeAddressEntry(
  oldEntry: AddressEntry | undefined,
  newEntry: unknown,
): AddressEntry | undefined {
  if (newEntry === undefined || newEntry === null) return undefined;
  if (typeof newEntry === 'string') {
    const url = normalizeHttpUrl(newEntry);
    return isHttpUrl(url) ? url : undefined;
  }
  if (typeof newEntry !== 'object' || Array.isArray(newEntry)) return undefined;
  const obj = newEntry as { url?: unknown; auth?: unknown };
  const url = normalizeHttpUrl(typeof obj.url === 'string' ? obj.url : '');
  if (!isHttpUrl(url)) return undefined;
  const rawAuth = obj.auth;
  const type =
    rawAuth && typeof rawAuth === 'object' && !Array.isArray(rawAuth)
      ? String((rawAuth as { type?: unknown }).type ?? '').trim().toLowerCase()
      : '';
  if (type !== 'basic' && type !== 'bearer') return url;
  const oldAuth = typeof oldEntry === 'object' && oldEntry ? oldEntry.auth : undefined;
  if (type === 'basic') {
    const a = rawAuth as { username?: unknown; password?: unknown };
    const username =
      (typeof a.username === 'string' ? a.username.trim() : '') ||
      (oldAuth?.type === 'basic' ? oldAuth.username : '');
    let password = typeof a.password === 'string' ? a.password.trim() : '';
    if ((!password || password === REDACTED_SECRET) && oldAuth?.type === 'basic') {
      password = oldAuth.password;
    }
    return username && password && password !== REDACTED_SECRET
      ? { url, auth: { type: 'basic', username, password } }
      : url;
  }
  const a = rawAuth as { token?: unknown };
  let token = typeof a.token === 'string' ? a.token.trim() : '';
  if ((!token || token === REDACTED_SECRET) && oldAuth?.type === 'bearer') token = oldAuth.token;
  return token && token !== REDACTED_SECRET ? { url, auth: { type: 'bearer', token } } : url;
}

/** 读取脱敏（插件 redact）：秘密字段一律 '***'，username 保留（非机密，
 * 前端回显）；无凭据条目回传字符串或 {url}——明文凭据永不出服务端。 */
export function redactAddressEntry(entry: AddressEntry | undefined): AddressEntry | undefined {
  if (entry === undefined) return undefined;
  if (typeof entry === 'string') return entry;
  if (!entry.auth) return { url: entry.url };
  if (entry.auth.type === 'basic') {
    return {
      url: entry.url,
      auth: { type: 'basic', username: entry.auth.username, password: REDACTED_SECRET },
    };
  }
  return { url: entry.url, auth: { type: 'bearer', token: REDACTED_SECRET } };
}

export function redactBackends(
  backends: Partial<Record<BackendName, BackendAddrs>>,
): Partial<Record<BackendName, BackendAddrs>> {
  const out: Partial<Record<BackendName, BackendAddrs>> = {};
  for (const name of BACKEND_NAMES) {
    const addrs = backends[name];
    if (!addrs) continue;
    const redacted: BackendAddrs = {};
    for (const slot of ADDRESS_SLOTS) {
      const entry = redactAddressEntry(addrs[slot]);
      if (entry) redacted[slot] = entry;
    }
    if (redacted.internal || redacted.external) out[name] = redacted;
  }
  return out;
}

/** 地址模式（对齐工作台插件）：auto=内网优先并自动回退外网；lan=只用内网；
 * wan=只用外网。固定档失败不静默切换（与插件 _pinned_note 同语义）。 */
export type AddressMode = 'auto' | 'lan' | 'wan';
export const ADDRESS_MODES: AddressMode[] = ['auto', 'lan', 'wan'];

export interface DashboardConfig {
  version: number;
  backends: Partial<Record<BackendName, BackendAddrs>>;
  addressMode?: AddressMode;
}

export function configFilePath(): string {
  return (process.env.DASHBOARD_CONFIG_FILE || '/data/agentteams-dashboard/config.json').trim();
}

async function tokenFilePath(): Promise<string> {
  const path = await import('node:path');
  return path.join(path.dirname(configFilePath()), '.setup-token');
}

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

/** 地址协议自动识别（异地部署常用 `host:port`）：
 * - 空串原样；
 * - 已带 http/https → 保留协议、去尾斜杠；
 * - 其它 scheme（ws:/javascript: 等）原样返回，交由 isHttpUrl 拒绝；
 * - 无 scheme → 前缀 http://。 */
export function normalizeHttpUrl(value: string | undefined | null): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(raw);
  if (m) {
    const scheme = m[1].toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') return raw;
    const rest = raw.slice(m[0].length).replace(/\/+$/, '');
    return rest ? `${scheme}://${rest}` : `${scheme}://`;
  }
  if (/^(ws|wss|ftp|ftps|file|data|mailto|javascript|blob):/i.test(raw)) return raw;
  return `http://${raw.replace(/\/+$/, '')}`;
}

export function isHttpUrl(value: string | undefined | null): value is string {
  if (!value) return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// Cloud instance-metadata sentinels: never a legitimate dashboard backend in
// any mode. Post-merge review: the original string-equality check on the
// plain IP missed the IPv4-mapped IPv6 form ([::ffff:169.254.169.254]), the
// rest of the 169.254.0.0/16 range, IPv6 link-local, and the common metadata
// DNS names.
const METADATA_HOSTNAMES = new Set([
  'metadata',
  'metadata.google.internal',
  'metadata.google.com',
  'instance-data',
]);

/** IPv4 address embedded in an IPv4-mapped IPv6 literal, if any. */
function ipv4MappedFrom(hostname: string): string | null {
  const dotted = hostname.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (dotted) return dotted[1];
  const hext = hostname.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hext) return null;
  const hi = Number.parseInt(hext[1], 16);
  const lo = Number.parseInt(hext[2], 16);
  return `${hi >>> 8}.${hi & 0xff}.${lo >>> 8}.${lo & 0xff}`;
}

/** 169.254.0.0/16 — link-local, the cloud metadata sentinel range. */
function isIpv4LinkLocal(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4) return false;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return nums[0] === 169 && nums[1] === 254;
}

/** fe80::/10 — IPv6 link-local (zone id, if any, stripped). */
function isIpv6LinkLocal(hostname: string): boolean {
  const h = hostname.toLowerCase().split('%')[0];
  return h.includes(':') && /^fe[89ab]/.test(h);
}

/** Metadata sentinel in any form: plain IP, IPv4-mapped, /16 range,
 * fe80::/10, or the DNS names that resolve to it. */
function isMetadataTarget(hostname: string): boolean {
  const mapped = ipv4MappedFrom(hostname);
  const hosts = mapped ? [hostname, mapped] : [hostname];
  return (
    hosts.some((h) => h === '169.254.169.254' || isIpv4LinkLocal(h) || METADATA_HOSTNAMES.has(h)) ||
    isIpv6LinkLocal(hostname)
  );
}

// Optional SSRF filter for the pre-login "test connection" endpoint.
// Empty (default) = allow any http(s) target — this is a local
// self-configuration tool; operators can pin exact hosts if they want.
export function isTestTargetAllowed(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url.trim()).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  // Cloud instance-metadata sentinel: never a legitimate dashboard backend
  // in any mode (the setup probe is an authenticated owner tool since the
  // PR-91 security review — this is belt, not the suspenders). Covers the
  // plain IP, IPv4-mapped IPv6 forms, the whole 169.254.0.0/16 range,
  // IPv6 link-local, and the common metadata DNS names (post-merge review).
  if (isMetadataTarget(hostname)) return false;
  const fromEnv = (process.env.DASHBOARD_ALLOWED_HOSTS || '').trim();
  // Empty = allow (local self-config posture — plugin config_test parity).
  // Since the PR-91 review the probe endpoint is no longer reachable
  // unauthenticated: pre-login callers must hold the setup token (or the
  // installer opted out with DASHBOARD_SETUP_TOKEN_ENFORCE=0, trusted-LAN),
  // and post-login callers hold a session. Set DASHBOARD_ALLOWED_HOSTS for
  // a strict allowlist regardless of caller.
  if (!fromEnv) return true;
  const allowed = fromEnv
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return allowed.some((h) => hostname === h || hostname.endsWith(`.${h}`));
}

// ---------------------------------------------------------------------------
// Config file access (sync read — see header; async writes)
// ---------------------------------------------------------------------------

export function normalizeConfig(parsed: unknown): DashboardConfig | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const candidate = parsed as Partial<DashboardConfig>;
  if (!candidate.backends || typeof candidate.backends !== 'object') return null;
  // Keep only valid entries; silently drop malformed ones so a partially
  // edited file cannot take the dashboard down.
  const backends: DashboardConfig['backends'] = {};
  for (const name of BACKEND_NAMES) {
    const entry = candidate.backends[name];
    if (!entry || typeof entry !== 'object') continue;
    const out: BackendAddrs = {};
    // 槽位条目：string（服务自身认证）或 {url, auth?}——两种形态同一归一。
    const internal = normalizeEntry(entry.internal);
    const external = normalizeEntry(entry.external);
    if (internal) out.internal = internal;
    if (external) out.external = external;
    if (out.internal || out.external) backends[name] = out;
  }
  const mode = candidate.addressMode;
  const addressMode: AddressMode =
    mode === 'lan' || mode === 'wan' || mode === 'auto' ? mode : 'auto';
  return { version: 1, backends, addressMode };
}

export function readConfigSync(): DashboardConfig | null {
  // Sync contract (called from sync URL resolution in proxy-helper). Uses the
  // module-init-warmed fs cache; null until warm or in non-Node environments.
  if (!fsResolved) return null;
  try {
    const raw = fsResolved.readFileSync(configFilePath(), 'utf-8');
    return normalizeConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function configExists(): Promise<boolean> {
  const fsp = (await loadFs()).promises;
  try {
    await fsp.access(configFilePath());
    return true;
  } catch {
    return false;
  }
}

async function writeConfigAtomic(config: DashboardConfig): Promise<void> {
  const fsp = (await loadFs()).promises;
  const path = await import('node:path');
  const file = configFilePath();
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(config, null, 2), { mode: 0o644 });
  await fsp.rename(tmp, file);
}

/** Pre-login one-shot write: only succeeds while no config file exists.
 * Unlike updateConfig it rejects a payload with no valid address at all —
 * a first-launch save that ends up configuring nothing is a user error, not
 * a meaningful state. */
export async function saveConfigOneShot(
  backends: DashboardConfig['backends'],
  addressMode?: AddressMode,
): Promise<{ ok: boolean; error?: string }> {
  if (await configExists()) return { ok: false, error: 'already-configured' };
  // First launch: no old entry to inherit from — mergeAddressEntry normalizes
  // the shape and degrades any credential carrying the '***' placeholder to a
  // plain (service-native) URL entry.
  const normalized: DashboardConfig['backends'] = {};
  for (const [name, addrs] of Object.entries(backends) as Array<[BackendName, BackendAddrs]>) {
    const entry: BackendAddrs = {};
    for (const slot of ADDRESS_SLOTS) {
      const mergedEntry = mergeAddressEntry(undefined, addrs?.[slot]);
      if (mergedEntry) entry[slot] = mergedEntry;
    }
    if (entry.internal || entry.external) normalized[name] = entry;
  }
  const config = normalizeConfig({ version: 1, backends: normalized, addressMode });
  if (!config) return { ok: false, error: 'invalid-config' };
  if (Object.keys(config.backends).length === 0) return { ok: false, error: 'invalid-config' };
  await writeConfigAtomic(config);
  return { ok: true };
}

/** Level-3 (L1 admin) update: creates or overwrites the config file. */
export async function updateConfig(
  backends: DashboardConfig['backends'],
  addressMode?: AddressMode,
): Promise<{ ok: boolean; error?: string }> {
  // F1f-E: per-backend MERGE, not full replacement. Sent backends replace
  // their entry; unsent backends are preserved. A partial save (e.g. the
  // admin fixing only the controller address on a shared instance) must
  // never wipe the other backends — under the old replace semantics that
  // one save made the whole instance unusable until re-configured.
  // Explicit removal of a backend = `docker volume rm` factory reset
  // (the UI form always sends all six, so merge === replace from the UI).
  //
  // Per-address credentials (plugin merge_address_entries parity): the pair
  // is matched by SLOT position — a basic/bearer secret that is empty or the
  // '***' redaction placeholder inherits the saved secret of the same slot
  // and type, and an explicit 服务自身认证 entry (plain string) drops it.
  const existingCfg = readConfigSync();
  const existing = existingCfg?.backends ?? {};
  const merged: DashboardConfig['backends'] = { ...existing };
  for (const [name, addrs] of Object.entries(backends) as Array<[BackendName, BackendAddrs]>) {
    const old = existing[name];
    const entry: BackendAddrs = {};
    for (const slot of ADDRESS_SLOTS) {
      const mergedEntry = mergeAddressEntry(old?.[slot], addrs?.[slot]);
      if (mergedEntry) entry[slot] = mergedEntry;
    }
    if (entry.internal || entry.external) merged[name] = entry;
    else delete merged[name];
  }
  const config = normalizeConfig({
    version: 1,
    backends: merged,
    addressMode: addressMode ?? existingCfg?.addressMode ?? 'auto',
  });
  if (!config) return { ok: false, error: 'invalid-config' };
  await writeConfigAtomic(config);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Address resolution (config file > env) + failover working cache
// ---------------------------------------------------------------------------

function envAddr(name: BackendName): string | undefined {
  const env = process.env;
  switch (name) {
    case 'controller':
      return env.AGENTTEAMS_CONTROLLER_URL || env.AGENTTEAMS_API_URL;
    case 'matrix':
      return env.AGENTTEAMS_MATRIX_URL || env.NEXT_PUBLIC_MATRIX_API_URL;
    case 'minio':
      return env.AGENTTEAMS_FS_ENDPOINT || env.AGENTTEAMS_MINIO_ENDPOINT || env.AGENTTEAMS_MINIO_URL;
    case 'higress-gateway':
      return env.AGENTTEAMS_AI_GATEWAY_URL;
    case 'higress-console':
      return env.AGENTTEAMS_AI_GATEWAY_ADMIN_URL;
    case 'sglang':
      return env.AGENTTEAMS_SGLANG_URL;
  }
}

/** Candidate order for one backend: config internal, config external, env.
 * Deduped; invalid URLs dropped. */
export function backendCandidates(name: BackendName, config: DashboardConfig | null): string[] {
  const out: string[] = [];
  const add = (value: string | undefined) => {
    if (value && isHttpUrl(value) && !out.includes(value.trim())) out.push(value.trim());
  };
  const mode = config?.addressMode ?? 'auto';
  if (mode !== 'wan') add(addressUrl(config?.backends[name]?.internal));
  if (mode !== 'lan') add(addressUrl(config?.backends[name]?.external));
  // 固定档下没有匹配槽位 → 仍给 env 兜底（env 是部署级默认，不是“另一条链路”）。
  if (out.length === 0) add(envAddr(name));
  else if (mode === 'auto') add(envAddr(name));
  return out;
}

export function backendCandidatesSync(name: BackendName): string[] {
  return backendCandidates(name, readConfigSync());
}

// TTL safety valve: the plugin's working cache has no TTL (only the background
// re-rank loop and the save re-probe update it). We keep a cap so a hand-edited
// config file cannot pin a stale address forever; 10 min covers the 30/120/300s
// loop intervals with margin.
const WORKING_TTL_MS = 600_000;
interface WorkingEntry {
  url: string;
  at: number;
  ms?: number;
}

// globalThis-scoped on purpose (same lesson as the session store, 87cb478):
// Next may instantiate a server module more than once per process; a plain
// module-level Map would then fragment the working cache.
function workingMap(): Map<BackendName, WorkingEntry> {
  const g = globalThis as unknown as { __dashboardBackendWorking?: Map<BackendName, WorkingEntry> };
  if (!g.__dashboardBackendWorking) g.__dashboardBackendWorking = new Map();
  return g.__dashboardBackendWorking;
}

export function markWorking(name: BackendName, url: string, ms?: number): void {
  const entry = workingMap().get(name);
  workingMap().set(name, { url: url.trim(), at: Date.now(), ms: ms ?? entry?.ms });
}

export function forgetWorking(name: BackendName): void {
  workingMap().delete(name);
}

/** Fresh (within TTL) working entry, or undefined. */
export function workingEntry(name: BackendName): WorkingEntry | undefined {
  const entry = workingMap().get(name);
  if (entry && Date.now() - entry.at < WORKING_TTL_MS) return entry;
  return undefined;
}

/** Currently effective address (working cache), or null. */
export function effectiveUrl(name: BackendName): string | null {
  return workingEntry(name)?.url ?? null;
}

/** Best address for a backend right now: the recently-probed working one if
 * it is still a candidate, else the first candidate. */
export function pickBackendUrl(name: BackendName): string | undefined {
  const candidates = backendCandidatesSync(name);
  const entry = workingEntry(name);
  if (entry && candidates.includes(entry.url)) {
    return entry.url;
  }
  return candidates[0];
}

/** Candidate order used by request-layer failover: fresh working address
 * first (only while it is still a candidate — same guard as pickBackendUrl),
 * then config internal → external → env (deduped). */
export function orderedCandidates(name: BackendName): string[] {
  const candidates = backendCandidatesSync(name);
  const out: string[] = [];
  const add = (v: string | undefined) => {
    if (v && !out.includes(v)) out.push(v);
  };
  const working = workingEntry(name)?.url;
  if (working && candidates.includes(working)) add(working);
  for (const c of candidates) add(c);
  return out;
}

// ---------------------------------------------------------------------------
// Per-address credentials → request headers (plugin parity:
// auth_for_url / headers_with_auth / build_auth_map)
// ---------------------------------------------------------------------------

/** 凭据反查归一：去 http(s):// 前缀 + 去尾斜杠（两侧同口径）。scheme 无关
 * → 同一个地址条目的 http/https 候选变体命中同一份凭据（插件 X1c）。 */
function authMatchKey(value: string): string {
  return value.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** 权威凭据表：全仓唯一出处；拨号点只调 backendAuthHeader，不各写各的。 */
export function authForUrl(name: BackendName, url: string): BackendAuth | null {
  const addrs = readConfigSync()?.backends[name];
  if (!addrs) return null;
  const target = authMatchKey(url);
  if (!target) return null;
  for (const slot of ADDRESS_SLOTS) {
    const entry = addrs[slot];
    if (!entry || typeof entry !== 'object' || !entry.auth) continue;
    if (authMatchKey(addressUrl(entry)) !== target) continue;
    const auth = normalizeAuth(entry.auth);
    if (auth) return auth;
  }
  return null;
}

/** 凭据 → Authorization 头（无凭据 → {}）。只动 Authorization 一个头。 */
export function authHeaderFor(auth: BackendAuth | null | undefined): Record<string, string> {
  if (!auth) return {};
  if (auth.type === 'basic') {
    return { Authorization: `Basic ${toBase64(`${auth.username}:${auth.password}`)}` };
  }
  return { Authorization: `Bearer ${auth.token}` };
}

/** 请求层：该后端地址的覆盖凭据头（无 → {}）。
 * 命中时整体替换 Authorization（网关 Basic/API key 门 = 服务前的门，与
 * 插件 headers_with_auth 同语义）。凭据只进请求头：不写日志、不回传浏览器。 */
export function backendAuthHeader(name: BackendName, url: string): Record<string, string> {
  return authHeaderFor(authForUrl(name, url));
}

// ---------------------------------------------------------------------------
// Shared (multi-user) deployment mode — F1f
//
// DASHBOARD_SHARED_MODE=1 marks an instance that MULTIPLE humans share
// (e.g. a shared single-container deployment: admin L1 + team L2 on one container). The plugin's
// "whoever uses this host edits this config" model assumes one instance per
// human; on a shared instance that model is an attack surface (an L2
// overwriting the backend config redirects EVERY user's data plane). In
// shared mode the dashboard therefore:
//   A: only level-3 (admin) sessions may save the backend config;
//   B: the setup token comes ONLY from DASHBOARD_SETUP_TOKEN env and is
//      NEVER generated or persisted to the volume (no owner credential on
//      disk); with no env token the pre-login write path stays closed;
//      F1f3: DASHBOARD_SETUP_TOKEN_ENFORCE=0 disables the whole gate
//      (installer opt-out — pre-login writes open, no token at all);
//   C: every config write is audited with actor + level + changed fields;
//   D: startup warns if AGENTTEAMS_AUTH_TOKEN (a cluster-level super
//      credential) is in the env — shared deployments should drop it and
//      use the per-login controller-token paste (C2) instead.
// Standalone (one instance per user) deployments keep the F1c behavior:
// any logged-in user saves, token auto-generated + persisted.
// ---------------------------------------------------------------------------

export function isSharedMode(): boolean {
  return process.env.DASHBOARD_SHARED_MODE === '1';
}

/** PR-91 review: the setup-token check shared by the pre-login write paths
 * (POST /setup/backends, POST /setup/backends/test, GET /setup/backends
 * prefill) — one implementation, timing-safe, fails closed on a missing
 * token source (shared mode without env token). */
export async function verifySetupToken(token: string): Promise<boolean> {
  const expected = await getSetupToken();
  // B: shared mode without a DASHBOARD_SETUP_TOKEN env — the pre-login
  // write path is closed (fails closed, no timing comparison on empty).
  if (!expected) return false;
  const crypto = await import('node:crypto');
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** F1f3: the installer (deployer) chooses whether the pre-login setup
 * token gate is enforced. `DASHBOARD_SETUP_TOKEN_ENFORCE=0` disables the
 * gate entirely — pre-login config saves need no token, and no token is
 * generated, printed or persisted (authoritative over DASHBOARD_SETUP_TOKEN).
 * Default (unset or '1') = enforced: all F1e/F1f behavior. Documented risk
 * of opting out: anyone who can reach the dashboard can rewrite the
 * backend addresses — trusted-LAN deployments only (the startup log
 * records the open state, instrumentation.ts). */
export function isSetupTokenEnforced(): boolean {
  return (process.env.DASHBOARD_SETUP_TOKEN_ENFORCE || '').trim() !== '0';
}

// ---------------------------------------------------------------------------
// First-launch setup token (gates the pre-auth write; repeatable — F1e)
// ---------------------------------------------------------------------------

export async function getSetupToken(): Promise<string> {
  // F1f3: the installer disabled the gate — no token exists at all.
  if (!isSetupTokenEnforced()) return '';
  const fromEnv = (process.env.DASHBOARD_SETUP_TOKEN || '').trim();
  if (fromEnv) return fromEnv;
  // B: shared mode — env is the ONLY token source. Nothing is generated,
  // printed or persisted; an empty result means the pre-login write path
  // is closed (verifySetupToken fails closed on it).
  if (isSharedMode()) return '';
  const fsp = (await loadFs()).promises;
  const path = await import('node:path');
  const tokenFile = await tokenFilePath();
  try {
    const persisted = (await fsp.readFile(tokenFile, 'utf-8')).trim();
    if (persisted) return persisted;
  } catch {
    // fall through to generation
  }
  const crypto = await import('node:crypto');
  const token = crypto.randomBytes(16).toString('hex');
  try {
    await fsp.mkdir(path.dirname(tokenFile), { recursive: true });
    await fsp.writeFile(tokenFile, token, { mode: 0o600 });
  } catch {
    // Read-only fs (tests): the token is still usable in this process.
  }
  // The pre-login setup page tells the user where to find it. console.error
  // (not log): the no-console lint rule only permits warn/error, and the
  // token must land in the plain `docker logs` stream either way.
  console.error(`[dashboard] one-time backend setup token: ${token}`);
  return token;
}

/**
 * Process-start bootstrap (post-merge review Block 4), called from
 * instrumentation register(): in standalone + enforced mode the setup token
 * must be retrievable from `docker logs` the moment the process is up — the
 * setup page tells the operator to search the logs, but getSetupToken() is
 * otherwise lazy (first verifySetupToken call only), so a fresh
 * deployment's logs contained no token until the first (wrong) submission.
 * No-op in shared mode (env is the only source by design), ENFORCE=0 (no
 * token at all), and env-token mode (the operator already holds it).
 */
export async function bootstrapSetupToken(): Promise<void> {
  if (isSharedMode() || !isSetupTokenEnforced()) return;
  if ((process.env.DASHBOARD_SETUP_TOKEN || '').trim()) return;
  const token = await getSetupToken();
  if (!token) return;
  console.error(`[dashboard] one-time backend setup token: ${token}`);
}

// ---------------------------------------------------------------------------
// Health probes (per-kind path; also used by the infrastructure panel)
// ---------------------------------------------------------------------------

const PROBE_PATHS: Record<BackendName, { path: string; method?: 'POST'; body?: string }> = {
  controller: { path: '/healthz' },
  matrix: { path: '/_matrix/client/versions' },
  minio: { path: '/minio/health/live' },
  // POST /v1/chat/completions with an unauthenticated probe: 404 = route
  // missing (unreachable), any other status = gateway is up.
  'higress-gateway': {
    path: '/v1/chat/completions',
    method: 'POST',
    body: JSON.stringify({ model: 'probe', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
  },
  // Console (Next.js): any HTTP response means it is up.
  'higress-console': { path: '/' },
  sglang: { path: '/v1/models' },
};

export interface ProbeResult {
  /** Network-layer connectivity: any HTTP response received (401/403/5xx
   * count as connected too) — plugin v0.4.93 two-layer model. */
  ok: boolean;
  /** Status code < 400 — only httpOk results are eligible for the effective
   * election (401/403 = "connected but needs auth"). */
  httpOk: boolean;
  status?: number;
  latencyMs: number;
  /** Classified error (only when !ok); network-layer failures may carry a
   * DNS segment diagnostic appended. */
  error?: string;
}

/** Per-address probe row for the UI / test endpoints (plugin config_test rows). */
export interface ProbeRow {
  url: string;
  ok: boolean;
  httpOk: boolean;
  ms: number | null;
  detail: string;
}

// ---------------------------------------------------------------------------
// Error classification (port of plugin selfcheck._classify_error)
//
// Three-layer semantics: "TLS 证书错误" is reserved for certificate
// verification failures; a handshake interruption is NOT a certificate error
// (often a middlebox / fake-ip).
// ---------------------------------------------------------------------------

export function classifyProbeError(err: unknown, timedOut: boolean): string {
  if (timedOut) return '连接超时（网络慢或地址不可达）';
  // undici wraps the real error in `TypeError: fetch failed` — walk the cause
  // chain collecting codes and messages.
  const codes: string[] = [];
  const messages: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur && typeof cur === 'object'; i++) {
    const e = cur as { code?: unknown; message?: unknown };
    if (typeof e.code === 'string' && e.code) codes.push(e.code);
    if (typeof e.message === 'string' && e.message) messages.push(e.message);
    cur = (cur as { cause?: unknown }).cause;
  }
  const msg = messages.join(' | ');
  if (codes.includes('ENOTFOUND') || codes.includes('EAI_AGAIN') || /getaddrinfo|ENOTFOUND/i.test(msg)) {
    return 'DNS 解析失败 — 检查域名拼写或内网 IP';
  }
  if (codes.includes('ECONNREFUSED')) return '连接被拒绝 — 端口未开放或服务未启动（公网地址若确认端口开放，亦可能为中间盒/DPI RST 拦截）';
  if (codes.includes('ETIMEDOUT')) return '连接超时（网络慢或地址不可达）';
  if (
    /CERTIFICATE_VERIFY_FAILED|certificate verify failed|certificate has expired|certificate is not yet valid|self[- ]signed|unable to verify the first certificate|unable to get local issuer|UNABLE_TO_VERIFY_LEAF_SIGNATURE/i.test(msg)
  ) {
    return 'TLS 证书校验失败 — 证书不受信任（自签/过期/链不完整）';
  }
  if (codes.includes('EPROTO') || /TLS|SSL|wrong version number|unexpected eof|handshake/i.test(msg)) {
    return `TLS 握手失败（加密协商被中断）— 常见于：部署机代理/中间盒拦截、DNS 解析到非公网 IP（fake-ip）、服务端协议不匹配｜detail: ${msg.slice(0, 220)}`;
  }
  if (codes.includes('ECONNRESET') || codes.includes('EPIPE') || /socket hang up/i.test(msg)) {
    return '连接被重置(RST) — 常见于：中间盒/DPI 拦截（SNI+TLS 栈指纹）、服务端主动断开、网络不稳定';
  }
  return `连接失败: ${msg.slice(0, 120) || 'unknown error'}`;
}

// Non-public address segments (port of plugin _FAKE_IP_HINTS): when DNS is
// hijacked by a proxy, resolution lands in these ranges and the visible error
// looks like a TLS failure while the root cause is on the deployment host.
const IP_SEGMENT_HINTS: Array<{ match: (_ip: string) => boolean; label: string }> = [
  { match: (ip) => ip.startsWith('198.18.') || ip.startsWith('198.19.'), label: 'fake-ip 段（代理/Clash 常用，非公网）' },
  {
    match: (ip) => ip.startsWith('::ffff:198.18.') || ip.startsWith('::ffff:198.19.'),
    label: 'fake-ip 段（v4 映射，代理 DNS 劫持典型）',
  },
  { match: (ip) => ip.startsWith('fdfe:') || ip.startsWith('fc') || ip.startsWith('fd'), label: 'IPv6 ULA 私有段（非公网）' },
  {
    match: (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|169\.254\.)/.test(ip),
    label: '内网/保留段（非公网）',
  },
];

/** Resolve the hostname and diagnose non-public segments (fake-ip / ULA /
 * private) — the classic "proxy DNS hijack" fingerprint. IP literals get a
 * plain segment note (no DNS was involved); domains get the full
 * "DNS may be hijacked by the proxy" diagnosis. Returns '' when public or
 * when the lookup itself fails (the base error already covers that). */
export async function resolveIpHint(url: string): Promise<string> {
  try {
    const host = new URL(url).hostname;
    if (!host) return '';
    const { default: net } = await import('node:net');
    const describe = (ips: string[]) => {
      const labels = [
        ...new Set(ips.map((ip) => IP_SEGMENT_HINTS.find((h) => h.match(ip))?.label).filter((l): l is string => !!l)),
      ];
      return labels.length > 0 ? labels.join('；') : '';
    };
    // IP literal: no DNS involved — only state the segment.
    if (net.isIP(host) !== 0) {
      const note = describe([host]);
      return note ? `该 IP 属于${note}` : '';
    }
    const dns = await import('node:dns');
    const infos = await dns.promises.lookup(host, { all: true });
    const ips = infos.slice(0, 3).map((i) => i.address);
    if (ips.length === 0) return '';
    const note = describe(ips);
    if (!note) return '';
    return `解析到 ${ips.join('/')} — ${note}：域名部署机的 DNS 可能被代理劫持，检查系统代理/DNS 设置（服务端证书本身可能没问题）`;
  } catch {
    return '';
  }
}

/**
 * Probe fetch with vetted redirects (post-merge review): the default fetch
 * follows 302/308, so a target that redirects to the cloud metadata sentinel
 * (or any other address) would bypass isTestTargetAllowed, which only vets
 * the ORIGINAL url. Each hop is re-vetted with the same filter — a
 * disallowed hop is refused, while a benign self-redirect (e.g. a console's
 * Next trailing-slash 308) still resolves. Cap: 2 hops.
 */
async function probeFetchWithVettedRedirects(url: string, init: RequestInit, maxHops = 2): Promise<Response> {
  let current = url;
  for (let hop = 0; ; hop += 1) {
    const res = await fetch(current, { ...init, redirect: 'manual' });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!location || hop >= maxHops) return res;
    const next = new URL(location, current).toString();
    if (!isTestTargetAllowed(next)) {
      throw new Error(`probe redirect refused: target host "${new URL(next).hostname}" not allowed`);
    }
    current = next;
  }
}

async function probeOnce(name: BackendName, url: string, timeoutMs: number): Promise<ProbeResult> {
  const spec = PROBE_PATHS[name];
  const target = new URL(spec.path, url.replace(/\/+$/, '')).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const res = await probeFetchWithVettedRedirects(target, {
      method: spec.method ?? 'GET',
      signal: controller.signal,
      headers: spec.body ? { 'content-type': 'application/json' } : undefined,
      body: spec.body,
    });
    const latencyMs = Date.now() - startedAt;
    if (name === 'higress-gateway' && res.status === 404) {
      // 404 = the gateway answered, but the AI route is missing.
      return { ok: true, httpOk: false, status: 404, latencyMs, error: '网关在线，AI 路由缺失（HTTP 404）' };
    }
    return { ok: true, httpOk: res.status < 400, status: res.status, latencyMs };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'AbortError';
    let error = classifyProbeError(err, timedOut);
    const hint = await resolveIpHint(url);
    if (hint) error = `${error}｜${hint}`;
    return { ok: false, httpOk: false, latencyMs: Date.now() - startedAt, error };
  } finally {
    clearTimeout(timeout);
  }
}

export async function probeBackend(
  name: BackendName,
  url: string,
  timeoutMs = 5000,
): Promise<ProbeResult> {
  const first = await probeOnce(name, url, timeoutMs);
  if (first.ok) return first;
  // v0.4.92 port: a one-off network-layer blip should not fail a row — retry
  // once after 500ms. Connected results (including 401/403) are never retried.
  await new Promise((resolve) => setTimeout(resolve, 500));
  return probeOnce(name, url, timeoutMs);
}

/** Convert a probe result into a UI row (plugin config_test row semantics). */
export function toProbeRow(url: string, r: ProbeResult): ProbeRow {
  if (r.ok) {
    const detail =
      r.error ??
      (r.httpOk
        ? `HTTP ${r.status}，正常`
        : r.status === 401 || r.status === 403
          ? `已连通，HTTP ${r.status}（需鉴权）`
          : `已连通，HTTP ${r.status}（状态异常）`);
    return { url, ok: true, httpOk: r.httpOk, ms: r.latencyMs, detail };
  }
  return { url, ok: false, httpOk: false, ms: null, detail: r.error ?? '不可达' };
}

// ---------------------------------------------------------------------------
// Effective-address election (port of plugin selfcheck._select_and_mark)
// ---------------------------------------------------------------------------

const HYSTERESIS_MIN_MS = 100;
const HYSTERESIS_RATIO = 0.3;

/** Latency-based fastest-wins + debounce hysteresis: the challenger must be
 * faster by max(100ms, 30% of the current) before switching; a dead current
 * switches immediately; nobody reachable → cache untouched. Returns the
 * effective url (null when nothing is eligible). */
export function selectAndMark(name: BackendName, rows: ProbeRow[]): string | null {
  const eligible = rows.filter((r) => r.ok && r.httpOk && r.ms != null);
  if (eligible.length === 0) return null;
  const best = eligible.reduce((a, b) => ((a.ms ?? 0) <= (b.ms ?? 0) ? a : b));
  const current = workingEntry(name)?.url;
  const curRow = current ? eligible.find((r) => r.url === current) : undefined;
  if (curRow && best.url !== curRow.url) {
    const gap = (curRow.ms ?? 0) - (best.ms ?? 0);
    if (gap <= Math.max(HYSTERESIS_MIN_MS, HYSTERESIS_RATIO * (curRow.ms ?? 0))) {
      // Keep the current one (touched: it was verified reachable this round).
      markWorking(name, curRow.url, curRow.ms ?? undefined);
      return curRow.url;
    }
  }
  markWorking(name, best.url, best.ms ?? undefined);
  return best.url;
}

/** True when `tested` equals the SAVED config-file list for the backend
 * (plugin config_test "applied" comparison). An empty saved list never
 * applies — draft testing must never rewrite the effective cache. */
export function listMatchesSaved(name: BackendName, tested: string[]): boolean {
  const cfg = readConfigSync()?.backends[name];
  if (!cfg) return false;
  const saved = [addressUrl(cfg.internal), addressUrl(cfg.external)]
    .filter((v): v is string => !!v && v.trim() !== '')
    .map((v) => v.trim());
  if (saved.length === 0) return false;
  const t = tested.map((u) => u.trim()).filter(Boolean);
  if (t.length !== saved.length) return false;
  return saved.every((u) => t.includes(u));
}

// ---------------------------------------------------------------------------
// Re-probe + re-elect (port of plugin refresh_effective)
// ---------------------------------------------------------------------------

export interface RefreshResult {
  effective: Partial<Record<BackendName, string>>;
  switched: Partial<Record<BackendName, boolean>>;
}

/** Injectable probe seam — tests substitute this so refreshEffective's
 * election logic runs without real network I/O (a whole-module vi.mock of
 * probeBackend cannot reach the module-internal call below). */
export type BackendProbeFn = typeof probeBackend;

/** Probe every candidate of the given backends and re-elect the effective
 * address. Used by the background re-rank loop (address-probe.ts) and the
 * post-save re-probe. */
export async function refreshEffective(
  names: BackendName[] = BACKEND_NAMES,
  timeoutMs = 4000,
  probeFn: BackendProbeFn = probeBackend,
): Promise<RefreshResult> {
  const effective: RefreshResult['effective'] = {};
  const switched: RefreshResult['switched'] = {};
  await Promise.all(
    names.map(async (name) => {
      const candidates = backendCandidatesSync(name);
      if (candidates.length === 0) return;
      const prev = workingEntry(name)?.url ?? null;
      const results = await Promise.all(candidates.map((url) => probeFn(name, url, timeoutMs)));
      const rows = candidates.map((url, i) => toProbeRow(url, results[i]));
      const picked = selectAndMark(name, rows);
      if (picked) {
        effective[name] = picked;
        if (prev && prev !== picked) switched[name] = true;
      }
    }),
  );
  return { effective, switched };
}

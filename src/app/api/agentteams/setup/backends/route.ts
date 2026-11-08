// /api/agentteams/setup/backends — dashboard-level backend address config (F1).
//
// GET (gate-shape public, topology gated — PR-91 review): the anonymous
// response reports only { configured, setupTokenRequired, embedded } so a
// logged-out caller cannot enumerate the saved topology. Candidates and
// effective are served to an authenticated session or a pre-login caller
// with the setup token (?token= — same owner gate as the pre-login write),
// which the ?setup=1 reconfigure page uses to prefill the saved addresses.
// Drives the first-launch gate on the root page: unconfigured -> backend
// setup UI instead of the login form. The embedded auto-detect probe only
// runs in the unconfigured case so normal deployments pay zero extra latency.
//
// POST (auth modes — F1c + F1f shared-mode hardening):
//   - post-login, standalone (default, one instance per user): any logged-in
//     user (L1 or L2) may create or update the config — plugin parity, the
//     instance's user IS the plugin's "user of this host".
//   - post-login, shared (DASHBOARD_SHARED_MODE=1, e.g. a shared multi-user deployment):
//     only level-3 (admin) sessions may save (A). An L2 overwriting the
//     backend config on a shared instance would redirect EVERY user's data
//     plane (config file > env, global) — that is attack surface ①.
//     Every save is audited with actor + level + changed fields (C).
//   - pre-login (token-gated, repeatable — F1e): body.token must equal the
//     setup token. First launch creates the config; afterwards the same
//     token remains the ONLY owner gate for re-configuring from a
//     logged-out browser — the escape hatch for broken/changed
//     environments (wrong addresses, network move), reachable from the
//     login screen via ?setup=1. Plugin parity (config-first): the config
//     surface stays reachable before login and login is downstream of it.
//     Shared mode (B): the token comes ONLY from DASHBOARD_SETUP_TOKEN env
//     and is never persisted; with no env token this path is closed.
//     The SSRF surface of user-supplied addresses stays pinned by
//     DASHBOARD_ALLOWED_HOSTS; config editing does not touch credentials
//     (L1 SA token / L2 session tokens stay server-side).
//   - pre-login (token-gated, repeatable — F1e): body.token must equal the
//     setup token. First launch creates the config; afterwards the same
//     token remains the ONLY owner gate for re-configuring from a
//     logged-out browser — the escape hatch for broken/changed
//     environments (wrong addresses, network move), reachable from the
//     login screen via ?setup=1. Plugin parity (config-first): the config
//     surface stays reachable before login and login is downstream of it;
//     the dashboard's install-method difference (a web login gate the
//     host-embedded plugin lacks) keeps the token as the pre-login write
//     authority — it plugs the auth-bypass threat (a logged-out attacker
//     redirecting the controller to a fake backend to spoof L1 password
//     verification). Losing the token = `docker volume rm` factory reset.
//
// Every successful save re-probes the saved backends (plugin put_config →
// refresh_effective) and returns `effective` / `switched` for the UI banner.
import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/dashboard-session';
import {
  BACKEND_NAMES,
  EMBEDDED_DEFAULTS,
  REQUIRED_BACKENDS,
  addressUrl,
  backendCandidates,
  configExists,
  effectiveUrl,
  isHttpUrl,
  isSetupTokenEnforced,
  isSharedMode,
  normalizeHttpUrl,
  pickBackendUrl,
  probeBackend,
  readConfigSync,
  redactBackends,
  refreshEffective,
  saveConfigOneShot,
  updateConfig,
  verifySetupToken,
  type AddressEntry,
  type BackendAddrs,
  type BackendName,
} from '@/lib/backend-config';
import { appendAuditEvent } from '@/lib/audit-log';
import { isAddressLike, resolveBackendUrl } from '@/lib/backend-url-resolve';

type BackendNameSet = Record<string, BackendName>;

/** 槽位条目解析：字符串（服务自身认证）或 {url, auth?}（显式覆盖凭据）。
 * 凭据的「留空 / *** = 继承旧值」在 updateConfig 的按槽位合并里处理，这里
 * 只校验形状与地址形态。地址允许省略协议（`host:port`）：协议由
 * resolveBackendUrl 解析（https 优先）后再落盘，本函数不擅自补 http://。 */
function parseSlot(candidate: unknown): { entry?: AddressEntry; error?: string } {
  if (candidate === undefined || candidate === null || candidate === '') return {};
  if (typeof candidate === 'string') {
    if (!isAddressLike(candidate)) return { error: 'must be an http(s) URL' };
    return { entry: normalizeHttpUrl(candidate) };
  }
  if (typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { error: 'must be a string or { url, auth }' };
  }
  const obj = candidate as { url?: unknown; auth?: unknown };
  const rawUrl = typeof obj.url === 'string' ? obj.url : '';
  if (!isAddressLike(rawUrl)) return { error: 'url must be an http(s) URL' };
  const url = normalizeHttpUrl(rawUrl);
  if (obj.auth === undefined || obj.auth === null) return { entry: { url } };
  if (typeof obj.auth !== 'object' || Array.isArray(obj.auth)) {
    return { error: 'auth must be an object' };
  }
  const auth = obj.auth as Record<string, unknown>;
  const type = typeof auth.type === 'string' ? auth.type.trim().toLowerCase() : '';
  if (type === 'basic') {
    const username = typeof auth.username === 'string' ? auth.username.trim() : '';
    if (!username) return { error: 'auth.username is required for basic auth' };
    const password = typeof auth.password === 'string' ? auth.password.trim() : '';
    return { entry: { url, auth: { type: 'basic', username, password } } };
  }
  if (type === 'bearer') {
    const token = typeof auth.token === 'string' ? auth.token.trim() : '';
    return { entry: { url, auth: { type: 'bearer', token } } };
  }
  return { error: 'auth.type must be "basic" or "bearer"' };
}

function parseBackendsPayload(
  raw: unknown,
): { backends?: Partial<Record<BackendName, BackendAddrs>>; error?: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'backends must be an object' };
  }
  const out: Partial<Record<BackendName, BackendAddrs>> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(key in BACKEND_NAMES_SET)) {
      return { error: `unknown backend "${key}"` };
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { error: `backend "${key}" must be an object` };
    }
    const entry = value as Record<string, unknown>;
    const addrs: BackendAddrs = {};
    for (const slot of ['internal', 'external'] as const) {
      const parsed = parseSlot(entry[slot]);
      if (parsed.error) return { error: `backend "${key}" ${slot} ${parsed.error}` };
      if (parsed.entry) addrs[slot] = parsed.entry;
    }
    if (addrs.internal || addrs.external) out[key as BackendName] = addrs;
  }
  return { backends: out };
}

const BACKEND_NAMES_SET: BackendNameSet = Object.fromEntries(
  BACKEND_NAMES.map((name) => [name, name]),
);

/** 协议探测失败的告知（UI 展示用）：哪个槽位、用户原输入、落地的 URL。 */
export interface BackendResolveWarning {
  backend: BackendName;
  slot: 'internal' | 'external';
  input: string;
  url: string;
  warning: 'scheme_unresolved';
}

interface ResolvedPayload {
  backends: Partial<Record<BackendName, BackendAddrs>>;
  /** 后端 → 槽位 → 解析后的地址（UI 用来自动回填输入框）。 */
  resolved: Partial<Record<BackendName, { internal?: string; external?: string }>>;
  warnings: BackendResolveWarning[];
}

/** 保存前逐个地址解析协议（https 优先，见 backend-url-resolve）。显式
 * http(s) 地址原样保留；无协议 `host:port` 探测后落成确定 URL，探测不到则
 * 按 https 落地并回报 warning —— 绝不静默存成 http（TLS 端口收明文会被
 * nginx 以 400 拒绝）。凭据随条目原样保留。 */
async function resolveBackendsPayload(
  sent: Partial<Record<BackendName, BackendAddrs>>,
): Promise<ResolvedPayload> {
  const backends: ResolvedPayload['backends'] = {};
  const resolved: ResolvedPayload['resolved'] = {};
  const warnings: BackendResolveWarning[] = [];
  await Promise.all(
    (Object.keys(sent) as BackendName[]).map(async (name) => {
      const addrs = sent[name]!;
      const entry: BackendAddrs = {};
      const urls: { internal?: string; external?: string } = {};
      await Promise.all(
        (['internal', 'external'] as const).map(async (slot) => {
          const item = addrs[slot];
          if (!item) return;
          const input = addressUrl(item);
          if (!input) return;
          const result = await resolveBackendUrl(input);
          if (!isHttpUrl(result.url)) return; // 非 http(s) → 不落库（merge 同样丢）
          if (result.warning) {
            warnings.push({ backend: name, slot, input, url: result.url, warning: result.warning });
          }
          entry[slot] = typeof item === 'string' ? result.url : { ...item, url: result.url };
          urls[slot] = result.url;
        }),
      );
      if (entry.internal || entry.external) {
        backends[name] = entry;
        resolved[name] = urls;
      }
    }),
  );
  return { backends, resolved, warnings };
}

export async function GET(request: NextRequest) {
  const config = readConfigSync();
  const perBackend: Record<string, { configured: boolean; candidates: string[] }> = {};
  let configured = true;
  for (const name of BACKEND_NAMES) {
    const candidates = backendCandidates(name, config);
    perBackend[name] = { configured: candidates.length > 0, candidates };
    if (REQUIRED_BACKENDS.includes(name) && candidates.length === 0) configured = false;
  }

  let healthy: Record<string, boolean> | null = null;
  if (!configured) {
    // First-launch auto-detect: probe the embedded topology defaults in
    // parallel so the setup page can offer a one-click "use defaults".
    const probed = await Promise.all(
      BACKEND_NAMES.filter((name) => EMBEDDED_DEFAULTS[name]).map(async (name) => {
        const result = await probeBackend(name, EMBEDDED_DEFAULTS[name] as string, 2000);
        return [name, result.httpOk] as const;
      }),
    );
    healthy = Object.fromEntries(probed);
  }

  // PR-91 review (Block 1): the saved topology (candidates + effective) is
  // NOT public pre-login — anyone who can reach the dashboard must not be
  // able to enumerate the internal controller/matrix/minio/higress
  // addresses. Full detail is served to:
  //   - any authenticated session (settings backend tab, L1 and L2 alike),
  //   - a pre-login caller holding the setup token (?token= — the same
  //     owner gate as the pre-login write), so the ?setup=1 reconfigure
  //     page can prefill the saved addresses once the operator has the
  //     token,
  //   - any pre-login caller when the installer opted out of the gate
  //     (DASHBOARD_SETUP_TOKEN_ENFORCE=0): that flag already makes the
  //     pre-login WRITE open (POST is gated by the same check, see below),
  //     so withholding the topology adds no protection — it only broke
  //     "save, reopen ?setup=1" (addresses came back empty).
  // Everyone else gets the gate-shape only: configured / setupTokenRequired
  // / embedded defaults (hardcoded in the source, not deployment data).
  const session = getSessionFromRequest(request);
  const queryToken = request.nextUrl.searchParams.get('token');
  // F-7 / 需求 2.7-2.8: prefer the Authorization Bearer header so the token
  // never lands in access logs, browser history, or referer headers. The
  // query-string form (?token=) is kept as a one-cycle compatibility alias
  // for old bookmarks / documentation links — both paths call the same
  // timing-safe verifySetupToken check.
  const headerToken = request.headers
    .get('authorization')
    ?.replace(/^Bearer\s+/i, '')
    .trim();
  const candidateToken = headerToken || queryToken;
  // F1f3: with the gate disabled (ENFORCE=0) the pre-login write is already
  // open, so prefill is open too; otherwise the old rule applies — session,
  // or a valid setup token.
  const gateOpen = !isSetupTokenEnforced();
  const prefillAuthorized =
    gateOpen || !!session || (!!candidateToken && (await verifySetupToken(candidateToken)));
  if (!prefillAuthorized) {
    return NextResponse.json({
      configured,
      setupTokenRequired: isSetupTokenEnforced(),
      embedded: { defaults: EMBEDDED_DEFAULTS, healthy },
    });
  }

  // Two shapes for the owner view:
  //   entries — 新增的逐地址条目（string | {url, auth}），秘密一律 '***'
  //             （basic: password、bearer: token；username 保留用于回显），
  //             前端据此回填认证方式 /「已保存 · 留空保持」占位。
  //   config  — 旧的字符串投影（仅 session；settings 后端 tab 仍按
  //             `{internal?: string}` 读取，保持向后兼容，不破坏老客户端）。
  const legacyConfig = session && config ? projectLegacyConfig(config.backends) : undefined;
  const redactedEntries = config ? redactBackends(config.backends) : {};

  // Effective (working-cache) address per backend — the "当前生效" badge data.
  // Working-cache first; before the first successful probe (fresh boot) the
  // resolved candidate is what the next request will actually use, so it is
  // reported too (never guessed in the anonymous branch above).
  const effective: Partial<Record<BackendName, string>> = {};
  for (const name of BACKEND_NAMES) {
    const url = effectiveUrl(name) ?? pickBackendUrl(name);
    if (url) effective[name] = url;
  }

  return NextResponse.json({
    configured,
    // F1f3: lets the setup page hide the token field when the installer
    // disabled the pre-login gate (DASHBOARD_SETUP_TOKEN_ENFORCE=0).
    setupTokenRequired: isSetupTokenEnforced(),
    backends: perBackend,
    embedded: { defaults: EMBEDDED_DEFAULTS, healthy },
    entries: redactedEntries,
    ...(legacyConfig ? { config: legacyConfig, addressMode: config?.addressMode ?? 'auto' } : {}),
    effective,
  });
}

/** 旧字符串投影：{ name: { internal: url, external: url } }（无凭据信息）。 */
function projectLegacyConfig(
  backends: Partial<Record<BackendName, BackendAddrs>>,
): Record<string, { internal?: string; external?: string }> {
  const out: Record<string, { internal?: string; external?: string }> = {};
  for (const name of BACKEND_NAMES) {
    const addrs = backends[name];
    if (!addrs) continue;
    const internal = addressUrl(addrs.internal);
    const external = addressUrl(addrs.external);
    if (!internal && !external) continue;
    out[name] = {
      ...(internal ? { internal } : {}),
      ...(external ? { external } : {}),
    };
  }
  return out;
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    token?: unknown;
    backends?: unknown;
    addressMode?: unknown;
  } | null;

  const rawMode = body?.addressMode;
  const addressMode =
    rawMode === 'lan' || rawMode === 'wan' || rawMode === 'auto' ? rawMode : undefined;
  const parsed = parseBackendsPayload(body?.backends);
  if (parsed.error || !parsed.backends) {
    return NextResponse.json({ error: parsed.error ?? 'invalid payload' }, { status: 400 });
  }
  if (Object.keys(parsed.backends).length === 0) {
    return NextResponse.json({ error: 'at least one address is required' }, { status: 400 });
  }

  const session = getSessionFromRequest(request);
  const token = typeof body?.token === 'string' ? body.token : undefined;
  const before = readConfigSync()?.backends ?? {};

  if (session) {
    // F1f-A: shared (multi-user) deployment — only an admin (level 3)
    // session may save. Standalone keeps the F1c any-user behavior.
    if (isSharedMode() && session.level < 3) {
      return NextResponse.json(
        { error: 'shared-mode: only admin (L1) may save backend config' },
        { status: 403 },
      );
    }
    // 协议解析（https 优先）必须在鉴权之后、合并落盘之前 —— 无协议输入在
    // 解析时要发网络探测，未授权调用方不得触发。
    const prepared = await resolveBackendsPayload(parsed.backends);
    const result = await updateConfig(prepared.backends, addressMode);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    // F1f-C: every config write is audited with actor + level + diff.
    await auditConfigWrite(before, savedSentBackends(prepared.backends), session.user, session.level, request);
    // Re-probe what was just saved (plugin put_config → refresh_effective):
    // the effective address is latency-elected from real probes, not seeded
    // blindly.
    const { effective, switched } = await refreshEffective(Object.keys(prepared.backends) as BackendName[]);
    return NextResponse.json({
      ok: true,
      mode: 'update',
      effective,
      switched,
      resolved: prepared.resolved,
      ...(prepared.warnings.length > 0 ? { warnings: prepared.warnings } : {}),
    });
  }

  // Pre-login: token-gated, repeatable (F1e) — unless the installer
  // disabled the gate with DASHBOARD_SETUP_TOKEN_ENFORCE=0 (F1f3).
  // First launch creates the config; afterwards the token overwrites it
  // (broken/changed environment escape hatch — see header). No session,
  // no other path.
  if (isSetupTokenEnforced()) {
    if (!token) {
      return NextResponse.json({ error: 'token-required' }, { status: 403 });
    }
    if (!(await verifySetupToken(token))) {
      return NextResponse.json({ error: 'invalid-token' }, { status: 403 });
    }
  }
  const existed = await configExists();
  // 同 session 分支：鉴权通过后再解析协议（https 优先），再合并落盘。
  const prepared = await resolveBackendsPayload(parsed.backends);
  const result = existed
    ? await updateConfig(prepared.backends, addressMode)
    : await saveConfigOneShot(prepared.backends, addressMode);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  await auditConfigWrite(before, savedSentBackends(prepared.backends), 'pre-login', 0, request);
  // Re-probe the saved config so the effective cache is honest from the
  // first request (plugin put_config → refresh_effective).
  const { effective, switched } = await refreshEffective(Object.keys(prepared.backends) as BackendName[]);
  return NextResponse.json({
    ok: true,
    mode: existed ? 'update' : 'first-launch',
    effective,
    switched,
    resolved: prepared.resolved,
    ...(prepared.warnings.length > 0 ? { warnings: prepared.warnings } : {}),
  });
}

/** F1f-C: audit a config write with actor, level and a per-backend diff.
 * A failed audit must never break the save (log + continue). */
async function auditConfigWrite(
  before: Partial<Record<BackendName, BackendAddrs>>,
  after: Partial<Record<BackendName, BackendAddrs>>,
  actor: string,
  level: number,
  request: NextRequest,
): Promise<void> {
  try {
    const changed = diffBackends(before, after);
    await appendAuditEvent({
      actor,
      actor_level: level,
      entity_type: 'system',
      entity_name: 'backend-config',
      action: 'config.write',
      details: changed ? `changed: ${changed}` : 'no-op (identical)',
      severity: 'warning',
      source_ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
    });
  } catch (err) {
    console.warn('[dashboard] backend-config audit write failed:', err);
  }
}

/** 审计用的「保存后」快照：只取本次提交的后端，值来自真正落盘的配置
 * （已按槽位合并凭据）——这样 '***' 占位不会被误报成秘密变更。 */
function savedSentBackends(
  sent: Partial<Record<BackendName, BackendAddrs>>,
): Partial<Record<BackendName, BackendAddrs>> {
  const saved = readConfigSync()?.backends ?? {};
  const out: Partial<Record<BackendName, BackendAddrs>> = {};
  for (const name of Object.keys(sent) as BackendName[]) {
    if (saved[name]) out[name] = saved[name];
  }
  return out;
}

/** 槽位签名：URL + 认证方式 + 秘密（**秘密只用于相等比较，绝不写进
 * details**——审计日志不得落凭据）。 */
interface SlotSignature {
  url: string;
  auth: string;
  secret: string;
}

function slotSignature(entry: AddressEntry | undefined): SlotSignature {
  if (entry === undefined) return { url: '', auth: 'none', secret: '' };
  if (typeof entry === 'string') return { url: entry, auth: 'none', secret: '' };
  const auth = entry.auth;
  if (!auth) return { url: entry.url, auth: 'none', secret: '' };
  return {
    url: entry.url,
    auth: auth.type,
    secret: auth.type === 'basic' ? auth.password : auth.token,
  };
}

/** Per-backend merge diff: sent backends replace, unsent are preserved
 * (F1f-E merge semantics), so the diff lists exactly what changed. */
function diffBackends(
  before: Partial<Record<BackendName, BackendAddrs>>,
  after: Partial<Record<BackendName, BackendAddrs>>,
): string {
  const names = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const name of [...names].sort()) {
    const b = before[name as BackendName];
    const a = after[name as BackendName];
    if (!a) continue; // merge keeps unsent backends — nothing to report
    if (!b) {
      // 新增后端：只报槽位名（键名里没有凭据）。
      changed.push(`${name}+(${Object.keys(a).join(',')})`);
      continue;
    }
    const slots: string[] = [];
    for (const slot of ['internal', 'external'] as const) {
      const beforeSig = slotSignature(b[slot]);
      const afterSig = slotSignature(a[slot]);
      if (
        beforeSig.url === afterSig.url &&
        beforeSig.auth === afterSig.auth &&
        beforeSig.secret === afterSig.secret
      ) {
        continue;
      }
      const notes = [
        `${slot}:${beforeSig.url ? 'set' : 'unset'}→${afterSig.url ? 'set' : 'unset'}`,
      ];
      if (beforeSig.url && afterSig.url && beforeSig.url !== afterSig.url) {
        notes.push(`${slot}:url-changed`);
      }
      if (beforeSig.auth !== afterSig.auth) notes.push(`${slot}:auth ${beforeSig.auth}→${afterSig.auth}`);
      if (beforeSig.url && afterSig.url && beforeSig.secret !== afterSig.secret) {
        notes.push(`${slot}:secret-changed`);
      }
      slots.push(notes.join(' '));
    }
    if (slots.length > 0) changed.push(`${name}(${slots.join(' ')})`);
  }
  return changed.join('; ');
}

// verifySetupToken is shared with POST /setup/backends/test — one
// implementation in @/lib/backend-config (PR-91 review).

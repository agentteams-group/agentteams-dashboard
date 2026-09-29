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
  backendCandidates,
  configExists,
  effectiveUrl,
  isHttpUrl,
  isSetupTokenEnforced,
  isSharedMode,
  probeBackend,
  readConfigSync,
  refreshEffective,
  saveConfigOneShot,
  updateConfig,
  verifySetupToken,
  type BackendAddrs,
  type BackendName,
} from '@/lib/backend-config';
import { appendAuditEvent } from '@/lib/audit-log';

type BackendNameSet = Record<string, BackendName>;

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
      const candidate = entry[slot];
      if (candidate === undefined || candidate === null || candidate === '') continue;
      if (typeof candidate !== 'string' || !isHttpUrl(candidate)) {
        return { error: `backend "${key}" ${slot} must be an http(s) URL` };
      }
      addrs[slot] = candidate.trim();
    }
    if (addrs.internal || addrs.external) out[key as BackendName] = addrs;
  }
  return { backends: out };
}

const BACKEND_NAMES_SET: BackendNameSet = Object.fromEntries(
  BACKEND_NAMES.map((name) => [name, name]),
);

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
  //     token.
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
  const prefillAuthorized =
    !session && candidateToken ? await verifySetupToken(candidateToken) : !!session;
  if (!prefillAuthorized) {
    return NextResponse.json({
      configured,
      setupTokenRequired: isSetupTokenEnforced(),
      embedded: { defaults: EMBEDDED_DEFAULTS, healthy },
    });
  }

  const authedConfig = session ? { config: config?.backends ?? {} } : {};

  // Effective (working-cache) address per backend — the "在生效" badge data.
  const effective: Partial<Record<BackendName, string>> = {};
  for (const name of BACKEND_NAMES) {
    const url = effectiveUrl(name);
    if (url) effective[name] = url;
  }

  return NextResponse.json({
    configured,
    // F1f3: lets the setup page hide the token field when the installer
    // disabled the pre-login gate (DASHBOARD_SETUP_TOKEN_ENFORCE=0).
    setupTokenRequired: isSetupTokenEnforced(),
    backends: perBackend,
    embedded: { defaults: EMBEDDED_DEFAULTS, healthy },
    ...authedConfig,
    effective,
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    token?: unknown;
    backends?: unknown;
  } | null;

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
    const result = await updateConfig(parsed.backends);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    // F1f-C: every config write is audited with actor + level + diff.
    await auditConfigWrite(before, parsed.backends, session.user, session.level, request);
    // Re-probe what was just saved (plugin put_config → refresh_effective):
    // the effective address is latency-elected from real probes, not seeded
    // blindly.
    const { effective, switched } = await refreshEffective(Object.keys(parsed.backends) as BackendName[]);
    return NextResponse.json({ ok: true, mode: 'update', effective, switched });
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
  const result = existed ? await updateConfig(parsed.backends) : await saveConfigOneShot(parsed.backends);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  await auditConfigWrite(before, parsed.backends, 'pre-login', 0, request);
  // Re-probe the saved config so the effective cache is honest from the
  // first request (plugin put_config → refresh_effective).
  const { effective, switched } = await refreshEffective(Object.keys(parsed.backends) as BackendName[]);
  return NextResponse.json({ ok: true, mode: existed ? 'update' : 'first-launch', effective, switched });
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
      changed.push(`${name}+(${Object.keys(a).join(',')})`);
      continue;
    }
    const slots: string[] = [];
    for (const slot of ['internal', 'external'] as const) {
      if (b[slot] !== a[slot]) {
        slots.push(`${slot}:${b[slot] ? 'set' : 'unset'}→${a[slot] ? 'set' : 'unset'}`);
      }
    }
    if (slots.length > 0) changed.push(`${name}(${slots.join(' ')})`);
  }
  return changed.join('; ');
}

// verifySetupToken is shared with POST /setup/backends/test — one
// implementation in @/lib/backend-config (PR-91 review).

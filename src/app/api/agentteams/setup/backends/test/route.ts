import { NextRequest, NextResponse } from 'next/server';
import {
  BACKEND_NAMES,
  backendCandidatesSync,
  configExists,
  effectiveUrl,
  isEgressPolicyError,
  isHttpUrl,
  isSetupTokenEnforced,
  listMatchesSaved,
  mergeAddressEntry,
  probeBackend,
  readConfigSync,
  selectAndMark,
  toProbeRow,
  validateEgressTarget,
  verifySetupToken,
  type BackendAuth,
  type BackendName,
  type ProbeRow,
} from '@/lib/backend-config';
import { getSessionFromRequest } from '@/lib/dashboard-session';
import { isAddressLike, resolveBackendUrl } from '@/lib/backend-url-resolve';

// POST /api/agentteams/setup/backends/test — server-side connectivity test.
//
// Plugin /config_test semantics (F1c parity):
// - body { backends: { [name]: { internal?, external? } } } = test the DRAFT
//   (unsaved form values) for the given backends; omit/empty = test the
//   currently configured candidate list. A slot is a URL string or
//   { url, auth } — the DRAFT credential probes the address behind the
//   gateway door (a `***` secret echo falls back to the saved credential).
// - A draft test NEVER touches the effective cache; only when the tested
//   list equals the SAVED config list (applied) does selectAndMark re-elect.
// - A failed test NEVER clears the current effective address.
// - Rows carry the two-layer model: ok = network connected (401/403 count),
//   httpOk = status < 400 (only these are election-eligible).
//
// Access (SEC-03): every authenticated probe requires level 3 in standalone
// and shared modes. Before first config, the setup token (or explicit ENFORCE=0
// trusted-LAN bootstrap) remains available. Once config exists, pre-login probes
// are closed. All targets and redirect hops share the save-path egress policy.

type DraftAddrs = { internal?: DraftSlot; external?: DraftSlot };
/** 草稿槽位：URL 字符串（服务自身认证）或 {url, auth?}（草稿凭据参与探测）。 */
type DraftSlot = string | { url: string; auth?: BackendAuth };

function draftSlotUrl(slot: DraftSlot | undefined): string {
  if (typeof slot === 'string') return slot;
  return slot?.url ?? '';
}

/** 草稿槽位解析：地址形状照旧（允许省略协议）；对象形态保留 auth —— 设置
 * 页「测试」必须能带上表单里刚填的网关凭据，否则门后地址永远 401。秘密的
 * 「'***' = 继承已存值」在探测侧判定，这里不丢字段。 */
function parseDraftSlot(raw: unknown): DraftSlot | undefined {
  if (typeof raw === 'string') return isAddressLike(raw) ? raw.trim() : undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const obj = raw as { url?: unknown; auth?: unknown };
  const url = typeof obj.url === 'string' ? obj.url.trim() : '';
  if (!isAddressLike(url)) return undefined;
  const auth = obj.auth;
  if (!auth || typeof auth !== 'object' || Array.isArray(auth)) return url;
  const a = auth as Record<string, unknown>;
  const type = typeof a.type === 'string' ? a.type.trim().toLowerCase() : '';
  if (type === 'basic') {
    const username = typeof a.username === 'string' ? a.username.trim() : '';
    if (!username) return url;
    const password = typeof a.password === 'string' ? a.password.trim() : '';
    return { url, auth: { type: 'basic', username, password } };
  }
  if (type === 'bearer') {
    const token = typeof a.token === 'string' ? a.token.trim() : '';
    return { url, auth: { type: 'bearer', token } };
  }
  return url;
}

function parseDrafts(body: unknown): Partial<Record<BackendName, DraftAddrs>> | null {
  if (body == null) return {};
  if (typeof body !== 'object') return null;
  const raw = (body as { backends?: unknown }).backends;
  if (raw == null) return {};
  if (typeof raw !== 'object') return null;
  const out: Partial<Record<BackendName, DraftAddrs>> = {};
  for (const name of BACKEND_NAMES) {
    const entry = (raw as Record<string, unknown>)[name];
    if (!entry || typeof entry !== 'object') continue;
    const addrs: DraftAddrs = {};
    const internal = parseDraftSlot((entry as Record<string, unknown>).internal);
    const external = parseDraftSlot((entry as Record<string, unknown>).external);
    if (internal) addrs.internal = internal;
    if (external) addrs.external = external;
    if (addrs.internal || addrs.external) out[name] = addrs;
  }
  return out;
}

async function targetDenied(url: string, backend: BackendName): Promise<boolean> {
  try {
    await validateEgressTarget(url, backend);
    return false;
  } catch (err) {
    if (isEgressPolicyError(err)) return true;
    throw err;
  }
}

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (session && session.level < 3) {
    return NextResponse.json({ ok: false, error: 'only admin (L1) may test backend config' }, { status: 403 });
  }
  const existed = await configExists();
  if (!session && existed) {
    return NextResponse.json({ ok: false, error: 'admin-required' }, { status: 403 });
  }
  const raw = (await request.json().catch(() => null)) as unknown;
  const body = (raw ?? {}) as { token?: unknown; backends?: unknown };
  const drafts = parseDrafts(raw);
  if (drafts === null) {
    return NextResponse.json({ ok: false, error: 'invalid-request' }, { status: 400 });
  }

  // Pre-login bootstrap is first-config-only; no session and an existing
  // config was rejected above before parsing or probing.
  if (!session && isSetupTokenEnforced()) {
    const token = typeof body.token === 'string' ? body.token : undefined;
    if (!token) {
      return NextResponse.json({ ok: false, error: 'token-required' }, { status: 403 });
    }
    if (!(await verifySetupToken(token))) {
      return NextResponse.json({ ok: false, error: 'invalid-token' }, { status: 403 });
    }
  }

  // SSRF 前置（PR-91）：无协议草稿在解析阶段就会发起网络请求，必须先按合成
  // URL 过一遍过滤，不能等解析完再查。
  for (const name of BACKEND_NAMES) {
    const draft = drafts[name];
    if (!draft) continue;
    for (const slot of [draft.internal, draft.external]) {
      const raw = draftSlotUrl(slot);
      if (!raw) continue;
      const probeUrl = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : `http://${raw}`;
      if (await targetDenied(probeUrl, name)) {
        return NextResponse.json({ ok: false, error: 'host-not-allowed', url: raw }, { status: 403 });
      }
    }
  }

  // Targets: draft values where provided, otherwise the configured list.
  // 草稿先解析成确定的 http(s) URL（https 优先）再探测 —— 与保存路径同一
  // 口径：TLS 端口若被当成 http 探测会「命中」，真正请求却吃 nginx 400。
  // sources 记住「解析结果 ← 原始输入」的对应，行里回报 resolvedFrom 供 UI
  // 回填输入框。
  const targets: Partial<Record<BackendName, string[]>> = {};
  const sources: Partial<
    Record<BackendName, Array<{ url: string; from?: string; auth?: BackendAuth }>>
  > = {};
  try {
    await Promise.all(
    BACKEND_NAMES.map(async (name) => {
      const draft = drafts[name];
      const slots = (['internal', 'external'] as const).flatMap((slotName) =>
        draft?.[slotName] ? [[slotName, draft[slotName]] as const] : [],
      );
      if (slots.length === 0) {
        const saved = backendCandidatesSync(name);
        if (saved.length > 0) targets[name] = saved;
        return;
      }
      const rows: Array<{ url: string; from?: string; auth?: BackendAuth }> = [];
      const saved = readConfigSync()?.backends[name];
      for (const [slotName, slot] of slots) {
        const raw = draftSlotUrl(slot);
        if (!raw) continue;
        const resolved = await resolveBackendUrl(raw, 3000, name);
        if (!isHttpUrl(resolved.url)) continue;
        if (rows.some((r) => r.url === resolved.url)) continue;
        // Draft redaction inherits only under the same origin/type contract as
        // save. A changed origin can never receive the old slot's credential.
        const merged = typeof slot === 'object' ? mergeAddressEntry(saved?.[slotName], slot) : undefined;
        const auth = typeof merged === 'object' ? merged.auth : undefined;
        rows.push({
          url: resolved.url,
          ...(resolved.changed ? { from: raw } : {}),
          ...(auth ? { auth } : {}),
        });
      }
      if (rows.length === 0) {
        const saved = backendCandidatesSync(name);
        if (saved.length > 0) targets[name] = saved;
        return;
      }
      targets[name] = rows.map((r) => r.url);
      sources[name] = rows;
    }),
    );
  } catch (err) {
    if (isEgressPolicyError(err)) {
      return NextResponse.json({ ok: false, error: 'host-not-allowed' }, { status: 403 });
    }
    throw err;
  }
  if (Object.keys(targets).length === 0) {
    return NextResponse.json(
      { ok: false, error: 'nothing-to-test', message: 'no addresses provided or configured' },
      { status: 400 },
    );
  }

  // SSRF filter: reject the whole request if any target is disallowed.
  for (const name of Object.keys(targets) as BackendName[]) {
    for (const url of targets[name]!) {
      if (await targetDenied(url, name)) {
        return NextResponse.json({ ok: false, error: 'host-not-allowed', url }, { status: 403 });
      }
    }
  }

  const results: Partial<Record<BackendName, ProbeRow[]>> = {};
  const switched: Partial<Record<BackendName, boolean>> = {};
  let applied = false;

  await Promise.all(
    (Object.keys(targets) as BackendName[]).map(async (name) => {
      const urls = targets[name]!;
      const probeResults = await Promise.all(
        urls.map((url, i) => probeBackend(name, url, 6000, sources[name]?.[i]?.auth)),
      );
      const rows = urls.map((url, i) => toProbeRow(url, probeResults[i], sources[name]?.[i]?.from));
      results[name] = rows;

      // Effective-cache update is APPLIED-ONLY (plugin config_test): a draft
      // test must never rewrite the working address; a failed probe never
      // clears it (selectAndMark returns null when nobody is eligible).
      if (listMatchesSaved(name, urls)) {
        const prev = effectiveUrl(name);
        const picked = selectAndMark(name, rows);
        applied = true;
        if (picked && prev && prev !== picked) switched[name] = true;
      }
    }),
  );

  const effective: Partial<Record<BackendName, string>> = {};
  for (const name of Object.keys(targets) as BackendName[]) {
    const url = effectiveUrl(name);
    if (url) effective[name] = url;
  }

  return NextResponse.json({ ok: true, results, effective, applied, switched });
}

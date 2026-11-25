import { NextRequest, NextResponse } from 'next/server';
import {
  BACKEND_NAMES,
  backendCandidatesSync,
  effectiveUrl,
  isHttpUrl,
  isSetupTokenEnforced,
  isTestTargetAllowed,
  listMatchesSaved,
  probeBackend,
  selectAndMark,
  toProbeRow,
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
// Access (PR-91 review, Block 2): the probe is NO LONGER an unauthenticated
// fetch proxy — same door as POST /setup/backends:
//   - any authenticated session (post-login settings tab, L1 and L2),
//   - pre-login: the setup token in the body (token-gated, repeatable,
//     exactly like the pre-login write); with
//     DASHBOARD_SETUP_TOKEN_ENFORCE=0 (installer opt-out, trusted-LAN) the
//     gate is off — the same documented posture as the unauthenticated
//     config writes that opt-out already accepts (startup warn).
// SSRF hardening: DASHBOARD_ALLOWED_HOSTS (empty = allow for the
// session/token holders above, strict allowlist when set) plus an
// unconditional deny of the cloud metadata sentinel (169.254.169.254).

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

export async function POST(request: NextRequest) {
  const raw = (await request.json().catch(() => null)) as unknown;
  const body = (raw ?? {}) as { token?: unknown; backends?: unknown };
  const drafts = parseDrafts(raw);
  if (drafts === null) {
    return NextResponse.json({ ok: false, error: 'invalid-request' }, { status: 400 });
  }

  // PR-91 review: same door as POST /setup/backends — a pre-login caller
  // must hold the setup token (when the gate is enforced). No session, no
  // probe: the endpoint used to be an unauthenticated fetch proxy.
  const session = getSessionFromRequest(request);
  if (!session) {
    if (isSetupTokenEnforced()) {
      const token = typeof body.token === 'string' ? body.token : undefined;
      if (!token) {
        return NextResponse.json({ ok: false, error: 'token-required' }, { status: 403 });
      }
      if (!(await verifySetupToken(token))) {
        return NextResponse.json({ ok: false, error: 'invalid-token' }, { status: 403 });
      }
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
      if (!isTestTargetAllowed(probeUrl)) {
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
  await Promise.all(
    BACKEND_NAMES.map(async (name) => {
      const draft = drafts[name];
      const slots = draft
        ? [draft.internal, draft.external].filter((v): v is DraftSlot => v !== undefined)
        : [];
      if (slots.length === 0) {
        const saved = backendCandidatesSync(name);
        if (saved.length > 0) targets[name] = saved;
        return;
      }
      const rows: Array<{ url: string; from?: string; auth?: BackendAuth }> = [];
      for (const slot of slots) {
        const raw = draftSlotUrl(slot);
        if (!raw) continue;
        const resolved = await resolveBackendUrl(raw);
        if (!isHttpUrl(resolved.url)) continue;
        if (rows.some((r) => r.url === resolved.url)) continue;
        const auth = typeof slot === 'object' ? slot.auth : undefined;
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
  if (Object.keys(targets).length === 0) {
    return NextResponse.json(
      { ok: false, error: 'nothing-to-test', message: 'no addresses provided or configured' },
      { status: 400 },
    );
  }

  // SSRF filter: reject the whole request if any target is disallowed.
  for (const name of Object.keys(targets) as BackendName[]) {
    for (const url of targets[name]!) {
      if (!isTestTargetAllowed(url)) {
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

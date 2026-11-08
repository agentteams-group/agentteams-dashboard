'use client';

// Settings > 后端 tab (F1b + F1c + F1d): the server-side backend address config.
//
// Plugin parity (F1c, decided 9/9 — deployment model is one instance per
// user, no shared instances): ANY logged-in user (L1 or L2) can view, test
// and SAVE the backend config — exactly like the plugin's config page, which
// is open to whoever uses the host. There is no owner token for saving; the
// first-launch token only gates the PRE-LOGIN setup page (the dashboard's
// install-method difference). SSRF surface of user-supplied addresses stays
// pinned server-side by DASHBOARD_ALLOWED_HOSTS.
//
// - GET /api/agentteams/setup/backends → entries (per-slot address + auth,
//   secrets redacted to '***') + effective (working cache) for the "在生效"
//   badge. `entries` is the authoritative shape; the legacy string-only
//   `config` projection is only a fallback for an older server.
// - Per-slot auth (plugin config_entries.AuthEntry parity): a slot is either
//   the service's own auth (plain URL) or a gateway credential — Basic
//   (public gateway door) / Bearer (API-key door). The saved secret comes
//   back as '***'; leaving the field blank keeps the stored secret, and
//   switching back to 服务自身认证 sends a plain URL (clears it). A slot is
//   NEVER downgraded from {url, auth} to a bare URL string while a
//   credential is selected — that was the F1d defect (saved Basic/Bearer
//   dropped on every save).
// - Per-backend "测试" → POST .../backends/test with the FORM values (draft,
//   INCLUDING the draft credential — otherwise a gateway-fronted address
//   always reports 401): the server probes each address (parallel, one
//   retry) and returns rows in the plugin's two-layer model — ✅ connected &
//   usable (ms) / ⚠️ connected but needs auth (401/403) / ❌ classified error
//   (DNS / refused / timeout / TLS 握手 / TLS 证书 / 连接失败). Draft tests
//   never touch the effective cache; a failed test never clears it.
// - 保存 → POST .../backends (no token). The server re-probes what was saved
//   and returns effective/switched; the tab then reloads `entries` (so the
//   redacted secrets confirm what was kept) and auto-runs a test on the saved
//   list (plugin "保存后自动测一次").
//
// Resolution priority (documented for the user): config file > env vars >
// embedded defaults. The background re-rank loop re-probes backends with
// >= 2 addresses every 30s/120s/300s (adaptive) and latency-elected the
// fastest reachable one (debounce: must be > 100ms AND > 30% faster); the
// request layer additionally walks the candidates with a same-address retry,
// so switching between internal/external networks is automatic.
import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Save,
  Server,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiUrl } from '@/lib/api-base';
import {
  BACKEND_LABELS,
  BACKEND_NAMES,
  EMBEDDED_DEFAULTS,
  REQUIRED_BACKENDS,
  type BackendName,
} from '@/lib/backend-names';

/** 脱敏占位（与服务端 REDACTED_SECRET 同值）：秘密字段留空 + 该槽位已有
 * 同类型凭据 → 发送 '***'，服务端按槽位继承旧秘密。 */
const REDACTED_SECRET = '***';
const STORED_HINT = '已保存 · 留空保持';

type AuthType = 'none' | 'basic' | 'bearer';
type SlotName = 'internal' | 'external';

interface EntryAuth {
  type?: string;
  username?: string;
  password?: string;
  token?: string;
}

type AddressEntry = string | { url?: string; auth?: EntryAuth };

interface SlotForm {
  url: string;
  authType: AuthType;
  username: string;
  password: string;
  token: string;
  /** 该槽位已保存的凭据类型（秘密被服务端脱敏回显，前端只留占位）。 */
  storedType: 'basic' | 'bearer' | null;
}

interface BackendForm {
  internal: SlotForm;
  external: SlotForm;
}

interface BackendsState {
  configured: boolean;
  backends: Record<string, { configured: boolean; candidates: string[] }>;
  /** 逐地址条目（服务端 redactBackends）：string 或 {url, auth}（秘密 '***'）。 */
  entries?: Record<string, { internal?: AddressEntry; external?: AddressEntry }>;
  /** 旧字符串投影（仅 session；entries 缺失时的兜底）。 */
  config?: Record<string, { internal?: string; external?: string }>;
  effective?: Record<string, string>;
  embedded?: {
    defaults: Record<string, string | undefined>;
    healthy: Record<string, boolean> | null;
  };
}

interface TestRow {
  url: string;
  ok: boolean;
  httpOk: boolean;
  ms: number | null;
  detail: string;
}

/** 保存/测试请求里的槽位：纯 URL（服务自身认证）或带凭据的对象。 */
type DraftAuth =
  | { type: 'basic'; username: string; password: string }
  | { type: 'bearer'; token: string };
type DraftSlot = string | { url: string; auth: DraftAuth };
type DraftAddrs = { internal?: DraftSlot; external?: DraftSlot };

function emptySlot(url = ''): SlotForm {
  return { url, authType: 'none', username: '', password: '', token: '', storedType: null };
}

/** entries 槽位 → 表单：secret 永远不回填（服务端只回 '***'），凭据类型 +
 * 用户名用来还原「认证方式」和占位提示。 */
function slotFromEntry(entry: AddressEntry | undefined): SlotForm {
  if (!entry) return emptySlot();
  if (typeof entry === 'string') return emptySlot(entry);
  const url = entry.url ?? '';
  const auth = entry.auth;
  if (auth?.type === 'basic') {
    return {
      url,
      authType: 'basic',
      username: auth.username ?? '',
      password: '',
      token: '',
      storedType: 'basic',
    };
  }
  if (auth?.type === 'bearer') {
    return { url, authType: 'bearer', username: '', password: '', token: '', storedType: 'bearer' };
  }
  return emptySlot(url);
}

function initialFields(
  state: BackendsState,
  prefillEmbedded: boolean,
): Record<string, BackendForm> {
  const out: Record<string, BackendForm> = {};
  for (const name of BACKEND_NAMES) {
    const entries = state.entries?.[name];
    const legacy = state.config?.[name];
    const internal = slotFromEntry(entries?.internal ?? legacy?.internal);
    const external = slotFromEntry(entries?.external ?? legacy?.external);
    // F-3 / 需求 2.4: an empty `internal` slot paired with a healthy embedded
    // probe gets prefilled with EMBEDDED_DEFAULTS — editable (the operator can
    // overwrite before saving). Required backends always get the default so
    // the slot never stays blank in the standard embedded install. `external`
    // stays empty (no auto-fallback for the operator's wide-area address).
    // A reload after saving never re-prefills: a deliberately cleared slot
    // must stay cleared.
    if (
      prefillEmbedded &&
      !internal.url.trim() &&
      state.embedded?.healthy?.[name] === true &&
      EMBEDDED_DEFAULTS[name]
    ) {
      internal.url = EMBEDDED_DEFAULTS[name] ?? '';
    }
    out[name] = { internal, external };
  }
  return out;
}

/** 表单槽位 → 请求槽位。认证方式为「服务自身认证」= 纯 URL 字符串（服务端
 * 据此清除该槽位旧凭据）；Basic/Bearer 保留对象形态。秘密留空且该槽位已有
 * 同类型凭据时发 '***'（保留旧值）。 */
function slotPayload(slot: SlotForm): DraftSlot | null {
  const url = slot.url.trim();
  if (!url) return null;
  if (slot.authType === 'basic') {
    const password = slot.password || (slot.storedType === 'basic' ? REDACTED_SECRET : '');
    return { url, auth: { type: 'basic', username: slot.username.trim(), password } };
  }
  if (slot.authType === 'bearer') {
    const token = slot.token || (slot.storedType === 'bearer' ? REDACTED_SECRET : '');
    return { url, auth: { type: 'bearer', token } };
  }
  return url;
}

function buildDraft(fields: Record<string, BackendForm>): Record<string, DraftAddrs> {
  const out: Record<string, DraftAddrs> = {};
  for (const [name, form] of Object.entries(fields)) {
    const internal = slotPayload(form.internal);
    const external = slotPayload(form.external);
    if (internal || external) {
      out[name] = { ...(internal ? { internal } : {}), ...(external ? { external } : {}) };
    }
  }
  return out;
}

/** 保存前的可读校验：选了 Basic/Bearer 但秘密和已存凭据都没有时，服务端只会
 * 把该槽位静默降级成纯 URL（凭据丢失的旧缺陷换了个入口）。这里先拦住。
 * 返回第一条错误文案，null = 通过。 */
function validateDraft(fields: Record<string, BackendForm>): string | null {
  for (const name of BACKEND_NAMES) {
    const form = fields[name];
    if (!form) continue;
    for (const slot of ['internal', 'external'] as const) {
      const slotForm = form[slot];
      const label = `${BACKEND_LABELS[name]} ${slot === 'internal' ? '内网' : '外网'}`;
      if (slotForm.authType === 'basic') {
        if (!slotForm.username.trim()) return `${label}：Basic 认证需要填写用户名。`;
        if (!slotForm.password && slotForm.storedType !== 'basic') {
          return `${label}：请填写网关密码（或切回「服务自身认证」）。`;
        }
      }
      if (slotForm.authType === 'bearer' && !slotForm.token && slotForm.storedType !== 'bearer') {
        return `${label}：请填写网关 Bearer token（或切回「服务自身认证」）。`;
      }
    }
  }
  return null;
}

function RowIcon({ row }: { row: TestRow }) {
  if (row.ok && row.httpOk) return <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />;
  if (row.ok) return <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />;
  return <XCircle className="w-3 h-3 text-red-600 shrink-0" />;
}

const AUTH_OPTIONS: Array<{ value: AuthType; label: string }> = [
  { value: 'none', label: '服务自身认证' },
  { value: 'basic', label: 'Basic' },
  { value: 'bearer', label: 'Bearer' },
];

export function BackendTab() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<BackendsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [fields, setFields] = useState<Record<string, BackendForm>>({});
  const [rows, setRows] = useState<Record<string, TestRow[]>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ switched: string[]; unchanged: string[] } | null>(null);

  const load = useCallback(async (refill = false) => {
    try {
      const res = await fetch(apiUrl('/api/agentteams/setup/backends/'), { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as BackendsState;
      setState(data);
      // refill: 保存成功后按新的 entries 回填（确认凭据仍是 stored 状态）。
      // 首次加载自动预填嵌入式默认；回填不再预填（保持用户清空的槽位）。
      setFields((prev) =>
        refill || Object.keys(prev).length === 0 ? initialFields(data, !refill) : prev,
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const clearFeedback = (backend: string) => {
    setSaved(false);
    setSaveError(null);
    setBanner(null);
    setRows((prev) => {
      const rest = { ...prev };
      delete rest[backend];
      return rest;
    });
  };

  const updateSlot = (backend: string, slot: SlotName, patch: Partial<SlotForm>) => {
    setFields((prev) => {
      const form = prev[backend];
      if (!form) return prev;
      return { ...prev, [backend]: { ...form, [slot]: { ...form[slot], ...patch } } };
    });
    clearFeedback(backend);
  };

  /** 认证方式切换：切回「服务自身认证」= 清凭据（保存时发纯 URL）；
   * 切到另一种凭据类型时清空秘密输入，且只有同类型的已存秘密才允许
   * 「留空保持」（发 '***'）。 */
  const setAuthType = (backend: string, slot: SlotName, authType: AuthType) => {
    const current = fields[backend]?.[slot];
    if (!current || current.authType === authType) return;
    if (authType === 'none') {
      updateSlot(backend, slot, {
        authType,
        username: '',
        password: '',
        token: '',
        storedType: null,
      });
      return;
    }
    updateSlot(backend, slot, {
      authType,
      password: '',
      token: '',
      storedType: current.storedType === authType ? current.storedType : null,
    });
  };

  const runTest = useCallback(
    async (backends: Record<string, DraftAddrs>) => {
      if (Object.keys(backends).length === 0) {
        setSaveError('请先在内部或外部地址栏填写地址，再点「测试」。');
        return;
      }
      setTesting(Object.fromEntries(Object.keys(backends).map((n) => [n, true])));
      try {
        const res = await fetch(apiUrl('/api/agentteams/setup/backends/test/'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ backends }),
        });
        if (!res.ok) {
          setSaveError(`测试失败（HTTP ${res.status}）`);
          return;
        }
        const data = (await res.json().catch(() => null)) as {
          results?: Record<string, TestRow[]>;
        } | null;
        if (data?.results) {
          setRows((prev) => ({ ...prev, ...data.results }));
          setSaved(true);
          setSaveError(null);
        } else {
          setSaveError('测试无结果返回');
        }
      } catch {
        setSaveError('测试请求失败（网络错误）');
      } finally {
        setTesting((prev) => {
          const next = { ...prev };
          for (const n of Object.keys(backends)) next[n] = false;
          return next;
        });
      }
    },
    [],
  );

  const handleTestBackend = (name: string) => {
    const form = fields[name];
    if (!form) {
      setSaveError('该后端没有待测草稿地址——先在内部/外部地址栏填写后再点「测试」。');
      return;
    }
    // 草稿凭据随请求发送：门后的地址不带表单里刚填的 Basic/Bearer 永远 401。
    void runTest(buildDraft({ [name]: form }));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    setBanner(null);
    const draftFields: Record<string, BackendForm> = {};
    for (const name of BACKEND_NAMES) {
      const form = fields[name];
      if (form) draftFields[name] = form;
    }
    const invalid = validateDraft(draftFields);
    if (invalid) {
      setSaving(false);
      setSaveError(invalid);
      return;
    }
    const backends = buildDraft(draftFields);
    try {
      const res = await fetch(apiUrl('/api/agentteams/setup/backends/'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ backends }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        effective?: Record<string, string>;
        switched?: Record<string, boolean>;
      } | null;
      if (res.ok && data?.ok) {
        setSaved(true);
        // 重新 GET 回填 entries：确认 Basic/Bearer 凭据仍以 stored（'***'）
        // 形态存在，而不是被降级成纯 URL。
        await load(true);
        // The overview infrastructure panel re-resolves per request; nudge it
        // so the health tiles reflect the new addresses promptly.
        void queryClient.invalidateQueries({ queryKey: ['agentteams-infrastructure'] });
        // Plugin parity: auto-test the saved list once after saving.
        void runTest(backends);
        const switchedNames: string[] = [];
        const unchangedNames: string[] = [];
        for (const name of Object.keys(backends) as BackendName[]) {
          if (data.switched?.[name]) switchedNames.push(BACKEND_LABELS[name]);
          else if (data.effective?.[name]) unchangedNames.push(BACKEND_LABELS[name]);
        }
        setBanner({ switched: switchedNames, unchanged: unchangedNames });
      } else {
        setSaveError(data?.error ?? `保存失败（HTTP ${res.status}）`);
      }
    } catch {
      setSaveError('保存请求失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !state) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        加载后端配置…
      </div>
    );
  }

  const effective = state.effective ?? {};

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground leading-relaxed">
        地址保存在服务端配置文件（<code className="font-mono">DASHBOARD_CONFIG_FILE</code>，数据卷上），保存后立即生效。
        解析优先级：本配置 &gt; 环境变量 &gt; 内置默认。
        <span className="block mt-1">
          公网网关后的地址可选「Basic / Bearer」并填网关凭据（只存服务端，回显为已保存）；留空即保持已存凭据，切回「服务自身认证」会清除该槽位凭据。
          有 ≥2 个地址的后端每 2 分钟自动重测、切到最快可达的（防抖：需快 100ms 且快 30% 以上才切）；
          切换内/外网期间请求自动逐候选重试，不会掉。测试未保存的草稿不影响生效地址，测试失败也不会清掉当前生效地址。
        </span>
      </p>

      {banner && (
        <div className="space-y-1 rounded-lg border px-3 py-2 text-xs">
          {banner.switched.map((label) => (
            <div key={`s-${label}`} className="flex items-center gap-1.5 text-emerald-600">
              <RefreshCw className="w-3 h-3" />
              {label}：已切换到最快可达地址
            </div>
          ))}
          {banner.unchanged.map((label) => (
            <div key={`u-${label}`} className="flex items-center gap-1.5 text-muted-foreground">
              <CheckCircle2 className="w-3 h-3" />
              {label}：当前生效地址已是最快，保持不变
            </div>
          ))}
        </div>
      )}

      {BACKEND_NAMES.map((name) => {
        const candidates = state.backends[name]?.candidates ?? [];
        const required = REQUIRED_BACKENDS.includes(name);
        const missingRequired = required && candidates.length === 0;
        const isTesting = !!testing[name];
        const form = fields[name];
        const hasAny = !!(form?.internal.url.trim() || form?.external.url.trim());
        return (
          <div key={name} className="space-y-1.5 rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <Server className="w-3.5 h-3.5 text-muted-foreground" />
              <Label className="text-sm">{BACKEND_LABELS[name]}</Label>
              {missingRequired && (
                <Badge variant="destructive" className="text-xs h-4 px-1.5">
                  无可用地址（影响登录/数据面）
                </Badge>
              )}
              <Button
                variant="outline"
                size="sm"
                className="ml-auto h-7 text-xs"
                aria-label={`测试 ${BACKEND_LABELS[name]}`}
                onClick={() => handleTestBackend(name)}
                disabled={isTesting || !hasAny}
              >
                {isTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '测试'}
              </Button>
            </div>
            {(['internal', 'external'] as const).map((slot) => {
              const slotForm = form?.[slot];
              if (!slotForm) return null;
              const slotLabel = slot === 'internal' ? '内网' : '外网';
              const keptSecret =
                slotForm.authType !== 'none' && slotForm.storedType === slotForm.authType;
              const embeddedPrefill =
                slot === 'internal' &&
                !!EMBEDDED_DEFAULTS[name] &&
                slotForm.url.trim() === EMBEDDED_DEFAULTS[name] &&
                !state.entries?.[name]?.internal &&
                !state.config?.[name]?.internal &&
                state.embedded?.healthy?.[name] === true;
              return (
                <div key={slot} className="space-y-1 pl-5">
                  <div className="flex items-center gap-2">
                    <span className="w-14 text-xs text-muted-foreground shrink-0">{slotLabel}</span>
                    <Input
                      aria-label={`${BACKEND_LABELS[name]} ${slotLabel} 地址`}
                      value={slotForm.url}
                      onChange={(e) => updateSlot(name, slot, { url: e.target.value })}
                      placeholder="http://host:port（可选，留空=用 env/内置）"
                      className="h-8 text-xs flex-1"
                      spellCheck={false}
                    />
                    <Select
                      value={slotForm.authType}
                      onValueChange={(value) => setAuthType(name, slot, value as AuthType)}
                    >
                      <SelectTrigger
                        size="sm"
                        className="h-8 w-32 text-xs shrink-0"
                        aria-label={`${BACKEND_LABELS[name]} ${slotLabel} 认证方式`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {AUTH_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {embeddedPrefill && (
                      <Badge variant="secondary" className="shrink-0 text-xs h-4 px-1.5">
                        嵌入式探测
                      </Badge>
                    )}
                    {keptSecret && (
                      <Badge variant="secondary" className="shrink-0 text-xs h-4 px-1.5">
                        凭据已保存
                      </Badge>
                    )}
                  </div>
                  {slotForm.authType === 'basic' && (
                    <div className="flex items-center gap-2 pl-[4.5rem]">
                      <Input
                        aria-label={`${BACKEND_LABELS[name]} ${slotLabel} 用户名`}
                        value={slotForm.username}
                        onChange={(e) => updateSlot(name, slot, { username: e.target.value })}
                        placeholder="网关用户名"
                        className="h-8 text-xs flex-1"
                        spellCheck={false}
                      />
                      <Input
                        type="password"
                        aria-label={`${BACKEND_LABELS[name]} ${slotLabel} 密码`}
                        value={slotForm.password}
                        onChange={(e) => updateSlot(name, slot, { password: e.target.value })}
                        placeholder={keptSecret ? STORED_HINT : '网关密码'}
                        className="h-8 text-xs flex-1"
                        spellCheck={false}
                      />
                    </div>
                  )}
                  {slotForm.authType === 'bearer' && (
                    <div className="flex items-center gap-2 pl-[4.5rem]">
                      <Input
                        type="password"
                        aria-label={`${BACKEND_LABELS[name]} ${slotLabel} Token`}
                        value={slotForm.token}
                        onChange={(e) => updateSlot(name, slot, { token: e.target.value })}
                        placeholder={keptSecret ? STORED_HINT : '网关 Bearer token'}
                        className="h-8 text-xs flex-1"
                        spellCheck={false}
                      />
                    </div>
                  )}
                </div>
              );
            })}
            {rows[name]?.map((row) => (
              <div key={row.url} className="flex items-center gap-1.5 pl-5 text-xs">
                <RowIcon row={row} />
                <span className="text-muted-foreground shrink-0">
                  {row.ok && row.httpOk && row.ms != null ? `${row.ms}ms · ` : ''}
                  {row.detail}
                </span>
                <span className="truncate text-muted-foreground/70 max-w-52" title={row.url}>
                  {row.url}
                </span>
                {effective[name] === row.url && (
                  <Badge variant="secondary" className="text-xs h-4 px-1 shrink-0">
                    在生效
                  </Badge>
                )}
              </div>
            ))}
            {candidates.length > 0 && (
              <p className="pl-5 text-xs text-muted-foreground truncate">
                当前候选顺序：{candidates.join(' → ')}
                {effective[name] ? ` · 生效：${effective[name]}` : ''}
              </p>
            )}
          </div>
        );
      })}

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <Loader2 className="w-4 h-4 mr-1 animate-spin" />
          ) : (
            <Save className="w-4 h-4 mr-1" />
          )}
          保存配置
        </Button>
        {saved && (
          <span className="text-xs text-emerald-600 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" /> 已保存，立即生效
          </span>
        )}
        {saveError && <span className="text-xs text-destructive">{saveError}</span>}
      </div>
    </div>
  );
}

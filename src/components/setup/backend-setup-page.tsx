'use client';

// First-launch backend setup (F1). Rendered INSTEAD OF the login form when
// the dashboard has no usable backend addresses yet (standalone docker
// install without env configuration).
//
// Pre-login writes are token-gated and repeatable (F1e): the token comes
// from the server log ("one-time backend setup token") or the
// DASHBOARD_SETUP_TOKEN env var — unless the installer disabled the gate
// (DASHBOARD_SETUP_TOKEN_ENFORCE=0, F1f3), in which case the token field
// is hidden and saving is plain. After the config is saved the login page
// appears and this screen can never be reached again from a logged-out
// browser (level-3 session updates go through the settings dialog, F1b).
//
// Per-address credentials (plugin SettingsTabShared parity): every address
// slot carries an auth mode — 服务自身认证 (plain URL entry, no extra header)
// / Basic 认证 / Bearer Token (public-gateway Basic or API-key door). Saved
// secrets are NEVER echoed back into the inputs: a stored credential shows
// as the 「已保存 · 留空保持」placeholder and an empty submit inherits the
// saved value server-side; switching back to 服务自身认证 drops it.
// MinIO is the exception: S3 requests sign with Access Key / Secret Key
// (AGENTTEAMS_FS_ACCESS_KEY / _SECRET_KEY), so its slots show an
// explanatory note instead of the auth selector.
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiUrl } from '@/lib/api-base';
import {
  BACKEND_LABELS,
  BACKEND_NAMES,
  EMBEDDED_DEFAULTS,
  REQUIRED_BACKENDS,
  type BackendName,
} from '@/lib/backend-names';

// Server address-entry shape (duplicated as TYPES only — the server module is
// never imported into this client bundle). Secrets arrive as '***'.
type ServerAuth =
  | { type: 'basic'; username: string; password: string }
  | { type: 'bearer'; token: string };
type ServerEntry = string | { url: string; auth?: ServerAuth };
type ServerAddrs = { internal?: ServerEntry; external?: ServerEntry };

const REDACTED_SECRET = '***';

/** 保存成功后离开本页，而 setup token 只活在内存 state 里 → 再次打开
 * ?setup=1 时 token 为空；PR-91 之后匿名 GET 只回门形状（不返回已存拓扑），
 * 于是地址全空。把 token 放 sessionStorage（标签页级、关浏览器即失，不做
 * 长期留存），挂载时读回，交给下面 token 驱动的 prefill 重取已存条目。 */
const SETUP_TOKEN_STORAGE_KEY = 'agentteams.setupToken';

function readStoredSetupToken(): string {
  try {
    return window.sessionStorage.getItem(SETUP_TOKEN_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function rememberSetupToken(value: string): void {
  try {
    if (value) window.sessionStorage.setItem(SETUP_TOKEN_STORAGE_KEY, value);
  } catch {
    /* 隐私模式 / storage 不可用：退化成手输 token */
  }
}

function forgetSetupToken(): void {
  try {
    window.sessionStorage.removeItem(SETUP_TOKEN_STORAGE_KEY);
  } catch {
    /* 同上 */
  }
}

interface BackendStatus {
  configured: boolean;
  candidates: string[];
}

interface SetupStatusResponse {
  configured: boolean;
  /** F1f3: false when the installer disabled the pre-login token gate
   * (DASHBOARD_SETUP_TOKEN_ENFORCE=0) — the token field is hidden. */
  setupTokenRequired?: boolean;
  /** 地址模式（对齐工作台插件）：auto/lan/wan；老响应缺省 = auto。 */
  addressMode?: 'auto' | 'lan' | 'wan';
  /** PR-91 review: absent in the anonymous (pre-login, no token) response —
   * the saved topology is only served to a session or ?token= holder. */
  backends?: Record<BackendName, BackendStatus>;
  /** 逐地址条目（已脱敏；秘密 '***'）——回填认证方式与「已保存」占位。 */
  entries?: Record<BackendName, ServerAddrs>;
  /** 旧字符串投影（仅 session 响应返回）：{ name: { internal?, external? } }。
   * 没有 entries 的老响应/匿名响应只能靠它回填槽位。 */
  config?: Record<string, { internal?: string; external?: string }>;
  /** 工作缓存里当前生效的地址（「当前生效」徽标）。 */
  effective?: Partial<Record<BackendName, string>>;
  embedded: {
    defaults: Record<BackendName, string | undefined>;
    healthy: Record<BackendName, boolean> | null;
  };
}

type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok'; detail: string }
  | { status: 'auth'; detail: string }
  | { status: 'fail'; detail: string };

const EMPTY_TEST: TestState = { status: 'idle' };

/** 认证方式草稿。stored = 该地址该类型已有服务端凭据（秘密不回显，输入框
 * 留空 = 保持不变）；换类型时清零（防止把 A 类型的 stored 误带到 B 类型）。 */
type AuthType = 'none' | 'basic' | 'bearer';

interface SlotDraft {
  url: string;
  type: AuthType;
  username: string;
  password: string;
  token: string;
  stored: boolean;
}

const EMPTY_SLOT: SlotDraft = {
  url: '',
  type: 'none',
  username: '',
  password: '',
  token: '',
  stored: false,
};

interface BackendForm {
  internal: SlotDraft;
  external: SlotDraft;
}

function emptyForm(): Record<BackendName, BackendForm> {
  return Object.fromEntries(
    BACKEND_NAMES.map((name) => [
      name,
      { internal: { ...EMPTY_SLOT }, external: { ...EMPTY_SLOT } },
    ]),
  ) as Record<BackendName, BackendForm>;
}

/** 服务端条目 → 编辑草稿。脱敏值 '***' 不进输入框（只置 stored 标记）。 */
function entryToDraft(entry: ServerEntry | undefined): SlotDraft {
  if (entry && typeof entry === 'object') {
    const auth = entry.auth;
    if (auth?.type === 'basic') {
      return {
        ...EMPTY_SLOT,
        url: entry.url,
        type: 'basic',
        username: auth.username ?? '',
        stored: true,
      };
    }
    if (auth?.type === 'bearer') {
      return { ...EMPTY_SLOT, url: entry.url, type: 'bearer', stored: true };
    }
    return { ...EMPTY_SLOT, url: entry.url };
  }
  return { ...EMPTY_SLOT, url: typeof entry === 'string' ? entry : '' };
}

/** 草稿 → 提交条目（插件 buildAuthEntry 语义）：
 * - 秘密已填 → 显式凭据；
 * - 秘密留空且已存 → 发 '***' 占位，服务端按槽位继承旧秘密；
 * - 凭据不完整 → 降级纯 URL 条目（诚实：不装半个凭据）。 */
function draftToEntry(draft: SlotDraft): ServerEntry | undefined {
  const url = draft.url.trim();
  if (!url) return undefined;
  if (draft.type === 'basic' && draft.username.trim()) {
    const password = draft.password.trim();
    if (password) {
      return { url, auth: { type: 'basic', username: draft.username.trim(), password } };
    }
    if (draft.stored) {
      return {
        url,
        auth: { type: 'basic', username: draft.username.trim(), password: REDACTED_SECRET },
      };
    }
  }
  if (draft.type === 'bearer') {
    const token = draft.token.trim();
    if (token) return { url, auth: { type: 'bearer', token } };
    if (draft.stored) return { url, auth: { type: 'bearer', token: REDACTED_SECRET } };
  }
  return url;
}

/** 服务端响应 → 表单预填：只填空槽，绝不覆盖用户已输入的地址。
 *
 * 槽位身份只能来自按槽位给出的数据：`entries` 存在时**只用 entries**，
 * 空槽保持空。`candidates` 是去掉空槽后的紧凑列表（只存外网时
 * candidates[0] = 外网地址），按下标回填会把外网地址猜进内网
 * （2026-11-07 实测缺陷）。
 *
 * `entries` 缺失（老响应 / 匿名响应）时才退回 legacy：先按槽位读
 * `data.config[name][slot]`，最后才在两个槽都空时按位置用 candidates。 */
function applyPrefill(
  data: SetupStatusResponse,
  prev: Record<BackendName, BackendForm>,
): Record<BackendName, BackendForm> {
  return Object.fromEntries(
    BACKEND_NAMES.map((name) => {
      const entries = data.entries?.[name];
      const legacy = data.config?.[name];
      const candidates = data.backends?.[name]?.candidates ?? [];
      const next: BackendForm = {
        internal: { ...prev[name].internal },
        external: { ...prev[name].external },
      };
      const slots = ['internal', 'external'] as const;
      for (const slot of slots) {
        if (next[slot].url.trim()) continue;
        if (entries) {
          const entry = entries[slot];
          if (entry) next[slot] = entryToDraft(entry);
          continue;
        }
        const legacyUrl = legacy?.[slot];
        if (legacyUrl) next[slot] = { ...EMPTY_SLOT, url: legacyUrl };
      }
      // 位置回填只作为最后的兜底，且两个槽都空时才用 —— 只要有任一槽已有
      // 地址（用户输入 / entries / legacy），位置对应关系就不再可信。
      if (!entries && !next.internal.url.trim() && !next.external.url.trim()) {
        slots.forEach((slot, idx) => {
          const url = candidates[idx] ?? '';
          if (url) next[slot] = { ...EMPTY_SLOT, url };
        });
      }
      return [name, next];
    }),
  ) as Record<BackendName, BackendForm>;
}

export function BackendSetupPage({ onDone, reconfigure = false }: { onDone: () => void; reconfigure?: boolean }) {

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<Record<BackendName, BackendForm>>(() => emptyForm());
  const [embeddedHealthy, setEmbeddedHealthy] = useState(false);
  const [token, setToken] = useState('');
  const [tokenRequired, setTokenRequired] = useState(true);
  const [addressMode, setAddressMode] = useState<'auto' | 'lan' | 'wan'>('auto');
  const [effective, setEffective] = useState<Partial<Record<BackendName, string>>>({});
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** 保存成功但协议没探测通的提示（已按 https 落库，需用户确认方向）。 */
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl('/api/agentteams/setup/backends'), { credentials: 'same-origin' })
      .then((res) => res.json().catch(() => null))
      .then((data: SetupStatusResponse | null) => {
        if (cancelled || !data) {
          if (!cancelled) {
            setLoading(false);
            setLoadError('读取后端配置状态失败，请刷新重试');
          }
          return;
        }
        setForm((prev) => applyPrefill(data, prev));
        setEffective(data.effective ?? {});
        setEmbeddedHealthy(
          !!data.embedded?.healthy &&
            REQUIRED_BACKENDS.every((name) => data.embedded.healthy?.[name] === true),
        );
        setTokenRequired(data.setupTokenRequired ?? true);
        if (data.addressMode === 'lan' || data.addressMode === 'wan' || data.addressMode === 'auto') {
          setAddressMode(data.addressMode);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false);
          setLoadError('读取后端配置状态失败，请刷新重试');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 重开 ?setup=1 时把上次保存成功的 setup token 读回 state —— 下面的
  // token 驱动 prefill 会用它带 Authorization 重取已存条目（本页此前只在
  // 用户手输 token 时才回填，重开即空白）。
  useEffect(() => {
    const saved = readStoredSetupToken();
    if (saved) setToken((prev) => prev || saved);
  }, []);

  // PR-91 review: the saved topology is no longer served pre-login. Once
  // the operator enters the setup token (reconfigure mode), refetch with
  // it — same owner gate as the pre-login write — and prefill the saved
  // addresses + auth mode (only empty slots: never overwrite what the user
  // typed).
  useEffect(() => {
    if (!reconfigure || !tokenRequired) return;
    const trimmed = token.trim();
    if (!trimmed) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      // F-7: prefer Authorization Bearer so the token doesn't leak into
      // server access logs / browser history. The server also accepts ?token=
      // (one-cycle compatibility) but new code paths use the header.
      fetch(apiUrl('/api/agentteams/setup/backends'), {
        credentials: 'same-origin',
        headers: { Authorization: `Bearer ${trimmed}` },
      })
        .then((res) => res.json().catch(() => null))
        .then((data: SetupStatusResponse | null) => {
          if (cancelled || !data) return;
          if (!data.backends && !data.entries) {
            // 服务端不返回拓扑 = token 不认（PR-91：匿名只回门形状）——丢掉
            // 过期 token，下次重开不再白跑一次。
            forgetSetupToken();
            return;
          }
          rememberSetupToken(trimmed);
          setForm((prev) => applyPrefill(data, prev));
          if (data.effective) setEffective(data.effective);
        })
        .catch(() => {
          /* wrong token / transient — the user keeps typing manually */
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [token, reconfigure, tokenRequired]);

  // F-3 / 需求 2.1-2.3: when embedded probes say every REQUIRED_BACKEND is
  // healthy, auto-fill the form on first render. Skipped in reconfigure mode
  // (the operator has already saved; the token-driven refetch above owns the
  // prefill) and skipped if the operator already typed anything (we never
  // overwrite a non-empty field with a default).
  const [autoFilled, setAutoFilled] = useState(false);
  useEffect(() => {
    if (autoFilled || reconfigure) return;
    if (!embeddedHealthy) return;
    setForm((prev) => {
      const anyFilled = BACKEND_NAMES.some(
        (name) => prev[name].internal.url.trim() !== '' || prev[name].external.url.trim() !== '',
      );
      if (anyFilled) return prev;
      return Object.fromEntries(
        BACKEND_NAMES.map((name) => [
          name,
          {
            internal: { ...EMPTY_SLOT, url: EMBEDDED_DEFAULTS[name] ?? '' },
            external: { ...EMPTY_SLOT },
          },
        ]),
      ) as Record<BackendName, BackendForm>;
    });
    setAutoFilled(true);
  }, [autoFilled, embeddedHealthy, reconfigure]);

  const setSlot = (name: BackendName, slot: 'internal' | 'external', patch: Partial<SlotDraft>) => {
    setForm((prev) => ({
      ...prev,
      [name]: { ...prev[name], [slot]: { ...prev[name][slot], ...patch } },
    }));
    setTests((prev) => ({ ...prev, [`${name}:${slot}`]: EMPTY_TEST }));
  };

  // F1c: one test per backend — probes the filled slots together (plugin
  // config_test parity): per-address rows in the two-layer model (✅ usable /
  // ⚠️ connected but needs auth / ❌ classified error).
  const runTest = useCallback(
    async (name: BackendName) => {
      const internal = form[name].internal.url.trim();
      const external = form[name].external.url.trim();
      if (!internal && !external) return;
      const filled = [
        { slot: 'internal' as const, url: internal },
        { slot: 'external' as const, url: external },
      ].filter((e) => e.url !== '');
      setTests((prev) => ({
        ...prev,
        ...Object.fromEntries(filled.map((e) => [`${name}:${e.slot}`, { status: 'testing' as const }])),
      }));
      try {
        const res = await fetch(apiUrl('/api/agentteams/setup/backends/test'), {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            // PR-91 review: the probe is token-gated pre-login (same door as
            // the save) — the endpoint is no longer an unauthenticated
            // fetch proxy.
            token: token.trim() || undefined,
            // 草稿凭据一起送探测：门后地址（公网 Basic/API key 门）只有带
            // 上表单里刚填的凭据才量得到真实可达性；已存秘密回显的 '***'
            // 由服务端认定为「沿用已存凭据」，不会当密码发出去。
            backends: {
              [name]: {
                internal: internal ? draftToEntry(form[name].internal) : undefined,
                external: external ? draftToEntry(form[name].external) : undefined,
              },
            },
            addressMode,
          }),
        });
        const data = (await res.json().catch(() => null)) as {
          results?: Record<
            string,
            Array<{
              url: string;
              ok: boolean;
              httpOk: boolean;
              ms: number | null;
              detail: string;
              /** 无协议输入的原始值（服务端解析出确定协议后回填输入框）。 */
              resolvedFrom?: string;
            }>
          >;
        } | null;
        const rows = data?.results?.[name] ?? [];
        // 无协议地址（host:port）由服务端按 https 优先解析；把解析结果回填到
        // 输入框，让用户看到实际生效的协议，而不是心里猜。
        const findRow = (url: string) => rows.find((r) => r.url === url || r.resolvedFrom === url);
        const backfilled = { ...form, [name]: { ...form[name] } };
        let touched = false;
        for (const { slot, url } of filled) {
          const row = findRow(url);
          if (row && row.url !== url) {
            backfilled[name][slot] = { ...backfilled[name][slot], url: row.url };
            touched = true;
          }
        }
        if (touched) setForm(backfilled);
        setTests((prev) => {
          const next = { ...prev };
          for (const { slot, url } of filled) {
            const row = findRow(url);
            if (!row) {
              next[`${name}:${slot}`] = { status: 'fail', detail: '无测试结果' };
              continue;
            }
            if (row.ok && row.httpOk) {
              next[`${name}:${slot}`] = { status: 'ok', detail: `${row.ms ?? '-'}ms · ${row.detail}` };
            } else if (row.ok) {
              next[`${name}:${slot}`] = {
                status: row.detail.includes('需鉴权') ? 'auth' : 'fail',
                detail: row.detail,
              };
            } else {
              next[`${name}:${slot}`] = { status: 'fail', detail: row.detail };
            }
          }
          return next;
        });
      } catch (err) {
        setTests((prev) => ({
          ...prev,
          ...Object.fromEntries(filled.map((e) => [`${name}:${e.slot}`, { status: 'fail' as const, detail: err instanceof Error ? err.message : '测试请求失败' }])),
        }));
      }
    },
    // Post-merge review Block 5: token was missing from the deps — entering
    // the address first and the token second left a stale-closure token
    // (empty → pre-login probe 403 → "no test result").
    [form, token, addressMode],
  );

  const applyEmbeddedDefaults = () => {
    setForm(
      Object.fromEntries(
        BACKEND_NAMES.map((name) => [
          name,
          {
            internal: { ...EMPTY_SLOT, url: EMBEDDED_DEFAULTS[name] ?? '' },
            external: { ...EMPTY_SLOT },
          },
        ]),
      ) as Record<BackendName, BackendForm>,
    );
    setTests({});
  };

  /** 保存成功后离开本页：F1g —— 先清掉 ?setup=1 深链再 onDone()（一次
   * reload），否则 reloaded 页面又读到 ?setup=1、forceSetup 仍为真，用户被
   * 困在本页，只能去找「返回登录页」逃生口（install-verify 9/9 验收）。 */
  const finishSetup = () => {
    if (window.location.search) {
      window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    }
    onDone();
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    setSaveNotice(null);
    const backends: Record<string, { internal?: ServerEntry; external?: ServerEntry }> = {};
    for (const name of BACKEND_NAMES) {
      const internal = draftToEntry(form[name].internal);
      const external = draftToEntry(form[name].external);
      if (internal || external) {
        backends[name] = {
          ...(internal ? { internal } : {}),
          ...(external ? { external } : {}),
        };
      }
    }
    try {
      const res = await fetch(apiUrl('/api/agentteams/setup/backends'), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: token.trim(), backends }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        /** 服务端协议解析结果（后端 → 槽位 → 带协议的地址）。 */
        resolved?: Record<string, { internal?: string; external?: string }>;
        /** 两路探测都不通、按 https 落地时的告知。 */
        warnings?: Array<{ backend?: string; slot?: 'internal' | 'external'; warning?: string }>;
      };
      if (res.ok && data.ok) {
        // 保存成功 = token 有效：留一份在 sessionStorage，重开 ?setup=1 才能
        // 带 Authorization 取回已存地址（匿名 GET 不返回拓扑）。
        rememberSetupToken(token.trim());
        // 无协议地址（host:port）已被服务端解析成确定的协议：回填输入框，
        // 让用户看到真正落库的地址。
        if (data.resolved) {
          const next = { ...form };
          for (const [name, slots] of Object.entries(data.resolved)) {
            if (!(name in next)) continue;
            const key = name as BackendName;
            next[key] = { ...next[key] };
            for (const slot of ['internal', 'external'] as const) {
              const url = slots[slot];
              if (url) next[key][slot] = { ...next[key][slot], url };
            }
          }
          setForm(next);
        }
        if (data.warnings && data.warnings.length > 0) {
          // 服务此刻探测不到：已按安全默认 https 保存（绝不静默存 http），但
          // 直接进登录页大概率仍失败（明文打到 TLS 端口 = 400）。停在本页把
          // 方向说清楚，由用户确认。
          setSaveNotice('未探测到服务，已按 https 保存；若只支持 http，请显式写 http://');
          return;
        }
        finishSetup();
        return;
      }
      const messages: Record<string, string> = {
        'token-required': '缺少首次启动 token',
        'invalid-token': '首次启动 token 不正确（见服务器日志 docker logs <容器>，或 env DASHBOARD_SETUP_TOKEN）',
        'already-configured': '后端已配置过；请刷新页面（或让管理员在设置里修改）',
      };
      const error = data.error ?? '';
      // token 不认 → 丢掉存下的那份，别让下次重开继续用坏 token。
      if (error === 'invalid-token' || error === 'token-required') forgetSetupToken();
      setSaveError(messages[error] || error || `保存失败（HTTP ${res.status}）`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>后端配置</CardTitle>
            <CardDescription>{loadError}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => window.location.reload()}>
              <RefreshCw className="mr-2 size-4" />
              刷新
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-start justify-center bg-muted/30 p-4 md:p-8">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="text-lg">{reconfigure ? '后端配置' : '后端配置（首次启动）'}</CardTitle>
          <CardDescription>
            {reconfigure
              ? `覆盖现有后端配置${tokenRequired ? '（登录前保存需要 setup token）' : '（本实例已关闭登录前 token 验证，直接保存即可）'}。保存后回到登录页；配置在挂载卷中，重启不丢失。登录前默认看不到已保存的具体值；token 在本标签页内记住（关闭浏览器即失效），再次打开本页会自动带它取回已存地址。`
              : 'Dashboard 还没有可用的后端地址。填写后保存即可登录；配置保存在挂载卷中，重启不丢失。'}
            每个后端可只填一个地址；「内网」= 容器/集群网络，「外网」= 跨网段备用（自动切换）。
            「测试」一次验证该后端填写的全部地址（✅ 可用 / ⚠️ 已连通需鉴权 / ❌ 不可达，含原因分类）。
            「认证方式」：服务自身认证 = 不额外加头；Basic / Bearer 用于地址前面的公网网关门（Basic 门 / API key 门）。
            MinIO 例外：用 Access Key / Secret Key 签名，不走该认证方式。
            已保存的密码或 token 不回显，留空即保持不变；切回「服务自身认证」= 清除该地址已存凭据。
          </CardDescription>
          {reconfigure && (
            <button
              type="button"
              onClick={() => {
                // A client-side router.push('/') changes the URL but keeps
                // this same-route component mounted; Home's mount effect
                // (which reads ?setup=1 and forceSetup) never runs again,
                // so the setup screen stays visible. A full replace clears
                // the query and remounts Home as the login gate.
                window.location.replace('/');
              }}
              className="self-start text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              ← 返回登录页
            </button>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 地址模式（对齐工作台插件）：自动=内网优先失败切外网；固定档失败不切换。 */}
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="address-mode" className="text-sm font-medium">
              地址模式
            </label>
            <select
              id="address-mode"
              value={addressMode}
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'auto' || v === 'lan' || v === 'wan') setAddressMode(v);
              }}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="auto">自动（内网优先，失败切外网）</option>
              <option value="lan">固定内网（失败不切换）</option>
              <option value="wan">固定外网（失败不切换）</option>
            </select>
          </div>
          {embeddedHealthy && (
            <div className="flex items-center justify-between rounded-md border bg-muted/50 px-3 py-2">
              <span className="text-sm">检测到嵌入式部署（内置地址可用）</span>
              <Button size="sm" variant="outline" onClick={applyEmbeddedDefaults}>
                使用内置默认地址
              </Button>
            </div>
          )}

          <div className="space-y-4">
            {BACKEND_NAMES.map((name) => {
              const hasAny = !!(form[name].internal.url.trim() || form[name].external.url.trim());
              const isTesting = ['internal', 'external'].some(
                (slot) => (tests[`${name}:${slot}`] ?? EMPTY_TEST).status === 'testing',
              );
              const effectiveUrl = effective[name];
              return (
                <div key={name} className="rounded-md border p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-sm font-medium">
                    {BACKEND_LABELS[name]}
                    {REQUIRED_BACKENDS.includes(name) && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        必需
                      </span>
                    )}
                    {effectiveUrl && (
                      <span
                        className="max-w-64 truncate rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-normal text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                        title={`当前生效：${effectiveUrl}`}
                      >
                        当前生效：{effectiveUrl}
                      </span>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto h-7 text-xs"
                      disabled={!hasAny || isTesting}
                      onClick={() => runTest(name)}
                    >
                      {isTesting ? <Loader2 className="size-3.5 animate-spin" /> : '测试'}
                    </Button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {(['internal', 'external'] as const).map((slot) => {
                      const key = `${name}:${slot}`;
                      const test = tests[key] ?? EMPTY_TEST;
                      const draft = form[name][slot];
                      const slotLabel = slot === 'internal' ? '内网地址' : '外网地址（备用）';
                      return (
                        <div key={slot} className="space-y-1">
                          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span className="shrink-0">{slotLabel}</span>
                            <span className="inline-flex items-center gap-1 min-w-0">
                              {test.status === 'ok' && (
                                <>
                                  <CheckCircle2 className="size-3.5 text-green-600 shrink-0" />
                                  <span className="truncate">{test.detail}</span>
                                </>
                              )}
                              {test.status === 'auth' && (
                                <>
                                  <AlertTriangle className="size-3.5 text-amber-500 shrink-0" />
                                  <span className="truncate">{test.detail}</span>
                                </>
                              )}
                              {test.status === 'fail' && (
                                <>
                                  <XCircle className="size-3.5 text-red-600 shrink-0" />
                                  <span className="truncate max-w-56" title={test.detail}>
                                    {test.detail}
                                  </span>
                                </>
                              )}
                            </span>
                          </div>
                          <Input
                            value={draft.url}
                            onChange={(e) => setSlot(name, slot, { url: e.target.value })}
                            placeholder="host:port（自动识别 https / http）"
                            spellCheck={false}
                          />
                          {/* 认证方式 + 凭据（秘密永不回显：已存时占位提示，留空保持）。
                              MinIO 例外：S3 用 Access Key/Secret Key 签名，不提供 Basic/Bearer。 */}
                          {name === 'minio' ? (
                            <p className="text-xs text-muted-foreground">
                              MinIO 用 Access Key / Secret Key 签名（AGENTTEAMS_FS_ACCESS_KEY /
                              AGENTTEAMS_FS_SECRET_KEY），不走 Basic/Bearer —— 这里只填地址。
                            </p>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2">
                              <select
                                aria-label={`${slotLabel}认证方式`}
                                value={draft.type}
                                onChange={(e) =>
                                  setSlot(name, slot, {
                                    type: e.target.value as AuthType,
                                    stored: false,
                                  })
                                }
                                className="h-8 rounded-md border bg-background px-2 text-xs"
                              >
                                <option value="none">服务自身认证</option>
                                <option value="basic">Basic 认证</option>
                                <option value="bearer">Bearer Token</option>
                              </select>
                              {draft.type === 'basic' && (
                                <>
                                  <Input
                                    className="h-8 min-w-24 flex-1 text-xs"
                                    value={draft.username}
                                    onChange={(e) => setSlot(name, slot, { username: e.target.value })}
                                    placeholder="用户名"
                                    spellCheck={false}
                                    autoComplete="off"
                                  />
                                  <Input
                                    className="h-8 min-w-24 flex-1 text-xs"
                                    type="password"
                                    value={draft.password}
                                    onChange={(e) => setSlot(name, slot, { password: e.target.value })}
                                    placeholder={draft.stored ? '密码（已保存 · 留空保持）' : '密码'}
                                    spellCheck={false}
                                    autoComplete="new-password"
                                  />
                                </>
                              )}
                              {draft.type === 'bearer' && (
                                <Input
                                  className="h-8 min-w-24 flex-1 text-xs"
                                  type="password"
                                  value={draft.token}
                                  onChange={(e) => setSlot(name, slot, { token: e.target.value })}
                                  placeholder={draft.stored ? 'Token（已保存 · 留空保持）' : 'Bearer token'}
                                  spellCheck={false}
                                  autoComplete="new-password"
                                />
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {tokenRequired && (
            <div className="space-y-1">
              <div className="text-sm font-medium">{reconfigure ? 'Setup token' : '首次启动 token'}</div>
              <Input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="见服务器日志或 DASHBOARD_SETUP_TOKEN"
                spellCheck={false}
              />
              <p className="text-xs text-muted-foreground">
                {reconfigure
                  ? '登录前修改配置需要 setup token（与首启同一个）：docker logs &lt;容器&gt; 搜 setup token，或 env DASHBOARD_SETUP_TOKEN。找不到 token = docker volume rm 数据卷 出厂重置（配置与 token 一并重建）。'
                  : '首启保存需要；之后登录前修改配置（?setup=1）仍是同一个 token（可重复使用，直到数据卷出厂重置）。token 在服务器日志里（docker logs &lt;容器&gt;，搜 setup token），也可用 env DASHBOARD_SETUP_TOKEN 预先指定。'}
              </p>
            </div>
          )}

          {saveError && <p className="text-sm text-red-600">{saveError}</p>}

          {saveNotice && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <span>{saveNotice}</span>
              <button type="button" onClick={finishSetup} className="ml-2 underline">
                仍要进入登录页
              </button>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              保存并进入登录
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

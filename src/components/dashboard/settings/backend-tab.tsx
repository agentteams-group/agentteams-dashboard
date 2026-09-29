'use client';

// Settings > 后端 tab (F1b + F1c): the server-side backend address config.
//
// Plugin parity (F1c, decided 9/9 — deployment model is one instance per
// user, no shared instances): ANY logged-in user (L1 or L2) can view, test
// and SAVE the backend config — exactly like the plugin's config page, which
// is open to whoever uses the host. There is no owner token for saving; the
// first-launch token only gates the PRE-LOGIN setup page (the dashboard's
// install-method difference). SSRF surface of user-supplied addresses stays
// pinned server-side by DASHBOARD_ALLOWED_HOSTS.
//
// - GET /api/agentteams/setup/backends → config (internal/external per
//   backend) + effective (working cache) for the "在生效" badge.
// - Per-backend "测试" → POST .../backends/test with the FORM values (draft):
//   the server probes each address (parallel, one retry) and returns rows in
//   the plugin's two-layer model — ✅ connected & usable (ms) / ⚠️ connected
//   but needs auth (401/403) / ❌ classified error (DNS / refused / timeout /
//   TLS 握手 / TLS 证书 / 连接失败). Draft tests never touch the effective
//   cache; a failed test never clears it.
// - 保存 → POST .../backends (no token). The server re-probes what was saved
//   and returns effective/switched; the tab then auto-runs a test on the
//   saved list (plugin "保存后自动测一次") and shows the switch banner.
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
import { apiUrl } from '@/lib/api-base';
import {
  BACKEND_LABELS,
  BACKEND_NAMES,
  EMBEDDED_DEFAULTS,
  REQUIRED_BACKENDS,
} from '@/lib/backend-names';

interface BackendAddrs {
  internal?: string;
  external?: string;
}

interface BackendsState {
  configured: boolean;
  backends: Record<string, { configured: boolean; candidates: string[] }>;
  config?: Record<string, BackendAddrs>;
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

function initialFields(
  config: Record<string, BackendAddrs> | undefined,
  embedded: BackendsState['embedded'],
) {
  const out: Record<string, { internal: string; external: string }> = {};
  for (const name of BACKEND_NAMES) {
    const cfg = config?.[name];
    // F-3 / 需求 2.4: an empty `internal` slot paired with a healthy embedded
    // probe gets prefilled with EMBEDDED_DEFAULTS — editable (the operator can
    // overwrite before saving). Required backends always get the default so
    // the slot never stays blank in the standard embedded install. `external`
    // stays empty (no auto-fallback for the operator's wide-area address).
    const internal =
      cfg?.internal?.trim() ||
      (embedded?.healthy?.[name] === true && EMBEDDED_DEFAULTS[name]
        ? EMBEDDED_DEFAULTS[name] ?? ''
        : '');
    out[name] = {
      internal,
      external: cfg?.external ?? '',
    };
  }
  return out;
}

function RowIcon({ row }: { row: TestRow }) {
  if (row.ok && row.httpOk) return <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />;
  if (row.ok) return <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />;
  return <XCircle className="w-3 h-3 text-red-600 shrink-0" />;
}

export function BackendTab() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<BackendsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [fields, setFields] = useState<Record<string, { internal: string; external: string }>>({});
  const [rows, setRows] = useState<Record<string, TestRow[]>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ switched: string[]; unchanged: string[] } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/agentteams/setup/backends/'), { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as BackendsState;
      setState(data);
      setFields((prev) => (Object.keys(prev).length > 0 ? prev : initialFields(data.config, data.embedded)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setField = (backend: string, slot: 'internal' | 'external', value: string) => {
    setFields((prev) => ({ ...prev, [backend]: { ...prev[backend], [slot]: value } }));
    setSaved(false);
    setSaveError(null);
    setBanner(null);
    setRows((prev) => {
      const rest = { ...prev };
      delete rest[backend];
      return rest;
    });
  };

  const runTest = useCallback(
    async (backends: Record<string, { internal: string; external: string }>) => {
      const payload: Record<string, BackendAddrs> = {};
      for (const [name, addrs] of Object.entries(backends)) {
        const internal = addrs.internal?.trim() ?? '';
        const external = addrs.external?.trim() ?? '';
        if (internal || external) {
          payload[name] = { ...(internal ? { internal } : {}), ...(external ? { external } : {}) };
        }
      }
      if (Object.keys(payload).length === 0) {
        setSaveError('请先在内部或外部地址栏填写地址，再点「测试」。');
        return;
      }
      setTesting(Object.fromEntries(Object.keys(payload).map((n) => [n, true])));
      try {
        const res = await fetch(apiUrl('/api/agentteams/setup/backends/test/'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ backends: payload }),
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
          for (const n of Object.keys(payload)) next[n] = false;
          return next;
        });
      }
    },
    [],
  );

  const handleTestBackend = (name: string) => {
    if (!fields[name]) {
      setSaveError('该后端没有待测草稿地址——先在内部/外部地址栏填写后再点「测试」。');
      return;
    }
    void runTest({ [name]: fields[name] });
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    setBanner(null);
    try {
      const backends: Record<string, { internal: string; external: string }> = {};
      for (const name of BACKEND_NAMES) {
        const internal = (fields[name]?.internal ?? '').trim();
        const external = (fields[name]?.external ?? '').trim();
        if (internal || external) backends[name] = { internal, external };
      }
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
        await load();
        // The overview infrastructure panel re-resolves per request; nudge it
        // so the health tiles reflect the new addresses promptly.
        void queryClient.invalidateQueries({ queryKey: ['agentteams-infrastructure'] });
        // Plugin parity: auto-test the saved list once after saving.
        void runTest(backends);
        const switchedNames: string[] = [];
        const unchangedNames: string[] = [];
        for (const name of Object.keys(backends)) {
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
        const hasAny = !!(fields[name]?.internal?.trim() || fields[name]?.external?.trim());
        return (
          <div key={name} className="space-y-1.5 rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <Server className="w-3.5 h-3.5 text-muted-foreground" />
              <Label className="text-sm">{BACKEND_LABELS[name]}</Label>
              {missingRequired && (
                <Badge variant="destructive" className="text-[10px] h-4 px-1.5">
                  无可用地址（影响登录/数据面）
                </Badge>
              )}
              <Button
                variant="outline"
                size="sm"
                className="ml-auto h-7 text-xs"
                onClick={() => handleTestBackend(name)}
                disabled={isTesting || !hasAny}
              >
                {isTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '测试'}
              </Button>
            </div>
            {(['internal', 'external'] as const).map((slot) => {
              const prefilled =
                slot === 'internal' &&
                !fields[name]?.internal?.trim() &&
                state.embedded?.healthy?.[name] === true &&
                !!EMBEDDED_DEFAULTS[name];
              return (
                <div key={slot} className="flex items-center gap-2 pl-5">
                  <span className="w-14 text-xs text-muted-foreground shrink-0">
                    {slot === 'internal' ? '内网' : '外网'}
                  </span>
                  <Input
                    value={fields[name]?.[slot] ?? ''}
                    onChange={(e) => setField(name, slot, e.target.value)}
                    placeholder="http://host:port（可选，留空=用 env/内置）"
                    className="h-8 text-xs flex-1"
                    spellCheck={false}
                  />
                  {prefilled && (
                    <Badge variant="secondary" className="shrink-0 text-[10px] h-4 px-1.5">
                      嵌入式探测
                    </Badge>
                  )}
                </div>
              );
            })}
            {rows[name]?.map((row) => (
              <div key={row.url} className="flex items-center gap-1.5 pl-5 text-[11px]">
                <RowIcon row={row} />
                <span className="text-muted-foreground shrink-0">
                  {row.ok && row.httpOk && row.ms != null ? `${row.ms}ms · ` : ''}
                  {row.detail}
                </span>
                <span className="truncate text-muted-foreground/70 max-w-52" title={row.url}>
                  {row.url}
                </span>
                {effective[name] === row.url && (
                  <Badge variant="secondary" className="text-[11px] h-4 px-1 shrink-0">
                    在生效
                  </Badge>
                )}
              </div>
            ))}
            {candidates.length > 0 && (
              <p className="pl-5 text-[10px] text-muted-foreground truncate">
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

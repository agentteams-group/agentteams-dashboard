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

interface BackendStatus {
  configured: boolean;
  candidates: string[];
}

interface SetupStatusResponse {
  configured: boolean;
  /** F1f3: false when the installer disabled the pre-login token gate
   * (DASHBOARD_SETUP_TOKEN_ENFORCE=0) — the token field is hidden. */
  setupTokenRequired?: boolean;
  /** PR-91 review: absent in the anonymous (pre-login, no token) response —
   * the saved topology is only served to a session or ?token= holder. */
  backends?: Record<BackendName, BackendStatus>;
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

export function BackendSetupPage({ onDone, reconfigure = false }: { onDone: () => void; reconfigure?: boolean }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addrs, setAddrs] = useState<Record<BackendName, { internal: string; external: string }>>(
    () =>
      Object.fromEntries(
        BACKEND_NAMES.map((name) => [name, { internal: '', external: '' }]),
      ) as Record<BackendName, { internal: string; external: string }>,
  );
  const [embeddedHealthy, setEmbeddedHealthy] = useState(false);
  const [token, setToken] = useState('');
  const [tokenRequired, setTokenRequired] = useState(true);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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
        const next = Object.fromEntries(
          BACKEND_NAMES.map((name) => {
            const candidates = data.backends?.[name]?.candidates ?? [];
            return [name, { internal: candidates[0] ?? '', external: candidates[1] ?? '' }];
          }),
        ) as Record<BackendName, { internal: string; external: string }>;
        setAddrs(next);
        setEmbeddedHealthy(
          !!data.embedded?.healthy &&
            REQUIRED_BACKENDS.every((name) => data.embedded.healthy?.[name] === true),
        );
        setTokenRequired(data.setupTokenRequired ?? true);
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

  // PR-91 review: the saved topology is no longer served pre-login. Once
  // the operator enters the setup token (reconfigure mode), refetch with
  // it — same owner gate as the pre-login write — and prefill the saved
  // addresses (only empty slots: never overwrite what the user typed).
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
          if (cancelled || !data?.backends) return;
          setAddrs((prev) =>
            Object.fromEntries(
              BACKEND_NAMES.map((name) => {
                const candidates = data.backends?.[name]?.candidates ?? [];
                const cur = prev[name];
                return [
                  name,
                  {
                    internal: cur.internal.trim() || (candidates[0] ?? ''),
                    external: cur.external.trim() || (candidates[1] ?? ''),
                  },
                ];
              }),
            ) as Record<BackendName, { internal: string; external: string }>,
          );
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
    setAddrs((prev) => {
      const anyFilled = BACKEND_NAMES.some(
        (name) => prev[name].internal.trim() !== '' || prev[name].external.trim() !== '',
      );
      if (anyFilled) return prev;
      return Object.fromEntries(
        BACKEND_NAMES.map((name) => [
          name,
          { internal: EMBEDDED_DEFAULTS[name] ?? '', external: '' },
        ]),
      ) as Record<BackendName, { internal: string; external: string }>;
    });
    setAutoFilled(true);
  }, [autoFilled, embeddedHealthy, reconfigure]);

  const setSlot = (name: BackendName, slot: 'internal' | 'external', value: string) => {
    setAddrs((prev) => ({ ...prev, [name]: { ...prev[name], [slot]: value } }));
    setTests((prev) => ({ ...prev, [`${name}:${slot}`]: EMPTY_TEST }));
  };

  // F1c: one test per backend — probes the filled slots together (plugin
  // config_test parity): per-address rows in the two-layer model (✅ usable /
  // ⚠️ connected but needs auth / ❌ classified error).
  const runTest = useCallback(
    async (name: BackendName) => {
      const internal = addrs[name].internal.trim();
      const external = addrs[name].external.trim();
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
            backends: { [name]: { internal: internal || undefined, external: external || undefined } },
          }),
        });
        const data = (await res.json().catch(() => null)) as {
          results?: Record<string, Array<{ url: string; ok: boolean; httpOk: boolean; ms: number | null; detail: string }>>;
        } | null;
        const rows = data?.results?.[name] ?? [];
        setTests((prev) => {
          const next = { ...prev };
          for (const { slot, url } of filled) {
            const row = rows.find((r) => r.url === url);
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
    [addrs, token],
  );

  const applyEmbeddedDefaults = () => {
    setAddrs(
      Object.fromEntries(
        BACKEND_NAMES.map((name) => [
          name,
          { internal: EMBEDDED_DEFAULTS[name] ?? '', external: '' },
        ]),
      ) as Record<BackendName, { internal: string; external: string }>,
    );
    setTests({});
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    const backends: Record<string, { internal?: string; external?: string }> = {};
    for (const name of BACKEND_NAMES) {
      const internal = addrs[name].internal.trim();
      const external = addrs[name].external.trim();
      if (internal || external) backends[name] = { internal: internal || undefined, external: external || undefined };
    }
    try {
      const res = await fetch(apiUrl('/api/agentteams/setup/backends'), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: token.trim(), backends }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        // F1g: clear the ?setup=1 deep link before onDone() (a reload) —
        // otherwise the reloaded page re-reads ?setup=1, forceSetup stays
        // true, and the user is stuck on this page and must hunt for the
        // "返回登录页" escape hatch (install-verify 9/9 acceptance).
        if (window.location.search) {
          window.history.replaceState(null, '', window.location.pathname + window.location.hash);
        }
        onDone();
        return;
      }
      const messages: Record<string, string> = {
        'token-required': '缺少首次启动 token',
        'invalid-token': '首次启动 token 不正确（见服务器日志 docker logs <容器>，或 env DASHBOARD_SETUP_TOKEN）',
        'already-configured': '后端已配置过；请刷新页面（或让管理员在设置里修改）',
      };
      setSaveError(messages[data.error ?? ''] || data.error || `保存失败（HTTP ${res.status}）`);
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
              ? `覆盖现有后端配置${tokenRequired ? '（登录前保存需要 setup token）' : '（本实例已关闭登录前 token 验证，直接保存即可）'}。保存后回到登录页；配置在挂载卷中，重启不丢失。登录前默认看不到已保存的具体值，直接填写正确地址即可；填入 setup token 后已存值会自动回填空槽。`
              : 'Dashboard 还没有可用的后端地址。填写后保存即可登录；配置保存在挂载卷中，重启不丢失。'}
            每个后端可只填一个地址；「内网」= 容器/集群网络，「外网」= 跨网段备用（自动切换）。
            「测试」一次验证该后端填写的全部地址（✅ 可用 / ⚠️ 已连通需鉴权 / ❌ 不可达，含原因分类）。
          </CardDescription>
          {reconfigure && (
            <button
              type="button"
              onClick={() => window.location.assign('/')}
              className="self-start text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              ← 返回登录页
            </button>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
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
              const hasAny = !!(addrs[name].internal.trim() || addrs[name].external.trim());
              const isTesting = ['internal', 'external'].some(
                (slot) => (tests[`${name}:${slot}`] ?? EMPTY_TEST).status === 'testing',
              );
              return (
                <div key={name} className="rounded-md border p-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    {BACKEND_LABELS[name]}
                    {REQUIRED_BACKENDS.includes(name) && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        必需
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
                      return (
                        <div key={slot} className="space-y-1">
                          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span className="shrink-0">{slot === 'internal' ? '内网地址' : '外网地址（备用）'}</span>
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
                            value={addrs[name][slot]}
                            onChange={(e) => setSlot(name, slot, e.target.value)}
                            placeholder="http://host:port"
                            spellCheck={false}
                          />
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

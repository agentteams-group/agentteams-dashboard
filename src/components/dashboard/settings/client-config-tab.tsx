'use client';

import { useState } from 'react';
import { useMatrixStore } from '@/lib/matrix-store';
import {
  loadClientConfig,
  updateClientConfig,
  validateClientAddress,
} from '@/lib/client-config-store';
import { apiUrl } from '@/lib/api-base';
import { AlertCircle, CheckCircle2, LogOut, Save, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const SPLIT = (text: string): string[] =>
  text.split('\n').map((s) => s.trim()).filter(Boolean);

/**
 * F7 "客户端" settings tab — visible only in stateless deployments
 * (DASHBOARD_STATELESS=1; the dialog probes /api/agentteams/mode).
 *
 * Holds the browser-side credential surface: the Matrix account (from the
 * persisted matrix-store, plugin config.json 1:1) with the S4
 * "revoke this device" action, and the at_cfg address lists (Matrix
 * homeservers / Controller URLs / optional L1 controller token / SGLang).
 *
 * No test/validate button: the browser cannot probe the backends directly
 * (CORS) and the server refuses ad-hoc SSRF — the login flow and the first
 * data call are the natural validation, with actionable errors.
 */
export function ClientConfigTab() {
  const matrix = useMatrixStore();
  // Hydrate the form from localStorage via lazy initializers (synchronous on
  // first render — no effect, no empty→value flash; the tab remounts on
  // every settings-dialog open, so the initial read is always fresh).
  const [matrixUrls, setMatrixUrls] = useState(() => loadClientConfig()?.matrix_homeservers.join('\n') ?? '');
  const [controllerUrls, setControllerUrls] = useState(() => loadClientConfig()?.controller_urls.join('\n') ?? '');
  const [controllerToken, setControllerToken] = useState(() => loadClientConfig()?.controller_token ?? '');
  const [sglangEnabled, setSglangEnabled] = useState(() => loadClientConfig()?.sglang.enabled ?? false);
  const [sglangUrls, setSglangUrls] = useState(() => loadClientConfig()?.sglang.urls.join('\n') ?? '');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const handleSave = () => {
    setError(null);
    setSaved(false);
    const mUrls = SPLIT(matrixUrls);
    const cUrls = SPLIT(controllerUrls);
    const sUrls = sglangEnabled ? SPLIT(sglangUrls) : [];
    for (const url of mUrls) {
      const err = validateClientAddress(url, 'matrix');
      if (err) { setError(`Matrix 地址 ${url}：${err}`); return; }
    }
    for (const url of [...cUrls, ...sUrls]) {
      const err = validateClientAddress(url, 'controller');
      if (err) { setError(`地址 ${url}：${err}`); return; }
    }
    updateClientConfig({
      matrix_homeservers: mUrls,
      controller_urls: cUrls,
      controller_token: controllerToken.trim(),
      sglang: { enabled: sglangEnabled, urls: sUrls },
    });
    setSaved(true);
  };

  const handleRevokeDevice = async () => {
    if (!matrix.deviceId) {
      setRevokeError('当前登录会话没有 device_id（旧会话），请重新登录后再撤销');
      return;
    }
    if (!window.confirm('确定撤销此设备？撤销后本浏览器的登录立即失效，需要重新登录。')) return;
    setRevoking(true);
    setRevokeError(null);
    try {
      const res = await fetch(apiUrl('/api/matrix/delete-devices'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${matrix.accessToken}`,
        },
        body: JSON.stringify({ homeserver: matrix.homeserver, deviceId: matrix.deviceId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `撤销失败 (HTTP ${res.status})`);
      }
      // Token is dead server-side now — wipe the browser credential (the
      // canonical clear also invalidates in-flight /sync loops) and go back
      // to the entry page (stateless login).
      matrix.logout();
      window.location.replace(`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/`);
    } catch (err: unknown) {
      setRevokeError(err instanceof Error ? err.message : '撤销失败');
    } finally {
      setRevoking(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Matrix account (persisted, plugin config.json 1:1) ───────── */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium">Matrix 账号（本浏览器凭据）</h3>
        {matrix.isLoggedIn && matrix.userId ? (
          <div className="space-y-3 rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="space-y-1">
                <div className="text-sm font-mono">{matrix.userId}</div>
                <div className="text-xs text-muted-foreground">
                  服务器：{matrix.homeserver || '—'}
                  {matrix.deviceId ? ` · 设备：${matrix.deviceId}` : ''}
                </div>
              </div>
              <Badge variant="outline" className="shrink-0">已登录</Badge>
            </div>
            <div className="flex items-center justify-between gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRevokeDevice}
                disabled={revoking || !matrix.deviceId}
                className="text-destructive hover:text-destructive"
              >
                <LogOut className="w-3.5 h-3.5 mr-1.5" />
                {revoking ? '撤销中…' : '撤销此设备（退出登录）'}
              </Button>
            </div>
            {revokeError && (
              <div className="flex items-center gap-2 text-destructive text-xs">
                <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                <span>{revokeError}</span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            未登录。回到登录页使用无状态登录建立本浏览器凭据。
          </p>
        )}
      </section>

      {/* ── Address lists (at_cfg) ────────────────────────────────────── */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium">服务地址（at_cfg，每行一个）</h3>
        <div className="space-y-1">
          <Label htmlFor="cfg-matrix-urls">Matrix 服务器地址（登录 failover 顺序 + 身份探针首选）</Label>
          <textarea
            id="cfg-matrix-urls"
            rows={2}
            value={matrixUrls}
            onChange={(e) => setMatrixUrls(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            placeholder={'http://<集群IP>:6867'}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cfg-controller-urls">
            Controller 地址（记录用·插件兼容字段——本部署数据面实际使用服务端部署 env 配置的 Controller 地址，改这里不影响当前数据面）
          </Label>
          <textarea
            id="cfg-controller-urls"
            rows={2}
            value={controllerUrls}
            onChange={(e) => setControllerUrls(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            placeholder={'http://<集群IP>:8090'}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cfg-controller-token">Controller 管理员 token（可选）</Label>
          <Input
            id="cfg-controller-token"
            type="password"
            value={controllerToken}
            onChange={(e) => setControllerToken(e.target.value)}
            placeholder="留空 = 按 Matrix 账号权限；填写 = L1 全量视图"
          />
          <p className="text-xs text-muted-foreground">
            保存后数据面请求立即携带该 token（每请求读取 localStorage）；身份级别由服务端按 token 重新解析（缓存 5 分钟）。
          </p>
        </div>
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={sglangEnabled}
              onChange={(e) => setSglangEnabled(e.target.checked)}
              className="rounded border-input"
            />
            SGLang 地址（记录用·插件兼容字段——dashboard 负载监控走服务端探针）
          </label>
          {sglangEnabled && (
            <textarea
              rows={2}
              value={sglangUrls}
              onChange={(e) => setSglangUrls(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
              placeholder={'http://<GPU节点IP>:30000（每行一个）'}
            />
          )}
        </div>
        {error && (
          <div className="flex items-center gap-2 text-destructive text-xs">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <Button size="sm" onClick={handleSave}>
          <Save className="w-4 h-4 mr-1.5" />
          保存地址配置
        </Button>
        {saved && (
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-xs">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span>已保存（数据面请求立即生效）</span>
          </div>
        )}
      </section>
    </div>
  );
}

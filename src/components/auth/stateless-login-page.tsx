'use client';

import { useState } from 'react';
import { apiUrl } from '@/lib/api-base';
import { useMatrixStore } from '@/lib/matrix-store';
import {
  loadClientConfig,
  saveClientConfig,
  validateClientAddress,
} from '@/lib/client-config-store';
import { AlertCircle, KeyRound, LogIn, RefreshCw, Server } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

interface StatelessLoginPageProps {
  onLoginSuccess?: () => void;
  /** 'unauthorized' = stored credential expired/revoked (401 bounce);
   * 'invalid' = credential rejected by the controller (re-login). */
  reason?: 'unauthorized' | 'invalid' | null;
  detail?: string;
  /** Server-side Matrix homeserver candidates (from /mode, stateless
   *  deployments only) — prefills the address on first-time login so the
   *  user does not have to type a deploy constant. Stored config wins. */
  defaultHomeservers?: string[];
  /** `?reason=unauthorized&from=data401`: the login was fine but the data
   *  plane rejected the credential — show the actionable cause, not "expired". */
  fromData401?: boolean;
}

interface LoginOutcome {
  ok: boolean;
  definitive?: boolean;
  message: string;
  homeserver?: string;
  accessToken?: string;
  userId?: string;
  deviceId?: string;
}

/**
 * Walk the configured Matrix homeservers with the plugin's failover
 * semantics: an AUTH error (401/403) is definitive — stop and surface it;
 * a network failure (502/unreachable) walks to the next address.
 */
async function loginWithFailover(
  homeservers: string[],
  username: string,
  password: string,
): Promise<LoginOutcome> {
  let lastNetworkError = '所有 Matrix 地址不可达';
  for (const homeserver of homeservers) {
    try {
      const res = await fetch(apiUrl('/api/matrix/static-login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ homeserver, username, password, device_name: 'dashboard' }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        return {
          ok: true,
          message: 'ok',
          homeserver,
          accessToken: data.access_token,
          userId: data.user_id,
          deviceId: data.device_id,
        };
      }
      // 502 = the dashboard could not reach this homeserver (network
      // failure) — walk to the next configured address (plugin parity).
      if (res.status === 502) {
        lastNetworkError = `${homeserver} 不可达（${data.error || '网络错误'}）`;
        continue;
      }
      // Any other status is an auth/validation answer from (in front of)
      // the homeserver — definitive, do not walk.
      return { ok: false, definitive: true, message: data.error || `登录失败 (HTTP ${res.status})` };
    } catch {
      lastNetworkError = `${homeserver} 不可达`;
      continue;
    }
  }
  return { ok: false, message: lastNetworkError };
}

export function StatelessLoginPage({ onLoginSuccess, reason, detail, defaultHomeservers, fromData401 = false }: StatelessLoginPageProps) {
  const stored = typeof window !== 'undefined' ? loadClientConfig() : null;
  // First-time login: prefill from the deployment's server-side address
  // list (a deploy constant — §11.10); an existing stored config always
  // wins. With no stored config and no server candidates the section
  // stays open so the user must fill the addresses.
  const [homeserverText, setHomeserverText] = useState(
    stored?.matrix_homeservers.length
      ? stored.matrix_homeservers.join('\n')
      : defaultHomeservers?.length
        ? defaultHomeservers.join('\n')
        : '',
  );
  const [controllerText, setControllerText] = useState(stored?.controller_urls.join('\n') ?? '');
  const [controllerToken, setControllerToken] = useState(stored?.controller_token ?? '');
  const [addressOpen, setAddressOpen] = useState(
    !(stored?.matrix_homeservers.length) && !(defaultHomeservers?.length),
  );
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setMatrixAuth = useMatrixStore((s) => s.setMatrixAuth);

  const splitLines = (text: string): string[] =>
    text.split('\n').map((s) => s.trim()).filter(Boolean);

  const handleLogin = async () => {
    if (!username || !password) return;
    setError(null);

    const matrixHomeservers = splitLines(homeserverText);
    if (matrixHomeservers.length === 0) {
      setError('请先填写 Matrix 服务器地址');
      return;
    }
    const controllerUrls = splitLines(controllerText);
    for (const url of [...matrixHomeservers, ...controllerUrls]) {
      const err = validateClientAddress(url, matrixHomeservers.includes(url) ? 'matrix' : 'controller');
      if (err) {
        setError(`${url}：${err}`);
        return;
      }
    }

    setIsLoading(true);
    try {
      // Persist the address config (1:1 with the plugin's config.json shape).
      saveClientConfig({
        matrix_homeservers: matrixHomeservers,
        controller_urls: controllerUrls,
        controller_token: controllerToken.trim(),
        sglang: stored?.sglang ?? { enabled: false, urls: [] },
      });

      const outcome = await loginWithFailover(matrixHomeservers, username, password);
      if (!outcome.ok) {
        setError(outcome.message);
        return;
      }
      if (!outcome.accessToken || !outcome.userId) {
        setError('登录响应缺少凭据字段');
        return;
      }
      setMatrixAuth({
        homeserver: outcome.homeserver ?? matrixHomeservers[0],
        accessToken: outcome.accessToken,
        userId: outcome.userId,
        deviceId: outcome.deviceId ?? '',
      });
      setTimeout(() => onLoginSuccess?.(), 100);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <KeyRound className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">AgentTeams Dashboard · 无状态模式</CardTitle>
              <p className="text-xs text-muted-foreground">
                凭据保存在本浏览器（localStorage），服务端零存储
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {reason === 'unauthorized' && (
            <div className="flex items-start gap-2 text-amber-600 dark:text-amber-400 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>
                {fromData401
                  ? '登录成功但数据面凭据被拒绝：请检查 Controller 服务账号 token / 网关认证，或使用 Controller token 登录'
                  : '登录已过期或设备被撤销，请重新登录'}
              </span>
            </div>
          )}
          {reason === 'invalid' && (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{detail || '凭据无效或已失效，请重新登录'}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => setAddressOpen((v) => !v)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              <Server className="w-3.5 h-3.5" />
              {addressOpen ? '收起服务地址配置 ▲' : '服务地址配置 ▼'}
            </button>
            {addressOpen && (
              <div className="space-y-2">
                <div className="space-y-1">
                  <Label htmlFor="sl-matrix-urls">Matrix 服务器地址（每行一个，按顺序 failover）</Label>
                  <textarea
                    id="sl-matrix-urls"
                    rows={2}
                    placeholder={'http://<集群IP>:6867'}
                    value={homeserverText}
                    onChange={(e) => setHomeserverText(e.target.value)}
                    disabled={isLoading}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sl-controller-urls">Controller 地址（记录用·插件兼容——数据面走服务端部署配置）</Label>
                  <textarea
                    id="sl-controller-urls"
                    rows={2}
                    placeholder={'http://<集群IP>:8090'}
                    value={controllerText}
                    onChange={(e) => setControllerText(e.target.value)}
                    disabled={isLoading}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sl-controller-token">Controller 管理员 token（可选）</Label>
                  <Input
                    id="sl-controller-token"
                    type="password"
                    placeholder="留空 = 按 Matrix 账号权限（L2/L3）；填写 = L1 全量视图"
                    value={controllerToken}
                    onChange={(e) => setControllerToken(e.target.value)}
                    disabled={isLoading}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="sl-username">用户名</Label>
            <Input
              id="sl-username"
              placeholder="l1 / l2 / l3"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              disabled={isLoading}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sl-password">密码</Label>
            <Input
              id="sl-password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              disabled={isLoading}
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <Button
            onClick={handleLogin}
            disabled={isLoading || !username || !password}
            className="w-full"
          >
            {isLoading ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                登录中（逐个地址尝试）...
              </>
            ) : (
              <>
                <LogIn className="w-4 h-4 mr-2" />
                登录
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { apiUrl } from '@/lib/api-base';
import { useMatrixStore } from '@/lib/matrix-store';
import { Lock, LogIn, RefreshCw, AlertCircle, ArrowUpRight, Bot, ShieldCheck, Workflow, Settings2 } from 'lucide-react';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

interface LoginPageProps {
  onLoginSuccess?: () => void;
  defaultUsername?: string;
  /** The data plane bounced with 401 (`?reason=unauthorized&from=data401`):
   * the login itself succeeded but the Controller/gateway rejected the
   * credential. Show an actionable notice — never retry automatically. */
  dataPlaneRejected?: boolean;
}

export function LoginPage({ onLoginSuccess, defaultUsername = 'admin', dataPlaneRejected = false }: LoginPageProps) {
  const [username, setUsername] = useState(defaultUsername);
  const [password, setPassword] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminVisible, setAdminVisible] = useState(false);
  const [tokenOnlyToken, setTokenOnlyToken] = useState('');
  const [tokenOnlyVisible, setTokenOnlyVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setMatrixAuth = useMatrixStore((s) => s.setMatrixAuth);
  useEffect(() => {
    const installedUsername = new URLSearchParams(window.location.search).get('username');
    if (installedUsername && /^[a-zA-Z0-9_.-]+$/.test(installedUsername)) setUsername(installedUsername);
  }, []);

  const handleLogin = async () => {
    if (!username || !password) return;
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          // Optional L1 administrator verification for the old Controller:
          // sent only when both fields are filled, so the body for ordinary
          // L2/L3 accounts stays exactly {username, password}.
          ...(adminUsername && adminPassword ? { adminUsername, adminPassword } : {}),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Login failed');
      }

      // Store Matrix auto-login result if available
      if (data.matrix?.accessToken) {
        setMatrixAuth(data.matrix);
      }

      // Small delay to ensure cookie is fully persisted before reload
      setTimeout(() => onLoginSuccess?.(), 100);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  // Token-only login: no username/password at all. The Controller admin token
  // is admin-grade on its own (single-operator deployments may have neither a
  // Console admin nor a Matrix Human account).
  const handleTokenLogin = async () => {
    if (!tokenOnlyToken) return;
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ controllerToken: tokenOnlyToken }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Login failed');
      }

      if (data.matrix?.accessToken) {
        setMatrixAuth(data.matrix);
      }

      // Small delay to ensure cookie is fully persisted before reload
      setTimeout(() => onLoginSuccess?.(), 100);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-primary/5 p-12 lg:flex xl:p-16">
        <div className="flex items-center gap-3"><Image src="/agentteams-logo.svg" alt="" width={32} height={32} /><span className="text-lg font-semibold tracking-tight">AgentTeams</span></div>
        <div className="max-w-lg py-16">
          <p className="mb-5 text-sm font-medium text-primary">你的目标，团队一起完成。</p>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">从一句话开始，<br />把工作向前推进。</h1>
          <p className="mt-6 max-w-md text-sm leading-7 text-muted-foreground">与平台助手管理日常运维，与团队助手协同推进项目。对话、执行过程和交付成果，都在同一个工作区。</p>
          <div className="mt-12 space-y-5">
            <div className="flex items-center gap-4"><ShieldCheck className="size-5 text-primary" /><span className="text-sm">平台管理，直接对话</span></div>
            <div className="flex items-center gap-4"><Bot className="size-5 text-primary" /><span className="text-sm">团队协作，随时跟进</span></div>
            <div className="flex items-center gap-4"><Workflow className="size-5 text-primary" /><span className="text-sm">从目标到交付，进展清晰可见</span></div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">AgentTeams · Agents work better together.</p>
      </section>
      <div className="flex items-center justify-center px-6 py-12 sm:px-12">
      <Card className="w-full max-w-sm border-0 bg-transparent shadow-none">
        <CardHeader className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Lock className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-xl font-semibold tracking-tight">欢迎回到 AgentTeams</CardTitle>
              <p className="mt-1.5 text-sm text-muted-foreground">登录你的工作区，继续和 Agent 协作。</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {dataPlaneRejected && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
              <AlertCircle className="mt-0.5 w-4 h-4 shrink-0" />
              <span>
                登录凭据被 Controller 拒绝，请重新登录。若仍无法访问，请联系管理员检查 Human 权限和后端配置。
              </span>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="higress-username">用户名</Label>
            <Input
              id="higress-username"
              autoComplete="username"
              placeholder="admin"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              disabled={isLoading}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="higress-password">密码</Label>
            <Input
              id="higress-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              disabled={isLoading}
            />
          </div>
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => setAdminVisible((v) => !v)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {adminVisible ? '收起 L1 账号管理员验证' : 'L1 账号管理员验证（旧 Controller 需要）'}
            </button>
            {adminVisible && (
              <div className="space-y-2">
                <Input
                  id="admin-username"
                  placeholder="管理员账号"
                  autoComplete="username"
                  value={adminUsername}
                  onChange={(e) => setAdminUsername(e.target.value)}
                  disabled={isLoading}
                />
                <Input
                  id="admin-password"
                  type="password"
                  placeholder="管理员密码"
                  autoComplete="current-password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  disabled={isLoading}
                />
                <p className="text-xs text-muted-foreground">
                  普通 L2/L3 Matrix 账号无需填写；旧 Controller 的 L1 Matrix 登录需要管理员账号验证。
                </p>
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => setTokenOnlyVisible((v) => !v)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {tokenOnlyVisible ? '收起 token 直接登录' : '仅用 Controller 管理员 token 登录'}
            </button>
            {tokenOnlyVisible && (
              <div className="space-y-2">
                <Input
                  id="controller-token-only"
                  type="password"
                  placeholder="Controller 管理员 token"
                  value={tokenOnlyToken}
                  onChange={(e) => setTokenOnlyToken(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleTokenLogin()}
                  disabled={isLoading}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleTokenLogin}
                  disabled={isLoading || !tokenOnlyToken}
                  className="w-full h-10 rounded-xl"
                >
                  {isLoading ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      登录中...
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4 mr-2" />
                      Token 登录
                    </>
                  )}
                </Button>
                <p className="text-xs text-muted-foreground">
                  没有 Console / Matrix 账号时使用。该 token 等同于管理员凭据，请勿在公共设备上保存。
                </p>
              </div>
            )}
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
            className="w-full h-11 rounded-xl"
          >
            {isLoading ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                登录中...
              </>
            ) : (
              <>
                <LogIn className="w-4 h-4 mr-2" />
                登录工作区 <ArrowUpRight className="ml-auto size-4" />
              </>
            )}
          </Button>
          {/* 登录页其余部分保持原样：只加一个「配置后端地址」按钮，
              点击才跳转到 ?setup=1（异地/换机部署需要改地址时用）。
              服务端 setup token 门控不变（ENFORCE=0 时免 token）。 */}
          <div className="pt-1 text-center">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground h-9"
              onClick={() => window.location.assign('/?setup=1')}
            >
              <Settings2 className="w-3.5 h-3.5 mr-1" />
              配置后端地址
            </Button>
          </div>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { apiUrl } from '@/lib/api-base';
import { useMatrixStore } from '@/lib/matrix-store';
import { Lock, LogIn, RefreshCw, AlertCircle, ArrowUpRight, ShieldCheck, Settings2 } from 'lucide-react';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import styles from './login-page.module.css';

interface LoginPageProps {
  onLoginSuccess?: () => void;
  defaultUsername?: string;
  /** The data plane bounced with 401 (`?reason=unauthorized&from=data401`):
   * the login itself succeeded but the Controller/gateway rejected the
   * credential. Show an actionable notice — never retry automatically. */
  dataPlaneRejected?: boolean;
}

export function LoginPage({ onLoginSuccess, defaultUsername = '', dataPlaneRejected = false }: LoginPageProps) {
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
    <div className={`${styles.surface} flex min-h-dvh flex-col px-5 sm:px-10 lg:px-14`}>
      <header className="mx-auto flex w-full max-w-7xl items-center gap-3 border-b border-white/10 py-5 sm:py-6">
        <Image src="/agentteams-logo.svg" alt="" width={32} height={32} />
        <span className="text-lg font-semibold tracking-tight">AgentTeams</span>
      </header>
      <div className="mx-auto grid w-full max-w-7xl flex-1 items-center gap-10 py-8 lg:grid-cols-[1.1fr_1fr] lg:py-14">
        <section className="hidden max-w-2xl lg:block">
          <h1 className="text-4xl leading-snug font-semibold tracking-tight xl:text-5xl">
            让 Agent 成为团队，<br /><span className="text-[#71e4ae]">一起把事情做成。</span>
          </h1>
          <p className="mt-6 max-w-md text-sm leading-7 text-[#c1d2d4]">把目标交给 Manager，让 Workers 分工推进。从第一句需求到最终成果，在同一个工作台里协作。</p>
        </section>
      <Card className="w-full max-w-md justify-self-center rounded-2xl bg-card text-card-foreground shadow-xl sm:px-2">
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
                  旧 Controller 上使用 Matrix 账号登录 L1 时，必须填写这里的 Console 管理员账号/密码；admin 账号本身不需要重复填写。
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
            className="w-full h-11 rounded-xl bg-[#1bc67b] text-[#092b20] hover:bg-[#6cdda8]"
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

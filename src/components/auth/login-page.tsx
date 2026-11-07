'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiUrl } from '@/lib/api-base';
import { useMatrixStore } from '@/lib/matrix-store';
import { Lock, LogIn, RefreshCw, AlertCircle, ArrowUpRight, Bot, ShieldCheck, Workflow } from 'lucide-react';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

interface LoginPageProps {
  onLoginSuccess?: () => void;
  defaultUsername?: string;
}

export function LoginPage({ onLoginSuccess, defaultUsername = '' }: LoginPageProps) {
  const router = useRouter();
  const [username, setUsername] = useState(defaultUsername);
  const [password, setPassword] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [controllerToken, setControllerToken] = useState('');
  const [adminVisible, setAdminVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setMatrixAuth = useMatrixStore((s) => s.setMatrixAuth);

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
          ...(adminUsername ? { adminUsername, adminPassword } : {}),
          ...(controllerToken ? { controllerToken } : {}),
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
          <div className="space-y-2">
            <Label htmlFor="higress-username">用户名</Label>
            <Input
              id="higress-username"
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
              {adminVisible ? '收起高级登录选项' : '高级登录选项'}
            </button>
            {adminVisible && (
              <div className="space-y-2">
                <Input
                  id="admin-username"
                  placeholder="管理员账号"
                  value={adminUsername}
                  onChange={(e) => setAdminUsername(e.target.value)}
                  disabled={isLoading}
                />
                <Input
                  id="admin-password"
                  type="password"
                  placeholder="管理员密码"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  disabled={isLoading}
                />
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="h-px flex-1 bg-border" />
                  或
                  <div className="h-px flex-1 bg-border" />
                </div>
                <Input
                  id="controller-token"
                  type="password"
                  placeholder="Controller 管理员 token（与上两种方式二选一）"
                  value={controllerToken}
                  onChange={(e) => setControllerToken(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  disabled={isLoading}
                />
                <p className="text-xs text-muted-foreground">
                  仅在管理员要求额外验证时填写。普通团队账号无需填写。
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
          {/* F1e (plugin parity: the config surface is always one click away,
              not a first-launch easter egg) — re-configure backends from a
              logged-out browser when the environment changed or addresses
              are wrong. Pre-login writes stay token-gated server-side. */}
          <div className="pt-1 text-center">
            <button
              type="button"
              onClick={() => router.push('?setup=1')}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              连接设置与登录帮助
            </button>
          </div>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}

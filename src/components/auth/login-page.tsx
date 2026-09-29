'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiUrl } from '@/lib/api-base';
import { useMatrixStore } from '@/lib/matrix-store';
import { Lock, LogIn, RefreshCw, AlertCircle } from 'lucide-react';
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
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Lock className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">AgentTeams Dashboard</CardTitle>
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
              {adminVisible ? '收起管理员账号验证 ▲' : '管理员账号验证（仅L1账号需要）▼'}
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
                  仅 L1 账号（Human CR level 1，需管理数据时）填写：填管理员账号与密码（部署管理员告知），或直接填
                  Controller 管理员 token，二选一。L2/L3 账号留空即可。
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
            className="w-full"
          >
            {isLoading ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                登录中...
              </>
            ) : (
              <>
                <LogIn className="w-4 h-4 mr-2" />
                登录
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
              无法登录？后端配置（地址 / 首启）
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

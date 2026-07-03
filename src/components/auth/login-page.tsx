'use client';

import { useState } from 'react';
import { apiUrl } from '@/lib/api-base';
import { Lock, LogIn, RefreshCw, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

interface LoginPageProps {
  onLoginSuccess?: () => void;
  defaultUsername?: string;
}

export function LoginPage({ onLoginSuccess, defaultUsername = '' }: LoginPageProps) {
  const [username, setUsername] = useState(defaultUsername);
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    if (!username || !password) return;
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Login failed');
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
              <CardTitle className="text-lg">HiClaw Dashboard</CardTitle>
              <CardDescription>管理员账号登录（首次登录自动注册）</CardDescription>
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
        </CardContent>
      </Card>
    </div>
  );
}

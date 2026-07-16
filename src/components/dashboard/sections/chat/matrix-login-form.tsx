'use client';

import { useState } from 'react';
import { Lock, LogIn, RefreshCw, AlertCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useMatrixLogin } from '@/hooks/use-matrix';
import { useInfrastructure } from '@/hooks/use-agentteams-infrastructure';

export function MatrixLoginForm({ onLoginSuccess }: { onLoginSuccess?: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [homeserverUrl, setHomeserverUrl] = useState('');
  const loginMutation = useMatrixLogin();
  const { data: infrastructure } = useInfrastructure();

  const effectiveHomeserverUrl = homeserverUrl || infrastructure?.matrix?.homeserver || '';

  const handleLogin = () => {
    if (!username || !password || !effectiveHomeserverUrl) return;
    loginMutation.mutate(
      { homeserver: effectiveHomeserverUrl, username, password },
      { onSuccess: () => onLoginSuccess?.() }
    );
  };

  return (
    <Card className="glass-card border-cyan-500/20">
      <CardContent className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center">
            <Lock className="w-5 h-5 text-cyan-500" />
          </div>
          <div>
            <h3 className="font-semibold">登录 Matrix</h3>
            <p className="text-xs text-muted-foreground">连接到 Matrix 服务器以收发消息</p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Homeserver 地址</label>
            <Input
              placeholder="http://agentteams-controller:6167"
              value={effectiveHomeserverUrl}
              onChange={(e) => setHomeserverUrl(e.target.value)}
              className="h-9 text-sm bg-background/50"
            />
            {infrastructure?.matrix?.homeserver && (
              <p className="text-[10px] text-muted-foreground mt-1">
                从基础设施自动获取: {infrastructure.matrix.homeserver}
              </p>
            )}
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">用户名</label>
            <Input
              placeholder="admin"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="h-9 text-sm bg-background/50"
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">密码</label>
            <Input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-9 text-sm bg-background/50"
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            />
          </div>
          {loginMutation.isError && (
            <div className="flex items-center gap-2 text-red-500 text-xs">
              <AlertCircle className="w-3 h-3 shrink-0" />
              <span>{loginMutation.error?.message || '登录失败'}</span>
            </div>
          )}
          <Button
            onClick={handleLogin}
            disabled={loginMutation.isPending || !username || !password || !effectiveHomeserverUrl}
            className="w-full h-9"
          >
            {loginMutation.isPending ? (
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
        </div>

        <div className="mt-4 p-3 rounded-lg bg-muted/50">
          <p className="text-[10px] text-muted-foreground">
            提示: AgentTeams 的 Human 用户可以作为 Matrix 账号登录。用户名即 Human 名称，初始密码由 Controller 创建时生成。
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

'use client';

import { useState, useCallback } from 'react';
import { Save, RefreshCw, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useNacosConfig, useUpdateNacosConfig, useNacosSync } from '@/hooks/use-nacos-config';

interface NacosConfigDialogProps {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
}

export function NacosConfigDialog({ open, onOpenChange }: NacosConfigDialogProps) {
  const { data: config } = useNacosConfig();
  const updateMutation = useUpdateNacosConfig();
  const syncMutation = useNacosSync();

  const [registryUrl, setRegistryUrl] = useState(config?.registryUrl || '');
  const [namespace, setNamespace] = useState(config?.namespace || 'public');
  const [username, setUsername] = useState(config?.username || '');
  const [password, setPassword] = useState(config?.password || '');

  const handleSave = useCallback(async () => {
    await updateMutation.mutateAsync({
      registryUrl,
      namespace,
      username: username || undefined,
      password: password || undefined,
    });
  }, [registryUrl, namespace, username, password, updateMutation]);

  const handleSync = useCallback(async () => {
    await syncMutation.mutateAsync();
  }, [syncMutation]);

  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const isReady = !!registryUrl && !updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-w-[95vw]">
        <DialogHeader>
          <DialogTitle>Nacos 注册中心配置</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>注册中心 URL *</Label>
            <Input
              value={registryUrl}
              onChange={(e) => setRegistryUrl(e.target.value)}
              placeholder="nacos://market.agentteams.io:80/public"
            />
            <p className="text-xs text-muted-foreground">
              格式：nacos://host:port/namespace
            </p>
          </div>

          <div className="space-y-2">
            <Label>命名空间</Label>
            <Input
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
              placeholder="public"
            />
          </div>

          <div className="space-y-2">
            <Label>用户名（可选）</Label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="nacos"
            />
          </div>

          <div className="space-y-2">
            <Label>密码（可选）</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="********"
            />
          </div>

          {config?.lastSyncStatus && (
            <div className="flex items-center gap-2 text-xs">
              <Badge variant={config.lastSyncStatus === 'success' ? 'secondary' : 'destructive'}>
                {config.lastSyncStatus === 'success' ? '上次同步成功' : '上次同步失败'}
              </Badge>
              {config.lastSyncAt && (
                <span className="text-muted-foreground">
                  {new Date(config.lastSyncAt).toLocaleString('zh-CN')}
                </span>
              )}
            </div>
          )}

          {config?.lastSyncError && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <p>{config.lastSyncError}</p>
            </div>
          )}

          {updateMutation.isError && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <p>{updateMutation.error?.message ?? '保存失败'}</p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose}>
            取消
          </Button>
          <Button
            variant="outline"
            onClick={handleSync}
            disabled={syncMutation.isPending || !config}
          >
            {syncMutation.isPending ? (
              <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-1" />
            )}
            同步
          </Button>
          <Button onClick={handleSave} disabled={!isReady || updateMutation.isPending}>
            {updateMutation.isPending ? (
              <>
                <Save className="mr-2 h-4 w-4 animate-pulse" />
                保存中...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                保存
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

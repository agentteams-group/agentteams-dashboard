'use client';

import { useState, useCallback } from 'react';
import {
  FlaskConical,
  Trash2,
  Loader2,
  Bot,
} from 'lucide-react';
import { SectionHeader } from '@/components/dashboard/section-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { useCreateWorker, useDeleteWorker } from '@/hooks/use-agentteams-mutations';
import { useWorkers } from '@/hooks/use-agentteams-workers';

export function SandboxSection() {
  const { data: workers } = useWorkers();
  const createWorker = useCreateWorker();
  const deleteWorker = useDeleteWorker();

  const [sandboxName, setSandboxName] = useState('');
  const [baseWorker, setBaseWorker] = useState('');
  const [testMessage, setTestMessage] = useState('');
  const [sandboxWorkers, setSandboxWorkers] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const handleCreateSandbox = useCallback(async () => {
    if (!sandboxName.trim()) return;
    setCreating(true);
    try {
      const base = workers?.find((w) => w.name === baseWorker);
      await createWorker.mutateAsync({
        name: `sandbox-${sandboxName.trim()}`,
        runtime: (base?.runtime as 'openclaw' | 'copaw' | 'hermes' | 'openhuman') || 'openclaw',
        model: base?.model,
        skills: base?.skills,
      });
      const name = `sandbox-${sandboxName.trim()}`;
      setSandboxWorkers((prev) => [...prev, name]);
      setSandboxName('');
      toast.success(`沙箱 Worker "${name}" 创建成功`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '创建失败');
    } finally {
      setCreating(false);
    }
  }, [sandboxName, baseWorker, workers, createWorker]);

  const handleDeleteSandbox = useCallback(async (name: string) => {
    try {
      await deleteWorker.mutateAsync(name);
      setSandboxWorkers((prev) => prev.filter((n) => n !== name));
      toast.success(`沙箱 "${name}" 已清理`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  }, [deleteWorker]);

  const handleCleanupAll = useCallback(async () => {
    for (const name of sandboxWorkers) {
      try {
        await deleteWorker.mutateAsync(name);
      } catch { /* ignore */ }
    }
    setSandboxWorkers([]);
    toast.success('所有沙箱已清理');
  }, [sandboxWorkers, deleteWorker]);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Agent 沙箱"
        description="创建临时 Worker 实例进行测试，不影响生产环境"
      />

      {/* Create sandbox */}
      <Card className="glass-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">创建沙箱实例</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">沙箱名称 *</Label>
              <Input
                value={sandboxName}
                onChange={(e) => setSandboxName(e.target.value)}
                placeholder="test-worker"
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">基于现有 Worker (可选)</Label>
              <Select value={baseWorker} onValueChange={setBaseWorker}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="选择模板 Worker" />
                </SelectTrigger>
                <SelectContent>
                  {workers?.map((w) => (
                    <SelectItem key={w.name} value={w.name}>
                      {w.name} ({w.runtime})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                size="sm"
                onClick={handleCreateSandbox}
                disabled={!sandboxName.trim() || creating}
                className="h-8"
              >
                {creating ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                ) : (
                  <FlaskConical className="w-3.5 h-3.5 mr-1" />
                )}
                创建沙箱
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Active sandboxes */}
      <Card className="glass-card">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">活跃沙箱 ({sandboxWorkers.length})</CardTitle>
            {sandboxWorkers.length > 0 && (
              <Button variant="ghost" size="sm" className="h-6 text-xs text-destructive" onClick={handleCleanupAll}>
                <Trash2 className="w-3 h-3 mr-1" />
                全部清理
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {sandboxWorkers.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">
              暂无活跃沙箱。创建一个沙箱 Worker 开始测试。
            </p>
          ) : (
            <div className="space-y-2">
              {sandboxWorkers.map((name) => (
                <div key={name} className="flex items-center justify-between p-2 rounded bg-background/50">
                  <div className="flex items-center gap-2">
                    <Bot className="w-4 h-4 text-primary" />
                    <span className="text-xs font-medium font-mono">{name}</span>
                    <Badge variant="secondary" className="text-[9px]">沙箱</Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={() => handleDeleteSandbox(name)}
                  >
                    <Trash2 className="w-3 h-3 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Test message area */}
      <Card className="glass-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">测试消息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Textarea
            value={testMessage}
            onChange={(e) => setTestMessage(e.target.value)}
            placeholder="输入测试消息，发送到沙箱 Worker 的 Matrix 房间..."
            rows={3}
            className="text-sm"
          />
          <p className="text-[10px] text-muted-foreground">
            提示: 沙箱 Worker 创建后会自动加入 Matrix。在「Matrix 聊天」页面找到对应的房间进行对话测试。
          </p>
        </CardContent>
      </Card>

      {/* Info */}
      <div className="border border-border/50 rounded-lg p-4 bg-muted/30">
        <div className="flex items-start gap-3">
          <FlaskConical className="w-5 h-5 text-violet-500 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-medium">沙箱模式</p>
            <p className="text-xs text-muted-foreground">
              沙箱 Worker 以 sandbox- 前缀命名，便于识别和批量清理。
              可基于现有 Worker 配置复制，测试完成后一键清理。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

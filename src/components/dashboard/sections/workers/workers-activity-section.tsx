'use client';

import { useState, useMemo } from 'react';
import { Search, Bot, Play, Pause, RotateCcw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PhaseBadge, RuntimeBadge } from '@/components/dashboard/phase-badge';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { useWakeWorker, useSleepWorker, useEnsureReadyWorker } from '@/hooks/use-agentteams-mutations';
import type { WorkerResponse } from '@/lib/agentteams-api';

export function WorkersActivitySection() {
  const [search, setSearch] = useState('');
  const { data: workers = [], refetch, isRefetching } = useWorkers();
  const wakeMutation = useWakeWorker();
  const sleepMutation = useSleepWorker();
  const ensureReadyMutation = useEnsureReadyWorker();

  const filteredWorkers = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return workers;
    return workers.filter(
      (w) =>
        (w.name || '').toLowerCase().includes(q) ||
        (w.runtime || '').toLowerCase().includes(q) ||
        (w.team || '').toLowerCase().includes(q)
    );
  }, [workers, search]);

  const activeWorkers = useMemo(() => {
    return filteredWorkers.filter((w) => w.phase === 'Running' || w.phase === 'Ready');
  }, [filteredWorkers]);

  const inactiveWorkers = useMemo(() => {
    return filteredWorkers.filter((w) => w.phase !== 'Running' && w.phase !== 'Ready');
  }, [filteredWorkers]);

  const handleWake = async (name: string) => {
    await wakeMutation.mutateAsync(name);
    refetch();
  };

  const handleSleep = async (name: string) => {
    await sleepMutation.mutateAsync(name);
    refetch();
  };

  const handleEnsureReady = async (name: string) => {
    await ensureReadyMutation.mutateAsync(name);
    refetch();
  };

  const getPhaseIcon = (phase: string) => {
    switch (phase) {
      case 'Running':
        return <Play className="h-3 w-3 text-emerald-500" />;
      case 'Ready':
        return <CheckCircle2 className="h-3 w-3 text-blue-500" />;
      case 'Sleeping':
        return <Pause className="h-3 w-3 text-muted-foreground" />;
      case 'Failed':
        return <AlertCircle className="h-3 w-3 text-red-500" />;
      default:
        return <Bot className="h-3 w-3 text-muted-foreground" />;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
            <RotateCcw className={`h-4 w-4 mr-1 ${isRefetching ? 'animate-spin' : ''}`} />
            刷新
          </Button>
          <Badge variant="outline" className="text-xs">
            活跃: {activeWorkers.length}
          </Badge>
          <Badge variant="outline" className="text-xs">
            总计: {filteredWorkers.length}
          </Badge>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="搜索 Worker..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {filteredWorkers.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Bot className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              {workers.length === 0
                ? '暂无 Worker 配置。请先创建 Worker。'
                : '没有匹配的 Worker'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {activeWorkers.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">活跃 Worker</h3>
              {activeWorkers.map((worker) => (
                <WorkerCard
                  key={worker.name}
                  worker={worker}
                  onWake={() => handleWake(worker.name)}
                  onSleep={() => handleSleep(worker.name)}
                  onEnsureReady={() => handleEnsureReady(worker.name)}
                  phaseIcon={getPhaseIcon(worker.phase)}
                />
              ))}
            </div>
          )}
          {inactiveWorkers.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-medium text-muted-foreground mb-2">休眠/失败 Worker</h3>
              {inactiveWorkers.map((worker) => (
                <WorkerCard
                  key={worker.name}
                  worker={worker}
                  onWake={() => handleWake(worker.name)}
                  onSleep={() => handleSleep(worker.name)}
                  onEnsureReady={() => handleEnsureReady(worker.name)}
                  phaseIcon={getPhaseIcon(worker.phase)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function WorkerCard({
  worker,
  onWake,
  onSleep,
  onEnsureReady,
  phaseIcon,
}: {
  worker: WorkerResponse;
  onWake: () => void;
  onSleep: () => void;
  onEnsureReady: () => void;
  phaseIcon: React.ReactNode;
}) {
  const isDeleting = false;

  return (
    <Card className="glass-card">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              {phaseIcon}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm">{worker.name}</span>
                <PhaseBadge kind="worker" phase={worker.phase} />
                <RuntimeBadge runtime={worker.runtime} />
              </div>
              <p className="text-xs text-muted-foreground font-mono truncate max-w-[400px]">
                {worker.roomID || '无房间'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {worker.phase === 'Running' || worker.phase === 'Ready' ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={onSleep}
                disabled={isDeleting}
                title="休眠"
              >
                <Pause className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={onWake}
                disabled={isDeleting}
                title="唤醒"
              >
                <Play className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={onEnsureReady}
              disabled={isDeleting}
              title="确保就绪"
            >
              <CheckCircle2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

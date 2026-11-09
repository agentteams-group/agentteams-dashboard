'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusDot } from '@/components/dashboard/status-dot';
import { PhaseBadge, RuntimeBadge } from '@/components/dashboard/phase-badge';
import { HealthRing } from '@/components/dashboard/health-ring';
import { useAgentHealth } from '@/hooks/use-agent-health';
import { RUNTIME_LABELS } from '@/lib/phase-colors';
import { getRuntimeMeta } from '@/lib/runtime-meta';
import { countToolCalls24h } from '@/lib/tool-call-counter';
import { formatAgoZh, formatDurationZh } from '@/lib/worker-activity';
import { useNowTick } from '@/hooks/use-now-tick';
import type { WorkerResponse } from '@/lib/agentteams-api';

const DETAIL_FIELDS: Array<[string, (_w: WorkerResponse) => string]> = [
  ['名称', (w) => w.name],
  ['状态', (w) => w.state],
  ['运行时', (w) => RUNTIME_LABELS[w.runtime] || w.runtime],
  ['运行时说明', (w) => getRuntimeMeta(w.runtime)?.description || '-'],
  ['模型', (w) => w.model || '-'],
  ['镜像', (w) => w.image || '-'],
  ['团队', (w) => w.team || '-'],
  ['角色', (w) => w.role || '-'],
  ['关联 Agents', (w) => w.agents || '-'],
  ['Matrix 用户', (w) => w.matrixUserID || '-'],
  ['房间 ID', (w) => w.roomID || '-'],
  ['容器管理', (w) => (w.containerManaged ? '是' : '否')],
  ['容器状态', (w) => w.containerState || '-'],
  ['消息', (w) => w.message || '-'],
  ['最近任务', (w) => w.lastTaskSummary || '-'],
];

/**
 * 只读详情弹窗。配置项（运行配置 / 技能 / 审批 / 频道 / 工具 / Coding CLI /
 * LLM 调优…）已迁到右侧详情抽屉 WorkerDrawer；这里只回答「这个 Worker 是什么」。
 */
export function WorkerDetailDialog({
  worker,
  onOpenChange,
}: {
  worker: WorkerResponse | null;
  onOpenChange: (_open: boolean) => void;
}) {
  const now = useNowTick(30_000);
  const activityFields = worker ? [
    ['持续时长', worker.stateStartedAt ? formatDurationZh(worker.stateStartedAt, now) || '-' : '-'],
    ['最近活动', worker.lastActivityAt ? formatAgoZh(worker.lastActivityAt, now) || '-' : '-'],
    ['工具调用（24 小时）', `${countToolCalls24h(worker.name, now)} 次`],
  ] : [];
  return (
    <Dialog open={!!worker} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(100%-2rem,40rem)] sm:max-w-[min(100%-2rem,40rem)] max-h-[85vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>Worker 详情 - {worker?.name}</DialogTitle>
        </DialogHeader>
        {worker && (
          <div className="min-w-0 space-y-3 py-2 text-sm">
            <div className="flex items-center gap-2 mb-3">
              <StatusDot phase={worker.phase} />
              <PhaseBadge kind="worker" phase={worker.phase} />
              <RuntimeBadge runtime={worker.runtime} />
            </div>
            <WorkerHealthBreakdown worker={worker} />
            {[...DETAIL_FIELDS.map(([label, read]) => [label, read(worker)]), ...activityFields].map(([label, value]) => (
              <div
                key={label}
                className="flex justify-between py-1 border-b border-border/50"
              >
                <span className="text-muted-foreground">{label}</span>
                <span className="font-mono text-xs max-w-[75%] text-right break-all">
                  {value}
                </span>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function WorkerHealthBreakdown({ worker }: { worker: WorkerResponse }) {
  const health = useAgentHealth(worker);
  if (!health) return null;

  return (
    <div className="flex items-center gap-4 p-3 rounded-lg bg-muted/30 border border-border/50">
      <HealthRing score={health.overall} size={56} strokeWidth={4} label={health.label} />
      <div className="flex-1 space-y-1.5">
        <HealthBar label="可用性" value={health.availability} />
        <HealthBar label="稳定性" value={health.stability} />
        <HealthBar label="就绪度" value={health.readiness} />
      </div>
    </div>
  );
}

function HealthBar({ label, value }: { label: string; value: number }) {
  const color = value >= 80 ? 'bg-emerald-500' : value >= 60 ? 'bg-green-500' : value >= 40 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground w-10">{label}</span>
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="text-xs font-mono w-6 text-right">{value}</span>
    </div>
  );
}

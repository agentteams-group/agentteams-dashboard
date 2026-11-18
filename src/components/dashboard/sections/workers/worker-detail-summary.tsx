'use client';

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
 * Worker 只读详情主体（唯一实现，共享）：「这个 Worker 是什么」——
 * 身份徽标 + 健康度 + 字段行 + 活动行。承载方：
 * ① 只读详情弹窗 WorkerDetailDialog 的正文；
 * ② EntityInspector 分区按钮下方的常驻只读块（工作台右栏 / dual 抽屉）；
 * ③ 卡片编辑抽屉（WorkerDrawer 复用 EntityInspector 后同路径呈现）。
 */
export function WorkerDetailSummary({ worker }: { worker: WorkerResponse }) {
  const now = useNowTick(30_000);
  const activityFields: Array<[string, string]> = [
    ['持续时长', worker.stateStartedAt ? formatDurationZh(worker.stateStartedAt, now) || '-' : '-'],
    ['最近活动', worker.lastActivityAt ? formatAgoZh(worker.lastActivityAt, now) || '-' : '-'],
    ['工具调用（24 小时）', `${countToolCalls24h(worker.name, now)} 次`],
  ];
  return (
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
          className="flex min-w-0 items-baseline justify-between gap-3 py-1 border-b border-border/50"
        >
          {/* 标签不换行、不被压扁：窄列（抽屉 420px / 分区弹窗）里逐字换行会让数值看起来「没跟着走」。 */}
          <span className="shrink-0 whitespace-nowrap text-muted-foreground">{label}</span>
          <span className="min-w-0 max-w-[75%] break-all text-right font-mono text-xs">
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

function WorkerHealthBreakdown({ worker }: { worker: WorkerResponse }) {
  const health = useAgentHealth(worker);
  if (!health) return null;

  return (
    <div className="flex flex-wrap items-center gap-4 p-3 rounded-lg bg-muted/30 border border-border/50">
      <HealthRing score={health.overall} size={56} strokeWidth={4} label={health.label} />
      {/* 窄容器里三项指标整体换到环下方（保底 180px），否则刻度条被压成 0、数值脱离刻度。 */}
      <div className="min-w-[180px] flex-1 space-y-1.5">
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
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">{label}</span>
      <div className="h-1.5 min-w-6 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="w-8 shrink-0 text-right font-mono text-xs tabular-nums">{value}</span>
    </div>
  );
}

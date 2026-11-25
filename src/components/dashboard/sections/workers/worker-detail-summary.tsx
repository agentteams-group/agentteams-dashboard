'use client';

import { countToolCalls24h } from '@/lib/tool-call-counter';
import { formatAgoZh, formatDurationZh } from '@/lib/worker-activity';
import { useNowTick } from '@/hooks/use-now-tick';
import type { WorkerResponse } from '@/lib/agentteams-api';

const DETAIL_FIELDS: Array<[string, (_w: WorkerResponse) => string]> = [
  ['镜像', (w) => w.image || '-'],
  ['团队', (w) => w.team || '-'],
  ['关联 Agents', (w) => w.agents || '-'],
  ['Matrix 用户', (w) => w.matrixUserID || '-'],
  ['房间 ID', (w) => w.roomID || '-'],
  ['容器管理', (w) => (w.containerManaged ? '是' : '否')],
  ['容器状态', (w) => w.containerState || '-'],
  ['消息', (w) => w.message || '-'],
  ['最近任务', (w) => w.lastTaskSummary || '-'],
];

/** 右侧详情补充字段；名称、状态、运行时、模型及角色由头部展示。 */
export function WorkerDetailSummary({ worker }: { worker: WorkerResponse }) {
  const now = useNowTick(30_000);
  const activityFields: Array<[string, string]> = [
    ['持续时长', worker.stateStartedAt ? formatDurationZh(worker.stateStartedAt, now) || '-' : '-'],
    ['最近活动', worker.lastActivityAt ? formatAgoZh(worker.lastActivityAt, now) || '-' : '-'],
    ['工具调用（24 小时）', `${countToolCalls24h(worker.name, now)} 次`],
  ];
  return (
    <div className="min-w-0 space-y-3 py-2 text-sm">
      {[...DETAIL_FIELDS.map(([label, read]) => [label, read(worker)]), ...activityFields].filter(([, value]) => value && value !== '-').map(([label, value]) => (
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

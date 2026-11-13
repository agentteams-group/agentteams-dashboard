'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PhaseBadge } from '@/components/dashboard/phase-badge';
import { runtimeLabel } from '@/lib/runtime-labels';
import type { HumanResponse } from '@/lib/agentteams-api';
import { PERMISSION_LABELS } from '../humans/human-types';

export interface AgentSummary {
  name: string;
  model: string;
  runtime: string;
  phase: string;
  kind: 'agent' | 'manager';
  label: string;
  team: string;
}

export function ResourceIdentity({ name, role, kind, phase, onView }: {
  name: string;
  role: string;
  kind: 'worker' | 'manager' | 'human' | 'team';
  phase?: string;
  onView?: () => void;
}) {
  const initials = name.split(/[-\s]+/).filter(Boolean).at(-1)?.slice(0, 2).toUpperCase();
  return <div className="flex items-start gap-3">
    <div aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-sm font-semibold text-emerald-700 dark:text-emerald-400">{initials}</div>
    <div className="min-w-0 flex-1 space-y-1">
      <h2 className="text-base font-semibold leading-6 [overflow-wrap:anywhere]">
        {onView ? <button type="button" onClick={onView} className="text-left hover:underline">{name}</button> : name}
      </h2>
      <p className="text-xs leading-5 text-muted-foreground">{role}</p>
    </div>
    {phase && <PhaseBadge kind={kind} phase={phase} className="mt-1 shrink-0" />}
  </div>;
}

export function AgentSummaryCard({ agent, onView, onEdit }: {
  agent: AgentSummary; onView: () => void; onEdit: () => void;
}) {
  return <Card className="h-full w-full max-w-[360px] min-h-[310px] gap-0 overflow-hidden rounded-2xl border-border/80 py-0 shadow-sm transition-shadow hover:shadow-md">
    <CardContent className="flex flex-1 flex-col gap-5 p-5">
      <ResourceIdentity name={agent.name} role={agent.label} kind={agent.kind === 'manager' ? 'manager' : 'worker'} phase={agent.phase} onView={onView} />
      <div className="space-y-1.5 rounded-xl bg-muted/40 px-3.5 py-3">
        <p className="text-xs text-muted-foreground">使用模型</p>
        <p className="break-all text-base font-medium">{agent.model || '未设置'}</p>
      </div>
      <dl className="mt-auto grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        <dt className="text-muted-foreground">运行时</dt><dd className="text-right">{runtimeLabel(agent.runtime)}</dd>
        <dt className="text-muted-foreground">所属团队</dt><dd className="text-right leading-5 [overflow-wrap:anywhere]">{agent.kind === 'manager' ? '平台' : agent.team || '独立 Agent'}</dd>
      </dl>
    </CardContent>
    <div className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-3">
      <Button variant="ghost" size="sm" onClick={onView}>查看详情</Button>
      <Button variant="outline" size="sm" onClick={onEdit}>编辑</Button>
    </div>
  </Card>;
}

export function HumanSummaryCard({ name, human, onView }: {
  name: string; human?: HumanResponse; onView: () => void;
}) {
  return <Card className="gap-0 overflow-hidden rounded-2xl border-border/80 py-0 shadow-sm">
    <CardContent className="space-y-5 p-5">
      <ResourceIdentity name={human?.displayName || name} role="人类成员" kind="human" phase={human?.phase} />
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
        <dt className="text-muted-foreground">账号</dt><dd className="text-right [overflow-wrap:anywhere]">{name}</dd>
        <dt className="text-muted-foreground">角色</dt><dd className="text-right">{human?.permissionLevel ? PERMISSION_LABELS[human.permissionLevel] : '未加载'}</dd>
        <dt className="text-muted-foreground">邮箱</dt><dd className="text-right [overflow-wrap:anywhere]">{human?.email || '未填写'}</dd>
      </dl>
    </CardContent>
    <div className="flex justify-end border-t border-border/60 px-4 py-3"><Button variant="outline" size="sm" onClick={onView}>查看主页</Button></div>
  </Card>;
}

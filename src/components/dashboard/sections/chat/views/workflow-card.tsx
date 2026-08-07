import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import type { WorkflowItem, WorkflowPayload } from '@/lib/a2ui/workflow';
import { CircleCheck, CircleX, Loader2, Workflow } from 'lucide-react';

const COMPLETE_STATUSES = new Set(['completed', 'success', 'done']);
const ERROR_STATUSES = new Set(['failed', 'error', 'cancelled', 'canceled']);

function itemLabel(item: WorkflowItem, fallback: string) {
  return item.title || item.name || item.id || fallback;
}

function statusLabel(status?: string) {
  if (!status) return '等待中';
  if (COMPLETE_STATUSES.has(status)) return '已完成';
  if (ERROR_STATUSES.has(status)) return '失败';
  if (status === 'in_progress' || status === 'running') return '进行中';
  return status;
}

function StatusBadge({ status }: { status?: string }) {
  const className = COMPLETE_STATUSES.has(status || '')
    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
    : ERROR_STATUSES.has(status || '')
      ? 'bg-red-500/15 text-red-700 dark:text-red-400'
      : 'bg-violet-500/15 text-violet-700 dark:text-violet-400';

  return <Badge className={className}>{statusLabel(status)}</Badge>;
}

export function WorkflowCard({ payload }: { payload: WorkflowPayload }) {
  const title = payload.title || payload.name || '工作流';
  const runId = payload.runId || payload.run_id;
  const subagents = Array.isArray(payload.subagents) ? payload.subagents : [];
  const steps = Array.isArray(payload.steps) ? payload.steps : [];
  const completedSteps = steps.filter((step) => COMPLETE_STATUSES.has(step.status || '')).length;
  const progress = steps.length ? (completedSteps / steps.length) * 100 : 0;

  return (
    <Card className="my-2 w-full max-w-4xl border-l-4 border-l-violet-500 py-4">
      <CardHeader className="gap-2 px-4 py-0">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Workflow className="h-4 w-4 text-violet-600 dark:text-violet-400" />
            {title}
          </CardTitle>
          <StatusBadge status={payload.status} />
        </div>
        {runId && <p className="font-mono text-xs text-muted-foreground">runId: {runId}</p>}
      </CardHeader>
      {(subagents.length > 0 || steps.length > 0) && (
        <CardContent className="space-y-4 px-4 pt-4">
          {subagents.length > 0 && (
            <section aria-label="子智能体">
              <p className="mb-2 text-xs font-medium text-muted-foreground">子智能体</p>
              <div className="space-y-1.5">
                {subagents.map((agent, index) => (
                  <div key={agent.id || agent.name || String(index)} className="flex items-center justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate">{itemLabel(agent, `智能体 ${index + 1}`)}</span>
                    <StatusBadge status={agent.status} />
                  </div>
                ))}
              </div>
            </section>
          )}
          {steps.length > 0 && (
            <section aria-label="执行步骤">
              <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>执行步骤</span>
                <span>{completedSteps}/{steps.length}</span>
              </div>
              <Progress value={progress} aria-label={`执行进度 ${completedSteps}/${steps.length}`} />
              <div className="mt-2 space-y-1.5">
                {steps.map((step, index) => {
                  const complete = COMPLETE_STATUSES.has(step.status || '');
                  const failed = ERROR_STATUSES.has(step.status || '');
                  return (
                    <div key={step.id || step.name || String(index)} className="flex items-center gap-2 text-xs">
                      {complete ? <CircleCheck className="h-3.5 w-3.5 text-emerald-500" /> : failed ? <CircleX className="h-3.5 w-3.5 text-red-500" /> : <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />}
                      <span className="min-w-0 flex-1 truncate">{itemLabel(step, `步骤 ${index + 1}`)}</span>
                      <span className="text-muted-foreground">{statusLabel(step.status)}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </CardContent>
      )}
    </Card>
  );
}

'use client';

import { useState } from 'react';
import { Ban, Loader2, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useCancelProjectTask } from '@/hooks/use-projects';
import { getTaskArtifactUrl, type WorkflowTaskDetail } from '@/lib/agentteams-projects-api';
import {
  NODE_STATUS_COLOR,
  NODE_STATUS_LABEL,
  normalizeNodeStatus,
  UNCANCELLABLE_STATUSES,
  toastMutationError,
} from './workflow-config';
import { ArtifactLink } from './artifact-link';

/** Cancel button for one task row (POST .../tasks/{taskId}/cancel).
 * Renders only for non-terminal tasks; opens a reason dialog. */
function CancelTaskButton({
  projectId,
  taskId,
  teamId,
}: {
  projectId: string;
  taskId: string;
  teamId?: string;
}) {
  const cancelMutation = useCancelProjectTask();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  const handleCancel = () => {
    cancelMutation.mutate(
      // Button is disabled while reason is blank; the controller also
      // 400s on an empty reason as a second line of defense.
      { projectId, taskId, teamId, reason: reason.trim() },
      {
        onSuccess: () => {
          setOpen(false);
          setReason('');
          toast.success('任务已取消', { description: '团队已收到取消通知' });
        },
        onError: (err) => toastMutationError('取消任务', err),
      },
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={cancelMutation.isPending}
        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-400 hover:bg-red-500/15 transition-colors disabled:opacity-50"
        title="取消任务"
      >
        <Ban className="h-3 w-3" />
        取消
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>取消任务</DialogTitle>
            <DialogDescription>
              任务将标记为 cancelled，团队会收到取消通知。原因必填。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="取消原因（必填）"
            rows={3}
            className="text-sm"
          />
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              关闭
            </Button>
            <Button
              size="sm"
              onClick={handleCancel}
              disabled={cancelMutation.isPending || !reason.trim()}
            >
              {cancelMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              确认取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** One task's TaskMeta row: status/assignee/result + artifact download
 *  links (result_path + each deliverable, via the artifact proxy). */
export function TaskDetailRow({
  task,
  projectId,
  teamId,
}: {
  task: WorkflowTaskDetail;
  projectId: string;
  teamId?: string;
}) {
  const deliverables = Array.isArray(task.deliverables)
    ? task.deliverables.filter((d): d is string => typeof d === 'string')
    : [];
  const cancellable =
    !!task.status && !UNCANCELLABLE_STATUSES.has(task.status);
  // 任务级巡检（#1230）：spec / 状态转换审计 / tracing 过滤提示——展开块，
  // 数据全部来自 includeTasks 的 tasks_detail（history 由转换引擎写入 task meta）。
  const [expanded, setExpanded] = useState(false);
  const history = Array.isArray(task.history) ? task.history : [];
  const hasExtra = !!task.spec_path || history.length > 0;
  return (
    <div className="rounded-lg border bg-background/40 p-2 text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-[10px] text-muted-foreground">{task.task_id}</span>
        {task.status && (
          <Badge className={`text-[10px] border ${NODE_STATUS_COLOR[normalizeNodeStatus(task.status)]}`}>
            {NODE_STATUS_LABEL[normalizeNodeStatus(task.status)]}
          </Badge>
        )}
        {task.assigned_to && (
          <span className="text-[10px] text-muted-foreground">{task.assigned_to}</span>
        )}
        {task.result_status && (
          <span className="text-[10px] text-muted-foreground">验收：{task.result_status}</span>
        )}
        {task.summary && (
          <span className="text-muted-foreground truncate max-w-[300px]" title={task.summary}>
            {task.summary}
          </span>
        )}
        {cancellable && (
          <CancelTaskButton projectId={projectId} taskId={task.task_id} teamId={teamId} />
        )}
        {hasExtra && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title={expanded ? '收起任务巡检详情' : '展开任务巡检详情（spec / 状态转换 / tracing）'}
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>
      {expanded && hasExtra && (
        <div className="pt-1.5 mt-1.5 border-t space-y-1.5">
          {task.spec_path ? (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground shrink-0">规格：</span>
              <ArtifactLink
                href={getTaskArtifactUrl(projectId, task.task_id, task.spec_path)}
                label={task.spec_path.split('/').pop() || task.spec_path}
              />
            </div>
          ) : null}
          {history.length > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground mb-1">
                状态转换（{history.length}，新→旧）
              </p>
              <div className="space-y-0.5 max-h-40 overflow-y-auto">
                {[...history].reverse().map((h, i) => (
                  <div key={h.seq ?? i} className="flex gap-1.5 items-baseline font-mono text-[10px]">
                    <span className="text-muted-foreground shrink-0">
                      {String(h.ts).replace('T', ' ').slice(5, 16)}
                    </span>
                    <span>
                      {h.from || '∅'} → <b>{h.to}</b>
                    </span>
                    <span className="text-muted-foreground shrink-0">{h.action}</span>
                    {h.actor ? (
                      <span className="text-muted-foreground/70 shrink-0">（{h.actor}）</span>
                    ) : null}
                    {h.note ? (
                      <span
                        className="text-muted-foreground/70 truncate max-w-[220px]"
                        title={h.note}
                      >
                        {h.note}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="text-[10px] font-mono text-muted-foreground/80 break-all">
            tracing 过滤：agentteams.project.id={projectId} · agentteams.task.id={task.task_id}
          </p>
        </div>
      )}
      {(task.result_path || deliverables.length > 0) && (
        <div className="flex items-center gap-2 flex-wrap pt-1">
          <span className="text-[10px] text-muted-foreground shrink-0">产物：</span>
          {task.result_path ? (
            <ArtifactLink
              href={getTaskArtifactUrl(projectId, task.task_id)}
              label="结果文件"
            />
          ) : null}
          {deliverables.map((d) => (
            <ArtifactLink
              key={d}
              href={getTaskArtifactUrl(projectId, task.task_id, d)}
              label={d.split('/').pop() || d}
            />
          ))}
        </div>
      )}
    </div>
  );
}

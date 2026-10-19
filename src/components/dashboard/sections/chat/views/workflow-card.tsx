import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { isProjectMiss, workflowLiveFromProject } from '@/lib/chat-workflow-live';
import { getProjectWorkflow, getTaskArtifactUrl } from '@/lib/agentteams-projects-api';
import { artifactStateFromTask } from '@/lib/artifact-state';
import { ArtifactStateBadge } from '@/components/dashboard/sections/projects/artifact-state-badge';
import { ReleaseControls } from '@/components/dashboard/sections/projects/release-controls';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import { useSectionStore } from '@/lib/section-store';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { openChatRoom } from '@/lib/open-chat-room';
import type { WorkflowItem, WorkflowPayload } from '@/lib/a2ui/workflow';
import { CircleCheck, CircleX, CornerDownRight, ExternalLink, Loader2, Workflow } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

const COMPLETE_STATUSES = new Set(['completed', 'success', 'done']);
const ERROR_STATUSES = new Set(['failed', 'error', 'cancelled', 'canceled']);

function itemLabel(item: WorkflowItem, fallback: string) {
  return item.title || item.name || item.id || fallback;
}

function statusLabel(status?: string) {
  if (!status) return '等待中';
  if (COMPLETE_STATUSES.has(status)) return '已完成';
  if (ERROR_STATUSES.has(status || '')) return '失败';
  if (status === 'in_progress' || status === 'running') return '进行中';
  return status;
}

/** 步骤工件态徽标（F1.3）：任务状态推导，projectId 缺失时不渲染（无任务上下文）。 */
function artifactStateBadgeFor(step: WorkflowItem) {
  return <ArtifactStateBadge info={artifactStateFromTask(step)} />;
}

function StatusBadge({ status }: { status?: string }) {
  const className = COMPLETE_STATUSES.has(status || '')
    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
    : ERROR_STATUSES.has(status || '')
      ? 'bg-red-500/15 text-red-700 dark:text-red-400'
      : 'bg-violet-500/15 text-violet-700 dark:text-violet-400';

  return <Badge className={className}>{statusLabel(status)}</Badge>;
}

/** Pending step glyph: static dashed ring (in_progress is the only spinning state). */
function PendingGlyph() {
  return (
    <span
      className="h-3.5 w-3.5 shrink-0 rounded-full border-[1.5px] border-dashed border-muted-foreground/50"
      aria-hidden="true"
    />
  );
}

/** Step status glyph: completed = solid check, failed = cross, in_progress = spinner, pending = dashed ring. */
function StepGlyph({ status }: { status?: string }) {
  if (COMPLETE_STATUSES.has(status || '')) {
    return <CircleCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />;
  }
  if (ERROR_STATUSES.has(status || '')) {
    return <CircleX className="h-3.5 w-3.5 shrink-0 text-red-500" aria-hidden="true" />;
  }
  if (status === 'in_progress' || status === 'running') {
    return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-violet-500" aria-hidden="true" />;
  }
  return <PendingGlyph />;
}

/** 责任 Agent 徽标（F1.5）：已知该 Agent 的房间时一步直达其会话。 */
function AssigneeChip({ name }: { name: string }) {
  const { data: workers } = useWorkers();
  const roomId = workers?.find((w) => w.name === name)?.roomID;
  if (!roomId) {
    return <span className="shrink-0 text-muted-foreground">@{name}</span>;
  }
  return (
    <button
      type="button"
      onClick={() => openChatRoom(roomId)}
      title={`打开 ${name} 的会话`}
      className="shrink-0 text-muted-foreground hover:text-violet-600 dark:hover:text-violet-400 transition-colors"
    >
      @{name}
    </button>
  );
}

/** 接力卡单步（F1.2）：状态 glyph + 名称 + 责任 Agent + 依赖副行；
 * 有摘要或工件的步骤可点开：摘要 + 工件三态（有来源房间时含放行控制，
 * F3.3）+ 产物直达；15s 正源轮询即时反映。 */
function RelayStepRow({
  step,
  index,
  projectId,
  sourceRoomId,
  expanded,
  onToggle,
}: {
  step: WorkflowItem;
  index: number;
  projectId?: string;
  sourceRoomId?: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const expandable = Boolean(step.summary || step.deliverableCount);
  return (
    <div>
      <button
        type="button"
        onClick={expandable ? onToggle : undefined}
        aria-expanded={expandable ? expanded : undefined}
        className={`flex w-full items-center gap-2 text-left text-xs ${expandable ? 'cursor-pointer rounded hover:bg-accent/50' : 'cursor-default'}`}
      >
        <StepGlyph status={step.status} />
        <span className="min-w-0 flex-1 truncate">{itemLabel(step, `步骤 ${index + 1}`)}</span>
        {step.assignedTo && <AssigneeChip name={step.assignedTo} />}
        <span className="text-muted-foreground">{statusLabel(step.status)}</span>
      </button>
      {(step.dependsOn?.length || (expandable && expanded)) && (
        <div className="ml-5 space-y-0.5">
          {step.dependsOn && step.dependsOn.length > 0 && (
            <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <CornerDownRight className="h-3 w-3 shrink-0" aria-hidden="true" />
              依赖：{step.dependsOn.join('、')}
            </p>
          )}
          {expandable && expanded && (
            <div className="rounded bg-muted/50 px-2 py-1.5 space-y-1.5">
              {step.summary && (
                <p className="text-[11px] leading-relaxed text-foreground/80">{step.summary}</p>
              )}
              {(step.deliverableCount || step.resultPath) && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] text-muted-foreground shrink-0">工件：</span>
                  {projectId && step.id && sourceRoomId ? (
                    <ReleaseControls
                      roomId={sourceRoomId}
                      projectId={projectId}
                      taskId={step.id}
                      taskStatus={step.status}
                      compact
                    />
                  ) : (
                    projectId && step.id && artifactStateBadgeFor(step)
                  )}
                  {projectId && step.resultPath && step.id && (
                    <a
                      href={getTaskArtifactUrl(projectId, step.id, step.resultPath)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] text-violet-600 dark:text-violet-400 underline decoration-dotted underline-offset-2"
                    >
                      {step.resultPath.split('/').pop() || step.resultPath}
                    </a>
                  )}
                  {!projectId && step.deliverableCount ? (
                    <span className="text-[10px] text-muted-foreground">
                      {step.deliverableCount} 个交付物
                    </span>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function WorkflowCard({ payload }: { payload: WorkflowPayload }) {
  const runId = payload.runId || payload.run_id;
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null);
  // live 刷新（第 11 轮）：项目工作流卡是一次性发布的快照，任务推进在
  // controller 侧 → 按 runId 轮询项目 workflow 正源（与任务看板同源同频 15s）
  // overlay 状态/步骤/参与 Worker。workerflow 卡（type=workerflow）运行时靠
  // m.replace 实时编辑消息本体（消息管线已聚合）→ 不探正源。
  // runId 非项目（404/409/400）→ 停探，永久回退快照。
  const isWorkerflow = payload.type === 'workerflow';
  const liveQuery = useQuery({
    queryKey: ['chat-workflow-live', String(runId ?? '')],
    queryFn: () => getProjectWorkflow(String(runId), { includeTasks: true }),
    enabled: !!runId && !isWorkerflow,
    refetchInterval: (q) => (isProjectMiss(q.state.error) ? false : 15000),
    retry: false,
    staleTime: 5000,
  });
  const live = liveQuery.data ? workflowLiveFromProject(liveQuery.data) : null;
  const liveReady = liveQuery.isSuccess && live != null; // 查询成功=正源接通

  const title = live?.title || payload.title || payload.name || '工作流';
  const status = live?.status ?? payload.status;
  const subagents =
    live && live.subagents.length > 0 ? live.subagents : Array.isArray(payload.subagents) ? payload.subagents : [];
  const steps =
    live && live.steps.length > 0 ? live.steps : Array.isArray(payload.steps) ? payload.steps : [];
  const completedSteps = steps.filter((step) => COMPLETE_STATUSES.has(step.status || '')).length;
  const progress = steps.length ? (completedSteps / steps.length) * 100 : 0;
  const liveStamp = liveReady
    ? new Date(liveQuery.dataUpdatedAt).toLocaleTimeString('zh-CN', { hour12: false })
    : null;

  // 接力卡 F1.2 双向跳转（正源确认是项目才显示入口，避免 workerflow 卡误跳）：
  // 卡片 → 任务中心项目详情，复用 HITL 深链通道（setPendingProjectKey + tasks）。
  const openProjectDetail = () => {
    if (!runId) return;
    useHitlInboxStore.getState().setPendingProjectKey({ id: String(runId) });
    useSectionStore.getState().setActiveSection('tasks');
  };

  return (
    <Card className="my-2 w-[min(100%,56rem)] max-w-full border-l-4 border-l-violet-500 py-4 shadow-none">
      <CardHeader className="gap-2 px-4 py-0">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Workflow className="h-4 w-4 text-violet-600 dark:text-violet-400" />
            {title}
            {/* LIVE 徽标：正源接通且 overlay 生效才显示（快照兜底无噪音）。 */}
            {liveReady && (
              <span
                className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
                title={`controller 正源 15s 轮询 · 最近更新 ${liveStamp}`}
              >
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
                live {liveStamp}
              </span>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            {liveReady && runId && (
              <Button
                variant="outline"
                size="sm"
                className="h-6 gap-1 px-2 text-[11px]"
                onClick={openProjectDetail}
              >
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                项目详情
              </Button>
            )}
            <StatusBadge status={status} />
          </div>
        </div>
        {runId && <p className="font-mono text-xs text-muted-foreground">runId: {runId}</p>}
      </CardHeader>
      {(subagents.length > 0 || steps.length > 0) && (
        <CardContent className="space-y-4 px-4 pt-4">
          {subagents.length > 0 && (
            <section aria-label="参与 Worker">
              <p className="mb-2 text-xs font-medium text-muted-foreground">参与 Worker</p>
              <div className="space-y-1.5">
                {subagents.map((agent, index) => (
                  <div key={agent.id || agent.name || String(index)} className="flex items-center justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate">{itemLabel(agent, `Worker ${index + 1}`)}</span>
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
                {steps.map((step, index) => (
                  <RelayStepRow
                    key={step.id || step.name || String(index)}
                    step={step}
                    index={index}
                    projectId={live?.projectId}
                    sourceRoomId={live?.sourceRoomId}
                    expanded={Boolean(step.id) && expandedStepId === step.id}
                    onToggle={() => setExpandedStepId((prev) => (prev === step.id ? null : step.id ?? null))}
                  />
                ))}
              </div>
            </section>
          )}
        </CardContent>
      )}
    </Card>
  );
}

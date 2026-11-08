'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  ChevronDown,
  Loader2,
  Moon,
  RefreshCw,
  Rocket,
  Sun,
  Trash2,
  Upload,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { StatusDot } from '@/components/dashboard/status-dot';
import { PhaseBadge, RuntimeBadge } from '@/components/dashboard/phase-badge';
import { WorkerApprovalControl } from './worker-approval-control';
import { WorkerChannelsPanel } from './worker-channels-panel';
import { WorkerCheckpointsCard } from './worker-checkpoints-card';
import { WorkerCodingCliPanel } from './worker-coding-cli-panel';
import { WorkerEnvCard } from './worker-env-card';
import { WorkerLlmTuningPanel } from './worker-llm-tuning-panel';
import { WorkerMcpPanel } from './worker-mcp-panel';
import { WorkerModelDialog } from './worker-model-dialog';
import { WorkerPluginsCard } from './worker-plugins-card';
import { WorkerRestartEffectivePanel } from './worker-restart-effective-panel';
import { WorkerRuntimeConfigPanel } from './worker-runtime-config-panel';
import { WorkerSkillAssign } from './worker-skill-assign';
import { WorkerSkillUploadDialog } from './worker-skill-upload-dialog';
import { WorkerToolsPanel } from './worker-tools-panel';
import { WorkerWorkspaceFilesPanel } from './worker-workspace-files-panel';
import { useNowTick } from '@/hooks/use-now-tick';
import {
  useDeleteWorker,
  useEnsureReadyWorker,
  useSleepWorker,
  useUpdateWorker,
  useWakeWorker,
} from '@/hooks/use-agentteams-mutations';
import { useWorkerSkills } from '@/hooks/use-agentteams-worker-skills';
import { agentteamsApi, type WorkerResponse } from '@/lib/agentteams-api';
import { buildStatusNarrative, formatAgoZh } from '@/lib/worker-activity';
import { fetchWorkerDetail, invalidateWorkerDetail } from '@/lib/worker-detail';
import { isLegacyCopaw } from '@/lib/runtime-options';
import type { ModelSelectionOption } from '@/lib/model-catalog';
import { formatErrorMessage } from '@/lib/api-error';
import { toast } from 'sonner';

const ROLE_LABEL: Record<string, string> = {
  team_leader: '团队负责人',
  leader: '团队负责人',
  worker: '成员',
  member: '成员',
  critic: '评审',
};

function roleLabel(role: string | undefined): string {
  if (!role) return '成员';
  return ROLE_LABEL[role] ?? role;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-20 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate text-xs" title={value}>{value}</span>
    </div>
  );
}

function ResourceCard({
  title,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 p-2.5 text-left text-xs font-semibold hover:bg-muted/50"
      >
        <span>{title}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {expanded && <div className="border-t p-2.5">{children}</div>}
    </div>
  );
}

type WorkerDrawerProps = {
  worker: WorkerResponse | null;
  onOpenChange: (_open: boolean) => void;
  modelOptions: ModelSelectionOption[];
  sessionIssue?: string | null;
  userLevel: number;
  onChanged?: () => void;
  onDeleted?: () => void;
};

/** 关闭时整棵子树不挂载：抽屉内各面板的 useQuery 不会在列表页空跑。 */
export function WorkerDrawer(props: WorkerDrawerProps) {
  if (!props.worker) return null;
  return <WorkerDrawerContent {...props} worker={props.worker} />;
}

function WorkerDrawerContent({
  worker,
  onOpenChange,
  modelOptions,
  sessionIssue,
  userLevel,
  onChanged,
  onDeleted,
}: WorkerDrawerProps & { worker: WorkerResponse }) {
  const open = true;
  const workerName = worker.name;
  const [detail, setDetail] = useState<WorkerResponse | null>(worker);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [modelOpen, setModelOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [ensureReadyUnsupported, setEnsureReadyUnsupported] = useState(false);
  const [tracingUrl, setTracingUrl] = useState<string | null>(null);
  const [loopStatus, setLoopStatus] = useState<{ state: string; modeName?: string } | null>(null);
  const now = useNowTick(30_000);

  const wakeWorker = useWakeWorker();
  const sleepWorker = useSleepWorker();
  const ensureReadyWorker = useEnsureReadyWorker();
  const updateWorker = useUpdateWorker();
  const deleteWorker = useDeleteWorker();
  const { data: existingSkills = [] } = useWorkerSkills(open ? workerName : null);

  const view = detail?.name === workerName ? detail : worker;

  const refreshDetail = useCallback(async (force = false) => {
    if (!workerName) return;
    try {
      const next = await fetchWorkerDetail(workerName, { force });
      setDetail(next);
    } catch {
      // 读取失败时保留卡片快照，不阻塞抽屉
    }
  }, [workerName]);

  useEffect(() => {
    if (!open || !workerName) return;
    let alive = true;
    setDetail(worker);
    setExpanded(new Set());
    setEnsureReadyUnsupported(false);
    setLoopStatus(null);
    fetchWorkerDetail(workerName)
      .then((next) => {
        if (alive) setDetail(next);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // worker 对象每次轮询都会换引用；只按名字重挂载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workerName]);

  // loop 预算：按 1:1 Worker 房间 session 查激活 loop；404/失败 → 整行不显。
  useEffect(() => {
    if (!open || !view?.roomID) return;
    let alive = true;
    fetch(
      `/api/agentteams/workers/${encodeURIComponent(workerName)}/loops/status?session_id=${encodeURIComponent(`matrix:${view.roomID}`)}`,
      { cache: 'no-store' },
    )
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as { state?: string; mode?: { name?: string } };
      })
      .then((data) => {
        if (alive && data?.state) setLoopStatus({ state: data.state, modeName: data.mode?.name });
      })
      .catch(() => {
        if (alive) setLoopStatus(null);
      });
    return () => {
      alive = false;
    };
  }, [open, workerName, view?.roomID]);

  // Tracing 跳转目标：可观测配置里的浏览器访问地址（publicUrl > langfuseUrl）。
  useEffect(() => {
    if (!open || userLevel < 3) {
      setTracingUrl(null);
      return;
    }
    let alive = true;
    fetch('/api/agentteams/observability', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as { enabled?: boolean; publicUrl?: string; langfuseUrl?: string };
      })
      .then((config) => {
        if (!alive) return;
        const url = config?.enabled ? config.publicUrl || config.langfuseUrl || null : null;
        setTracingUrl(url ? url.replace(/\/+$/, '') : null);
      })
      .catch(() => {
        if (alive) setTracingUrl(null);
      });
    return () => {
      alive = false;
    };
  }, [open, userLevel]);

  const providerName = view.model
    ? modelOptions.find((option) => option.alias === view.model)?.binding?.providerName ?? ''
    : '';

  const toggle = useCallback((id: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleRestart = useCallback(async () => {
    if (!workerName || restarting) return;
    setRestarting(true);
    try {
      await agentteamsApi.restartWorker(workerName);
      invalidateWorkerDetail(workerName);
      toast.success(`Worker "${workerName}" 重启中`);
      void refreshDetail(true);
      onChanged?.();
    } catch (err) {
      toast.error(formatErrorMessage(err));
    } finally {
      setRestarting(false);
    }
  }, [onChanged, refreshDetail, restarting, workerName]);

  const handleDelete = useCallback(() => {
    if (!workerName) return;
    deleteWorker.mutate(workerName, {
      onSuccess: () => {
        invalidateWorkerDetail(workerName);
        setDeleteOpen(false);
        onOpenChange(false);
        onDeleted?.();
      },
    });
  }, [deleteWorker, onDeleted, onOpenChange, workerName]);

  const handleUpgrade = useCallback(() => {
    if (!workerName) return;
    updateWorker.mutate(
      { name: workerName, data: { runtime: 'qwenpaw' } },
      {
        onSuccess: () => {
          setUpgradeOpen(false);
          invalidateWorkerDetail(workerName);
          void refreshDetail(true);
          onChanged?.();
        },
      },
    );
  }, [onChanged, refreshDetail, updateWorker, workerName]);

  if (!view) return null;

  const sleeping = view.phase === 'Sleeping' || view.phase === 'Stopped';
  const showEnsureReady = view.phase === 'Pending' || view.phase === 'Stopped';
  const actionPending = wakeWorker.isPending || sleepWorker.isPending || ensureReadyWorker.isPending;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="left-auto right-0 top-0 h-full max-h-full w-full max-w-none translate-x-0 translate-y-0 gap-0 rounded-none border-l p-0 sm:w-[min(92vw,560px)] sm:max-w-[560px] data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right"
          showCloseButton={false}
        >
          <DialogHeader className="sticky top-0 z-10 shrink-0 gap-0 border-b bg-background px-4 py-3 text-left">
            <div className="flex items-start gap-3">
              <Avatar className="size-9 shrink-0">
                <AvatarFallback className="text-sm">{view.name.slice(0, 1).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
                  <span className="truncate">{view.name}</span>
                  <Badge variant="outline" className="text-xs">{roleLabel(view.role)}</Badge>
                </DialogTitle>
                <DialogDescription className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  <StatusDot phase={view.phase} />
                  <PhaseBadge kind="worker" phase={view.phase} />
                  <RuntimeBadge runtime={view.runtime} />
                  <span className="truncate font-mono text-muted-foreground">{view.model || '未设置模型'}</span>
                </DialogDescription>
              </div>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="shrink-0 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                aria-label="关闭详情面板"
              >
                关闭
              </button>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={actionPending}
                onClick={() => (sleeping ? wakeWorker.mutate(view.name) : sleepWorker.mutate(view.name))}
              >
                {sleeping ? <Sun className="mr-1 h-3 w-3" /> : <Moon className="mr-1 h-3 w-3" />}
                {sleeping ? '唤醒' : '休眠'}
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={restarting} onClick={() => void handleRestart()}>
                <RefreshCw className={`mr-1 h-3 w-3 ${restarting ? 'animate-spin' : ''}`} />
                重启
              </Button>
              {showEnsureReady && !ensureReadyUnsupported && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={actionPending}
                  onClick={() => {
                    ensureReadyWorker.mutate(view.name, {
                      onError: (err) => {
                        if ((err as { status?: number })?.status === 404) setEnsureReadyUnsupported(true);
                      },
                    });
                  }}
                >
                  <Rocket className="mr-1 h-3 w-3" />
                  Ensure Ready
                </Button>
              )}
              {tracingUrl && (
                <Button size="sm" variant="outline" className="h-7 text-xs" asChild>
                  <a href={tracingUrl} target="_blank" rel="noopener noreferrer">
                    <Activity className="mr-1 h-3 w-3" />
                    Tracing
                  </a>
                </Button>
              )}
              {userLevel >= 3 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-destructive hover:text-destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="mr-1 h-3 w-3" />
                  删除
                </Button>
              )}
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {/* 状态区 */}
            <section className="space-y-1.5 rounded-lg border p-2.5" aria-label="状态">
              <p className="text-xs text-foreground/80" title={buildStatusNarrative(view, now)}>
                {buildStatusNarrative(view, now)}
              </p>
              <Row label="心跳" value={view.agentStatus || '未上报'} />
              <Row label="最近活动" value={view.lastActivityAt ? formatAgoZh(view.lastActivityAt, now) ?? '-' : '暂无'} />
              <Row label="在跑任务" value={view.runningTaskCount != null ? `${view.runningTaskCount} 个` : '暂无'} />
              <Row label="上次运行" value={view.lastRunAt ? formatAgoZh(view.lastRunAt, now) ?? '-' : '暂无'} />
              <Row label="上次完成" value={view.lastFinishAt ? formatAgoZh(view.lastFinishAt, now) ?? '-' : '暂无'} />
              {loopStatus && (
                <Row label="loop 预算" value={`${loopStatus.state}${loopStatus.modeName ? ` · ${loopStatus.modeName}` : ''}`} />
              )}
            </section>

            {/* 模型卡 */}
            <section className="flex items-center gap-2 rounded-lg border p-2.5" aria-label="模型">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">模型</p>
                <p className="truncate font-mono text-xs">{view.model || '未设置'}</p>
                <p className="truncate text-xs text-muted-foreground">provider: {view.modelProvider || providerName || '-'}</p>
              </div>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setModelOpen(true)}>
                编辑模型
              </Button>
            </section>

            {/* 资源区（按插件右栏顺序；折叠时才挂载内容 → 懒加载） */}
            <div className="space-y-2">
              <ResourceCard title="运行配置" expanded={expanded.has('runtime')} onToggle={() => toggle('runtime')}>
                {view.runtime === 'qwenpaw' ? (
                  <WorkerRuntimeConfigPanel key={`runtime-${view.name}`} workerName={view.name} />
                ) : (
                  <WorkerRestartEffectivePanel key={`apply-${view.name}`} workerName={view.name} />
                )}
              </ResourceCard>

              <ResourceCard title="MCP" expanded={expanded.has('mcp')} onToggle={() => toggle('mcp')}>
                <WorkerMcpPanel
                  key={`mcp-${view.name}`}
                  worker={view}
                  workerName={view.name}
                  workerTeam={view.team || undefined}
                  canEdit={userLevel >= 2}
                  onChanged={() => {
                    invalidateWorkerDetail(view.name);
                    void refreshDetail(true);
                    onChanged?.();
                  }}
                />
              </ResourceCard>

              <ResourceCard title="工具" expanded={expanded.has('tools')} onToggle={() => toggle('tools')}>
                <WorkerToolsPanel key={`tools-${view.name}`} workerName={view.name} />
              </ResourceCard>

              <ResourceCard title="技能" expanded={expanded.has('skills')} onToggle={() => toggle('skills')}>
                <div className="space-y-2">
                  <WorkerSkillAssign
                    key={`skills-${view.name}`}
                    worker={view}
                    onSaved={() => {
                      invalidateWorkerDetail(view.name);
                      void refreshDetail(true);
                      onChanged?.();
                    }}
                  />
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setUploadOpen(true)}>
                    <Upload className="mr-1 h-3 w-3" />
                    上传技能包
                  </Button>
                </div>
              </ResourceCard>

              <ResourceCard title="频道" expanded={expanded.has('channels')} onToggle={() => toggle('channels')}>
                <WorkerChannelsPanel key={`channels-${view.name}`} workerName={view.name} />
              </ResourceCard>

              <ResourceCard title="审批模式" expanded={expanded.has('approval')} onToggle={() => toggle('approval')}>
                <WorkerApprovalControl key={`approval-${view.name}`} workerName={view.name} />
              </ResourceCard>

              <ResourceCard title="Coding CLI" expanded={expanded.has('coding-cli')} onToggle={() => toggle('coding-cli')}>
                <WorkerCodingCliPanel key={`coding-cli-${view.name}`} workerName={view.name} />
              </ResourceCard>

              <ResourceCard title="工作区文件" expanded={expanded.has('workspace-files')} onToggle={() => toggle('workspace-files')}>
                <WorkerWorkspaceFilesPanel key={`ws-${view.name}`} workerName={view.name} />
              </ResourceCard>

              <ResourceCard title="环境变量与网关" expanded={expanded.has('env')} onToggle={() => toggle('env')}>
                <WorkerEnvCard
                  key={`env-${view.name}`}
                  worker={view}
                  onSaved={() => {
                    invalidateWorkerDetail(view.name);
                    void refreshDetail(true);
                    onChanged?.();
                  }}
                />
              </ResourceCard>

              <ResourceCard title="LLM 调优" expanded={expanded.has('llm')} onToggle={() => toggle('llm')}>
                <WorkerLlmTuningPanel key={`llm-${view.name}`} workerName={view.name} />
              </ResourceCard>

              <ResourceCard title="Worker 插件" expanded={expanded.has('plugins')} onToggle={() => toggle('plugins')}>
                <WorkerPluginsCard key={`plugins-${view.name}`} workerName={view.name} />
              </ResourceCard>

              {isLegacyCopaw(view.runtime) && (
                <ResourceCard title="运行时升级" expanded={expanded.has('upgrade')} onToggle={() => toggle('upgrade')}>
                  <div className="space-y-2 text-xs">
                    <p className="text-muted-foreground">
                      将运行时从 CoPaw 升级到 QwenPaw。升级前请备份持久化数据，并避免在任务执行中切换。
                    </p>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setUpgradeOpen(true)}>
                      升级到 QwenPaw
                    </Button>
                  </div>
                </ResourceCard>
              )}
            </div>

            {/* 检查点 */}
            <div className="rounded-lg border">
              <div className="border-b p-2.5 text-xs font-semibold">检查点</div>
              <div className="p-2.5">
                <WorkerCheckpointsCard key={`checkpoints-${view.name}`} workerName={view.name} />
              </div>
            </div>

            {actionPending && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                正在下发操作…
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <WorkerModelDialog
        open={modelOpen}
        workerName={view.name}
        model={view.model || ''}
        modelProvider={view.modelProvider}
        providerHint={providerName}
        modelOptions={modelOptions}
        sessionIssue={sessionIssue}
        onOpenChange={setModelOpen}
        onSaved={() => {
          invalidateWorkerDetail(view.name);
          void refreshDetail(true);
          onChanged?.();
        }}
      />

      <WorkerSkillUploadDialog
        open={uploadOpen}
        workerName={view.name}
        existingSkills={existingSkills}
        onOpenChange={setUploadOpen}
        onUploaded={() => {
          invalidateWorkerDetail(view.name);
          void refreshDetail(true);
          onChanged?.();
        }}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除 Worker {view.name}</AlertDialogTitle>
            <AlertDialogDescription>
              删除 Worker CR 及其容器。若该 Worker 属于某团队，Controller 会拒绝删除（请先从团队移除）。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteWorker.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleteWorker.isPending}>
              {deleteWorker.isPending ? '删除中...' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={upgradeOpen} onOpenChange={setUpgradeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>升级到 QwenPaw</AlertDialogTitle>
            <AlertDialogDescription>
              将 Worker &quot;{view.name}&quot; 的运行时从 CoPaw 改为 QwenPaw。工作区、会话、记忆和凭据会按 Controller 迁移链路保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={updateWorker.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleUpgrade} disabled={updateWorker.isPending}>
              {updateWorker.isPending ? '升级中...' : '确认升级'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

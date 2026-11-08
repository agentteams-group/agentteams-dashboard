'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  ChevronRight,
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
import { QwenpawRuntimeConfigPanel } from './qwenpaw-runtime-config-panel';
import { WorkerRuntimeConfigSurface } from './worker-runtime-config-surface';
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
import { runtimeLabel } from '@/lib/runtime-labels';
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

/** Resource card = entry point only. Clicking it opens the full panel in a
 * dialog (same modal pattern as the workbench plugin); the drawer never
 * expands panel content inline and never nests a second drawer. */
function ResourceCard({
  title,
  desc,
  onOpen,
}: {
  title: string;
  desc: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={title}
      onClick={onOpen}
      className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-left hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold">{title}</span>
        <span className="block truncate text-xs text-muted-foreground" title={desc}>
          {desc}
        </span>
      </span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
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
  const [openCard, setOpenCard] = useState<string | null>(null);
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
    setOpenCard(null);
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

  // Non-QwenPaw runtimes expose their native config through the controller's
  // member-config surface; capability cards reuse that surface (bucket filter)
  // instead of calling QwenPaw-only worker endpoints that answer 400.
  //
  // QwenPaw is the exception: the controller registers no member-config
  // surface adapter for it (only openclaw + hermes), so the legacy
  // `runtime-config` end is the only real config plane. An empty runtime is
  // treated as non-QwenPaw (surface), never as a fake QwenPaw form.
  const nonQwenpaw = Boolean(view.runtime) && view.runtime !== 'qwenpaw';
  const isQwenpaw = view.runtime === 'qwenpaw';
  const runtimeName = runtimeLabel(view.runtime);
  const envCount = Object.keys(view.env ?? {}).length;

  const surface = (bucket: 'config' | 'mcp' | 'tools' | 'skills' | 'channels' | 'approval') => (
    <WorkerRuntimeConfigSurface
      key={`surface-${bucket}-${view.name}`}
      workerName={view.name}
      runtime={view.runtime}
      bucket={bucket}
      canWrite={userLevel >= 3}
      onChanged={() => {
        invalidateWorkerDetail(view.name);
        void refreshDetail(true);
        onChanged?.();
      }}
    />
  );

  const qwenpawRuntimeConfig = (
    <QwenpawRuntimeConfigPanel
      key={`qwenpaw-runtime-${view.name}`}
      workerName={view.name}
      canWrite={userLevel >= 3}
      onChanged={() => {
        invalidateWorkerDetail(view.name);
        void refreshDetail(true);
        onChanged?.();
      }}
    />
  );

  const resourceCards: Array<{
    id: string;
    title: string;
    desc: string;
    render: () => React.ReactNode;
  }> = [
    {
      id: 'runtime',
      title: '运行配置',
      desc: isQwenpaw
        ? `${runtimeName} · 全部配置分区 / 循环 / 重启生效`
        : `${runtimeName} · 分组 / 搜索 / 已改计数 / 回滚`,
      render: () => (isQwenpaw ? qwenpawRuntimeConfig : surface('config')),
    },
    {
      id: 'mcp',
      title: 'MCP',
      desc: nonQwenpaw
        ? `${runtimeName} 配置面（surface 驱动）`
        : `${view.mcpServers?.length ?? 0} 个声明 server · 声明 + 自注册合并`,
      render: () =>
        nonQwenpaw ? (
          surface('mcp')
        ) : (
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
        ),
    },
    {
      id: 'tools',
      title: '工具',
      desc: nonQwenpaw ? `${runtimeName} 配置面（surface 驱动）` : '内置工具启用列表',
      render: () =>
        nonQwenpaw ? (
          surface('tools')
        ) : (
          <WorkerToolsPanel key={`tools-${view.name}`} workerName={view.name} />
        ),
    },
    {
      id: 'skills',
      title: '技能',
      desc: nonQwenpaw
        ? `${runtimeName} 配置面（surface 驱动）`
        : `${view.skills?.length ?? 0} 项 · 目录 / 分配矩阵`,
      render: () =>
        nonQwenpaw ? (
          surface('skills')
        ) : (
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
            <Button size="sm" variant="outline" className="h-11 text-sm sm:h-9" onClick={() => setUploadOpen(true)}>
              <Upload className="mr-1 h-4 w-4" />
              上传技能包
            </Button>
          </div>
        ),
    },
    {
      id: 'channels',
      title: '频道',
      desc: nonQwenpaw ? `${runtimeName} 配置面（surface 驱动）` : '频道配置 + 二维码授权 + 重启',
      render: () =>
        nonQwenpaw ? (
          surface('channels')
        ) : (
          <WorkerChannelsPanel key={`channels-${view.name}`} workerName={view.name} />
        ),
    },
    {
      id: 'approval',
      title: '审批模式',
      desc: nonQwenpaw ? `${runtimeName} 配置面（surface 驱动）` : '审批三档 + 保存',
      render: () =>
        nonQwenpaw ? (
          surface('approval')
        ) : (
          <WorkerApprovalControl key={`approval-${view.name}`} workerName={view.name} />
        ),
    },
    {
      id: 'coding-cli',
      title: 'Coding CLI',
      desc: '安装 / 升级 / 配置（含 QwenCode 桥）',
      render: () => (
        <WorkerCodingCliPanel
          key={`coding-cli-${view.name}`}
          workerName={view.name}
          runtime={view.runtime}
          onChanged={onChanged}
        />
      ),
    },
    {
      id: 'workspace-files',
      title: '工作区文件',
      desc: 'MEMORY / memory / digest · 文本可编辑',
      render: () => (
        <WorkerWorkspaceFilesPanel key={`ws-${view.name}`} workerName={view.name} />
      ),
    },
    {
      id: 'env',
      title: '环境变量与网关',
      desc: `${envCount} 个变量 · 模型 / MCP 网关探测`,
      render: () => (
        <WorkerEnvCard
          key={`env-${view.name}`}
          worker={view}
          onSaved={() => {
            invalidateWorkerDetail(view.name);
            void refreshDetail(true);
            onChanged?.();
          }}
        />
      ),
    },
    {
      id: 'llm',
      title: 'LLM 调优',
      desc: '重试 / 限流 + 流式超时',
      render: () => <WorkerLlmTuningPanel key={`llm-${view.name}`} workerName={view.name} />,
    },
    {
      id: 'plugins',
      title: 'Worker 插件',
      desc: 'id / 名称 / 版本 / 启用（只读）',
      render: () => <WorkerPluginsCard key={`plugins-${view.name}`} workerName={view.name} />,
    },
  ];

  if (isLegacyCopaw(view.runtime)) {
    resourceCards.push({
      id: 'upgrade',
      title: '运行时升级',
      desc: 'CoPaw → QwenPaw（二次确认）',
      render: () => (
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            将运行时从 CoPaw 升级到 QwenPaw。升级前请备份持久化数据，并避免在任务执行中切换。
          </p>
          <Button
            variant="outline"
            className="h-11 text-sm"
            onClick={() => {
              setOpenCard(null);
              setUpgradeOpen(true);
            }}
          >
            升级到 QwenPaw
          </Button>
        </div>
      ),
    });
  }

  resourceCards.push({
    id: 'checkpoints',
    title: '检查点',
    desc: '回迁 / 恢复',
    render: () => <WorkerCheckpointsCard key={`checkpoints-${view.name}`} workerName={view.name} />,
  });

  const activeCard = openCard ? resourceCards.find((card) => card.id === openCard) ?? null : null;

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
                className="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded px-3 text-xs text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                aria-label="关闭详情面板"
              >
                关闭
              </button>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                disabled={actionPending}
                onClick={() => (sleeping ? wakeWorker.mutate(view.name) : sleepWorker.mutate(view.name))}
              >
                {sleeping ? <Sun className="mr-1 h-3 w-3" /> : <Moon className="mr-1 h-3 w-3" />}
                {sleeping ? '唤醒' : '休眠'}
              </Button>
              <Button size="sm" variant="outline" className="text-xs" disabled={restarting} onClick={() => void handleRestart()}>
                <RefreshCw className={`mr-1 h-3 w-3 ${restarting ? 'animate-spin' : ''}`} />
                重启
              </Button>
              {showEnsureReady && !ensureReadyUnsupported && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs"
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
                <Button size="sm" variant="outline" className="text-xs" asChild>
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
                  className="text-xs text-destructive hover:text-destructive"
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
              <Button size="sm" variant="outline" className="text-xs" onClick={() => setModelOpen(true)}>
                编辑模型
              </Button>
            </section>

            {/* 资源卡 = 入口：点击打开大弹窗（面板只在弹窗打开时挂载） */}
            <div className="space-y-2">
              {resourceCards.map((card) => (
                <ResourceCard
                  key={card.id}
                  title={card.title}
                  desc={card.desc}
                  onOpen={() => setOpenCard(card.id)}
                />
              ))}
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

      {/* 卡片弹窗：桌面 960×86vh，移动全屏；Esc/遮罩/关闭按钮都能关 */}
      <Dialog
        open={activeCard != null}
        onOpenChange={(next) => {
          if (!next) setOpenCard(null);
        }}
      >
        <DialogContent
          className="flex h-[86vh] w-[min(96vw,960px)] max-w-none flex-col gap-0 overflow-hidden rounded-lg p-0 max-sm:h-[100dvh] max-sm:w-full max-sm:max-w-none max-sm:rounded-none"
          showCloseButton={false}
        >
          <DialogHeader className="flex shrink-0 flex-row items-start gap-2 border-b px-5 py-3 text-left">
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base">{activeCard?.title ?? ''}</DialogTitle>
              <DialogDescription className="text-xs">
                {activeCard?.desc ?? ''}
              </DialogDescription>
            </div>
            <Button
              variant="ghost"
              className="h-11 w-11 shrink-0 p-0 text-lg"
              aria-label="关闭弹窗"
              onClick={() => setOpenCard(null)}
            >
              ×
            </Button>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {activeCard ? activeCard.render() : null}
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

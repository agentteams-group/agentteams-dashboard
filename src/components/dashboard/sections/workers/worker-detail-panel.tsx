'use client';

// Worker 详情面板（F7 唯一实现）：WorkerDrawer 与「团队与Agent」页内联详情
// 共用本组件。对齐工作台插件 WorkerDetailPane：
// - 状态叙述 + 心跳/最近活动/在跑任务/上次运行/上次完成/loop 预算（D2）；
// - 竖向配置标签页；只挂载当前分区，编辑模型仍使用确认弹窗；
// - 「会话」页：WorkerChatsPanel showKindTabs —— 会话/子代理会话双 tab；
// - 生命周期动作：唤醒 / 休眠 / 重启 / Ensure Ready（仅 Pending/Stopped，
//   404 → 隐藏）/ Tracing（Langfuse 外链，仅 L1）/ 删除（仅 L1，D8 409
//   团队占用走友好文案）/ CoPaw 升级；
// - 头部「私聊」按钮（D1）：复用 dmTargetFor；onDm 缺省回落 hash 导航。
// 网关探测（WorkerEnvCard 内）、编辑弹窗等均为既有组件复用，不重复实现。

import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Loader2,
  MessageCircle,
  Moon,
  RefreshCw,
  Rocket,
  Sun,
  Trash2,
  Upload,
} from 'lucide-react';
import { AccountAvatar } from '@/components/dashboard/account-avatar';
import { AvatarEditor } from '@/components/dashboard/avatar-editor';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ResourceDetailTabs } from '@/components/dashboard/resource-detail-tabs';
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
import { WorkerHeartbeatControl } from './worker-heartbeat-control';
import { WorkerLlmTuningPanel } from './worker-llm-tuning-panel';
import { WorkerMcpPanel } from './worker-mcp-panel';
import { WorkerEditDialog, type WorkerEditForm } from './worker-edit-dialog';
import { WorkerPluginsCard } from './worker-plugins-card';
import { WorkerChatsPanel } from './worker-chats-panel';
import { QwenpawRuntimeConfigPanel } from './qwenpaw-runtime-config-panel';
import { WorkerRuntimeConfigSurface } from './worker-runtime-config-surface';
import { WorkerSkillAssign } from './worker-skill-assign';
import { WorkerSkillUploadDialog } from './worker-skill-upload-dialog';
import { WorkerToolsPanel } from './worker-tools-panel';
import { WorkerWorkspaceFilesPanel } from './worker-workspace-files-panel';
import { FilesBrowserPanel } from '../chat/views/worker-files-panel';
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
import { hashForSection, roomHash } from '@/lib/nav-hash';
import type { ModelSelectionOption } from '@/lib/model-catalog';
import { formatErrorMessage } from '@/lib/api-error';
import { dmTargetFor } from '../managers/manager-drawer-logic';
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

export type WorkerDetailPanelProps = {
  worker: WorkerResponse;
  modelOptions: ModelSelectionOption[];
  sessionIssue?: string | null;
  userLevel: number;
  /** 提供后头部显示「关闭」按钮（抽屉场景）；内联页面不传。 */
  onClose?: () => void;
  /** 私聊跳转；缺省时回落 hash 导航（roomHash / chat 首页）。 */
  onDm?: (_mxid: string, _roomId?: string) => void;
  /** 根节点附加 class（内联页面用 min-h-0 flex-1 参与父级 flex 布局）。 */
  className?: string;
  onChanged?: () => void;
  onDeleted?: () => void;
};

export function WorkerDetailPanel({
  worker,
  modelOptions,
  sessionIssue,
  userLevel,
  onClose,
  onDm,
  className,
  onChanged,
  onDeleted,
}: WorkerDetailPanelProps) {
  const workerName = worker.name;
  const [detail, setDetail] = useState<WorkerResponse | null>(worker);
  const [editForm, setEditForm] = useState<WorkerEditForm | null>(null);
  const [envOpen, setEnvOpen] = useState(false);
  const [llmOpen, setLlmOpen] = useState(false);
  const [expandedCards, setExpandedCards] = useState<string[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
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
  const { data: existingSkills = [] } = useWorkerSkills(workerName);

  const view = detail?.name === workerName ? detail : worker;
  const dm = dmTargetFor(view);

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
    // 只按名字重挂载：worker prop 每次轮询都换引用，若进依赖会触发
    // 反复 fetch。挂载初始值由 useState(worker) 提供；换名后 detail 还
    // 是旧名 → view 回退到 worker prop，数据一致，无需 setDetail(worker)。
    let alive = true;
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
  }, [workerName]);

  // loop 预算：按 1:1 Worker 房间 session 查激活 loop；404/失败 → 整行不显。
  useEffect(() => {
    if (!view?.roomID) return;
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
  }, [workerName, view?.roomID]);

  // Tracing 跳转目标：可观测配置里的浏览器访问地址（publicUrl > langfuseUrl）。
  useEffect(() => {
    if (userLevel < 3) {
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
  }, [userLevel]);

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
        onClose?.();
        onDeleted?.();
      },
    });
  }, [deleteWorker, onClose, onDeleted, workerName]);

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

  const openDm = useCallback(() => {
    if (!dm) return;
    if (onDm) {
      onDm(dm.mxid, dm.roomId);
      return;
    }
    window.location.hash = dm.roomId ? roomHash(dm.roomId) : hashForSection('chat');
  }, [dm, onDm]);

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
      title: '高级配置',
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
          <WorkerToolsPanel
            key={`tools-${view.name}`}
            workerName={view.name}
            runtime={view.runtime}
          />
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
            {Boolean(worker.skillWarnings?.length) && <div role="alert" className="space-y-1 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400">
              <p className="font-medium">部分技能未能加载，Agent 可继续运行</p>
              <ul className="list-disc space-y-1 pl-4">{worker.skillWarnings!.map((warning) => <li key={warning} className="break-words">{warning}</li>)}</ul>
            </div>}
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
          modelAliases={modelOptions.map((option) => option.alias)}
          onChanged={onChanged}
        />
      ),
    },
    {
      id: 'workspace-files',
      title: '工作区文件',
      desc: 'Agent 工作区和存储文件',
      render: () => (
        <div className="space-y-4">
          <WorkerWorkspaceFilesPanel key={`ws-${view.name}`} workerName={view.name} />
          <div className="h-[36rem] border-t pt-3"><FilesBrowserPanel key={`storage-${view.name}`} scope={{ worker: view.name }} /></div>
        </div>
      ),
    },
    {
      id: 'plugins',
      title: 'Worker 插件',
      desc: 'id / 名称 / 版本 / 启用（只读）',
      render: () => <WorkerPluginsCard key={`plugins-${view.name}`} workerName={view.name} />,
    },
    {
      id: 'chats',
      title: '会话',
      desc: '会话列表 / 子代理会话（只读）',
      render: () => (
        <WorkerChatsPanel key={`chats-${view.name}`} workerName={view.name} showKindTabs />
      ),
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
  const tabIds = ['mcp', 'skills', 'runtime', 'workspace-files', 'chats'];
  const tabCards = tabIds.flatMap((id) => resourceCards.filter((card) => card.id === id));
  const advancedCards = resourceCards.filter((card) => !tabIds.includes(card.id));

  return (
    <div className={`flex min-w-0 flex-col ${className ?? ''}`}>
      <div className="sticky top-0 z-10 shrink-0 border-b bg-background px-4 py-3">
        <div className="flex items-start gap-3">
          {userLevel >= 3 ? <button type="button" className="shrink-0 rounded-full hover:ring-2 hover:ring-ring focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`更换 ${view.name} 的头像`} title="更换头像" onClick={() => setAvatarOpen(true)}>
            <AccountAvatar kind="agent" name={view.name} className="size-9" />
          </button> : <AccountAvatar kind="agent" name={view.name} className="size-9" />}
          <div className="min-w-0 flex-1">
            <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">
              <span className="truncate">{view.name}</span>
              <Badge variant="outline" className="text-xs">{roleLabel(view.role)}</Badge>
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <StatusDot phase={view.phase} />
              <PhaseBadge kind="worker" phase={view.phase} />
              <RuntimeBadge runtime={view.runtime} />
              <span className="truncate font-mono text-muted-foreground">{view.model || '未设置模型'}</span>
            </div>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded px-3 text-xs text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              aria-label="关闭详情面板"
            >
              关闭
            </button>
          )}
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
          {dm && (
            <Button size="sm" variant="outline" className="text-xs" onClick={openDm}>
              <MessageCircle className="mr-1 h-3 w-3" />
              私聊
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
      </div>

      <ResourceDetailTabs key={workerName} label="Agent 配置" items={[
        { id: 'basic', title: '基础配置', render: () => <div className="space-y-4">
        <section className="space-y-2 rounded-lg border p-3" aria-label="基础配置">
          <Row label="运行时" value={runtimeName} />
          <Row label="模型 ID" value={view.model || '未设置'} />
          <Row label="模型连接" value={view.modelProvider || providerName || '默认连接'} />
          <Row label="镜像" value={view.image || '默认镜像'} />
          <Button size="sm" variant="outline" disabled={userLevel < 3} onClick={() => setEditForm({ model: view.model || '', runtime: view.runtime, image: view.image || '' })}>编辑基础配置</Button>
        </section>
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

        {view.runtime === 'openclaw' ? (
          <WorkerHeartbeatControl
            enabled={view.llmHeartbeatEnabled}
            disabled={userLevel < 3 || !view.envEditable || updateWorker.isPending}
            onCheckedChange={(enabled) => updateWorker.mutate(
              { name: workerName, data: { llmHeartbeatEnabled: enabled } },
              {
                onSuccess: () => {
                  invalidateWorkerDetail(workerName);
                  void refreshDetail(true);
                  onChanged?.();
                },
              },
            )}
          />
        ) : null}

        <details className="rounded-lg border p-3" onToggle={(event) => setEnvOpen(event.currentTarget.open)}>
          <summary className="cursor-pointer text-sm">环境变量与网关 · {envCount} 个变量</summary>
          {envOpen && <div className="pt-3"><WorkerEnvCard key={`env-${view.name}`} worker={view} onSaved={() => {
            invalidateWorkerDetail(view.name);
            void refreshDetail(true);
            onChanged?.();
          }} /></div>}
        </details>
        <details className="rounded-lg border p-3" onToggle={(event) => setLlmOpen(event.currentTarget.open)}>
          <summary className="cursor-pointer text-sm">模型调优</summary>
          {llmOpen && <div className="pt-3"><WorkerLlmTuningPanel key={`llm-${view.name}`} workerName={view.name} /></div>}
        </details>
        </div> },
        ...tabCards.map(card => ({ ...card, render: () => (
          <div className="space-y-4">
            <h3 className="text-sm font-medium">{card.title}</h3>
            {card.render()}
            {card.id === 'runtime' && advancedCards.map((item) => (
              <details key={item.id} className="rounded-lg border p-3" onToggle={(event) => {
                const open = event.currentTarget.open;
                setExpandedCards((previous) => open ? [...new Set([...previous, item.id])] : previous.filter((id) => id !== item.id));
              }}>
                <summary className="cursor-pointer text-sm">{item.title}</summary>
                {expandedCards.includes(item.id) && <div className="pt-3">{item.render()}</div>}
              </details>
            ))}
          </div>
        ) })),
      ]} />

      {actionPending && <p role="status" className="flex items-center gap-2 border-t px-4 py-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" aria-hidden="true" />正在下发操作…</p>}

      {editForm && <WorkerEditDialog
        open
        basicOnly
        workerName={view.name}
        value={editForm}
        onChange={setEditForm}
        isPending={updateWorker.isPending}
        onOpenChange={(open) => !open && setEditForm(null)}
        modelOptions={modelOptions}
        modelProvider={view.modelProvider}
        sessionIssue={sessionIssue}
        onSubmit={() => updateWorker.mutate({ name: view.name, data: editForm }, {
          onSuccess: () => {
            setEditForm(null);
            invalidateWorkerDetail(view.name);
            void refreshDetail(true);
            onChanged?.();
          },
        })}
      />}

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

      {avatarOpen && userLevel >= 3 && <AvatarEditor key={view.name} kind="agent" name={view.name} onClose={() => setAvatarOpen(false)} />}
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
    </div>
  );
}

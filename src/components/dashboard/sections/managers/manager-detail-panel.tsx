'use client';

// Manager 详情面板：ManagerDrawer 与平台助手设置
// 共用本组件。1:1 移植工作台插件「管理页 · Manager 详情面板」
// （ManagerDetailPane / ManagerLogsCard）。
//
// 分区：
//   · 状态卡：唤醒 / 休眠（PUT {state} desired-state 语义）+ 重启
//     （POST /managers/{name}/restart）+ 健康/心跳摘要；
//   · 私聊入口（有 MXID 才显示）；
//   · 模型配置（ModelPicker：Provider → Model，保存 updateManagerModel）；
//   · SOUL.md / AGENTS.md（查看 + 编辑，PUT 仅非空才写，保存前确认）；
//   · Skills / MCP Servers / Env（各自整表替换保存）；
//   · Manager 独有 Config：心跳间隔 / Worker 空闲超时 / 通知频道（整对象替换）；
//   · 容器日志（折叠卡，tail 300，点击才加载，手动刷新，不轮询）。
//
// 契约现状（诚实降级）：Controller 的 ManagerResponse / managerToResponse 目前
// 旧版只映射标量列，详情响应可能不带 soul/agents/skills/mcpServers/config——
// 摘要显示「未配置」，保存后回读不一致时明示「未确认/未生效」，不假装成功。

import { useCallback, useEffect, useState } from 'react';
import {
  Brain,
  ChevronRight,
  Code2,
  Cpu,
  Crown,
  Loader2,
  MessageSquare,
  Moon,
  Package,
  Pencil,
  Plug,
  RefreshCw,
  SlidersHorizontal,
  Sun,
  Tags,
} from 'lucide-react';
import { ResourceDetailTabs } from '@/components/dashboard/resource-detail-tabs';
import { AccountAvatar } from '@/components/dashboard/account-avatar';
import { QwenpawRuntimeConfigPanel } from '../workers/qwenpaw-runtime-config-panel';
import { InfoTip } from '@/components/dashboard/info-tip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { CopyButton } from '@/components/dashboard/copy-button';
import { PhaseBadge, RuntimeBadge } from '@/components/dashboard/phase-badge';
import { useUpdateManager } from '@/hooks/use-agentteams-mutations';
import { useSkills } from '@/hooks/use-skill-center';
import { agentteamsApi, type ManagerResponse } from '@/lib/agentteams-api';
import type { ModelSelectionOption } from '@/lib/model-catalog';
import { formatErrorMessage } from '@/lib/api-error';
import { fetchManagerFull, invalidateManagerDetail } from '@/lib/manager-detail';
import { hashForSection, roomHash } from '@/lib/nav-hash';
import { toast } from 'sonner';
import {
  configDraftFrom,
  dmTargetFor,
  isManagerAsleep,
  managerActionErrorText,
  managerConfigApplied,
  managerConfigDirty,
  managerConfigPayload,
  managerDocSaveBlocked,
  managerEnvApplied,
  managerSpecReadable,
  managerVersionLabel,
  type ManagerConfigDraft,
} from './manager-drawer-logic';
import { ManagerDocDialog, MANAGER_DOC_META, type ManagerDocKind } from './manager-doc-dialog';
import { ManagerEnvDialog } from './manager-env-dialog';
import { ManagerLogsCard } from './manager-logs-card';
import { ManagerMcpDialog } from './manager-mcp-dialog';
import { ManagerModelDialog } from './manager-model-dialog';
import { ManagerSkillsDialog } from './manager-skills-dialog';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 break-words text-xs">{children}</span>
    </div>
  );
}

/** 配置摘要卡：标题 + 摘要 + 点击进入编辑（只读时禁用）。 */
function ConfigCard({
  icon: Icon,
  title,
  summary,
  disabled,
  onClick,
}: {
  icon: typeof Crown;
  title: string;
  summary: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-11 w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-lg border bg-card p-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold">{title}</span>
        <span className="block truncate text-xs text-muted-foreground" title={typeof summary === 'string' ? summary : undefined}>
          {summary}
        </span>
      </span>
      {disabled ? null : (
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
    </button>
  );
}

export type ManagerDetailPanelProps = {
  manager: ManagerResponse;
  modelOptions: ModelSelectionOption[];
  sessionIssue?: string | null;
  /** Dashboard 会话等级：3 = 管理员（插件侧 L1）才能编辑。 */
  userLevel: number;
  /** 编辑入口（沿用列表页的 ManagerEditDialog：模型 / 运行时 / 镜像）。 */
  onEdit?: (_manager: ManagerResponse) => void;
  onChanged?: () => void;
  /** 私聊跳转；缺省 = 有房间就跳私聊房，无房间跳协作空间。 */
  onDm?: (_mxid: string, _roomId?: string) => void;
  /** 根节点附加 class（内联页面用 min-h-0 flex-1 参与父级 flex 布局）。 */
  className?: string;
  initialTab?: string;
  chrome?: 'full' | 'section';
};

export function ManagerDetailPanel({
  manager,
  modelOptions,
  sessionIssue,
  userLevel,
  onEdit,
  onChanged,
  onDm,
  className,
  initialTab,
  chrome = 'full',
}: ManagerDetailPanelProps) {
  const managerName = manager.name;
  const canWrite = userLevel >= 3;
  const updateManager = useUpdateManager();
  const { data: skillCatalog } = useSkills(undefined, undefined, 1, 10000);

  const [detail, setDetail] = useState<ManagerResponse | null>(manager);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [acting, setActing] = useState<'wake' | 'sleep' | 'restart' | null>(null);
  const [saving, setSaving] = useState<'model' | 'doc' | 'skills' | 'mcp' | 'env' | 'config' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [restartOpen, setRestartOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [docKind, setDocKind] = useState<ManagerDocKind | null>(null);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [envOpen, setEnvOpen] = useState(false);
  const [cfg, setCfg] = useState<ManagerConfigDraft>(() => configDraftFrom(manager.config));

  const view = detail?.name === managerName ? detail : manager;
  const specReadable = managerSpecReadable(detail);
  const asleep = isManagerAsleep(view.state);
  const dm = dmTargetFor(view);

  const refresh = useCallback(async () => {
    invalidateManagerDetail(managerName);
    try {
      const next = await fetchManagerFull(managerName, { force: true });
      setDetail(next);
      setDetailError(null);
      setCfg(configDraftFrom(next.config));
      return next;
    } catch (err) {
      setDetailError(formatErrorMessage(err));
      return null;
    }
  }, [managerName]);

  useEffect(() => {
    let alive = true;
    invalidateManagerDetail(managerName);
    fetchManagerFull(managerName, { force: true })
      .then((next) => {
        if (!alive) return;
        setDetail(next);
        setCfg(configDraftFrom(next.config));
      })
      .catch((err: unknown) => {
        if (alive) setDetailError(formatErrorMessage(err));
      });
    return () => {
      alive = false;
    };
  }, [managerName]);

  const finishSave = useCallback(() => {
    invalidateManagerDetail(managerName);
    onChanged?.();
  }, [managerName, onChanged]);

  // ── 状态操作 ─────────────────────────────────────────────────────────
  const handleState = useCallback(
    async (target: 'Running' | 'Sleeping') => {
      setActing(target === 'Running' ? 'wake' : 'sleep');
      setActionError(null);
      try {
        await updateManager.mutateAsync({ name: managerName, data: { state: target } });
        finishSave();
        void refresh();
      } catch (err) {
        setActionError(managerActionErrorText(err));
      } finally {
        setActing(null);
      }
    },
    [finishSave, managerName, refresh, updateManager],
  );

  const handleRestart = useCallback(async () => {
    setRestartOpen(false);
    setActing('restart');
    setActionError(null);
    try {
      await agentteamsApi.restartManager(managerName);
      toast.success('已发送重启');
      finishSave();
      void refresh();
    } catch (err) {
      setActionError(managerActionErrorText(err));
    } finally {
      setActing(null);
    }
  }, [finishSave, managerName, refresh]);

  // ── 模型 ─────────────────────────────────────────────────────────────
  const handleModelSave = useCallback(
    async (model: string, provider: string) => {
      setSaving('model');
      setActionError(null);
      try {
        await agentteamsApi.updateManagerModel(managerName, model, provider || undefined);
        toast.success('已保存');
        setModelOpen(false);
        finishSave();
        void refresh();
      } catch (err) {
        setActionError(managerActionErrorText(err));
      } finally {
        setSaving(null);
      }
    },
    [finishSave, managerName, refresh],
  );

  // ── 文档 ─────────────────────────────────────────────────────────────
  const handleDocSave = useCallback(
    async (draft: string) => {
      if (!docKind) return;
      const base = docKind === 'soul' ? detail?.soul ?? '' : detail?.agents ?? '';
      if (managerDocSaveBlocked(draft, base)) return;
      setSaving('doc');
      setActionError(null);
      try {
        await updateManager.mutateAsync({
          name: managerName,
          data: docKind === 'soul' ? { soul: draft } : { agents: draft },
        });
        setDocKind(null);
        finishSave();
        const next = await refresh();
        if (next && next[docKind] === undefined) {
          setNotice(`${MANAGER_DOC_META[docKind].file} 已提交，但 Controller 未回显该字段，无法确认已生效`);
        }
      } catch (err) {
        setActionError(managerActionErrorText(err));
      } finally {
        setSaving(null);
      }
    },
    [detail, docKind, finishSave, managerName, refresh, updateManager],
  );

  // ── Skills ───────────────────────────────────────────────────────────
  const handleSkillsSave = useCallback(
    async (skills: string[]) => {
      setSaving('skills');
      setActionError(null);
      try {
        await updateManager.mutateAsync({ name: managerName, data: { skills } });
        setSkillsOpen(false);
        finishSave();
        void refresh();
      } catch (err) {
        setActionError(managerActionErrorText(err));
      } finally {
        setSaving(null);
      }
    },
    [finishSave, managerName, refresh, updateManager],
  );

  // ── MCP ──────────────────────────────────────────────────────────────
  const handleMcpSave = useCallback(
    async (mcpServers: NonNullable<ManagerResponse['mcpServers']>) => {
      setSaving('mcp');
      setActionError(null);
      try {
        await updateManager.mutateAsync({ name: managerName, data: { mcpServers } });
        setMcpOpen(false);
        finishSave();
        void refresh();
      } catch (err) {
        setActionError(managerActionErrorText(err));
      } finally {
        setSaving(null);
      }
    },
    [finishSave, managerName, refresh, updateManager],
  );

  // 仅在 Controller 声明 envEditable 时提交，并回读确认保存结果。
  const handleEnvSave = useCallback(
    async (env: Record<string, string>) => {
      if (!detail?.envEditable) return;
      setSaving('env');
      setActionError(null);
      try {
        await updateManager.mutateAsync({ name: managerName, data: { env } });
        finishSave();
        const next = await refresh();
        if (!next || !managerEnvApplied(env, next.env)) {
          setActionError('环境变量未能回读确认，请刷新后重试。');
          return;
        }
        setEnvOpen(false);
        setNotice('环境变量已保存，Controller 将重建助手容器以应用配置。');
      } catch (err) {
        setActionError(managerActionErrorText(err));
      } finally {
        setSaving(null);
      }
    },
    [detail?.envEditable, finishSave, managerName, refresh, updateManager],
  );

  // ── Manager 独有 Config（整对象替换）──────────────────────────────────
  const handleConfigSave = useCallback(async () => {
    const payload = managerConfigPayload(cfg);
    setSaving('config');
    setActionError(null);
    try {
      await updateManager.mutateAsync({ name: managerName, data: { config: payload } });
      finishSave();
      const next = await refresh();
      if (next && !managerConfigApplied(payload, next.config)) {
        setNotice('配置未回读确认：Controller 详情响应未回显 config');
      } else {
        setNotice(null);
      }
    } catch (err) {
      setActionError(managerActionErrorText(err));
    } finally {
      setSaving(null);
    }
  }, [cfg, finishSave, managerName, refresh, updateManager]);

  const openDm = useCallback(() => {
    if (!dm) return;
    if (onDm) {
      onDm(dm.mxid, dm.roomId);
      return;
    }
    window.location.hash = dm.roomId ? roomHash(dm.roomId) : hashForSection('chat');
  }, [dm, onDm]);

  const skills = detail?.skills ?? view.skills ?? [];
  const mcpServers = detail?.mcpServers ?? [];
  const env = detail?.env ?? {};
  const envKeys = Object.keys(env);
  const loadingText = '加载中…';
  const emptyText = specReadable ? '未配置' : 'Controller 未回显';
  const cfgDirty = managerConfigDirty(cfg, detail?.config);

  return (
    <div className={`flex min-w-0 flex-col ${className ?? ''}`}>
      {chrome === 'full' && <>
      {/* 身份头（抽屉场景由 Sheet 关闭键兜底关闭；内联场景由页面返回键兜底） */}
      <div className="shrink-0 border-b px-3 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <AccountAvatar kind="agent" name={view.name} label={view.name} className="size-8 rounded-lg" />
          <h2 className="min-w-0 truncate text-base font-semibold">{view.name}</h2>
          <PhaseBadge kind="manager" phase={view.phase} className="shrink-0" />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <RuntimeBadge runtime={view.runtime || ''} />
          {view.model && <span className="font-mono text-muted-foreground">{view.model}</span>}
          <span className="text-muted-foreground" title={view.image || view.version}>版本 {managerVersionLabel(view.image, view.version)}</span>
        </div>
      </div>

      <div className="shrink-0 space-y-2 border-b px-3 py-3">
        {/* 操作区 */}
        <div className="flex flex-wrap items-center gap-2">
          {canWrite ? (
            <Button
              size="sm"
              variant="outline"
              className="h-9 text-xs"
              disabled={acting != null}
              onClick={() => void handleState(asleep ? 'Running' : 'Sleeping')}
            >
              {acting === 'wake' || acting === 'sleep' ? (
                <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden="true" />
              ) : asleep ? (
                <Sun className="mr-1 size-3.5" aria-hidden="true" />
              ) : (
                <Moon className="mr-1 size-3.5" aria-hidden="true" />
              )}
              {asleep ? '唤醒' : '休眠'}
            </Button>
          ) : null}
          {canWrite ? (
            <Button
              size="sm"
              variant="outline"
              className="h-9 text-xs"
              disabled={acting != null}
              onClick={() => setRestartOpen(true)}
            >
              <RefreshCw
                className={`mr-1 size-3.5 ${acting === 'restart' ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              重启
            </Button>
          ) : null}
          {onEdit ? (
            <Button
              size="sm"
              variant="outline"
              className="h-9 text-xs"
              onClick={() => onEdit(view)}
            >
              <Pencil className="mr-1 size-3.5" aria-hidden="true" />
              编辑
            </Button>
          ) : null}
          {dm ? (
            <Button size="sm" variant="outline" className="h-9 text-xs" onClick={openDm}>
              <MessageSquare className="mr-1 size-3.5" aria-hidden="true" />
              私聊
            </Button>
          ) : null}
        </div>

        {!canWrite ? (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs text-amber-700 dark:text-amber-400">
            只读：编辑 Manager 配置需要 L1 管理员权限（Controller 管理员 token）。
            当前会话仅可查看状态与摘要。
          </p>
        ) : null}

        {notice ? (
          <p role="status" className="rounded-lg border border-dashed p-2.5 text-xs text-muted-foreground">
            {notice}
          </p>
        ) : null}

        {actionError && !envOpen ? (
          <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-2.5 text-xs text-destructive">
            {actionError}
          </p>
        ) : null}

        {detailError ? (
          <p role="alert" className="rounded-lg border border-destructive/40 p-2.5 text-xs text-destructive">
            读取 Manager 详情失败：{detailError}
          </p>
        ) : null}

      </div>

      </>}
      <ResourceDetailTabs key={managerName} label="平台助手配置" initialTab={initialTab} chrome={chrome} items={[
        { id: 'basic', title: '基础配置', render: () => <section className="space-y-4" aria-label="连接信息">
          <h3 className="text-sm font-medium">连接信息</h3>
          <Row label="Matrix 账号">
            {view.matrixUserID ? (
              <span className="flex min-w-0 items-center gap-1">
                <code className="truncate font-mono text-xs">{view.matrixUserID}</code>
                <CopyButton text={view.matrixUserID} />
              </span>
            ) : (
              '—'
            )}
          </Row>
          <Row label="管理员会话">
            {view.roomID ? (
              <span className="flex min-w-0 items-center gap-1">
                <code className="truncate font-mono text-xs">{view.roomID}</code>
                <CopyButton text={view.roomID} />
              </span>
            ) : (
              '—'
            )}
          </Row>
          <p className="text-xs leading-5 text-muted-foreground">该会话由安装时的管理员与助手创建，不代表当前登录账号的专属私聊。<InfoTip label="管理员会话说明">其他 L1 不会自动拥有独立的助手会话；只有已加入该会话的账号可以访问。</InfoTip></p>
          {view.message && view.phase !== 'Running' && <p className="text-sm text-muted-foreground">{view.message}</p>}
        </section> },
        { id: 'model', title: '模型', render: () =>
        <ConfigCard
          icon={Cpu}
          title="模型配置"
          summary={`${view.model || '未配置'}${view.modelProvider ? ` · ${view.modelProvider}` : ''}`}
          disabled={!canWrite}
          onClick={() => setModelOpen(true)}
        />
        },
        { id: 'prompts', title: '提示词', render: () => <div className="space-y-3">
        <ConfigCard
          icon={Brain}
          title="SOUL.md"
          summary={
            detail?.soul !== undefined
              ? `${detail.soul.length} 字符`
              : detail
                ? emptyText
                : loadingText
          }
          disabled={!canWrite}
          onClick={() => setDocKind('soul')}
        />
        <ConfigCard
          icon={Code2}
          title="AGENTS.md"
          summary={
            detail?.agents !== undefined
              ? `${detail.agents.length} 字符`
              : detail
                ? emptyText
                : loadingText
          }
          disabled={!canWrite}
          onClick={() => setDocKind('agents')}
        />
        </div> },
        { id: 'skills', title: '技能', render: () =>
        <ConfigCard
          icon={Tags}
          title="Skills"
          summary={
            skills.length > 0
              ? `${skills.slice(0, 4).join('、')}${skills.length > 4 ? ` +${skills.length - 4}` : ''}`
              : detail
                ? emptyText
                : loadingText
          }
          disabled={!canWrite}
          onClick={() => setSkillsOpen(true)}
        />
        },
        { id: 'mcp', title: 'MCP', render: () =>
        <ConfigCard
          icon={Plug}
          title="MCP Servers"
          summary={
            mcpServers.length > 0
              ? mcpServers.map((server) => server.name).join('、')
              : detail
                ? emptyText
                : loadingText
          }
          disabled={!canWrite}
          onClick={() => setMcpOpen(true)}
        />
        },
        { id: 'env', title: '环境变量', render: () => <div className="space-y-3">
          {!detail?.envEditable && <p role="status" className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">当前 Controller 不支持编辑助手环境变量，请升级 Controller 后再配置。</p>}
          <ConfigCard
          icon={Package}
          title="环境变量"
          summary={
            envKeys.length > 0
              ? `${envKeys.length} 项`
              : detail
                ? detail.envEditable ? '未配置' : emptyText
                : loadingText
          }
          disabled={!canWrite || !detail?.envEditable}
          onClick={() => setEnvOpen(true)}
        />
        </div> },
        { id: 'config', title: '运行参数', render: () =>
        <section className="space-y-2.5 rounded-lg border p-2.5" aria-label="Manager 配置">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="text-xs font-semibold">Manager 配置</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="min-w-0 space-y-1">
              <Label htmlFor="manager-config-heartbeat" className="text-xs">
                心跳间隔
              </Label>
              <Input
                id="manager-config-heartbeat"
                className="font-mono"
                placeholder="15m"
                value={cfg.heartbeatInterval}
                disabled={!canWrite || saving === 'config'}
                onChange={(event) =>
                  setCfg((current) => ({ ...current, heartbeatInterval: event.target.value }))
                }
              />
              <p className="text-xs text-muted-foreground">留空 = 默认 15m</p>
            </div>
            <div className="min-w-0 space-y-1">
              <Label htmlFor="manager-config-idle" className="text-xs">
                Worker 空闲超时
              </Label>
              <Input
                id="manager-config-idle"
                className="font-mono"
                placeholder="720m"
                value={cfg.workerIdleTimeout}
                disabled={!canWrite || saving === 'config'}
                onChange={(event) =>
                  setCfg((current) => ({ ...current, workerIdleTimeout: event.target.value }))
                }
              />
              <p className="text-xs text-muted-foreground">留空 = 默认 720m</p>
            </div>
            <div className="min-w-0 space-y-1">
              <Label htmlFor="manager-config-channel" className="text-xs">
                通知频道
              </Label>
              <Input
                id="manager-config-channel"
                className="font-mono"
                placeholder="admin-dm"
                value={cfg.notifyChannel}
                disabled={!canWrite || saving === 'config'}
                onChange={(event) =>
                  setCfg((current) => ({ ...current, notifyChannel: event.target.value }))
                }
              />
              <p className="text-xs text-muted-foreground">留空 = 默认 admin-dm</p>
            </div>
          </div>
          {canWrite ? (
            <Button
              size="sm"
              className="h-9 text-xs"
              disabled={!cfgDirty || saving === 'config'}
              onClick={() => void handleConfigSave()}
            >
              {saving === 'config' ? '保存中…' : '保存配置'}
            </Button>
          ) : null}
        </section>
        },
        ...(view.runtime === 'qwenpaw' ? [{ id: 'advanced', title: '高级配置', render: () => <QwenpawRuntimeConfigPanel workerName={managerName} memberKind="managers" canWrite={canWrite} onChanged={finishSave} /> }] : []),
        { id: 'logs', title: '日志', render: () => <ManagerLogsCard managerName={managerName} enabled={canWrite} /> },
      ]} />

      {/* 重启确认 */}
      <AlertDialog open={restartOpen} onOpenChange={setRestartOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重启 Manager {managerName}？</AlertDialogTitle>
            <AlertDialogDescription>
              停止并重新启动容器：运行中的进程重新读配置；进行中的任务会被中断。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={acting === 'restart'}>取消</AlertDialogCancel>
            <AlertDialogAction disabled={acting === 'restart'} onClick={() => void handleRestart()}>
              重启
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ManagerModelDialog
        open={modelOpen}
        managerName={managerName}
        model={view.model ?? ''}
        modelProvider={view.modelProvider}
        modelOptions={modelOptions}
        sessionIssue={sessionIssue}
        saving={saving === 'model'}
        onCancel={() => setModelOpen(false)}
        onSubmit={(model, provider) => void handleModelSave(model, provider)}
      />

      {docKind ? (
        <ManagerDocDialog
          open
          kind={docKind}
          initial={(docKind === 'soul' ? detail?.soul : detail?.agents) ?? ''}
          saving={saving === 'doc'}
          onCancel={() => setDocKind(null)}
          onSubmit={(draft) => void handleDocSave(draft)}
        />
      ) : null}

      <ManagerSkillsDialog
        open={skillsOpen}
        managerName={managerName}
        value={skills}
        suggestions={(skillCatalog?.skills ?? []).map((skill) => skill.name)}
        saving={saving === 'skills'}
        onCancel={() => setSkillsOpen(false)}
        onSubmit={(next) => void handleSkillsSave(next)}
      />

      <ManagerMcpDialog
        open={mcpOpen}
        managerName={managerName}
        value={mcpServers}
        saving={saving === 'mcp'}
        onCancel={() => setMcpOpen(false)}
        onSubmit={(servers) => void handleMcpSave(servers)}
      />

      <ManagerEnvDialog
        open={envOpen}
        managerName={managerName}
        value={env}
        saving={saving === 'env'}
        error={actionError}
        onCancel={() => setEnvOpen(false)}
        onSubmit={(next) => void handleEnvSave(next)}
      />
    </div>
  );
}

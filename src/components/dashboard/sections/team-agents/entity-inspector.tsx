'use client';

// 右栏 Inspector（A3）：当前选中实体的「快动作 + 分区入口」。
//
// - 头部：实体名 + 角色徽标（负责人/评审/成员 / Manager / Team）+
//   状态 / 运行时 / 模型 chips（复用 PhaseBadge / RuntimeBadge）；
// - 动作条：与详情面板同一套 mutation 与权限门——
//   Worker = 休眠/唤醒、重启、私聊、删除（仅 L1）；
//   Manager = 休眠/唤醒（L1）、重启（L1）、私聊（沿用 ManagerDetailPanel 动作集）；
//   Team = 删除团队（仅 L1；完整配置仍在详情大弹窗）；
// - 分区按钮列表（行高 ≥44px、右侧箭头）：点击打开详情大弹窗并直达该分区
//   （onOpenSection(tab id)，section 写入 URL ?panel=，见 team-agents-section A4）。
// - 分区按钮下方：常驻只读详情——
//   worker = WorkerDetailSummary（与只读详情弹窗同一实现，禁复制）；
//   team = 头部 TeamStatusSummary（既有只读摘要）；
//   manager = 无现成只读组件，不另造面板（任务书②分支）。
//
// 只发 mutation / 导航，不承载可编辑面板本体——编辑仍是大弹窗里的单一实现。

import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Bot,
  ChevronRight,
  Crown,
  MessageCircle,
  Moon,
  RefreshCw,
  Sun,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { PhaseBadge, RuntimeBadge } from '@/components/dashboard/phase-badge';
import {
  useDeleteTeam,
  useDeleteWorker,
  useSleepWorker,
  useUpdateManager,
  useWakeWorker,
} from '@/hooks/use-agentteams-mutations';
import {
  agentteamsApi,
  type ManagerResponse,
  type TeamResponse,
  type WorkerResponse,
} from '@/lib/agentteams-api';
import { formatErrorMessage } from '@/lib/api-error';
import { hashForSection, roomHash } from '@/lib/nav-hash';
import { toast } from 'sonner';
import type { ManagerDmTarget } from '../managers/manager-drawer-logic';
import { dmTargetFor, isManagerAsleep } from '../managers/manager-drawer-logic';
import { TeamStatusSummary } from '../teams/team-status-summary';
import { WorkerDetailSummary } from '../workers/worker-detail-summary';
import { ROLE_LABELS, memberRole } from './team-agents-logic';

interface SectionEntry {
  /** 分区 panel id（弹窗直达用，写 URL ?panel=；团队侧由弹窗翻译成真实 tab）。 */
  id: string;
  title: string;
}

/** Agent 分区 = WorkerDetailPanel 的 tab（同 id，弹窗可直达）。 */
const WORKER_SECTIONS: SectionEntry[] = [
  { id: 'basic', title: '基础配置' },
  { id: 'mcp', title: 'MCP' },
  { id: 'skills', title: '技能' },
  { id: 'runtime', title: '高级配置' },
  { id: 'workspace-files', title: '工作区文件' },
  { id: 'chats', title: '会话' },
];

/**
 * 团队分区（6 个细粒度 panel id，按钮文字 = 弹窗标题的分区名）：
 * team-detail-dialog 把 panel id 翻译成 TeamSettingsPanel 真实 tab + 分区标题
 * （team-skills → agents；llm / danger → basic；users → users）。
 */
const TEAM_SECTIONS: SectionEntry[] = [
  { id: 'basic', title: '基本信息' },
  { id: 'users', title: '团队成员' },
  { id: 'team-skills', title: '团队技能' },
  { id: 'llm', title: 'LLM 调优' },
  { id: 'agents', title: 'Worker管理' },
  { id: 'danger', title: '危险区' },
];

/** Manager 分区 = ManagerDetailPanel 现有的八个 tab。 */
const MANAGER_SECTIONS: SectionEntry[] = [
  { id: 'basic', title: '基本信息' },
  { id: 'model', title: '模型' },
  { id: 'prompts', title: '提示词' },
  { id: 'skills', title: '技能' },
  { id: 'mcp', title: 'MCP' },
  { id: 'env', title: '环境变量' },
  { id: 'config', title: '运行参数' },
  { id: 'logs', title: '日志' },
];

export type EntityInspectorEntity =
  | { kind: 'worker'; worker: WorkerResponse; homeTeam: TeamResponse | null }
  | { kind: 'team'; team: TeamResponse }
  | { kind: 'manager'; manager: ManagerResponse };

export interface EntityInspectorProps {
  /** 当前选中的已解析实体；null = 占位说明（未选实体）。 */
  entity: EntityInspectorEntity | null;
  /** 全部 Worker 列表：团队状态块的成员健康口径（computeTeamAnalytics）。 */
  workers: WorkerResponse[];
  /** Dashboard 会话等级：3 = 管理员（插件侧 L1）。 */
  userLevel: number;
  /** 打开详情大弹窗并直达分区（panel id 由 section 写入 URL ?panel=）。 */
  onOpenSection: (_panel: string) => void;
  /** 动作成功后刷新列表 / 拓扑数据。 */
  onChanged?: () => void;
  /** 删除成功后（section 清选中 / 关覆盖层 / 关弹窗）。 */
  onDeleted?: () => void;
  /** dual 覆盖层模式：头部显示关闭按钮（Esc 同样关闭，见 section）。 */
  onClose?: () => void;
}

function roleBadgeClass(label: string): string {
  if (label === '负责人') return 'border-primary/40 bg-primary/10 text-primary';
  if (label === '评审') return 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400';
  if (label === 'Manager' || label === 'Team') return 'border-border bg-muted/40 text-muted-foreground';
  return 'border-border bg-muted/40 text-muted-foreground';
}

export function EntityInspector({
  entity,
  workers,
  userLevel,
  onOpenSection,
  onChanged,
  onDeleted,
  onClose,
}: EntityInspectorProps) {
  const sleepWorker = useSleepWorker();
  const wakeWorker = useWakeWorker();
  const deleteWorker = useDeleteWorker();
  const deleteTeam = useDeleteTeam();
  const updateManager = useUpdateManager();
  const [restarting, setRestarting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'worker' | 'team'; name: string } | null>(null);
  const reduceMotion = useReducedMotion();

  if (!entity) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 p-4 text-center">
        <p className="text-sm font-semibold">未选中实体</p>
        <p className="text-xs text-muted-foreground">
          从列表或拓扑中选择一个团队 / Worker / Manager，
          <br />
          这里会显示它的详情与快速操作。
        </p>
      </div>
    );
  }

  const sections =
    entity.kind === 'worker' ? WORKER_SECTIONS : entity.kind === 'team' ? TEAM_SECTIONS : MANAGER_SECTIONS;
  const name =
    entity.kind === 'worker' ? entity.worker.name : entity.kind === 'team' ? entity.team.name : entity.manager.name;
  const entityKey = `${entity.kind}:${name}`;
  const roleLabel =
    entity.kind === 'worker'
      ? ROLE_LABELS[memberRole(entity.worker, entity.homeTeam?.leaderName)]
      : entity.kind === 'team'
        ? 'Team'
        : 'Manager';
  const isManager = entity.kind === 'manager';
  const isTeam = entity.kind === 'team';
  const canWrite = userLevel >= 3;

  const openDm = (dm: ManagerDmTarget | null) => {
    if (!dm) return;
    window.location.hash = dm.roomId ? roomHash(dm.roomId) : hashForSection('chat');
  };

  const handleConfirmDelete = () => {
    if (!deleteTarget) return;
    const { kind, name: targetName } = deleteTarget;
    const options = {
      onSuccess: () => {
        setDeleteTarget(null);
        onDeleted?.();
        onChanged?.();
      },
    };
    if (kind === 'worker') deleteWorker.mutate(targetName, options);
    else deleteTeam.mutate(targetName, options);
  };

  return (
    <motion.div
      key={entityKey}
      initial={reduceMotion ? false : { opacity: 0, y: 2 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.18 }}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      {/* 头部：名 + 角色徽标 + chips + 动作条（sticky，正文独立滚动）。 */}
      <div className="shrink-0 border-b px-3 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Avatar className="size-8 shrink-0">
            <AvatarFallback
              className={
                isManager
                  ? 'rounded-md bg-[var(--action-primary)] text-[var(--action-primary-foreground)]'
                  : 'text-xs'
              }
            >
              {isManager ? (
                <Crown className="size-3.5" aria-hidden="true" />
              ) : isTeam ? (
                <Users className="size-3.5" aria-hidden="true" />
              ) : (
                <Bot className="size-3.5" aria-hidden="true" />
              )}
            </AvatarFallback>
          </Avatar>
          <h3 className="min-w-0 truncate text-sm font-semibold">{name}</h3>
          <Badge variant="outline" className={`shrink-0 text-xs ${roleBadgeClass(roleLabel)}`}>
            {roleLabel}
          </Badge>
          {onClose && (
            <button
              type="button"
              aria-label="关闭 Inspector"
              onClick={onClose}
              className="ml-auto flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
          {entity.kind === 'worker' && (
            <>
              <PhaseBadge kind="worker" phase={entity.worker.phase} />
              <RuntimeBadge runtime={entity.worker.runtime || ''} />
              {entity.worker.model && (
                <span className="max-w-40 truncate font-mono text-muted-foreground" title={entity.worker.model}>
                  {entity.worker.model}
                </span>
              )}
            </>
          )}
          {isTeam && <PhaseBadge kind="team" phase={entity.team.phase} />}
          {isManager && (
            <>
              <PhaseBadge kind="manager" phase={entity.manager.phase} />
              <RuntimeBadge runtime={entity.manager.runtime || ''} />
              {entity.manager.model && (
                <span className="max-w-40 truncate font-mono text-muted-foreground" title={entity.manager.model}>
                  {entity.manager.model}
                </span>
              )}
            </>
          )}
        </div>
        {/* 团队状态块（选中团队时）：与团队设置面板「运行状态与房间信息」同字段同口径。 */}
        {isTeam && (
          <div className="mt-2">
            <TeamStatusSummary team={entity.team} workers={workers} />
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {entity.kind === 'worker' && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                disabled={sleepWorker.isPending || wakeWorker.isPending}
                onClick={() =>
                  entity.worker.phase === 'Sleeping' || entity.worker.phase === 'Stopped'
                    ? wakeWorker.mutate(entity.worker.name)
                    : sleepWorker.mutate(entity.worker.name)
                }
              >
                {entity.worker.phase === 'Sleeping' || entity.worker.phase === 'Stopped' ? (
                  <Sun className="mr-1 size-3.5" aria-hidden="true" />
                ) : (
                  <Moon className="mr-1 size-3.5" aria-hidden="true" />
                )}
                {entity.worker.phase === 'Sleeping' || entity.worker.phase === 'Stopped' ? '唤醒' : '休眠'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                disabled={restarting}
                onClick={async () => {
                  setRestarting(true);
                  try {
                    await agentteamsApi.restartWorker(entity.worker.name);
                    toast.success(`Worker "${entity.worker.name}" 重启中`);
                    onChanged?.();
                  } catch (err) {
                    toast.error(formatErrorMessage(err));
                  } finally {
                    setRestarting(false);
                  }
                }}
              >
                <RefreshCw className={`mr-1 size-3.5 ${restarting ? 'animate-spin' : ''}`} aria-hidden="true" />
                重启
              </Button>
              {dmTargetFor(entity.worker) ? (
                <Button size="sm" variant="outline" className="text-xs" onClick={() => openDm(dmTargetFor(entity.worker))}>
                  <MessageCircle className="mr-1 size-3.5" aria-hidden="true" />
                  私聊
                </Button>
              ) : null}
              {canWrite && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs text-destructive hover:text-destructive"
                  onClick={() => setDeleteTarget({ kind: 'worker', name: entity.worker.name })}
                >
                  <Trash2 className="mr-1 size-3.5" aria-hidden="true" />
                  删除
                </Button>
              )}
            </>
          )}
          {isTeam &&
            (canWrite ? (
              <Button
                size="sm"
                variant="ghost"
                className="text-xs text-destructive hover:text-destructive"
                onClick={() => setDeleteTarget({ kind: 'team', name: entity.team.name })}
              >
                <Trash2 className="mr-1 size-3.5" aria-hidden="true" />
                删除团队
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">删除团队需要管理员（L1）权限</p>
            ))}
          {isManager && (
            <>
              {canWrite && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs"
                  disabled={updateManager.isPending}
                  onClick={() =>
                    updateManager.mutate({
                      name: entity.manager.name,
                      data: { state: isManagerAsleep(entity.manager.state) ? 'Running' : 'Sleeping' },
                    })
                  }
                >
                  {isManagerAsleep(entity.manager.state) ? (
                    <Sun className="mr-1 size-3.5" aria-hidden="true" />
                  ) : (
                    <Moon className="mr-1 size-3.5" aria-hidden="true" />
                  )}
                  {isManagerAsleep(entity.manager.state) ? '唤醒' : '休眠'}
                </Button>
              )}
              {canWrite && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs"
                  disabled={updateManager.isPending}
                  onClick={async () => {
                    try {
                      await agentteamsApi.restartManager(entity.manager.name);
                      toast.success('已发送重启');
                      onChanged?.();
                    } catch (err) {
                      toast.error(formatErrorMessage(err));
                    }
                  }}
                >
                  <RefreshCw className="mr-1 size-3.5" aria-hidden="true" />
                  重启
                </Button>
              )}
              {dmTargetFor(entity.manager) ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs"
                  onClick={() => openDm(dmTargetFor(entity.manager))}
                >
                  <MessageCircle className="mr-1 size-3.5" aria-hidden="true" />
                  私聊
                </Button>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* 分区列表 + 常驻只读详情（独立滚动；只读，可编辑面在分区弹窗）。 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2 custom-scrollbar">
        <p className="px-1.5 pb-1 pt-0.5 text-xs font-semibold text-muted-foreground">详情分区</p>
        <ul className="space-y-0.5" aria-label="详情分区">
          {sections.map((entry, index) => (
            <li key={`${entry.id}-${index}`} className="min-w-0">
              <button
                type="button"
                onClick={() => onOpenSection(entry.id)}
                className="flex min-h-11 w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        {/* worker 常驻只读详情（与 WorkerDetailDialog 正文同一实现）；
            team 的只读摘要在头部（TeamStatusSummary），manager 无现成只读组件。 */}
        {entity.kind === 'worker' && (
          <div className="mt-2 border-t pt-2">
            <p className="px-1.5 pb-1 text-xs font-semibold text-muted-foreground">只读详情</p>
            <WorkerDetailSummary worker={entity.worker} />
          </div>
        )}
      </div>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTarget?.kind === 'worker'
                ? `删除 Worker ${deleteTarget.name}？`
                : `删除团队 ${deleteTarget?.name ?? ''}？`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.kind === 'worker'
                ? '容器与相关配置将被删除，不可恢复。'
                : '团队房间与团队配置将删除；成员 Worker 保留（变为Worker）。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}

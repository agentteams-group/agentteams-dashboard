'use client';

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Brain,
  ChevronRight,
  DoorOpen,
  HardDrive,
  Shield,
  Trash2,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { CopyButton } from '@/components/dashboard/copy-button';
import { PhaseBadge } from '@/components/dashboard/phase-badge';
import { StatusDot } from '@/components/dashboard/status-dot';
import { useDeleteHuman } from '@/hooks/use-agentteams-mutations';
import { agentteamsApi, type HumanConfigRecord, type HumanResponse } from '@/lib/agentteams-api';
import { draftFromHumanRecord } from '@/lib/model-access';
import { formatQuotaValue } from '@/lib/quota-edit';
import { extractWorkspaceAccess } from '@/lib/workspace-access';
import { PERMISSION_BADGE_CLASSES, PERMISSION_LABELS } from './human-types';
import { HumanAccessDialog } from './human-access-dialog';
import { HumanDeleteDialog } from './human-delete-dialog';
import { HumanModelAccessDialog } from './human-model-access-dialog';
import { HumanQuotaDialog } from './human-quota-dialog';
import { HumanWorkspaceAccessDialog } from './human-workspace-access-dialog';

function CardButton({
  icon,
  title,
  subtitle,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-11 w-full cursor-pointer items-start gap-2.5 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block break-words text-xs text-muted-foreground">{subtitle}</span>
      </span>
      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 break-all text-right text-xs">{children}</span>
    </div>
  );
}

export function HumanDrawer({
  human,
  teams,
  workers,
  teamsLoading,
  teamsError,
  teamsErrorMessage,
  onRetryTeams,
  userLevel,
  onOpenChange,
  onDeleted,
}: {
  human: HumanResponse | null;
  teams: { name: string; humanMembers?: string[] }[];
  workers: { name: string }[];
  teamsLoading?: boolean;
  teamsError?: boolean;
  teamsErrorMessage?: string;
  onRetryTeams?: () => void;
  userLevel: number;
  onOpenChange: (_open: boolean) => void;
  onDeleted?: () => void;
}) {
  if (!human) return null;
  return (
    <HumanDrawerContent
      human={human}
      teams={teams}
      workers={workers}
      teamsLoading={teamsLoading}
      teamsError={teamsError}
      teamsErrorMessage={teamsErrorMessage}
      onRetryTeams={onRetryTeams}
      userLevel={userLevel}
      onOpenChange={onOpenChange}
      onDeleted={onDeleted}
    />
  );
}

function HumanDrawerContent({
  human,
  teams,
  workers,
  teamsLoading,
  teamsError,
  teamsErrorMessage,
  onRetryTeams,
  userLevel,
  onOpenChange,
  onDeleted,
}: {
  human: HumanResponse;
  teams: { name: string; humanMembers?: string[] }[];
  workers: { name: string }[];
  teamsLoading?: boolean;
  teamsError?: boolean;
  teamsErrorMessage?: string;
  onRetryTeams?: () => void;
  userLevel: number;
  onOpenChange: (_open: boolean) => void;
  onDeleted?: () => void;
}) {
  const queryClient = useQueryClient();
  const deleteHuman = useDeleteHuman();
  const canManage = userLevel >= 3;

  const [accessOpen, setAccessOpen] = useState(false);
  const [quotaOpen, setQuotaOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const configQuery = useQuery({
    queryKey: ['agentteams-human-config', human.name],
    queryFn: () => agentteamsApi.getHumanConfig(human.name),
    retry: false,
    gcTime: 0,
  });
  const quotaQuery = useQuery({
    queryKey: ['agentteams-human-quota', human.name],
    queryFn: () => agentteamsApi.getHumanQuota(human.name),
    retry: false,
    gcTime: 0,
  });

  const record: HumanConfigRecord | null = configQuery.data ?? human;
  const teamNames = teams.map((team) => team.name);
  const workerNames = workers.map((worker) => worker.name);
  const defaultTeams = useMemo(() => {
    const membership = teams
      .filter((team) => (team.humanMembers ?? []).includes(human.name))
      .map((team) => team.name);
    return [...new Set([...(record?.accessibleTeams ?? []), ...membership])];
  }, [teams, record?.accessibleTeams, human.name]);

  const level = record?.permissionLevel ?? 2;
  const accessibleTeams = record?.accessibleTeams ?? [];
  const accessibleWorkers = record?.accessibleWorkers ?? [];
  const modelScopes = draftFromHumanRecord(record).scopes;
  const workspaceAccess = extractWorkspaceAccess(record);
  const grants = workspaceAccess?.grants?.length ?? 0;
  const restrictions = workspaceAccess?.restrictions?.length ?? 0;

  const configReady = !!configQuery.data;
  const configFailed = configQuery.isError;
  const openConfigDialog = (open: () => void) => {
    if (configFailed) {
      void configQuery.refetch();
      return;
    }
    if (!configReady) return;
    open();
  };

  const quota = quotaQuery.data;
  const quotaSubtitle = quotaQuery.isError
    ? '配额读取失败（点开重试）'
    : quotaQuery.isLoading
      ? '读取中…'
      : quota
        ? quota.quotaBytes !== null
          ? `已用 ${formatQuotaValue(quota.usedBytes)} / 上限 ${formatQuotaValue(quota.quotaBytes)}`
          : `无限制 · 已用 ${formatQuotaValue(quota.usedBytes)}`
        : '未读取';

  const refreshConfig = () => {
    void queryClient.invalidateQueries({ queryKey: ['agentteams-human-config', human.name] });
  };

  const handleDelete = () => {
    deleteHuman.mutate(human.name, {
      onSuccess: () => {
        setDeleteOpen(false);
        onOpenChange(false);
        onDeleted?.();
      },
    });
  };

  return (
    <>
      <Sheet open onOpenChange={(next) => onOpenChange(next)}>
        <SheetContent side="right" className="w-full gap-0 overflow-x-hidden p-0 sm:max-w-[480px]">
          <SheetHeader className="border-b pr-12">
            <div className="flex items-start gap-2.5">
              <Avatar className="size-9 shrink-0">
                <AvatarFallback className="text-sm">
                  {human.name.slice(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <SheetTitle className="flex flex-wrap items-center gap-1.5 text-base">
                  <span>编辑人员</span>
                  <Badge variant="outline" className={`text-xs ${PERMISSION_BADGE_CLASSES[level] || ''}`}>
                    {PERMISSION_LABELS[level] || `L${level}`}
                  </Badge>
                </SheetTitle>
                <SheetDescription className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="min-w-0 truncate font-medium text-foreground">{human.name}</span>
                  <StatusDot phase={human.phase} />
                  <PhaseBadge kind="human" phase={human.phase} />
                  <span className="min-w-0 break-all font-mono">{human.matrixUserID || '无 Matrix 用户'}</span>
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-4 py-4">
            <section className="space-y-1.5 rounded-lg border p-3" aria-label="基本信息">
              <InfoRow label="显示名称">{human.displayName || '-'}</InfoRow>
              <InfoRow label="邮箱">{human.email || '-'}</InfoRow>
              <InfoRow label="备注">{human.note || '-'}</InfoRow>
              <InfoRow label="房间">{human.rooms?.length ?? 0} 个</InfoRow>
              {human.initialPassword && (
                <InfoRow label="初始密码">
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <span className="truncate font-mono">{human.initialPassword}</span>
                    <CopyButton text={human.initialPassword} />
                  </span>
                </InfoRow>
              )}
            </section>

            {!canManage && (
              <p role="status" className="rounded-md border border-status-waiting/30 bg-status-waiting/5 p-2 text-xs text-status-waiting">
                只读（403）：配置人员需要 L1 管理员（Controller 管理员 token）。
              </p>
            )}

            <div className="space-y-2">
              <CardButton
                icon={<Shield className="h-4 w-4" aria-hidden="true" />}
                title="访问与权限"
                subtitle={`L${level} · 团队 ${accessibleTeams.length} · Worker ${accessibleWorkers.length}`}
                disabled={!canManage}
                onClick={() => setAccessOpen(true)}
              />
              <CardButton
                icon={<HardDrive className="h-4 w-4" aria-hidden="true" />}
                title="工作区容量配额"
                subtitle={quotaSubtitle}
                onClick={() => {
                  if (quotaQuery.isError) void quotaQuery.refetch();
                  setQuotaOpen(true);
                }}
              />
              <CardButton
                icon={<Brain className="h-4 w-4" aria-hidden="true" />}
                title="模型授权"
                subtitle={
                  configFailed
                    ? '读取失败（点开重试）'
                    : configQuery.isLoading
                      ? '读取中…'
                      : modelScopes.length
                        ? `${modelScopes.length} 个作用域`
                        : '未配置（fail-closed）'
                }
                disabled={!canManage}
                onClick={() => openConfigDialog(() => setModelOpen(true))}
              />
              <CardButton
                icon={<DoorOpen className="h-4 w-4" aria-hidden="true" />}
                title="工作区访问"
                subtitle={
                  configFailed
                    ? '读取失败（点开重试）'
                    : configQuery.isLoading
                      ? '读取中…'
                      : grants || restrictions
                        ? `授予 ${grants} 条 · 限制 ${restrictions} 条`
                        : '未配置（继承默认）'
                }
                disabled={!canManage}
                onClick={() => openConfigDialog(() => setWorkspaceOpen(true))}
              />
            </div>

            <section className="space-y-2 rounded-lg border border-destructive/30 p-3" aria-label="危险区">
              <p className="text-xs font-semibold text-destructive">危险区</p>
              <Button
                variant="outline"
                className="min-h-11 w-full justify-start text-destructive hover:text-destructive"
                disabled={!canManage}
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                删除人员
              </Button>
              <p className="text-xs text-muted-foreground">
                删除 Human CR：Matrix 账号停用并离开全部房间；文件区保留。不可撤销。
              </p>
            </section>
          </div>
        </SheetContent>
      </Sheet>

      {accessOpen && (
        <HumanAccessDialog
          open
          human={human}
          record={record}
          teamNames={teamNames}
          workerNames={workerNames}
          teamsLoading={teamsLoading}
          teamsError={teamsError}
          teamsErrorMessage={teamsErrorMessage}
          onRetryTeams={onRetryTeams}
          canManage={canManage}
          onOpenChange={(next) => !next && setAccessOpen(false)}
          onSaved={refreshConfig}
        />
      )}
      {quotaOpen && (
        <HumanQuotaDialog
          open
          humanName={human.name}
          quota={quota ?? null}
          canManage={canManage}
          onOpenChange={(next) => !next && setQuotaOpen(false)}
          onSaved={() => void quotaQuery.refetch()}
        />
      )}
      {modelOpen && (
        <HumanModelAccessDialog
          open
          humanName={human.name}
          record={record}
          canManage={canManage}
          onOpenChange={(next) => !next && setModelOpen(false)}
          onSaved={refreshConfig}
        />
      )}
      {workspaceOpen && (
        <HumanWorkspaceAccessDialog
          open
          humanName={human.name}
          record={record}
          teamNames={teamNames}
          defaultTeams={defaultTeams}
          teamsLoading={teamsLoading}
          teamsError={teamsError}
          teamsErrorMessage={teamsErrorMessage}
          onRetryTeams={onRetryTeams}
          canManage={canManage}
          onOpenChange={(next) => !next && setWorkspaceOpen(false)}
          onSaved={refreshConfig}
        />
      )}
      {deleteOpen && (
        <HumanDeleteDialog
          open
          humanName={human.name}
          isPending={deleteHuman.isPending}
          onOpenChange={(next) => !next && setDeleteOpen(false)}
          onConfirm={handleDelete}
        />
      )}
    </>
  );
}

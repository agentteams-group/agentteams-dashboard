'use client';

// 团队设置面板（无 Sheet / 无 Dialog 的 body）——「团队与Agent」页内联详情与
// TeamDrawer 共用的唯一实现（F7 单一数据源）。对齐工作台插件「配置团队」
// 四分区 + 千锻 + 加入未归属 Worker + 危险区。
//
// 保存边界（与插件一致）：
//   · 基本信息（含 心跳间隔 / 子代理默认模型）+ 团队 LLM 调优 = 同一次
//     PUT /teams（字段级 diff；心跳/子代理留空 = null 清空）；
//   · 团队成员 = PUT /teams（workerMembers 全量替换）+ 只对改动行
//     PUT /workers {model, modelProvider?}；
//   · 团队技能 / 分配矩阵 / MCP = 各自独立保存（PUT /workers）。
//
// 删除团队带 6 秒撤销（插件 doDeleteTeam 语义）：先快照（含
// workerMembers / heartbeatEvery / peerMentions / subagentModel），
// 删除成功后 toast.warning + 「撤销（按快照重建）」= createTeam。

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Loader2,
  Puzzle,
  SlidersHorizontal,
  Trash2,
  UserCog,
  UserPlus,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { CopyButton } from '@/components/dashboard/copy-button';
import { PhaseBadge } from '@/components/dashboard/phase-badge';
import { StatusDot } from '@/components/dashboard/status-dot';
import { LlmTuningFields } from '@/components/dashboard/sections/workers/llm-tuning-fields';
import { useCreateTeam, useDeleteTeam, useUpdateTeam } from '@/hooks/use-agentteams-mutations';
import type { TeamResponse, WorkerResponse } from '@/lib/agentteams-api';
import { formatErrorMessage } from '@/lib/api-error';
import {
  findLlmTuningError,
  pickLlmTuning,
  type LlmTuningKey,
  type LlmTuningRecord,
} from '@/lib/llm-tuning';
import type { ModelSelectionOption } from '@/lib/model-catalog';
import { computeTeamAnalytics } from '@/lib/team-analytics';
import { toast } from 'sonner';

import { TeamMembersPanel } from './team-members-panel';
import { TeamSkillsPanel } from './team-skills-panel';
import {
  buildBasicDraft,
  buildBasicUpdate,
  standaloneWorkers,
  type TeamBasicDraft,
} from './team-drawer-logic';

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 text-xs">{children}</span>
    </div>
  );
}

function SettingsSection({
  title,
  icon: Icon,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  icon: typeof Users;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-lg border">
      <div className="flex min-w-0 items-center gap-1 pr-1.5">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={onToggle}
          className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2 p-2.5 text-left text-xs font-semibold hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate">{title}</span>
          <ChevronDown
            className={`ml-auto size-3.5 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>
      </div>
      {expanded && <div className="min-w-0 border-t p-2.5">{children}</div>}
    </section>
  );
}

export type TeamSettingsPanelProps = {
  team: TeamResponse;
  /** 全部团队（判定未归属 Worker 的引用集）。 */
  allTeams?: TeamResponse[];
  workers: WorkerResponse[];
  modelOptions: ModelSelectionOption[];
  sessionIssue?: string | null;
  userLevel: number;
  onChanged?: () => void;
  /** 删除成功后回调（抽屉 = 关抽屉；内联页 = 清选中回落）。 */
  onDeleted?: () => void;
};

/**
 * 面板根：标题栏（名称 + 阶段 + 保存）+ 可滚动分区体。
 * 调用方必须按 team.name key 重挂载，保证「切队重建草稿、同队草稿不丢」。
 */
export function TeamSettingsPanel({
  team,
  allTeams,
  workers,
  modelOptions,
  sessionIssue,
  userLevel,
  onChanged,
  onDeleted,
}: TeamSettingsPanelProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['basic', 'members']));
  const [basic, setBasic] = useState<TeamBasicDraft>(() => buildBasicDraft(team));
  const [llm, setLlm] = useState<LlmTuningRecord>(() => pickLlmTuning(team));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);

  const updateTeam = useUpdateTeam();
  const deleteTeam = useDeleteTeam();
  const createTeam = useCreateTeam();

  const analytics = useMemo(() => computeTeamAnalytics(team, workers), [team, workers]);
  const standalone = useMemo(() => standaloneWorkers(allTeams, workers), [allTeams, workers]);
  const showPeerMentions = typeof team.peerMentions === 'boolean';
  const llmError = findLlmTuningError(llm);

  const toggle = (id: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSaveBasic = async () => {
    if (saving) return;
    if (llmError) {
      setError(`${llmError.label}：${llmError.message}`);
      return;
    }
    const data = buildBasicUpdate(team, basic, llm);
    if (Object.keys(data).length === 0) {
      toast.info('没有需要保存的改动');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateTeam.mutateAsync({ name: team.name, data });
      // 上游 PUT 的静默忽略（空描述 / 未接收 workerIdleTimeout）如实提示。
      const nextNotices: string[] = [];
      if (data.description !== undefined && (updated?.description ?? '') !== data.description) {
        nextNotices.push('描述未生效：上游 PUT 忽略空描述（清空需另行处理）');
      }
      if (
        data.workerIdleTimeout !== undefined &&
        (updated?.workerIdleTimeout ?? '').trim() !== (data.workerIdleTimeout ?? '').trim()
      ) {
        nextNotices.push(
          '空闲超时未确认：后端未回显该字段（controller v1.2.x 的团队 PUT 尚未接收 workerIdleTimeout）',
        );
      }
      if (data.teamName && (updated?.teamName ?? '') !== data.teamName) {
        nextNotices.push('团队名称未生效：请检查后端返回');
      }
      setNotices(nextNotices);
      setLlm(pickLlmTuning(updated ?? team));
      onChanged?.();
    } catch (err) {
      setError(formatErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleJoin = async (worker: WorkerResponse) => {
    if (joining) return;
    // 与插件 doAddWorker 同语义：已是现有成员 → info，不发起 PUT。
    if (
      team.leaderName === worker.name ||
      (team.workerNames ?? []).includes(worker.name)
    ) {
      toast.info('该 Worker 已是团队现有成员');
      return;
    }
    setJoining(worker.name);
    try {
      const workerNames = [...new Set([...(team.workerNames ?? []), worker.name])];
      await updateTeam.mutateAsync({
        name: team.name,
        data: { workerNames, leader: team.leaderName ? { name: team.leaderName } : null },
      });
      onChanged?.();
    } catch (err) {
      toast.error(formatErrorMessage(err));
    } finally {
      setJoining(null);
    }
  };

  const handleDelete = async () => {
    if (confirmName.trim() !== team.name || deleting) return;
    setDeleting(true);
    // 删除前快照（插件 doDeleteTeam）：撤销 = 按快照 createTeam 重建。
    const snapshot = {
      name: team.name,
      ...(team.teamName ? { teamName: team.teamName } : {}),
      ...(team.description ? { description: team.description } : {}),
      ...(team.leaderName ? { leader: { name: team.leaderName } } : {}),
      workerNames: (team.workerNames ?? []).filter(Boolean),
      ...(team.heartbeatEvery ? { heartbeatEvery: team.heartbeatEvery } : {}),
      ...(typeof team.peerMentions === 'boolean' ? { peerMentions: team.peerMentions } : {}),
      ...(team.subagentModel ? { subagentModel: team.subagentModel } : {}),
    };
    try {
      await deleteTeam.mutateAsync(team.name);
      setDeleteOpen(false);
      onDeleted?.();
      toast.warning(`团队 ${team.name} 已删除（房间历史与容器状态不随之恢复）`, {
        duration: 6000,
        action: {
          label: '撤销（按快照重建）',
          onClick: () => {
            createTeam.mutate(snapshot, {
              onSuccess: () => {
                toast.success(`团队 ${team.name} 已按快照重建`);
                onChanged?.();
              },
              onError: (err) => {
                toast.error(`重建失败：${formatErrorMessage(err)}`);
              },
            });
          },
        },
      });
    } catch (err) {
      toast.error(formatErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      data-slot="team-drawer-body"
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden"
    >
      {/* 标题栏：名称 + 阶段 + 保存（C2：保存随面板标题，对齐插件 PaneHeader） */}
      <div className="flex shrink-0 items-center gap-1.5 border-b px-3 py-2">
        <Users className="size-4 shrink-0 text-status-done" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{team.name}</span>
        <PhaseBadge kind="team" phase={team.phase} className="shrink-0" />
        <Button
          size="sm"
          className="min-h-11 shrink-0 text-xs sm:min-h-9"
          data-testid="basic-save"
          disabled={saving}
          onClick={() => void handleSaveBasic()}
        >
          {saving ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="size-3.5" aria-hidden="true" />
          )}
          保存
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-2.5 overflow-x-hidden overflow-y-auto px-3 py-3">
        {/* 1. 基本信息 */}
        <SettingsSection
          title="基本信息"
          icon={Users}
          expanded={expanded.has('basic')}
          onToggle={() => toggle('basic')}
        >
          <div className="space-y-2">
            <div className="space-y-1 rounded-md bg-muted/20 p-2">
              <SummaryRow label="阶段">
                <span className="flex items-center gap-1.5">
                  <StatusDot phase={team.phase} />
                  <PhaseBadge kind="team" phase={team.phase} />
                </span>
              </SummaryRow>
              {team.phase === 'Failed' && team.message ? <SummaryRow label="失败原因"><span className="break-words text-destructive">{team.message}</span></SummaryRow> : null}
              <SummaryRow label="Leader">
                <span className="font-mono">{team.leaderName || '-'}</span>
              </SummaryRow>
              <SummaryRow label="Workers">
                <span>
                  {team.readyWorkers}/{team.totalWorkers} 就绪
                </span>
              </SummaryRow>
              <SummaryRow label="团队房间">
                {team.teamRoomID ? (
                  <span className="flex min-w-0 items-center gap-1">
                    <span className="truncate font-mono">{team.teamRoomID}</span>
                    <CopyButton text={team.teamRoomID} />
                  </span>
                ) : (
                  '-'
                )}
              </SummaryRow>
              <SummaryRow label="Leader DM">
                {team.leaderDMRoomID ? (
                  <span className="flex min-w-0 items-center gap-1">
                    <span className="truncate font-mono">{team.leaderDMRoomID}</span>
                    <CopyButton text={team.leaderDMRoomID} />
                  </span>
                ) : (
                  '-'
                )}
              </SummaryRow>
              <SummaryRow label="健康度">
                <span className="flex flex-wrap items-center gap-1.5">
                  <Badge
                    variant={analytics.trend === 'critical' ? 'destructive' : analytics.trend === 'healthy' ? 'secondary' : 'outline'}
                    className="text-xs"
                  >
                    {analytics.label}
                  </Badge>
                  <span className="text-muted-foreground">
                    就绪率 {analytics.readinessPct}% · 成员健康 {analytics.healthScore}
                  </span>
                </span>
              </SummaryRow>
            </div>

            <div className="space-y-1">
              <Label htmlFor="team-drawer-team-name" className="text-xs">
                团队名称
              </Label>
              <Input
                id="team-drawer-team-name"
                className="min-h-11 text-xs sm:min-h-9"
                value={basic.teamName}
                placeholder="显示名称"
                onChange={(event) => setBasic({ ...basic, teamName: event.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="team-drawer-description" className="text-xs">
                描述
              </Label>
              <Textarea
                id="team-drawer-description"
                className="min-h-16 text-xs"
                rows={2}
                value={basic.description}
                placeholder="团队描述"
                onChange={(event) => setBasic({ ...basic, description: event.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="team-drawer-idle-timeout" className="text-xs">
                空闲超时（workerIdleTimeout，如 720m）
              </Label>
              <Input
                id="team-drawer-idle-timeout"
                className="min-h-11 text-xs sm:min-h-9"
                value={basic.workerIdleTimeout}
                placeholder="720m"
                onChange={(event) =>
                  setBasic({ ...basic, workerIdleTimeout: event.target.value })
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="team-drawer-heartbeat" className="text-xs">
                心跳间隔（heartbeatEvery，如 10m）
              </Label>
              <Input
                id="team-drawer-heartbeat"
                className="min-h-11 text-xs sm:min-h-9"
                value={basic.heartbeatEvery}
                placeholder="如 10m（留空 = 清空）"
                onChange={(event) =>
                  setBasic({ ...basic, heartbeatEvery: event.target.value })
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="team-drawer-subagent-model" className="text-xs">
                子代理默认模型（subagentModel）
              </Label>
              <Input
                id="team-drawer-subagent-model"
                className="min-h-11 text-xs sm:min-h-9"
                value={basic.subagentModel}
                placeholder="留空 = 继承各 Worker 主模型"
                onChange={(event) =>
                  setBasic({ ...basic, subagentModel: event.target.value })
                }
              />
            </div>
            {showPeerMentions && (
              <div className="flex min-h-11 items-center gap-2">
                <Switch
                  id="team-drawer-peer-mentions"
                  checked={basic.peerMentions ?? false}
                  onCheckedChange={(checked) => setBasic({ ...basic, peerMentions: checked })}
                />
                <Label htmlFor="team-drawer-peer-mentions" className="text-xs">
                  peerMentions（团队成员可互 @）
                </Label>
              </div>
            )}
            {notices.length > 0 && (
              <div role="status" className="space-y-1 rounded-md border border-status-waiting/30 bg-status-waiting/10 p-2">
                {notices.map((notice) => (
                  <p key={notice} className="text-xs text-status-waiting">
                    {notice}
                  </p>
                ))}
              </div>
            )}
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>
        </SettingsSection>

        {/* 2. LLM 调优（团队级默认，随基本信息保存） */}
        <SettingsSection
          title="LLM 调优"
          icon={SlidersHorizontal}
          expanded={expanded.has('llm')}
          onToggle={() => toggle('llm')}
        >
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              团队级默认：成员 Worker 未单独设置时继承。留空 = 不设置；保存随团队 PUT。
            </p>
            <LlmTuningFields
              values={llm}
              onChange={(key: LlmTuningKey, value: string) =>
                setLlm((previous) => ({ ...previous, [key]: value }))
              }
              disabled={saving}
              idPrefix="team-drawer-llm"
            />
            {llmError && (
              <p className="text-xs text-destructive">
                {llmError.label}：{llmError.message}
              </p>
            )}
          </div>
        </SettingsSection>

        {/* 3. 团队成员 */}
        <SettingsSection
          title="团队成员"
          icon={UserCog}
          expanded={expanded.has('members')}
          onToggle={() => toggle('members')}
        >
          <TeamMembersPanel
            team={team}
            workers={workers}
            modelOptions={modelOptions}
            sessionIssue={sessionIssue}
            onChanged={onChanged}
          />
        </SettingsSection>

        {/* 4. 团队技能（默认收起） */}
        <SettingsSection
          title="团队技能"
          icon={Puzzle}
          expanded={expanded.has('skills')}
          onToggle={() => toggle('skills')}
        >
          <TeamSkillsPanel team={team} workers={workers} onChanged={onChanged} />
        </SettingsSection>

        {/* 5. 千锻入口只在「团队与Agent」拓扑头部（对齐插件 TeamSection）。 */}

        {/* 6. 加入未归属 Worker */}
        <SettingsSection
          title="加入未归属 Worker"
          icon={UserPlus}
          expanded={expanded.has('standalone')}
          onToggle={() => toggle('standalone')}
        >
          <div className="space-y-2">
            {standalone.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                没有未归属任何团队的 Worker。
              </p>
            ) : (
              <div className="space-y-1.5">
                {standalone.map((worker) => (
                  <div
                    key={worker.name}
                    className="flex min-w-0 items-center gap-2 rounded-lg border p-2"
                  >
                    <StatusDot phase={worker.phase} />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">
                      {worker.name}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11 shrink-0 text-xs sm:min-h-9"
                      disabled={joining !== null}
                      onClick={() => void handleJoin(worker)}
                    >
                      {joining === worker.name ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <UserPlus className="size-3.5" aria-hidden="true" />
                      )}
                      加入本团队
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              一键加入 = PUT 合并进当前团队成员（保留原有成员，角色 = worker）。
            </p>
          </div>
        </SettingsSection>

        {/* 7. 危险区 */}
        <SettingsSection
          title="危险区"
          icon={AlertTriangle}
          expanded={expanded.has('danger')}
          onToggle={() => toggle('danger')}
        >
          <div className="space-y-2">
            {userLevel >= 3 ? (
              <>
                <Button
                  variant="destructive"
                  className="min-h-11 text-xs"
                  data-testid="danger-delete"
                  onClick={() => {
                    setConfirmName('');
                    setDeleteOpen(true);
                  }}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  删除团队
                </Button>
                <p className="text-xs text-muted-foreground">
                  成员 Worker 保留（变为未归属）；团队房间与团队配置删除后不可恢复。
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                删除团队需要管理员（L1）权限。
              </p>
            )}
          </div>
        </SettingsSection>
      </div>

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) setConfirmName('');
        }}
      >
        <DialogContent className="max-w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除团队 {team.name}</DialogTitle>
            <DialogDescription>
              团队房间与团队配置将删除；成员 Worker 保留（变为未归属）。请核对团队名后确认。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label htmlFor="team-delete-confirm" className="text-xs">
              输入团队名以确认
            </Label>
            <Input
              id="team-delete-confirm"
              className="min-h-11 text-xs sm:min-h-9"
              value={confirmName}
              placeholder={team.name}
              onChange={(event) => setConfirmName(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="min-h-11 sm:min-h-9"
              onClick={() => setDeleteOpen(false)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              className="min-h-11 sm:min-h-9"
              data-testid="danger-delete-confirm"
              disabled={confirmName.trim() !== team.name || deleting}
              onClick={() => void handleDelete()}
            >
              {deleting ? '删除中…' : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

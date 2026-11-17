'use client';

// 团队设置面板（无 Sheet / 无 Dialog 的 body）——「团队与Agent」页内联详情与
// TeamDrawer 共用的唯一实现（F7 单一数据源）。对齐工作台插件「配置团队」
// 基本信息 / 成员管理 / Agent 管理三个标签页。
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

import { useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Loader2,
  Puzzle,
  SlidersHorizontal,
  Trash2,
  Users,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useHumans } from '@/hooks/use-agentteams-humans';
import { CopyButton } from '@/components/dashboard/copy-button';
import { PhaseBadge } from '@/components/dashboard/phase-badge';
import { LlmTuningFields } from '@/components/dashboard/sections/workers/llm-tuning-fields';
import { useCreateTeam, useDeleteTeam, useUpdateTeam } from '@/hooks/use-agentteams-mutations';
import { teamHumanMembers, type TeamResponse, type WorkerResponse } from '@/lib/agentteams-api';
import { formatErrorMessage } from '@/lib/api-error';
import {
  findLlmTuningError,
  pickLlmTuning,
  type LlmTuningKey,
  type LlmTuningRecord,
} from '@/lib/llm-tuning';
import type { ModelSelectionOption } from '@/lib/model-catalog';
import { toast } from 'sonner';

import { TeamMembersPanel } from './team-members-panel';
import { TeamUsersPanel } from './team-users-panel';
import { TeamSkillsPanel } from './team-skills-panel';
import { TeamStatusSummary } from './team-status-summary';
import {
  buildBasicDraft,
  buildBasicUpdate,
  type TeamBasicDraft,
} from './team-drawer-logic';

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
  /** 全部团队（判定独立 Agent 的引用集）。 */
  allTeams?: TeamResponse[];
  workers: WorkerResponse[];
  /** 初始 tab（默认 'basic'，行为不变）；仅接受 basic/users/agents（A3 Inspector 分区直达）。 */
  initialTab?: string;
  /**
   * 渲染模式：'full'（默认，行为不变）= 标题栏 + 横向 tab 列表；
   * 'section' = 分区直出（详情弹窗场景）：隐藏标题栏图标 / 团队名 / 阶段
   * 徽标与横向 tab 列表，仅渲染 initialTab 命中的分区（内容区自滚）；
   * initialTab 缺失或无效时回退 'full'（避免空白弹窗）。
   */
  chrome?: 'full' | 'section';
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
  workers,
  modelOptions,
  sessionIssue,
  userLevel,
  onChanged,
  onDeleted,
  initialTab,
  chrome = 'full',
}: TeamSettingsPanelProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const initialTabValid = initialTab !== undefined && ['basic', 'users', 'agents'].includes(initialTab) ? initialTab : 'basic';
  // 'section' 模式（详情弹窗）：initialTab 必须命中分区，否则回退 'full'（避免空白弹窗）。
  const sectionMode = chrome === 'section';
  const [tab, setTab] = useState(initialTabValid);
  const [visitedTabs, setVisitedTabs] = useState(() => new Set([initialTabValid]));
  const { data: humans = [] } = useHumans();
  const humanNames = new Set([
    ...teamHumanMembers(team).map((member) => member.name),
    ...humans.filter((human) => human.accessibleTeams?.includes(team.name)).map((human) => human.name),
    ...(team.admin?.name ? [team.admin.name] : []),
  ]);
  const agentCount = new Set([...(team.workerNames ?? []), ...(team.leaderName ? [team.leaderName] : [])]).size;
  const [basic, setBasic] = useState<TeamBasicDraft>(() => buildBasicDraft(team));
  const [llm, setLlm] = useState<LlmTuningRecord>(() => pickLlmTuning(team));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);

  const updateTeam = useUpdateTeam();
  const deleteTeam = useDeleteTeam();
  const createTeam = useCreateTeam();

  const failureSummary = /matrix/i.test(team.message) && /connection refused|ECONNREFUSED/i.test(team.message)
    ? '暂时无法连接对话服务，请检查服务状态。'
    : '展开技术详情，查看具体失败原因。';
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
    <div data-slot="team-drawer-body" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden">
      {/* section 模式下标题栏只保留基本信息分区的保存按钮（功能控件，非 chrome）。 */}
      {(!sectionMode || tab === 'basic') && (
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
          {!sectionMode && <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
          {!sectionMode && <span className="min-w-0 flex-1 truncate text-sm font-medium">{team.name}</span>}
          {!sectionMode && <PhaseBadge kind="team" phase={team.phase} className="shrink-0" />}
          {tab === 'basic' && <Button size="sm" data-testid="basic-save" disabled={saving} onClick={() => void handleSaveBasic()}>
            {saving ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Check className="size-3.5" aria-hidden="true" />}
            保存基本信息
          </Button>}
        </div>
      )}

      <Tabs value={tab} onValueChange={(next) => {
        setTab(next);
        setVisitedTabs((previous) => new Set([...previous, next]));
      }} className="min-h-0 flex-1 gap-0">
        {!sectionMode && (
          <div className="shrink-0 border-b px-4 py-3">
            <TabsList aria-label="团队编辑" className="grid h-10 w-full max-w-lg grid-cols-3">
              <TabsTrigger value="basic">基本信息</TabsTrigger>
              <TabsTrigger value="users">成员管理 <span className="text-xs text-muted-foreground">{humanNames.size}</span></TabsTrigger>
              <TabsTrigger value="agents">Agent 管理 <span className="text-xs text-muted-foreground">{agentCount}</span></TabsTrigger>
            </TabsList>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {(!sectionMode || tab === 'basic') && (
          <TabsContent value="basic" forceMount hidden={tab !== 'basic'} className="m-0 space-y-5">
            {team.phase === 'Failed' && team.message ? (
              <Alert className="min-w-0 border-destructive/20 bg-destructive/5 px-3 py-2.5 text-destructive">
                <AlertTriangle aria-hidden="true" />
                <AlertTitle className="text-xs">团队暂未就绪</AlertTitle>
                <AlertDescription className="min-w-0 w-full gap-2 text-xs">
                  <p>{failureSummary}</p>
                  <details className="w-full min-w-0 border-t border-destructive/10 pt-2">
                    <summary className="cursor-pointer rounded-sm text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">技术详情</summary>
                    <div className="mt-2 flex min-w-0 items-start gap-2 rounded-md border bg-background/80 p-2">
                      <pre className="max-h-32 min-w-0 flex-1 overflow-y-auto font-mono text-xs leading-5 break-all whitespace-pre-wrap">{team.message}</pre>
                      <CopyButton text={team.message} label="复制失败详情" className="shrink-0" />
                    </div>
                  </details>
                </AlertDescription>
              </Alert>
            ) : null}

            <dl className="grid grid-cols-1 gap-x-8 gap-y-5 rounded-xl border bg-muted/20 p-4 sm:grid-cols-2">
              <div className="space-y-1"><dt className="text-xs text-muted-foreground">团队 Admin</dt><dd className="text-sm">{humans.find((human) => human.name === team.admin?.name)?.displayName || team.admin?.name || '未设置'}</dd></div>
              <div className="space-y-1"><dt className="text-xs text-muted-foreground">Leader Agent</dt><dd className="break-all text-sm">{team.leaderName || '未设置'}</dd></div>
              <div className="space-y-1"><dt className="text-xs text-muted-foreground">成员数</dt><dd className="text-sm">{humanNames.size}</dd></div>
              <div className="space-y-1"><dt className="text-xs text-muted-foreground">Agent 数</dt><dd className="text-sm">{agentCount}</dd></div>
            </dl>
            <div className="space-y-4">
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
            <SettingsSection title="高级设置" icon={SlidersHorizontal} expanded={expanded.has('advanced')} onToggle={() => toggle('advanced')}>
              <div className="space-y-4">
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

              <div className="border-t pt-4">
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
              </div>
              </div>
            </SettingsSection>
            <SettingsSection title="运行状态与房间信息" icon={Users} expanded={expanded.has('status')} onToggle={() => toggle('status')}>
              <TeamStatusSummary team={team} workers={workers} />
            </SettingsSection>
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
                  成员 Worker 保留（变为独立 Agent）；团队房间与团队配置删除后不可恢复。
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                删除团队需要管理员（L1）权限。
              </p>
            )}
          </div>
        </SettingsSection>
          </TabsContent>
          )}

          {visitedTabs.has('users') && <TabsContent value="users" forceMount hidden={tab !== 'users'} className="m-0 space-y-4">
            <div><h3 className="text-sm font-medium">成员管理</h3><p className="mt-1 text-xs text-muted-foreground">设置团队管理员，添加成员并调整角色。</p></div>
            {userLevel >= 3 ? <TeamUsersPanel team={team} onChanged={onChanged} /> : <p className="text-sm text-muted-foreground">需要管理员权限才能编辑团队成员。</p>}
          </TabsContent>}

          {visitedTabs.has('agents') && <TabsContent value="agents" forceMount hidden={tab !== 'agents'} className="m-0 space-y-5">
            <div><h3 className="text-sm font-medium">Agent 管理</h3><p className="mt-1 text-xs text-muted-foreground">查看 Leader 和 Worker，添加或移除 Agent，并调整模型。</p></div>
            <TeamMembersPanel team={team} workers={workers} modelOptions={modelOptions} sessionIssue={sessionIssue} onChanged={onChanged} />
        <SettingsSection
          title="团队技能"
          icon={Puzzle}
          expanded={expanded.has('skills')}
          onToggle={() => toggle('skills')}
        >
          <TeamSkillsPanel team={team} workers={workers} onChanged={onChanged} />
        </SettingsSection>
          </TabsContent>}
        </div>
      </Tabs>

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
              团队房间与团队配置将删除；成员 Worker 保留（变为独立 Agent）。请核对团队名后确认。
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

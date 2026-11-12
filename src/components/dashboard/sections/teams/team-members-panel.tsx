'use client';

// 团队成员分区（团队设置抽屉 B3）：Leader + Worker 行、批量模型画笔、
// 添加/移除成员。保存 = 团队 PUT（workerMembers 全量替换）+ 只对改动的行
// 逐条 PUT /workers 写模型——行内「改模型」走统一 WorkerModelDialog（直写）。
// 缺失/悬空引用红标并禁止提交（Controller 侧会 400，界面先拦）。

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Check,
  Crown,
  Loader2,
  Plus,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { WorkerModelDialog } from '@/components/dashboard/sections/workers/worker-model-dialog';
import { workerPickerLabel } from '@/components/dashboard/sections/shared/member-picker';
import { useUpdateTeam, useUpdateWorker } from '@/hooks/use-agentteams-mutations';
import { formatErrorMessage } from '@/lib/api-error';
import type { TeamResponse, WorkerResponse } from '@/lib/agentteams-api';
import type { ModelSelectionOption } from '@/lib/model-catalog';
import { getAvailableWorkers } from './team-selectors';
import {
  applyBatchModel,
  buildMemberUpdate,
  buildMemberRows,
  changedMemberModels,
  missingMemberNames,
  type TeamMemberRow,
} from './team-drawer-logic';

const ROLE_LABEL: Record<TeamMemberRow['role'], string> = {
  team_leader: 'Leader',
  worker: '成员',
};

const BATCH_EMPTY = '未设置（留空 = 不刷）';

/** 批量画笔摘要：provider + model；未选择时提示留空语义。 */
function batchSummary(batch: { provider: string; model: string }): string {
  if (!batch.model) return BATCH_EMPTY;
  return batch.provider ? `${batch.provider} · ${batch.model}` : batch.model;
}

export function TeamMembersPanel({
  team,
  workers,
  modelOptions,
  sessionIssue,
  onChanged,
}: {
  team: TeamResponse;
  workers: WorkerResponse[];
  modelOptions: ModelSelectionOption[];
  sessionIssue?: string | null;
  onChanged?: () => void;
}) {
  const [rows, setRows] = useState<TeamMemberRow[]>(() => buildMemberRows(team, workers));
  const [leaderBatch, setLeaderBatch] = useState({ provider: '', model: '' });
  const [workerBatch, setWorkerBatch] = useState({ provider: '', model: '' });
  const [batchDialog, setBatchDialog] = useState<null | 'team_leader' | 'worker'>(null);
  const [modelTarget, setModelTarget] = useState<TeamMemberRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const updateTeam = useUpdateTeam();
  const updateWorker = useUpdateWorker();

  const missing = missingMemberNames(rows);
  const hasLeader = rows.some((row) => row.role === 'team_leader');
  const modelChanges = changedMemberModels(rows);
  const memberNames = useMemo(() => rows.map((row) => row.name), [rows]);
  const addOptions = useMemo(
    () => (hasLeader ? getAvailableWorkers(workers, team.name, memberNames) : []),
    [hasLeader, memberNames, team.name, workers],
  );

  const currentNames = new Set(memberNames);
  const currentLeader = rows.find((row) => row.role === 'team_leader')?.name ?? '';
  const memberChanged =
    currentLeader !== (team.leaderName || '') ||
    (team.workerNames ?? []).some((name) => !currentNames.has(name)) ||
    [...currentNames].some(
      (name) => name !== currentLeader && !(team.workerNames ?? []).includes(name),
    );
  const dirty = memberChanged || modelChanges.length > 0;
  const blocked = missing.length > 0 || !hasLeader;
  const leaderCount = rows.filter((row) => row.role === 'team_leader').length;
  const workerCount = rows.filter((row) => row.role === 'worker').length;
  const leaderSummary = batchSummary(leaderBatch);
  const workerSummary = batchSummary(workerBatch);

  const addMember = (name: string) => {
    const worker = workers.find((item) => item.name === name);
    if (!worker) return;
    setRows((previous) => [
      ...previous,
      {
        name,
        role: 'worker',
        model: worker.model || '',
        provider: worker.modelProvider ?? '',
        baseModel: worker.model || '',
        baseProvider: worker.modelProvider,
        missing: false,
      },
    ]);
    setError(null);
  };

  const removeMember = (name: string) => {
    setRows((previous) => previous.filter((row) => !(row.role === 'worker' && row.name === name)));
    setError(null);
  };

  const handleSave = async () => {
    if (blocked || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { leader, workerNames } = buildMemberUpdate(rows);
      // 成员集合没变时不要重复 PUT 团队（例如只批量改了模型）。
      if (memberChanged) {
        await updateTeam.mutateAsync({ name: team.name, data: { workerNames, leader } });
      }
      // 成员变更成功后再逐行写模型：只发改动行，失败行单独报错。
      // modelProvider 只在行 provider 真变化且非空时携带（未改 = 保持现值）。
      for (const change of modelChanges) {
        await updateWorker.mutateAsync({
          name: change.name,
          data: {
            model: change.model,
            ...(change.modelProvider ? { modelProvider: change.modelProvider } : {}),
          },
        });
      }
      setRows((previous) =>
        previous.map((row) => ({
          ...row,
          baseModel: row.model,
          baseProvider: row.provider.trim() || row.baseProvider,
        })),
      );
      onChanged?.();
    } catch (err) {
      setError(formatErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  // 批量弹窗保存：只刷本地草稿（团队保存时才逐行 PUT）；model 留空 = 清空该批选择。
  const applyBatchSelection = async (
    role: 'team_leader' | 'worker',
    selection: { provider: string; model: string },
  ) => {
    const model = selection.model.trim();
    const provider = selection.provider.trim();
    if (!model) {
      if (role === 'team_leader') setLeaderBatch({ provider: '', model: '' });
      else setWorkerBatch({ provider: '', model: '' });
      return;
    }
    if (role === 'team_leader') setLeaderBatch({ provider, model });
    else setWorkerBatch({ provider, model });
    setRows((previous) => applyBatchModel(previous, role, model, provider));
  };

  return (
    <div className="space-y-3">
      {/* 批量模型画笔：Leader 批 / Workers 批，选中即刷到该角色全部行 */}
      <div className="rounded-lg border bg-muted/20 p-2.5">
        <p className="text-xs font-semibold text-muted-foreground">
          批量设置模型（选中值刷到对应角色全部成员；留空 = 不改）
        </p>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0 space-y-1" data-testid="batch-leader">
            <Label className="text-xs">Leader 批（{leaderCount} 人）</Label>
            <div className="flex min-w-0 items-center gap-2">
              <div
                className="min-w-0 flex-1 truncate rounded-md border bg-background px-2 py-1.5 font-mono text-xs text-muted-foreground"
                title={leaderSummary}
              >
                {leaderSummary}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 shrink-0 text-xs sm:min-h-9"
                onClick={() => setBatchDialog('team_leader')}
              >
                <SlidersHorizontal className="size-3.5" aria-hidden="true" />
                设置模型
              </Button>
            </div>
          </div>
          <div className="min-w-0 space-y-1" data-testid="batch-workers">
            <Label className="text-xs">Workers 批（{workerCount} 人）</Label>
            <div className="flex min-w-0 items-center gap-2">
              <div
                className="min-w-0 flex-1 truncate rounded-md border bg-background px-2 py-1.5 font-mono text-xs text-muted-foreground"
                title={workerSummary}
              >
                {workerSummary}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 shrink-0 text-xs sm:min-h-9"
                onClick={() => setBatchDialog('worker')}
              >
                <SlidersHorizontal className="size-3.5" aria-hidden="true" />
                设置模型
              </Button>
            </div>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground break-words">
          画笔语义：选中值立即同步到对应行的「模型」（行内仍可再精修，覆盖刷值）；调整角色/新增行不会自动补刷——对那一批重新选一次即可。Provider
          与模型成对刷写；留空=不改。
        </p>
        {sessionIssue ? (
          <p className="mt-2 text-xs text-amber-600 break-words">
            模型别名组暂不可用：{sessionIssue}。内置模型与自定义输入仍可使用。
          </p>
        ) : null}
      </div>

      {/* 成员行 */}
      <div className="space-y-1.5">
        {rows.map((row) => {
          const changed = row.model.trim() && row.model.trim() !== row.baseModel.trim();
          return (
            <div
              key={`${row.role}-${row.name}`}
              data-testid={`member-${row.name}`}
              className={`min-w-0 space-y-1 rounded-lg border p-2 ${
                row.missing ? 'border-red-400 bg-red-500/10' : ''
              }`}
            >
              {/* 第一行：图标 + 姓名（占满剩余空间）+ 角色 + 改模型。
                  姓名 flex-1 truncate，按钮 shrink-0，不再被 flex-wrap 挤成单字。 */}
              <div className="flex min-w-0 items-center gap-2">
                {row.role === 'team_leader' ? (
                  <Crown className="size-3.5 shrink-0 text-purple-500" aria-hidden="true" />
                ) : (
                  <Bot className="size-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1 truncate text-xs font-medium" title={row.name}>
                  {row.name}
                </span>
                <Badge variant="outline" className="shrink-0 text-xs">
                  {ROLE_LABEL[row.role]}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 shrink-0 text-xs sm:min-h-9"
                  disabled={row.missing}
                  onClick={() => setModelTarget(row)}
                >
                  改模型
                </Button>
              </div>
              {/* 第二行：模型 + 状态徽标 + 移除（仅 Worker）。 */}
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
                  title={row.model || '未设置模型'}
                >
                  {row.model || '未设置模型'}
                </span>
                {changed && (
                  <Badge variant="secondary" className="shrink-0 text-xs text-amber-600 dark:text-amber-400">
                    待保存
                  </Badge>
                )}
                {row.missing && (
                  <Badge variant="destructive" className="shrink-0 text-xs">
                    不存在
                  </Badge>
                )}
                {row.role === 'worker' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-11 shrink-0 px-2 text-xs text-muted-foreground sm:min-h-9"
                    onClick={() => removeMember(row.name)}
                    aria-label={`移除 ${row.name}`}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                    移除
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 添加成员：只从已有 Worker 选 */}
      <div className="space-y-1">
        <Label className="text-xs">添加成员（仅已有 Worker）</Label>
        {addOptions.length > 0 ? (
          // key 按成员数重挂载：选完立刻回到占位符（与 MemberPicker 同款手法）。
          <Select key={rows.length} onValueChange={addMember}>
            <SelectTrigger className="min-h-11 w-full sm:min-h-9" aria-label="添加成员">
              <SelectValue placeholder="选择 Worker 添加…" />
            </SelectTrigger>
            <SelectContent>
              {addOptions.map((worker) => (
                <SelectItem key={worker.name} value={worker.name}>
                  {workerPickerLabel(worker.name, worker.model)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Plus className="size-3.5" aria-hidden="true" />
            没有可添加的未归属 Worker
          </p>
        )}
      </div>

      {missing.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            以下 Worker 不存在：{missing.join('、')}——请先移除，团队配置不能引用不存在的 Worker。
          </span>
        </p>
      )}
      {!hasLeader && (
        <p className="text-xs text-red-600 dark:text-red-400">
          团队缺少 Leader（workerMembers 必须恰好包含一个 team_leader），无法保存。
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="min-h-11 sm:min-h-9"
          data-testid="members-save"
          disabled={!dirty || blocked || saving}
          onClick={() => void handleSave()}
        >
          {saving ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="size-3.5" aria-hidden="true" />
          )}
          保存成员
        </Button>
        <span className="text-xs text-muted-foreground">
          {modelChanges.length > 0
            ? `将更新 ${modelChanges.length} 个成员模型（只发改动行）`
            : '保存 = 全量替换成员列表'}
        </span>
      </div>

      <WorkerModelDialog
        open={!!modelTarget}
        workerName={modelTarget?.name ?? ''}
        model={modelTarget?.model ?? ''}
        modelProvider={modelTarget?.provider || modelTarget?.baseProvider || ''}
        modelOptions={modelOptions}
        sessionIssue={sessionIssue}
        onOpenChange={(open) => !open && setModelTarget(null)}
        onSaved={({ model, provider }) => {
          const next = model.trim();
          const target = modelTarget?.name;
          if (target && next) {
            setRows((previous) =>
              previous.map((row) =>
                row.name === target
                  ? {
                      ...row,
                      model: next,
                      baseModel: next,
                      provider,
                      baseProvider: provider || row.baseProvider,
                    }
                  : row,
              ),
            );
          }
          setModelTarget(null);
          onChanged?.();
        }}
      />

      {/* 批量画笔复用同一个模型弹窗（唯一一套 ModelPicker），保存只刷本地 rows。 */}
      <WorkerModelDialog
        open={batchDialog === 'team_leader'}
        title="批量设置模型 - Leader 批"
        workerName="Leader 批"
        model={leaderBatch.model}
        modelProvider={leaderBatch.provider}
        modelOptions={modelOptions}
        sessionIssue={sessionIssue}
        onOpenChange={(open) => !open && setBatchDialog(null)}
        onSave={(selection) => applyBatchSelection('team_leader', selection)}
      />
      <WorkerModelDialog
        open={batchDialog === 'worker'}
        title="批量设置模型 - Workers 批"
        workerName="Workers 批"
        model={workerBatch.model}
        modelProvider={workerBatch.provider}
        modelOptions={modelOptions}
        sessionIssue={sessionIssue}
        onOpenChange={(open) => !open && setBatchDialog(null)}
        onSave={(selection) => applyBatchSelection('worker', selection)}
      />
    </div>
  );
}

'use client';

// 团队成员分区（团队设置抽屉 B3）：Leader + Worker 行、批量模型画笔、
// 添加/移除成员。保存 = 团队 PUT（workerMembers 全量替换）+ 只对改动的行
// 逐条 PUT /workers 写模型——行内「改模型」走统一 WorkerModelDialog（直写）。
// 缺失/悬空引用红标并禁止提交（Controller 侧会 400，界面先拦）。

import { useMemo, useState } from 'react';
import { AlertTriangle, Bot, Check, Crown, Loader2, Plus, X } from 'lucide-react';
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
import { ModelSelector } from '@/components/dashboard/sections/shared/model-selector';
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
  const [leaderBatch, setLeaderBatch] = useState('');
  const [workerBatch, setWorkerBatch] = useState('');
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

  const addMember = (name: string) => {
    const worker = workers.find((item) => item.name === name);
    if (!worker) return;
    setRows((previous) => [
      ...previous,
      { name, role: 'worker', model: worker.model || '', baseModel: worker.model || '', missing: false },
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
      for (const change of modelChanges) {
        await updateWorker.mutateAsync({ name: change.name, data: { model: change.model } });
      }
      setRows((previous) => previous.map((row) => ({ ...row, baseModel: row.model })));
      onChanged?.();
    } catch (err) {
      setError(formatErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* 批量模型画笔：Leader 批 / Workers 批，选中即刷到该角色全部行 */}
      <div className="rounded-lg border bg-muted/20 p-2.5">
        <p className="text-xs font-semibold text-muted-foreground">
          批量设置模型（选中值刷到对应角色全部成员；留空 = 不改）
        </p>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0 space-y-1">
            <Label className="text-xs">
              Leader 批（{rows.filter((row) => row.role === 'team_leader').length} 人）
            </Label>
            <div className="min-w-0" data-testid="batch-leader">
              <ModelSelector
                value={leaderBatch}
                onChange={(next) => {
                  setLeaderBatch(next);
                  setRows((previous) => applyBatchModel(previous, 'team_leader', next));
                }}
                placeholder="Leader 批模型"
                options={modelOptions}
                sessionIssue={sessionIssue}
              />
            </div>
          </div>
          <div className="min-w-0 space-y-1">
            <Label className="text-xs">
              Workers 批（{rows.filter((row) => row.role === 'worker').length} 人）
            </Label>
            <div className="min-w-0" data-testid="batch-workers">
              <ModelSelector
                value={workerBatch}
                onChange={(next) => {
                  setWorkerBatch(next);
                  setRows((previous) => applyBatchModel(previous, 'worker', next));
                }}
                placeholder="Workers 批模型"
                options={modelOptions}
                sessionIssue={sessionIssue}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 成员行 */}
      <div className="space-y-1.5">
        {rows.map((row) => {
          const changed = row.model.trim() && row.model.trim() !== row.baseModel.trim();
          return (
            <div
              key={`${row.role}-${row.name}`}
              data-testid={`member-${row.name}`}
              className={`flex min-w-0 flex-wrap items-center gap-2 rounded-lg border p-2 ${
                row.missing ? 'border-red-400 bg-red-500/10' : ''
              }`}
            >
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
              <span
                className="max-w-[45%] shrink-0 truncate font-mono text-xs text-muted-foreground"
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
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 shrink-0 text-xs sm:min-h-9"
                disabled={row.missing}
                onClick={() => setModelTarget(row)}
              >
                改模型
              </Button>
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
        modelOptions={modelOptions}
        sessionIssue={sessionIssue}
        onOpenChange={(open) => !open && setModelTarget(null)}
        onSaved={(model) => {
          const next = (model ?? '').trim();
          const target = modelTarget?.name;
          if (target && next) {
            setRows((previous) =>
              previous.map((row) =>
                row.name === target ? { ...row, model: next, baseModel: next } : row,
              ),
            );
          }
          setModelTarget(null);
          onChanged?.();
        }}
      />
    </div>
  );
}

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
  worker: 'Worker',
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
  const leaderOptions = workers.filter((worker) => memberNames.includes(worker.name) || !worker.team);
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

  const selectLeader = (name: string) => {
    const worker = workers.find((item) => item.name === name);
    if (!worker) return;
    setRows((previous) => {
      const existing = previous.find((row) => row.name === name);
      const leader: TeamMemberRow = existing ? { ...existing, role: 'team_leader' } : {
        name, role: 'team_leader', model: worker.model || '', provider: worker.modelProvider ?? '',
        baseModel: worker.model || '', baseProvider: worker.modelProvider, missing: false,
      };
      return [leader, ...previous.filter((row) => row.name !== name).map((row): TeamMemberRow => ({ ...row, role: 'worker' }))];
    });
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
      <div className="space-y-1.5">
        <Label>Leader Agent</Label>
        <Select value={currentLeader} onValueChange={selectLeader} disabled={saving}>
          <SelectTrigger className="w-full sm:max-w-md" aria-label="Leader Agent"><SelectValue placeholder="选择已有 Agent 作为 Leader…" /></SelectTrigger>
          <SelectContent>
            {currentLeader && !leaderOptions.some((worker) => worker.name === currentLeader) && <SelectItem value={currentLeader} disabled>{currentLeader}（不存在）</SelectItem>}
            {leaderOptions.map((worker) => <SelectItem key={worker.name} value={worker.name}>{worker.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">更换 Leader 后，原 Leader 保留为 Worker。</p>
      </div>
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full table-fixed text-left text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr><th className="p-3 font-medium">Agent</th><th className="w-20 p-3 font-medium">角色</th><th className="hidden p-3 font-medium sm:table-cell">模型</th><th className="w-32 p-3 font-medium">操作</th></tr>
          </thead>
          <tbody>{rows.map((row) => {
            const changed = row.model.trim() && row.model.trim() !== row.baseModel.trim();
            return <tr key={row.name} data-testid={`member-${row.name}`} className={`border-t ${row.missing ? 'bg-destructive/5' : ''}`}>
              <td className="p-3">
                <div className="flex min-w-0 items-center gap-2">
                  {row.role === 'team_leader' ? <Crown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> : <Bot className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
                  <span className="truncate font-medium" title={row.name}>{row.name}</span>
                </div>
                <p className="mt-1 truncate text-muted-foreground sm:hidden" title={row.model}>{row.model || '未设置模型'}</p>
                {row.missing && <Badge variant="destructive" className="mt-1 text-xs">不存在</Badge>}
              </td>
              <td className="p-3"><Badge variant="outline" className="text-xs">{ROLE_LABEL[row.role]}</Badge></td>
              <td className="hidden min-w-0 p-3 sm:table-cell"><p className="truncate font-mono text-muted-foreground" title={row.model}>{row.model || '未设置模型'}</p>{changed && <span className="text-amber-600">待保存</span>}</td>
              <td className="p-2"><div className="flex flex-wrap gap-1">
                <Button variant="ghost" size="sm" className="px-2 text-xs" disabled={row.missing} onClick={() => setModelTarget(row)}>改模型</Button>
                {row.role === 'worker' && <Button variant="ghost" size="sm" className="px-2 text-xs text-muted-foreground" onClick={() => removeMember(row.name)} aria-label={`移除 ${row.name}`}><X className="size-3" aria-hidden="true" />移除</Button>}
              </div></td>
            </tr>;
          })}</tbody>
        </table>
      </div>

      {/* 添加成员：只从已有 Worker 选 */}
      <div className="space-y-1">
        <Label className="text-xs">添加 Agent</Label>
        {addOptions.length > 0 ? (
          // key 按成员数重挂载：选完立刻回到占位符（与 MemberPicker 同款手法）。
          <Select key={rows.length} onValueChange={addMember}>
            <SelectTrigger className="min-h-11 w-full sm:min-h-9" aria-label="添加 Agent">
              <SelectValue placeholder="选择已有 Agent…" />
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
            没有可添加的 Agent
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

      <details className="rounded-lg border p-3">
        <summary className="cursor-pointer text-sm">批量设置模型</summary>
      <div className="mt-3 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground">
          为 Leader 或 Worker 批量选择模型
        </p>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0 space-y-1" data-testid="batch-leader">
            <Label className="text-xs">Leader（{leaderCount}）</Label>
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
            <Label className="text-xs">Worker（{workerCount}）</Label>
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
          选择后应用到对应 Agent，也可逐个调整。点击「保存 Agent」后生效。
        </p>
        {sessionIssue ? (
          <p className="mt-2 text-xs text-amber-600 break-words">
            模型别名组暂不可用：{sessionIssue}。内置模型与自定义输入仍可使用。
          </p>
        ) : null}
      </div>

      </details>

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
          保存 Agent
        </Button>
        <span className="text-xs text-muted-foreground">
          {modelChanges.length > 0
            ? `将更新 ${modelChanges.length} 个 Agent 的模型`
            : '保存后应用 Agent 变更'}
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

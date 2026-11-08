'use client';

// 千锻注入面板——注入模式（更新已选 Worker / 新建 Worker 并注入）+ mapping
// 逐角色选现有 worker / create_workers 行（name/role/model）+ apply soul 开关
// + 注入按钮；结果表逐 worker 状态（souls/created 逐项 + partial），覆盖前
// 的 SOUL 冲突须显式确认。写入 Worker CR（Controller PUT/POST /workers）。

import { AlertTriangle, CheckCircle2, Loader2, MinusCircle, XCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { MillforgeInjectEntry, WorkerResponse } from '@/lib/agentteams-api';
import type { MillforgeInjectMode } from './use-millforge-core';
import type { MillforgeCore } from './use-millforge-core';

const MODES: { value: MillforgeInjectMode; label: string }[] = [
  { value: 'mapping', label: '更新已选 Worker' },
  { value: 'create', label: '新建 Worker 并注入' },
];

function StatusCell({ entry }: { entry: MillforgeInjectEntry }) {
  if (entry.status === 'unchanged') {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <MinusCircle className="size-3" aria-hidden="true" />
        无变化（已跳过）
      </span>
    );
  }
  if (entry.status === 'ok') {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-3" aria-hidden="true" />
        成功{entry.verified ? '（读回验证）' : ''}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-destructive">
      <XCircle className="size-3" aria-hidden="true" />
      失败
    </span>
  );
}

const MODE_LABELS: Record<string, string> = {
  overwrite: '覆盖',
  unchanged: '跳过',
  rollback: '回滚',
  apply: '写入',
};

export function MillforgeInjectPanel({
  core,
  workers,
  teamName,
  modelAliases = [],
}: {
  core: MillforgeCore;
  workers: WorkerResponse[];
  teamName: string;
  /** 新建 Worker 行的模型候选（与 Worker 模型编辑同源；空 = 纯自由输入）。 */
  modelAliases?: readonly string[];
}) {
  const {
    build,
    injectMode,
    setInjectMode,
    mapping,
    setMapping,
    createRows,
    setCreateRows,
    applySoul,
    setApplySoul,
    injecting,
    injectError,
    injectResult,
    doInject,
    soulConflicts,
    confirmSoulOverwrite,
    cancelSoulOverwrite,
    rollbackSoul,
  } = core;

  if (!build) return null;
  const budgetAllOk = build.roles.every((role) => role.budget_ok);
  const workerOptions = workers.map((worker) => ({
    value: worker.name,
    label: `${worker.name}（${worker.role || 'worker'}${worker.team ? ` · ${worker.team}` : ''}）`,
  }));

  const resultRows = injectResult
    ? [
        ...injectResult.souls.map((entry) => ({ kind: '更新 SOUL', target: entry.worker || '—', entry })),
        ...injectResult.created.map((entry) => ({ kind: '新建 Worker', target: entry.name || '—', entry })),
      ]
    : [];

  return (
    <div className="space-y-2">
      <div className="inline-flex overflow-hidden rounded-md border" role="group" aria-label="注入模式">
        {MODES.map((mode) => (
          <button
            key={mode.value}
            type="button"
            aria-pressed={injectMode === mode.value}
            onClick={() => setInjectMode(mode.value)}
            className={`min-h-9 px-2.5 text-xs ${
              injectMode === mode.value ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
            }`}
          >
            {mode.label}
          </button>
        ))}
      </div>

      {injectMode === 'mapping' ? (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground">
            逐角色选现有 Worker（mapping）
          </p>
          {build.roles.map((role) => (
            <div
              key={role.role}
              className="flex items-center gap-2"
              data-testid={`millforge-mapping-${role.role}`}
            >
              <span className="w-28 shrink-0 truncate font-mono text-xs">
                {role.role}
                <span className="text-muted-foreground">（{role.kind}）</span>
              </span>
              <Select
                value={mapping[role.role] || undefined}
                onValueChange={(value) => setMapping({ ...mapping, [role.role]: value })}
              >
                <SelectTrigger
                  className="h-8 min-w-0 flex-1 text-xs"
                  aria-label={`角色 ${role.role} 的 Worker`}
                >
                  <SelectValue placeholder="选择现有 Worker（不选 = 该角色不注入）" />
                </SelectTrigger>
                <SelectContent>
                  {workerOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value} className="text-xs">
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground">
            新建 Worker 行（create_workers：name/role/model）
          </p>
          {createRows.map((row) => (
            <div key={row.key} className="space-y-1 rounded-md border border-dashed p-1.5">
              <p className="text-xs text-muted-foreground">
                角色：<span className="font-mono">{row.role_id}</span>
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <Input
                  aria-label={`Worker 名（${row.role_id}）`}
                  className="h-8 min-w-0 flex-[1_1_140px] text-xs"
                  placeholder={`Worker 名（${teamName || 'team'}-${row.role_id}）`}
                  value={row.name}
                  onChange={(event) =>
                    setCreateRows((previous) =>
                      previous.map((item) =>
                        item.key === row.key ? { ...item, name: event.target.value } : item,
                      ),
                    )
                  }
                />
                <Select
                  value={row.role}
                  onValueChange={(value) =>
                    setCreateRows((previous) =>
                      previous.map((item) =>
                        item.key === row.key
                          ? { ...item, role: value as 'team_leader' | 'worker' }
                          : item,
                      ),
                    )
                  }
                >
                  <SelectTrigger className="h-8 w-32 text-xs" aria-label={`角色类型（${row.role_id}）`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="team_leader" className="text-xs">
                      team_leader
                    </SelectItem>
                    <SelectItem value="worker" className="text-xs">
                      worker
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Combobox
                  ariaLabel={`模型（${row.role_id}）`}
                  className="min-w-0 flex-[1_1_140px]"
                  inputClassName="text-xs"
                  placeholder="模型（可选，留空跟随集群默认）"
                  value={row.model}
                  options={modelAliases}
                  onChange={(model) =>
                    setCreateRows((previous) =>
                      previous.map((item) =>
                        item.key === row.key ? { ...item, model } : item,
                      ),
                    )
                  }
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex min-h-9 items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            className="size-3.5"
            checked={applySoul}
            onChange={(event) => setApplySoul(event.target.checked)}
          />
          写入 SOUL（mapping/新建行）
        </label>
        <span className="text-xs text-muted-foreground">
          core 技能已由 TeamHarness 提供（AgentTeams 1.2.6+），注入只写 SOUL
        </span>
      </div>

      {!budgetAllOk ? (
        <Alert className="py-2">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertDescription className="text-xs">
            预算未全绿——后端将拒绝注入（回模板层减片段或提预算走人审）。
          </AlertDescription>
        </Alert>
      ) : null}

      <Button
        size="sm"
        className="h-10 min-h-10"
        data-testid="millforge-inject"
        disabled={!budgetAllOk || !teamName || injecting}
        onClick={() => void doInject(teamName)}
      >
        {injecting ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : null}
        注入到「{teamName || '—'}」
      </Button>

      {injectError ? (
        <Alert variant="destructive">
          <XCircle className="size-4" aria-hidden="true" />
          <AlertTitle>注入失败</AlertTitle>
          <AlertDescription className="break-all font-mono text-xs">
            {injectError}
          </AlertDescription>
        </Alert>
      ) : null}

      {injectResult ? (
        <div className="space-y-1">
          <p className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
            {injectResult.partial ? (
              <>
                <AlertTriangle className="size-3 text-amber-500" aria-hidden="true" />
                注入结果（部分失败）
              </>
            ) : (
              '注入结果（全部成功）'
            )}
            {injectResult.partial ? (
              <Badge variant="outline" className="text-xs">
                partial
              </Badge>
            ) : null}
          </p>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="h-8 text-xs">Worker</TableHead>
                  <TableHead className="h-8 text-xs">角色</TableHead>
                  <TableHead className="h-8 text-xs">动作</TableHead>
                  <TableHead className="h-8 text-xs">状态</TableHead>
                  <TableHead className="h-8 text-xs">方式</TableHead>
                  <TableHead className="h-8 text-xs">错误</TableHead>
                  <TableHead className="h-8 text-xs">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resultRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-xs text-muted-foreground">
                      —
                    </TableCell>
                  </TableRow>
                ) : (
                  resultRows.map((row) => (
                    <TableRow key={`${row.entry.role_id}:${row.target}`}>
                      <TableCell className="max-w-40 truncate py-1 text-xs">{row.target}</TableCell>
                      <TableCell className="py-1 font-mono text-xs">{row.entry.role_id}</TableCell>
                      <TableCell className="py-1 text-xs">{row.kind}</TableCell>
                      <TableCell className="py-1 text-xs">
                        <StatusCell entry={row.entry} />
                      </TableCell>
                      <TableCell className="py-1 text-xs">
                        {MODE_LABELS[row.entry.mode || ''] || '—'}
                      </TableCell>
                      <TableCell className="max-w-56 py-1 text-xs break-all">
                        {row.entry.error ? (
                          <span className="font-mono text-destructive">{row.entry.error}</span>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="py-1">
                        {row.entry.prev_sha256 && row.entry.mode === 'overwrite' ? (
                          <Button
                            variant="link"
                            size="sm"
                            className="h-6 p-0 text-xs"
                            onClick={async () => {
                              const ok = await rollbackSoul(row.target);
                              if (ok) {
                                // 回滚成功即刷新历史（后端已记录 rollback）。
                                void core.loadInjections();
                              }
                            }}
                          >
                            回滚
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            core 技能：
            {injectResult.core_skill.status === 'ok' ? (
              <span className="text-emerald-600 dark:text-emerald-400">
                成功
                {injectResult.core_skill.assigned?.length
                  ? `（已挂接：${injectResult.core_skill.assigned.join('、')}）`
                  : ''}
              </span>
            ) : injectResult.core_skill.status === 'skipped' ? (
              <span>跳过</span>
            ) : (
              <span className="text-amber-600 dark:text-amber-400">部分失败</span>
            )}
            {injectResult.core_skill.detail ? ` — ${injectResult.core_skill.detail}` : ''}
          </p>
        </div>
      ) : null}

      <AlertDialog
        open={!!soulConflicts}
        onOpenChange={(open) => {
          if (!open) cancelSoulOverwrite();
        }}
      >
        <AlertDialogContent className="max-h-[80vh] max-w-[95vw] overflow-y-auto sm:max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>现有 SOUL 将被覆盖</AlertDialogTitle>
            <AlertDialogDescription>
              以下 Worker 已有内容不同的 SOUL。确认后将整体覆盖（覆盖前会留底，可在结果里回滚）。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1 text-xs">
            {(soulConflicts || []).map((target) => (
              <div key={target.worker} className="rounded-md border p-2">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{target.worker}</span>
                  <Badge variant="outline" className="text-xs">
                    {target.role_id}
                  </Badge>
                  <span className="text-muted-foreground">
                    现有来源：
                    {target.prev_provenance?.millforge
                      ? `千锻 ${String(target.prev_provenance.build || target.prev_provenance.instance_fp || '').slice(0, 10)}`
                      : '手工/未知'}
                  </span>
                  <span className="text-muted-foreground">长度 {target.prev_len ?? '—'}</span>
                </p>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {target.prev_head || '—'}
                </p>
              </div>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelSoulOverwrite}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void confirmSoulOverwrite()}
            >
              覆盖并注入
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

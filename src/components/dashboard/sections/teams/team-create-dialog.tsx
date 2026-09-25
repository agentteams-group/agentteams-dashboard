'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { CreateTeamRequest, WorkerResponse, WorkerRuntime } from '@/lib/agentteams-api';
import { agentteamsApi } from '@/lib/agentteams-api';
import { workerNameError } from '@/lib/resource-name';
import type { ModelSelectionOption } from '@/lib/model-catalog';
import { ModelSelector } from '@/components/dashboard/sections/shared/model-selector';
import { SoulField } from '@/components/dashboard/sections/shared/soul-field';
import {
  MemberPicker,
  workerPickerLabel,
} from '@/components/dashboard/sections/shared/member-picker';
import { CREATABLE_WORKER_RUNTIMES, rejectCopawCreate } from '@/lib/runtime-options';

export function parseWorkerNames(value: string): string[] {
  return value.split(/[,，]/).map((name) => name.trim()).filter(Boolean);
}

const RUNTIME_OPTIONS: { value: WorkerRuntime; label: string }[] = CREATABLE_WORKER_RUNTIMES.map((option) =>
  option.value === 'openclaw' ? { ...option, label: 'OpenClaw（默认）' } : option,
);

/** 建队内联新建 Worker 的空白表单（对齐插件 nw 初始态）。
 * role：对齐插件 CrdManage 成员行 { name, role }——新建 Worker 后选择
 * Leader（team_leader）还是普通 Worker（9/13 装验反馈：dashboard 建队 leader
 * 只能从现有的选，应参考插件允许新建即 leader）。 */
const EMPTY_NEW_WORKER = {
  name: '',
  runtime: 'openclaw' as WorkerRuntime,
  model: '',
  soul: '',
  role: 'worker' as 'leader' | 'worker',
};

/**
 * 创建团队（对齐插件建队卡：Worker 从已有 CR 选择，**且可内联新建 Worker**
 * ——9/13 装验反馈，参考插件 CrdManage「＋ 新建 Worker（Worker CRD）」
 * 折叠区：先 POST /workers 显式建 CR，再把名字编入团队；Controller 调和
 * 拉镜像起容器（数分钟就绪），可先保存团队，Worker 就绪后自动生效）。
 */
export function TeamCreateDialog({
  open,
  value,
  onChange,
  isPending,
  onOpenChange,
  onSubmit,
  workers,
  modelOptions,
  sessionIssue,
  onWorkerCreated,
}: {
  open: boolean;
  value: CreateTeamRequest;
  onChange: (_next: CreateTeamRequest) => void;
  isPending: boolean;
  onOpenChange: (_open: boolean) => void;
  onSubmit: () => void;
  workers: WorkerResponse[];
  modelOptions: ModelSelectionOption[];
  sessionIssue?: string | null;
  /** 内联新建 Worker 成功后回调（上层刷新 workers 查询，新名字进选择列表）。 */
  onWorkerCreated?: (_name: string) => void;
}) {
  const workerNames = value.workerNames ?? [];

  // ── 内联新建 Worker（对齐插件：显式 POST /workers 后入队，不靠隐式自动建站）──
  const [nwOpen, setNwOpen] = useState(false);
  const [nw, setNw] = useState(EMPTY_NEW_WORKER);
  const [nwBusy, setNwBusy] = useState(false);
  const [nwError, setNwError] = useState<string | null>(null);
  /** 本会话内联新建成功、但父级 workers 查询尚未刷新的条目——并入选项列表，
   *  让 Leader/Workers 下拉立即可选（否则新名字在下拉里缺席，role=leader
   *  自动填入的 Leader 值在 Select 中显示空白）。 */
  const [createdWorkers, setCreatedWorkers] = useState<{ name: string; model?: string }[]>([]);

  // 选项条目 = 已有 Worker + 本会话新建（父级刷新前的补充项，携带创建时填的模型）。
  const knownNames = new Set(workers.map((worker) => worker.name));
  const createdExtras = createdWorkers
    .filter((entry) => !knownNames.has(entry.name))
    .map((entry) => entry);
  const allWorkers: { name: string; model?: string }[] = [
    ...workers.map((worker) => ({ name: worker.name, model: worker.model })),
    ...createdExtras,
  ];

  const selectedWorkers = allWorkers.filter((worker) => workerNames.includes(worker.name));
  const workersWithoutModel = selectedWorkers.filter((worker) => !worker.model?.trim());
  // Leader 从已有（或本会话新建）Worker 里选；Worker 选项排除当前 Leader（不重复编入）。
  const workerOptions = allWorkers
    .filter((worker) => worker.name !== value.leader?.name)
    .map((worker) => ({
      value: worker.name,
      label: workerPickerLabel(worker.name, worker.model),
    }));

  const nwNameError = workerNameError(nw.name);
  const nwDuplicate = allWorkers.some((worker) => worker.name === nw.name.trim());
  const nwInTeam = workerNames.includes(nw.name.trim());

  const submitNewWorker = async () => {
    const name = nw.name.trim();
    if (!name || nwNameError) return;
    if (nwInTeam) {
      setNwError('该 Worker 已在团队 Workers 中');
      return;
    }
    if (nwDuplicate) {
      setNwError('该 Worker 已存在，请从下方 Workers 列表选择');
      return;
    }
    const blocked = rejectCopawCreate(nw.runtime);
    if (blocked) {
      setNwError(blocked);
      return;
    }
    setNwBusy(true);
    setNwError(null);
    try {
      await agentteamsApi.createWorker({
        name,
        runtime: nw.runtime,
        model: nw.model.trim() || undefined,
        soul: nw.soul.trim() || undefined,
      });
      // role=leader：新建 Worker 直接成为本团队 Leader（对齐插件成员行 role
      // 选择；Controller team CRD 的 team_leader 引用该名字，就绪前保存合法）。
      onChange({
        ...value,
        workerNames: [...workerNames, name],
        ...(nw.role === 'leader' ? { leader: { name } } : {}),
      });
      setCreatedWorkers((prev) => [
        ...prev,
        { name, model: nw.model.trim() || undefined },
      ]);
      onWorkerCreated?.(name);
      setNw(EMPTY_NEW_WORKER);
      setNwOpen(false);
    } catch (err) {
      setNwError(err instanceof Error ? err.message : 'Worker 创建失败');
    } finally {
      setNwBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-w-[95vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>创建团队</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>名称 *</Label>
            <Input
              value={value.name}
              onChange={(e) => onChange({ ...value, name: e.target.value })}
              placeholder="team-name"
            />
          </div>
          <div className="space-y-2">
            <Label>Leader *</Label>
            {allWorkers.length > 0 ? (
              <Select
                value={value.leader?.name || undefined}
                onValueChange={(name) => onChange({ ...value, leader: { name } })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择 Leader（已有或新建 Worker）" />
                </SelectTrigger>
                <SelectContent>
                  {allWorkers.map((worker) => (
                    <SelectItem key={worker.name} value={worker.name}>
                      {workerPickerLabel(worker.name, worker.model)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-xs text-muted-foreground">
                暂无 Worker，先在下方「新建 Worker」创建（可创建后直接设为 Leader），或到 Worker 列表创建后再建团队
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>团队名称</Label>
            <Input
              value={value.teamName || ''}
              onChange={(e) => onChange({ ...value, teamName: e.target.value })}
              placeholder="显示名称（可选）"
            />
          </div>
          <div className="space-y-2">
            <Label>描述</Label>
            <Textarea
              value={value.description || ''}
              onChange={(e) => onChange({ ...value, description: e.target.value })}
              placeholder="团队描述（可选）"
              rows={3}
            />
          </div>

          {/* 内联新建 Worker（对齐插件折叠区；默认收起，建队主路径仍是选已有） */}
          <div className="rounded-md border border-dashed border-border p-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setNwOpen((v) => !v)}
            >
              {nwOpen ? '收起' : '＋ 新建 Worker（Worker CRD）'}
            </Button>
            {nwOpen && (
              <div className="mt-3 space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">Worker 名（唯一，小写字母/数字/-）</Label>
                  <Input
                    value={nw.name}
                    onChange={(e) => {
                      setNw((p) => ({ ...p, name: e.target.value }));
                      setNwError(null);
                    }}
                    placeholder="worker-name"
                  />
                  {nwNameError && <p className="text-xs text-red-600 dark:text-red-400">{nwNameError}</p>}
                </div>
                {/* 对齐插件 CrdManage 成员行 { name, role }：新建 Worker 后
                    选择 Leader（team_leader）还是普通 Worker。 */}
                <div className="space-y-1">
                  <Label className="text-xs">创建后</Label>
                  <Select
                    value={nw.role}
                    onValueChange={(v) => setNw((p) => ({ ...p, role: v as 'leader' | 'worker' }))}
                  >
                    <SelectTrigger className="w-full min-w-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="worker">普通 Worker（加入 Workers 列表）</SelectItem>
                      <SelectItem value="leader">团队 Leader（设为本团队 Leader）</SelectItem>
                    </SelectContent>
                  </Select>
                  {nw.role === 'leader' && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400">
                      创建后该 Worker 将设为本团队 Leader（上方 Leader 选择自动填入）。
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">运行时</Label>
                  <Select
                    value={nw.runtime}
                    onValueChange={(v) => setNw((p) => ({ ...p, runtime: v as WorkerRuntime }))}
                  >
                    <SelectTrigger className="w-full min-w-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RUNTIME_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">请求模型别名</Label>
                  <ModelSelector
                    value={nw.model}
                    onChange={(model) => setNw((p) => ({ ...p, model }))}
                    placeholder="留空 = 跟随集群默认"
                    options={modelOptions}
                    sessionIssue={sessionIssue}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">SOUL</Label>
                  <SoulField
                    value={nw.soul}
                    onChange={(soul) => setNw((p) => ({ ...p, soul }))}
                    placeholder="SOUL（可选，多行，worker ≤150 行）"
                    rows={2}
                  />
                </div>
                {nwError && <p className="text-xs text-red-600 dark:text-red-400">{nwError}</p>}
                <Button
                  type="button"
                  size="sm"
                  disabled={!nw.name.trim() || !!nwNameError || nwDuplicate || nwInTeam || nwBusy}
                  onClick={() => void submitNewWorker()}
                >
                  {nwBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                  {nwBusy ? '创建中...' : nw.role === 'leader' ? '创建并设为 Leader' : '创建并加入团队'}
                </Button>
                <p className="text-xs text-muted-foreground">
                  创建后由 Controller 调和器拉镜像起容器（数分钟就绪）；可先保存团队，Worker 就绪后自动生效。
                </p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Workers（从已有 Worker 选择）</Label>
            <MemberPicker
              options={workerOptions}
              selected={workerNames}
              onAdd={(name) =>
                onChange({ ...value, workerNames: [...workerNames, name] })
              }
              onRemove={(name) =>
                onChange({
                  ...value,
                  workerNames: workerNames.filter((w) => w !== name),
                })
              }
              placeholder="选择 Worker 添加…"
            />
          </div>
          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
            <p>团队模型由 Leader 运行时与成员 Worker 的“请求模型别名”分别管理。</p>
            {workersWithoutModel.length > 0 ? (
              <p className="text-amber-600 dark:text-amber-400">
                以下已选 Worker 仍需配置模型：{workersWithoutModel.map((worker) => worker.name).join('、')}
              </p>
            ) : selectedWorkers.length > 0 ? (
              <p className="text-emerald-600 dark:text-emerald-400">已选 Worker 均已填写请求模型别名。</p>
            ) : (
              <p>添加成员后可在此检查成员模型配置。</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={onSubmit}
            disabled={!value.name || !value.leader?.name || isPending}
            className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:from-emerald-600 hover:to-teal-600"
          >
            {isPending ? '创建中...' : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

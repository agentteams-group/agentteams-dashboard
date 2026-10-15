'use client';

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
import type { UpdateTeamRequest, WorkerResponse } from '@/lib/agentteams-api';
import { workerPickerLabel } from '@/components/dashboard/sections/shared/member-picker';
import { findLlmTuningError, pickLlmTuning, type LlmTuningKey } from '@/lib/llm-tuning';
import { LlmTuningFields } from '@/components/dashboard/sections/workers/llm-tuning-fields';

export type TeamEditForm = UpdateTeamRequest & { name?: string };

/**
 * 编辑团队（对齐插件配置团队：成员从已有 Worker 选择替换/移除/添加——
 * 编辑没有自动建站语义，界面上选不出的名字 = 不会产生悬空引用）。
 */
export function TeamEditDialog({
  open,
  teamName,
  value,
  onChange,
  isPending,
  onOpenChange,
  onSubmit,
  workers,
}: {
  open: boolean;
  teamName: string | null;
  value: TeamEditForm;
  onChange: (_next: TeamEditForm) => void;
  isPending: boolean;
  onOpenChange: (_open: boolean) => void;
  onSubmit: () => void;
  workers: WorkerResponse[];
}) {
  const workerNames = value.workerNames ?? [];
  // 兜底守卫：从服务端载入的存量成员可能已失效（被删的 Worker）——
  // 界面上选不出的幽灵名仍然红标 + 拦提交（防服务端 400 裸奔）。
  const missingWorkerNames = workerNames.filter(
    (name) => !workers.some((worker) => worker.name === name),
  );
  const workerOptions = workers
    .filter((worker) => !workerNames.includes(worker.name))
    .map((worker) => ({
      value: worker.name,
      label: workerPickerLabel(worker.name, worker.model),
    }));

  // 团队级 LLM 默认（#146 缺口 3）：成员 Worker 未显式设置时继承。
  const llmValues = pickLlmTuning(value);
  const llmError = findLlmTuningError(llmValues);
  const handleLlmChange = (key: LlmTuningKey, next: string) => onChange({ ...value, [key]: next });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-w-[95vw]">
        <DialogHeader>
          <DialogTitle>编辑团队 - {teamName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>团队名称</Label>
            <Input
              value={value.teamName || ''}
              onChange={(e) => onChange({ ...value, teamName: e.target.value })}
              placeholder="显示名称"
            />
          </div>
          <div className="space-y-2">
            <Label>描述</Label>
            <Textarea
              value={value.description || ''}
              onChange={(e) => onChange({ ...value, description: e.target.value })}
              placeholder="团队描述"
              rows={3}
            />
          </div>
          <div className="space-y-1.5">
            <Label>LLM 调优默认（成员 Worker 未设置时继承）</Label>
            <LlmTuningFields
              values={llmValues}
              onChange={handleLlmChange}
              disabled={isPending}
              idPrefix={`team-llm-${teamName ?? 'new'}`}
            />
            {llmError && (
              <p className="text-xs text-red-600 dark:text-red-400">
                {llmError.label}：{llmError.message}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Workers（从已有 Worker 选择）</Label>
            {workerNames.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {workerNames.map((name) => (
                  <span
                    key={name}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${
                      missingWorkerNames.includes(name)
                        ? 'border-red-400 bg-red-500/10 text-red-600 dark:text-red-400'
                        : 'border-border bg-muted/50'
                    }`}
                  >
                    {name}
                    <button
                      type="button"
                      aria-label={`移除 ${name}`}
                      onClick={() =>
                        onChange({
                          ...value,
                          workerNames: workerNames.filter((w) => w !== name),
                        })
                      }
                      className="text-muted-foreground hover:text-foreground"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            {workerOptions.length > 0 ? (
              <Select
                onValueChange={(name) =>
                  onChange({ ...value, workerNames: [...workerNames, name] })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择 Worker 添加…" />
                </SelectTrigger>
                <SelectContent>
                  {workerOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              workerNames.length > 0 && (
                <p className="text-xs text-muted-foreground">已无其他可添加的 Worker</p>
              )
            )}
            {missingWorkerNames.length > 0 && (
              <p className="text-xs text-red-600 dark:text-red-400">
                以下 Worker 不存在：{missingWorkerNames.join('、')}——团队编辑不能引用不存在的 Worker（移除后保存）
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={onSubmit}
            disabled={missingWorkerNames.length > 0 || isPending || !!llmError}
            className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:from-emerald-600 hover:to-teal-600"
          >
            {isPending ? '更新中...' : '更新'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

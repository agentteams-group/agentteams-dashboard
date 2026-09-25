'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { Button } from '@/components/ui/button';
import type { UpdateWorkerRequest, WorkerRuntime } from '@/lib/agentteams-api';
import type { ModelSelectionOption } from '@/lib/model-catalog';
import { ModelSelector } from '@/components/dashboard/sections/shared/model-selector';
import { SkillSelector } from '@/components/dashboard/sections/skills/skill-selector';
import { McpSelector } from '@/components/dashboard/sections/mcps/mcp-selector';
import { CREATABLE_WORKER_RUNTIMES, isLegacyCopaw } from '@/lib/runtime-options';

export interface WorkerEditForm extends UpdateWorkerRequest {
  name?: string;
}

export function WorkerEditDialog({
  open,
  workerName,
  value,
  onChange,
  isPending,
  onOpenChange,
  onSubmit,
  modelOptions,
  sessionIssue,

}: {
  open: boolean;
  workerName: string | null;
  value: WorkerEditForm;
  onChange: (_next: WorkerEditForm) => void;
  isPending: boolean;
  onOpenChange: (_open: boolean) => void;
  onSubmit: () => void;
  modelOptions: ModelSelectionOption[];
  sessionIssue?: string | null;

}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-w-[95vw]">
        <DialogHeader>
          <DialogTitle>编辑 Worker - {workerName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>请求模型别名</Label>
            <ModelSelector
              value={value.model}
              onChange={(model) => onChange({ ...value, model })}
              placeholder="例如 team-chat"
              options={modelOptions}
              sessionIssue={sessionIssue}
            />
          </div>
          <div className="space-y-2">
            <Label>运行时</Label>
            <Select
              value={value.runtime || ''}
              onValueChange={(v) => onChange({ ...value, runtime: v as WorkerRuntime })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {isLegacyCopaw(value.runtime) && (
                  <SelectItem value="copaw" disabled>
                    CoPaw（存量，请升级到 QwenPaw）
                  </SelectItem>
                )}
                {CREATABLE_WORKER_RUNTIMES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isLegacyCopaw(value.runtime) && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                CoPaw 已停止新建。将运行时改为 QwenPaw 后保存即可升级；升级前请备份持久化数据，并避免在任务执行中切换。
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>镜像</Label>
            <Input
              value={value.image || ''}
              onChange={(e) => onChange({ ...value, image: e.target.value })}
              placeholder="容器镜像地址（可选）"
            />
          </div>
          <div className="space-y-2">
            <Label>技能</Label>
            <SkillSelector
              value={value.skills || []}
              onChange={(skills) => onChange({ ...value, skills: skills.length ? skills : undefined })}
            />
          </div>
          <div className="space-y-2">
            <Label>关联 Agents（逗号分隔）</Label>
            <Input
              value={value.agents || ''}
              onChange={(e) => onChange({ ...value, agents: e.target.value || undefined })}
              placeholder="agent1, agent2"
            />
          </div>
          <div className="space-y-2">
            <Label>MCP Servers</Label>
            <McpSelector
              value={value.mcpServers || []}
              onChange={(mcpServers) => onChange({ ...value, mcpServers: mcpServers.length ? mcpServers : undefined })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={onSubmit}
            disabled={isPending}
            className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:from-emerald-600 hover:to-teal-600"
          >
            {isPending ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

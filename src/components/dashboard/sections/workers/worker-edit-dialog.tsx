'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { ModelSelector } from '@/components/dashboard/sections/shared/model-selector';
import { McpServersField } from './worker-create-dialog';

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
}: {
  open: boolean;
  workerName: string | null;
  value: WorkerEditForm;
  onChange: (_next: WorkerEditForm) => void;
  isPending: boolean;
  onOpenChange: (_open: boolean) => void;
  onSubmit: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-w-[95vw]">
        <DialogHeader>
          <DialogTitle>编辑 Worker - {workerName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>模型</Label>
            <ModelSelector
              value={value.model}
              onChange={(model) => onChange({ ...value, model })}
              placeholder="选择模型"
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
                {/* Standalone Worker CRD only allows openclaw/copaw/hermes/qwenpaw;
                    openhuman is valid for team members only (teams CRD). */}
                <SelectItem value="openclaw">OpenClaw</SelectItem>
                <SelectItem value="copaw">CoPaw</SelectItem>
                <SelectItem value="hermes">Hermes</SelectItem>
                <SelectItem value="qwenpaw">QwenPaw</SelectItem>
              </SelectContent>
            </Select>
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
            <Label>Soul</Label>
            <Textarea
              value={value.soul || ''}
              onChange={(e) => onChange({ ...value, soul: e.target.value })}
              placeholder="Worker 人格描述（可选）"
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label>技能（逗号分隔）</Label>
            <Input
              value={value.skills?.join(', ') || ''}
              onChange={(e) =>
                onChange({
                  ...value,
                  skills: e.target.value
                    ? e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean)
                    : [],
                })
              }
              placeholder="skill1, skill2, skill3"
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
          <McpServersField
            value={value.mcpServers || []}
            onChange={(mcpServers) => onChange({ ...value, mcpServers: mcpServers.length ? mcpServers : undefined })}
          />
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

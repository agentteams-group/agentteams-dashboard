'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
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
import type { CreateWorkerRequest } from '@/lib/agentteams-api';
import { ModelSelector } from '@/components/dashboard/sections/shared/model-selector';

export function WorkerCreateDialog({
  open,
  onOpenChange,
  value,
  onChange,
  isPending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  value: CreateWorkerRequest;
  onChange: (_next: CreateWorkerRequest) => void;
  isPending: boolean;
  onSubmit: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-w-[95vw]">
        <DialogHeader>
          <DialogTitle>创建 Worker</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>名称 *</Label>
            <Input
              value={value.name}
              onChange={(e) => onChange({ ...value, name: e.target.value })}
              placeholder="worker-name"
            />
          </div>
          <div className="space-y-2">
            <Label>运行时 *</Label>
            <Select
              value={value.runtime}
              onValueChange={(v) => onChange({ ...value, runtime: v as CreateWorkerRequest['runtime'] })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openclaw">OpenClaw</SelectItem>
                <SelectItem value="copaw">CoPaw</SelectItem>
                <SelectItem value="hermes">Hermes</SelectItem>
                <SelectItem value="openhuman">OpenHuman</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>模型</Label>
            <ModelSelector
              value={value.model}
              onChange={(model) => onChange({ ...value, model })}
              placeholder="选择模型"
            />
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
                    : undefined,
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
            disabled={!value.name || isPending}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {isPending ? '创建中...' : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Reusable MCP Servers list editor */
export function McpServersField({
  value,
  onChange,
}: {
  value: { name: string; url: string; transport: string }[];
  onChange: (_next: { name: string; url: string; transport: string }[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const addServer = () => {
    onChange([...value, { name: '', url: '', transport: 'stdio' }]);
    setExpanded(true);
  };

  const removeServer = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  const updateServer = (idx: number, field: string, val: string) => {
    const next = value.map((s, i) => (i === idx ? { ...s, [field]: val } : s));
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>MCP Servers</Label>
        <Button variant="ghost" size="sm" type="button" onClick={addServer} className="h-6 px-2 text-xs">
          <Plus className="w-3 h-3 mr-1" />
          添加
        </Button>
      </div>
      {value.length > 0 && !expanded && (
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded(true)}
        >
          {value.length} 个 MCP Server（点击展开）
        </button>
      )}
      {expanded &&
        value.map((server, idx) => (
          <div key={idx} className="flex gap-2 items-start">
            <Input
              value={server.name}
              onChange={(e) => updateServer(idx, 'name', e.target.value)}
              placeholder="名称"
              className="h-8 text-xs"
            />
            <Input
              value={server.url}
              onChange={(e) => updateServer(idx, 'url', e.target.value)}
              placeholder="URL"
              className="h-8 text-xs"
            />
            <select
              value={server.transport}
              onChange={(e) => updateServer(idx, 'transport', e.target.value)}
              className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
            >
              <option value="stdio">stdio</option>
              <option value="sse">sse</option>
              <option value="streamable-http">streamable-http</option>
            </select>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => removeServer(idx)}
              className="h-8 w-8 p-0 shrink-0"
            >
              <X className="w-3 h-3" />
            </Button>
          </div>
        ))}
    </div>
  );
}

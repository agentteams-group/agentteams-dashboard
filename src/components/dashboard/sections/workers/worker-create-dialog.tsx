'use client';

import { useState } from 'react';
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
import { Wand2 } from 'lucide-react';
import type { CreateWorkerRequest, WorkerRuntime } from '@/lib/agentteams-api';
import type { ModelSelectionOption } from '@/lib/model-catalog';
import { workerNameError } from '@/lib/resource-name';
import { ModelSelector } from '@/components/dashboard/sections/shared/model-selector';
import { SkillSelector } from '@/components/dashboard/sections/skills/skill-selector';
import { McpSelector } from '@/components/dashboard/sections/mcps/mcp-selector';

export interface AgentSpecTemplateOption {
  name: string;
  description: string;
  version: string;
}

export function WorkerCreateDialog({
  open,
  onOpenChange,
  value,
  onChange,
  isPending,
  onSubmit,
  modelOptions,
  agentSpecs,
}: {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  value: CreateWorkerRequest;
  onChange: (_next: CreateWorkerRequest) => void;
  isPending: boolean;
  onSubmit: () => void;
  modelOptions: ModelSelectionOption[];
  agentSpecs?: AgentSpecTemplateOption[];
}) {
  const nameError = workerNameError(value.name);
  const [selectedTemplate, setSelectedTemplate] = useState('');

  const handleTemplateSelect = (templateName: string) => {
    if (!templateName || templateName === '__none__') return;
    setSelectedTemplate(templateName);
    const baseName = templateName.replace(/[^a-z0-9-]/g, '-').substring(0, 63);
    onChange({ ...value, name: baseName });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-w-[95vw]">
        <DialogHeader>
          <DialogTitle>创建 Worker</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {agentSpecs && agentSpecs.length > 0 && (
            <div className="rounded-lg border p-3 bg-muted/20">
              <div className="flex items-center gap-2 mb-2">
                <Wand2 className="h-4 w-4 text-violet-500" />
                <Label className="text-sm font-medium">从模板创建</Label>
              </div>
              <Select value={selectedTemplate} onValueChange={handleTemplateSelect}>
                <SelectTrigger>
                  <SelectValue placeholder="选择 AgentSpec 模板..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">手动创建</SelectItem>
                  {agentSpecs.map((spec) => (
                    <SelectItem key={spec.name} value={spec.name}>
                      <span className="font-medium">{spec.name}</span>
                      {spec.description && (
                        <span className="text-muted-foreground ml-2 text-xs">
                          - {spec.description.substring(0, 60)}
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label>名称 *</Label>
            <Input
              value={value.name}
              onChange={(e) => onChange({ ...value, name: e.target.value })}
              placeholder="worker-name"
            />
            {nameError && <p className="text-xs text-red-600 dark:text-red-400">{nameError}</p>}
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
                <SelectItem value="qwenpaw">QwenPaw</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>请求模型别名</Label>
            <ModelSelector
              value={value.model}
              onChange={(model) => onChange({ ...value, model })}
              placeholder="例如 team-chat"
              options={modelOptions}
            />
            <p className="text-xs text-muted-foreground">
              Worker 通过 AI 网关访问模型，使用 Consumer 凭证认证，无需提供真实 API Key。
            </p>
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
            disabled={!value.name || !!nameError || isPending}
            className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:from-emerald-600 hover:to-teal-600"
          >
            {isPending ? '创建中...' : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

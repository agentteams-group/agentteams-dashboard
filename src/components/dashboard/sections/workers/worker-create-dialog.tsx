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
import { Wand2, Loader2 } from 'lucide-react';
import type { CreateWorkerRequest } from '@/lib/agentteams-api';
import { agentteamsApi } from '@/lib/agentteams-api';
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
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateNote, setTemplateNote] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);

  const handleTemplateSelect = async (templateName: string) => {
    if (!templateName || templateName === '__none__') {
      setSelectedTemplate('');
      setTemplateNote(null);
      setTemplateError(null);
      return;
    }
    setSelectedTemplate(templateName);
    setTemplateError(null);

    const spec = (agentSpecs ?? []).find((s) => s.name === templateName);
    if (!spec?.version) {
      const baseName = templateName.replace(/[^a-z0-9-]/g, '-').substring(0, 63);
      onChange({ ...value, name: baseName });
      setTemplateNote('该模板缺少版本信息，仅预填名称');
      return;
    }

    setTemplateLoading(true);
    try {
      const mapping = await agentteamsApi.getAgentSpecDetail(templateName, spec.version);
      onChange({
        ...value,
        name: mapping.name,
        image: mapping.image || value.image,
        runtime: mapping.runtime,
        soul: mapping.soul || value.soul,
      });
      const parts: string[] = [];
      if (mapping.description) parts.push(mapping.description);
      if (mapping.from) parts.push(`来源 ${mapping.from}`);
      setTemplateNote(parts.join(' · ') || null);
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : '模板解析失败，可手动填写');
      const baseName = templateName.replace(/[^a-z0-9-]/g, '-').substring(0, 63);
      onChange({ ...value, name: baseName });
    } finally {
      setTemplateLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-w-[95vw] max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
          <DialogTitle>创建 Worker</DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-2 space-y-4">
          {agentSpecs && agentSpecs.length > 0 && (
            <div className="rounded-lg border p-3 bg-muted/20 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <Wand2 className="h-4 w-4 shrink-0 text-violet-500" />
                <Label className="text-sm font-medium">从模板创建</Label>
                {templateLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </div>
              <Select value={selectedTemplate || undefined} onValueChange={handleTemplateSelect} disabled={templateLoading}>
                <SelectTrigger className="w-full min-w-0">
                  <SelectValue placeholder="选择 AgentSpec 模板..." />
                </SelectTrigger>
                <SelectContent className="max-w-[min(100vw-2rem,28rem)]">
                  <SelectItem value="__none__">手动创建</SelectItem>
                  {agentSpecs.map((spec) => (
                    <SelectItem key={spec.name} value={spec.name} className="min-w-0">
                      <span className="block truncate">
                        <span className="font-medium">{spec.name}</span>
                        {spec.description && (
                          <span className="text-muted-foreground ml-2 text-xs">
                            - {spec.description.substring(0, 40)}
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {templateNote && (
                <p className="mt-2 text-xs text-muted-foreground break-words">{templateNote}</p>
              )}
              {templateError && (
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-400 break-words">{templateError}</p>
              )}
              {selectedTemplate && selectedTemplate !== '__none__' && !templateLoading && (
                <p className="mt-1 text-xs text-muted-foreground">
                  已按模板预填名称、镜像、运行时与 Soul，可在下方修改后再创建。
                </p>
              )}
            </div>
          )}

          <div className="space-y-2 min-w-0">
            <Label>名称 *</Label>
            <Input
              className="w-full min-w-0"
              value={value.name}
              onChange={(e) => onChange({ ...value, name: e.target.value })}
              placeholder="worker-name"
            />
            {nameError && <p className="text-xs text-red-600 dark:text-red-400">{nameError}</p>}
          </div>

          <div className="space-y-2 min-w-0">
            <Label>运行时 *</Label>
            <Select
              value={value.runtime}
              onValueChange={(v) => onChange({ ...value, runtime: v as CreateWorkerRequest['runtime'] })}
            >
              <SelectTrigger className="w-full min-w-0">
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

          <div className="space-y-2 min-w-0">
            <Label>请求模型别名</Label>
            <div className="min-w-0 w-full overflow-hidden">
              <ModelSelector
                value={value.model}
                onChange={(model) => onChange({ ...value, model })}
                placeholder="例如 team-chat"
                options={modelOptions}
              />
            </div>
            <p className="text-xs text-muted-foreground break-words">
              Worker 通过 AI 网关访问模型，使用 Consumer 凭证认证，无需提供真实 API Key。
            </p>
          </div>

          <div className="space-y-2 min-w-0">
            <Label>镜像</Label>
            <Input
              className="w-full min-w-0"
              value={value.image || ''}
              onChange={(e) => onChange({ ...value, image: e.target.value })}
              placeholder="容器镜像地址（可选）"
            />
          </div>

          <div className="space-y-2 min-w-0">
            <Label>Soul</Label>
            <Textarea
              className="w-full min-w-0 resize-y"
              value={value.soul || ''}
              onChange={(e) => onChange({ ...value, soul: e.target.value })}
              placeholder="Worker 人格描述（可选）"
              rows={3}
            />
          </div>

          <div className="space-y-2 min-w-0">
            <Label>技能</Label>
            <div className="min-w-0 w-full overflow-hidden">
              <SkillSelector
                value={value.skills || []}
                onChange={(skills) => onChange({ ...value, skills: skills.length ? skills : undefined })}
              />
            </div>
          </div>

          <div className="space-y-2 min-w-0">
            <Label>关联 Agents（逗号分隔）</Label>
            <Input
              className="w-full min-w-0"
              value={value.agents || ''}
              onChange={(e) => onChange({ ...value, agents: e.target.value || undefined })}
              placeholder="agent1, agent2"
            />
          </div>

          <div className="space-y-2 min-w-0">
            <Label>MCP Servers</Label>
            <div className="min-w-0 w-full overflow-hidden">
              <McpSelector
                value={value.mcpServers || []}
                onChange={(mcpServers) =>
                  onChange({ ...value, mcpServers: mcpServers.length ? mcpServers : undefined })
                }
              />
            </div>
          </div>
        </div>

        <DialogFooter className="px-6 py-4 shrink-0 border-t">
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

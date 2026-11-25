'use client';

import { useEffect, useId, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useMcpCatalog, trustedCatalogServerNames } from '@/hooks/use-mcp-catalog';
import { useInfrastructure } from '@/hooks/use-agentteams-infrastructure';
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
import { Loader2, Wand2 } from 'lucide-react';
import type { CreateWorkerRequest } from '@/lib/agentteams-api';
import { agentteamsApi } from '@/lib/agentteams-api';
import type { ModelSelectionOption } from '@/lib/model-catalog';
import { workerNameError } from '@/lib/resource-name';
import { SoulField } from '@/components/dashboard/sections/shared/soul-field';
import { isPathLikeModel } from '@/lib/model-verdict';
import { SkillSelector } from '@/components/dashboard/sections/skills/skill-selector';
import { McpSelector } from '@/components/dashboard/sections/mcps/mcp-selector';
import { CREATABLE_WORKER_RUNTIMES } from '@/lib/runtime-options';
import { InfoTip } from '@/components/dashboard/info-tip';

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
  sessionIssue,
  modelsLoading = false,
  agentSpecs,
}: {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  value: CreateWorkerRequest;
  onChange: (_next: CreateWorkerRequest) => void;
  isPending: boolean;
  onSubmit: () => void;
  modelOptions: ModelSelectionOption[];
  sessionIssue?: string | null;
  modelsLoading?: boolean;
  agentSpecs?: AgentSpecTemplateOption[];
}) {
  const nameError = workerNameError(value.name);
  const infrastructure = useInfrastructure({ enabled: open });
  const gatewayMode = infrastructure.data?.higress?.mode;
  const modelIssue = sessionIssue ?? (modelsLoading
    ? '正在加载模型列表，请稍候。'
    : !gatewayMode
      ? infrastructure.isLoading ? '正在读取模型连接设置，请稍候。' : '无法读取模型连接设置，请稍后重试。'
      : null);
  const modelId = useId();
  const connectionId = useId();
  const [externalConnection, setExternalConnection] = useState('');
  useEffect(() => {
    if (!open) setExternalConnection('');
  }, [open]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateNote, setTemplateNote] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);

  const connectionsByModel = new Map<string, Set<string>>();
  for (const { alias, kind, binding } of modelOptions ?? []) {
    const model = alias.trim();
    const provider = binding?.providerName.trim();
    if (kind !== 'configured' || !binding?.available || !provider || !model || isPathLikeModel(model)) continue;
    const connections = connectionsByModel.get(model) ?? new Set<string>();
    connections.add(provider);
    connectionsByModel.set(model, connections);
  }
  // External gateways route by alias, so a model with several upstreams is
  // one choice with all of its connections shown, rather than a false override.
  const selections = [...connectionsByModel].flatMap(([model, connections]) =>
    (gatewayMode === 'external' ? [[...connections].join(' / ')] : [...connections])
      .map((provider) => ({ model, provider, value: JSON.stringify([provider, model]) })),
  );
  const modelProviders = [...new Set(selections.map((selection) => selection.provider))].sort((a, b) => a.localeCompare(b));
  const connection = gatewayMode === 'external'
    ? externalConnection || selections.find((selection) => selection.model === value.model)?.provider || ''
    : value.modelProvider || '';
  const connectionModels = selections.filter((selection) => selection.provider === connection);
  const selected = selections.find((selection) =>
    selection.model === value.model && selection.provider === connection,
  );
  // B7 21.1: catalog 上标记 trusted 的 MCP server 在新建 Worker 时默认勾选
  //（操作员可手动取消）；catalog 不可用（旧 Controller 404）时退化为无默认。
  const mcpCatalog = useMcpCatalog();
  const defaultMcpNames = trustedCatalogServerNames(mcpCatalog);
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
            <div className="flex items-center gap-1">
              <Label>运行时 *</Label>
              <InfoTip label="运行时选择说明">
                推荐 QwenPaw。CoPaw 已停止新建；存量实例请在 Worker 卡片上升级。
              </InfoTip>
            </div>
            <Select
              value={value.runtime}
              onValueChange={(v) => onChange({ ...value, runtime: v as CreateWorkerRequest['runtime'] })}
            >
              <SelectTrigger className="w-full min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CREATABLE_WORKER_RUNTIMES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 min-w-0">
            <Label htmlFor={connectionId}>模型连接 *</Label>
            <Select
              name="worker-model-connection"
              value={modelProviders.includes(connection) ? connection : ''}
              disabled={isPending || !!modelIssue || modelProviders.length === 0}
              onValueChange={(provider) => {
                setExternalConnection(provider);
                onChange({
                  ...value,
                  model: '',
                  modelProvider: gatewayMode === 'external' ? undefined : provider,
                });
              }}
            >
              <SelectTrigger id={connectionId} aria-label="模型连接" className="w-full min-w-0">
                <SelectValue placeholder="请选择模型连接" />
              </SelectTrigger>
              <SelectContent>
                {modelProviders.map((provider) => (
                  <SelectItem key={provider} value={provider}>{provider}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {gatewayMode === 'external' && connection.includes(' / ') && (
              <p className="text-xs text-muted-foreground">此连接组由外部网关按模型路由分配，无法单独指定其中一个连接。</p>
            )}
          </div>

          <div className="space-y-2 min-w-0">
            <div className="flex items-center gap-1">
              <Label htmlFor={modelId}>模型 *</Label>
              <InfoTip label="模型访问与验证说明">
                <span className="block">
                  Worker 通过 AI 网关访问模型，使用 Consumer 凭证认证，无需提供真实 API Key。
                </span>
                <span className="mt-1 block">
                  创建后请在编辑页运行「已保存配置的网关验证」，以该 Worker 的 Consumer 身份确认授权与调用。
                </span>
              </InfoTip>
            </div>
            <div className="min-w-0 w-full overflow-hidden">
              <Select
                name="worker-model"
                value={selected?.model ?? ''}
                disabled={isPending || !!modelIssue || connectionModels.length === 0}
                onValueChange={(next) => {
                  const selection = connectionModels.find((item) => item.model === next);
                  if (!selection) return;
                  onChange({
                    ...value,
                    model: selection.model,
                    // External gateways resolve the connection from the alias;
                    // their API rejects an explicit modelProvider override.
                    modelProvider: gatewayMode === 'external' ? undefined : selection.provider,
                  });
                }}
              >
                <SelectTrigger id={modelId} aria-label="模型" className="w-full min-w-0">
                  <SelectValue placeholder={connection ? '请选择模型' : '请先选择模型连接'}>
                    {value.model || undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {connectionModels.map((selection) => (
                    <SelectItem key={selection.value} value={selection.model}>
                      {selection.model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {modelIssue ? (
              <p role="alert" className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-600 break-words">
                {modelIssue}
              </p>
            ) : selections.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                暂无已配置的模型，请先添加模型连接及模型路由。
                <a href="#console/resources/models" className="ml-1 underline" onClick={() => onOpenChange(false)}>前往模型管理</a>
              </p>
            ) : value.model && !selected ? (
              <p role="alert" className="text-xs text-amber-600 dark:text-amber-400">请先选择模型连接，再选择该连接下的模型。</p>
            ) : (
              <p className="text-xs text-muted-foreground">仅显示所选连接下已配置的模型。</p>
            )}
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
            <SoulField
              value={value.soul || ''}
              onChange={(soul) => onChange({ ...value, soul })}
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
                defaultSelectedNames={defaultMcpNames}
                onChange={(mcpServers) =>
                  onChange({ ...value, mcpServers: mcpServers.length ? mcpServers : undefined })
                }
              />
            </div>
          </div>
        </div>

        <DialogFooter className="px-6 py-4 shrink-0 border-t flex-col items-stretch gap-3 sm:flex-col">
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button
              onClick={onSubmit}
              disabled={!value.name || !!nameError || isPending || !!modelIssue || !selected}
            >
              {isPending ? '创建中...' : '创建'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { useState } from 'react';
import { WorkerEnvEditor } from './worker-env-editor';
import { WorkerGatewayProbe } from './worker-gateway-probe';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { WorkerHeartbeatControl } from './worker-heartbeat-control';
import { WorkerRuntimeHandoff } from './worker-runtime-handoff';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { UpdateWorkerRequest } from '@/lib/agentteams-api';
import {
  buildModelCandidateCatalog,
  type ModelSelectionOption,
} from '@/lib/model-catalog';
import { ModelPicker } from '@/components/dashboard/sections/shared/model-picker';
import { InfoTip } from '@/components/dashboard/info-tip';
import { SkillSelector } from '@/components/dashboard/sections/skills/skill-selector';
import { McpSelector } from '@/components/dashboard/sections/mcps/mcp-selector';
import { isLegacyCopaw } from '@/lib/runtime-options';

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
  modelProvider,
  sessionIssue,
  envEditable = false,
  basicOnly = false,

}: {
  open: boolean;
  workerName: string | null;
  value: WorkerEditForm;
  onChange: (_next: WorkerEditForm) => void;
  isPending: boolean;
  onOpenChange: (_open: boolean) => void;
  onSubmit: () => void;
  modelOptions: ModelSelectionOption[];
  /** 控制器现值（未改不写回；只在表单里出现真变化的值）。 */
  modelProvider?: string;
  sessionIssue?: string | null;
  envEditable?: boolean;
  basicOnly?: boolean;

}) {
  const [envValid, setEnvValid] = useState(true);
  const initialProvider = (modelProvider ?? '').trim();
  const [provider, setProvider] = useState(initialProvider);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setProvider(initialProvider);
  }
  const modelCatalog = buildModelCandidateCatalog(modelOptions ?? []);
  const currentRuntime = value.runtime || '';
  const handleModelChange = (nextProvider: string, nextModel: string) => {
    const trimmed = nextProvider.trim();
    setProvider(nextProvider);
    const next: WorkerEditForm = { ...value, model: nextModel };
    // provider 真变化且非空才带；未改（或改回原值）= 不下发，沿用控制器现值。
    if (trimmed && trimmed !== initialProvider) next.modelProvider = trimmed;
    else delete next.modelProvider;
    onChange(next);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-w-[95vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>编辑 Worker - {workerName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <div className="flex items-center gap-1">
              <Label>请求模型别名</Label>
              <InfoTip label="模型访问与验证说明">
                Worker 通过 AI 网关访问模型。已配置别名仅表示存在模型映射，请运行「已保存配置的网关验证」确认授权与调用。
              </InfoTip>
            </div>
            <ModelPicker
              providers={modelCatalog.providers}
              provider={provider}
              model={value.model ?? ''}
              modelsByProvider={modelCatalog.modelsByProvider}
              allModels={modelCatalog.models}
              modelPlaceholder="例如 team-chat"
              providerPlaceholder="选择或输入 Provider"
              onChange={handleModelChange}
            />
            {sessionIssue ? (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-600 break-words">
                模型别名组暂不可用：{sessionIssue}。内置模型与自定义输入仍可使用。
              </p>
            ) : null}
          </div>
          {open && workerName && <WorkerRuntimeHandoff key={workerName} name={workerName} runtime={currentRuntime} />}
          {isLegacyCopaw(currentRuntime) && <p className="text-xs text-muted-foreground">CoPaw 已停止新建，可选择 QwenPaw 作为目标运行时。</p>}
          {!basicOnly && currentRuntime === 'openclaw' ? (
            <WorkerHeartbeatControl
              enabled={value.llmHeartbeatEnabled}
              disabled={isPending || !envEditable}
              onCheckedChange={(checked) => onChange({ ...value, llmHeartbeatEnabled: checked })}
            />
          ) : null}
          <div className="space-y-2">
            <Label>镜像</Label>
            <Input
              value={value.image || ''}
              onChange={(e) => onChange({ ...value, image: e.target.value })}
              placeholder="容器镜像地址（可选）"
            />
          </div>
          {!basicOnly && <>
          <div className="space-y-2">
            <Label>技能</Label>
            <SkillSelector
              value={value.skills || []}
              onChange={(skills) => onChange({ ...value, skills })}
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
              onChange={(mcpServers) => onChange({ ...value, mcpServers })}
            />
          </div>
          <div className="space-y-2">
            <Label>环境变量</Label>
            {envEditable ? <WorkerEnvEditor key={workerName} value={value.env || {}} onChange={(env) => onChange({ ...value, env })} onValidityChange={setEnvValid} /> : <p className="text-xs text-muted-foreground">需要管理员权限及支持环境变量编辑的 Controller。</p>}
          </div>
          {workerName && <WorkerGatewayProbe key={workerName} workerName={workerName} />}
          </>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={onSubmit}
            disabled={isPending || !envValid}
          >
            {isPending ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

'use client';

// Manager 模型配置弹窗：Provider → Model（与工作台插件 / Worker 模型卡同一
// ModelPicker，provider-first）。
//
// spawn / sub 子代理模型：Controller 的 UpdateManagerRequest 目前没有
// subagentModel 字段（只有 Worker 侧有），下发会被静默忽略——这里不下发，
// 用一行说明把限制讲清楚，而不是留一个「看起来能存」的输入框。

import { useState } from 'react';
import { AgentApprovalMode } from '../shared/agent-approval-mode';
import { CREATABLE_MANAGER_RUNTIMES } from '@/lib/runtime-options';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ModelPicker } from '@/components/dashboard/sections/shared/model-picker';
import {
  buildModelCandidateCatalog,
  type ModelSelectionOption,
} from '@/lib/model-catalog';

function resolveProviderHint(
  model: string,
  modelOptions: ModelSelectionOption[],
): string {
  const option = modelOptions.find((entry) => entry.alias === model.trim());
  return option?.binding?.providerName ?? '';
}

export function ManagerModelDialog({
  open,
  managerName,
  runtime = "",
  image = "",
  model,
  modelProvider,
  approvalMode,
  modelOptions,
  saving,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  managerName: string;
  runtime?: string;
  image?: string;
  model: string;
  modelProvider?: string;
  approvalMode?: 'ask' | 'allow';
  modelOptions: ModelSelectionOption[];
  sessionIssue?: string | null;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (_model: string, _provider: string, _runtime: string, _image: string, _approvalMode?: 'ask' | 'allow') => void;
}) {
  const [draftApprovalMode, setDraftApprovalMode] = useState(approvalMode);
  const [draftRuntime, setDraftRuntime] = useState(runtime);
  const [draftImage, setDraftImage] = useState(image);
  const [draft, setDraft] = useState(model);
  const [provider, setProvider] = useState(modelProvider ?? '');
  const [providerTouched, setProviderTouched] = useState(false);
  const [initMarker, setInitMarker] = useState(`${managerName}\u0000${model}\u0000${modelProvider ?? ''}`);
  const [wasOpen, setWasOpen] = useState(open);
  const marker = `${managerName}\u0000${model}\u0000${modelProvider ?? ''}`;
  if (initMarker !== marker) {
    setInitMarker(marker);
    setDraft(model);
    setProvider(modelProvider ?? '');
    setProviderTouched(false);
  }
  // 每次打开都从当前 spec 重新起稿（取消后重开不留上次未保存的改动）。
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setDraftApprovalMode(approvalMode);
      setDraftRuntime(runtime);
      setDraftImage(image);
      setDraft(model);
      setProvider(modelProvider ?? '');
      setProviderTouched(false);
    }
  }

  const providerHint = resolveProviderHint(draft, modelOptions);
  const providerCatalog = buildModelCandidateCatalog(modelOptions);
  const changed = draft.trim() !== model.trim() || providerTouched || draftRuntime !== runtime || draftImage !== image || draftApprovalMode !== approvalMode;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent onOpenAutoFocus={event => event.preventDefault()} className="max-w-[95vw] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>编辑基础配置 - {managerName}</DialogTitle>
          <DialogDescription>
            选择模型连接、模型和运行时。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <ModelPicker
            requireProvider
            providers={providerCatalog.providers}
            provider={provider}
            model={draft}
            modelsByProvider={providerCatalog.modelsByProvider}
            allModels={providerCatalog.models}
            modelPlaceholder="例如 team-chat"
            providerPlaceholder={
              providerHint ? `当前连接：${providerHint}` : '选择或输入连接名称'
            }
            onChange={(nextProvider, nextModel) => {
              const providerChanged = nextProvider.trim() !== provider.trim();
              setDraft(nextModel);
              if (providerChanged) {
                setProvider(nextProvider);
                setProviderTouched(true);
                return;
              }
              setProvider(nextProvider);
              // 选模型时若该 alias 有网关绑定、且用户没手改 provider → 自动跟随；
              // 自动填的值不标 touched，未手选就不下发（沿用 Controller 现值）。
              if (!providerTouched) {
                const mappedProvider = providerCatalog.providerByModel[nextModel];
                setProvider(mappedProvider ?? nextProvider);
              }
            }}
          />
          <AgentApprovalMode value={draftApprovalMode} disabled={saving} onChange={setDraftApprovalMode} />
          <div className="space-y-2">
            <Label>运行时</Label>
            <Select value={draftRuntime} onValueChange={(next) => { setDraftRuntime(next); setDraftImage(""); }}>
              <SelectTrigger aria-label="运行时"><SelectValue placeholder="选择运行时" /></SelectTrigger>
              <SelectContent>{CREATABLE_MANAGER_RUNTIMES.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label htmlFor="manager-image">镜像</Label><Input id="manager-image" value={draftImage} onChange={event => setDraftImage(event.target.value)} placeholder="容器镜像地址（可选）" /></div>
          <p className="text-xs text-muted-foreground">
            模型名称默认与模型 ID 相同，也可以使用连接中配置的调用别名。请选择当前助手使用的连接。
          </p>

          <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
            子代理模型目前沿用运行时配置，此处仅修改主模型。
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button
            disabled={!changed || saving || !draft.trim() || !provider.trim() || !draftRuntime}
            onClick={() => {
              const trimmedProvider = provider.trim();
              // 手选优先；未手选但自动跟随 binding 得到了与现值不同的 provider
              // 也一并下发；与现值相同 / 为空 = 不带（沿用 Controller 现值）。
              const submittedProvider =
                providerTouched ||
                trimmedProvider !== (modelProvider ?? '').trim()
                  ? trimmedProvider
                  : '';
              onSubmit(draft.trim(), submittedProvider || provider.trim(), draftRuntime, draftImage, draftApprovalMode);
            }}
          >
            {saving ? (
              <>
                <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden="true" />
                保存中…
              </>
            ) : (
              '保存'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

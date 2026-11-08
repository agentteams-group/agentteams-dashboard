'use client';

// Manager 模型配置弹窗：主模型（ModelSelector，与 Worker/团队详情同源）+
// provider（可选，多 provider 部署下决定转发路由）。
//
// spawn / sub 子代理模型：Controller 的 UpdateManagerRequest 目前没有
// subagentModel 字段（只有 Worker 侧有），下发会被静默忽略——这里不下发，
// 用一行说明把限制讲清楚，而不是留一个「看起来能存」的输入框。

import { useState } from 'react';
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
import { Combobox } from '@/components/ui/combobox';
import { Label } from '@/components/ui/label';
import { ModelSelector } from '@/components/dashboard/sections/shared/model-selector';
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
  model,
  modelProvider,
  modelOptions,
  sessionIssue,
  saving,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  managerName: string;
  model: string;
  modelProvider?: string;
  modelOptions: ModelSelectionOption[];
  sessionIssue?: string | null;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (_model: string, _provider: string) => void;
}) {
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
      setDraft(model);
      setProvider(modelProvider ?? '');
      setProviderTouched(false);
    }
  }

  const providerHint = resolveProviderHint(draft, modelOptions);
  const providerCatalog = buildModelCandidateCatalog(modelOptions);
  const changed = draft.trim() !== model.trim() || providerTouched;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="max-w-[95vw] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>编辑模型 - {managerName}</DialogTitle>
          <DialogDescription>
            通过 AI 网关访问模型。已配置别名只表示存在映射，实际授权以网关为准。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>主模型（请求别名）</Label>
            <ModelSelector
              value={draft}
              onChange={setDraft}
              placeholder="例如 team-chat"
              options={modelOptions}
              sessionIssue={sessionIssue}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="manager-model-provider">Provider（可选）</Label>
            <Combobox
              id="manager-model-provider"
              value={provider}
              options={providerCatalog.providers}
              onChange={(next) => {
                setProvider(next);
                setProviderTouched(true);
              }}
              placeholder={providerHint ? `当前解析：${providerHint}` : '留空 = 保持 Controller 现值'}
              ariaLabel="Provider（可选）"
            />
            <p className="text-xs text-muted-foreground">
              多 provider 部署下同时下发 model 与 provider；留空则沿用 Controller 现值。
            </p>
          </div>

          <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
            子代理模型（spawn / sub）：当前 Controller 的 Manager 更新接口未接收该字段，
            这里不下发（配置后会静默失效，故不提供入口）。
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button
            disabled={!changed || saving || !draft.trim()}
            onClick={() => onSubmit(draft.trim(), providerTouched ? provider.trim() : '')}
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

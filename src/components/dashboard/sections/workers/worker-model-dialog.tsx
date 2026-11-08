'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ModelSelector } from '@/components/dashboard/sections/shared/model-selector';
import { InfoTip } from '@/components/dashboard/info-tip';
import { useUpdateWorker } from '@/hooks/use-agentteams-mutations';
import type { ModelSelectionOption } from '@/lib/model-catalog';

/**
 * 仅编辑 model 的最小弹窗（PUT /workers/{name} 为合并语义，只下发 model）。
 * 完整表单编辑仍走列表页的 WorkerEditDialog；抽屉里的模型卡只负责这一件事。
 */
export function WorkerModelDialog({
  open,
  workerName,
  model,
  modelProvider,
  providerHint,
  modelOptions,
  sessionIssue,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  workerName: string;
  model: string;
  modelProvider?: string;
  /** 由模型别名解析出的 provider 提示（只读，未显式填写时展示）。 */
  providerHint?: string;
  modelOptions: ModelSelectionOption[];
  sessionIssue?: string | null;
  onOpenChange: (_open: boolean) => void;
  /** 保存成功后回传本次写入的 model（团队抽屉用它同步行内基线）。 */
  onSaved?: (_model?: string) => void;
}) {
  const [draft, setDraft] = useState(model);
  const [provider, setProvider] = useState(modelProvider ?? '');
  const [providerTouched, setProviderTouched] = useState(false);
  const [initMarker, setInitMarker] = useState(`${workerName}\u0000${model}\u0000${modelProvider ?? ''}`);
  const marker = `${workerName}\u0000${model}\u0000${modelProvider ?? ''}`;
  if (initMarker !== marker) {
    setInitMarker(marker);
    setDraft(model);
    setProvider(modelProvider ?? '');
    setProviderTouched(false);
  }
  const updateWorker = useUpdateWorker();
  const changed = draft.trim() !== model.trim() || providerTouched;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-w-[95vw]">
        <DialogHeader>
          <DialogTitle>编辑模型 - {workerName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <div className="flex items-center gap-1">
            <Label>请求模型别名</Label>
            <InfoTip label="模型访问与验证说明">
              Worker 通过 AI 网关访问模型。已配置别名仅表示存在模型映射，请运行「已保存配置的网关验证」确认授权与调用。
            </InfoTip>
          </div>
          <ModelSelector
            value={draft}
            onChange={setDraft}
            placeholder="例如 team-chat"
            options={modelOptions}
            sessionIssue={sessionIssue}
          />
          <div className="space-y-1 pt-2">
            <Label>Provider（可选）</Label>
            <Input
              value={provider}
              onChange={(event) => {
                setProvider(event.target.value);
                setProviderTouched(true);
              }}
              placeholder={providerHint ? `当前解析：${providerHint}` : '留空 = 保持控制器现值'}
            />
            <p className="text-xs text-muted-foreground">
              多 provider 部署下同时下发 model 与 provider；留空则沿用控制器现值。
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={!changed || updateWorker.isPending}
            onClick={() => {
              const data = {
                model: draft.trim(),
                ...(providerTouched && provider.trim() ? { modelProvider: provider.trim() } : {}),
              };
              updateWorker.mutate(
                { name: workerName, data },
                {
                  onSuccess: () => {
                    onOpenChange(false);
                    onSaved?.(draft.trim());
                  },
                },
              );
            }}
          >
            {updateWorker.isPending ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

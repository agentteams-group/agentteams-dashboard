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
import { Label } from '@/components/ui/label';
import { ModelPicker } from '@/components/dashboard/sections/shared/model-picker';
import { InfoTip } from '@/components/dashboard/info-tip';
import { useUpdateWorker } from '@/hooks/use-agentteams-mutations';
import { formatErrorMessage } from '@/lib/api-error';
import {
  buildModelCandidateCatalog,
  type ModelSelectionOption,
} from '@/lib/model-catalog';

/**
 * 仅编辑 model 的最小弹窗（PUT /workers/{name} 为合并语义，只下发 model）。
 * 完整表单编辑仍走列表页的 WorkerEditDialog；抽屉里的模型卡只负责这一件事。
 *
 * 1:1 插件语义：先 Provider 再 Model；provider 只在「用户真的改了」时下发，
 * 未改（含列表投影没带 provider、但解析结果等于现值）不写 modelProvider，
 * 避免外部 Higress 模式被 409 拒绝或把自动推断值写回控制器。
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
  /** 保存成功后回传本次写入的 model/provider（团队抽屉用它同步行内基线）。 */
  onSaved?: (_result: { model: string; provider: string }) => void;
}) {
  const initialProvider = (modelProvider ?? '').trim();
  const [draft, setDraft] = useState(model);
  const [provider, setProvider] = useState(initialProvider);
  const [providerTouched, setProviderTouched] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastRequestBody, setLastRequestBody] = useState<string | null>(null);
  const [initMarker, setInitMarker] = useState(
    `${workerName}\u0000${model}\u0000${initialProvider}`,
  );
  const marker = `${workerName}\u0000${model}\u0000${initialProvider}`;
  if (initMarker !== marker) {
    setInitMarker(marker);
    setDraft(model);
    setProvider(initialProvider);
    setProviderTouched(false);
    setSaveError(null);
    setLastRequestBody(null);
  }
  const updateWorker = useUpdateWorker();
  const catalog = buildModelCandidateCatalog(modelOptions);
  const changed =
    draft.trim() !== model.trim() || provider.trim() !== initialProvider;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full min-w-0 max-w-[95vw] items-start overflow-x-hidden overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>编辑模型 - {workerName}</DialogTitle>
        </DialogHeader>
        <div className="min-w-0 space-y-2 py-2">
          <div className="flex items-center gap-1">
            <Label>模型访问与验证说明</Label>
            <InfoTip label="模型访问与验证说明">
              Worker 通过 AI 网关访问模型。已配置别名仅表示存在模型映射，请运行「已保存配置的网关验证」确认授权与调用。
            </InfoTip>
          </div>
          <ModelPicker
            providers={catalog.providers}
            provider={provider}
            model={draft}
            modelsByProvider={catalog.modelsByProvider}
            allModels={catalog.models}
            providerPlaceholder={
              providerHint ? `当前解析：${providerHint}` : '选择或输入 Provider'
            }
            modelPlaceholder="例如 team-chat"
            onChange={(nextProvider, nextModel) => {
              const providerChanged = nextProvider.trim() !== provider.trim();
              setDraft(nextModel);
              setSaveError(null);
              if (providerChanged) {
                setProvider(nextProvider);
                setProviderTouched(true);
                return;
              }
              // 选模型时若该 alias 有网关绑定、且用户没手改 provider → 自动跟随。
              if (!providerTouched) {
                const mappedProvider = catalog.providerByModel[nextModel];
                setProvider(mappedProvider ?? (nextModel ? provider : ''));
              }
            }}
          />
          {providerHint && !provider.trim() ? (
            <p className="text-xs text-muted-foreground break-words">
              当前解析：{providerHint}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground break-words">
            多 provider 部署下先选 Provider 再选 Model；Provider 只在改动时下发。
            留空 = 不绑定 provider，沿用控制器现值。
          </p>
          {sessionIssue ? (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-600 break-words">
              模型别名组暂不可用：{sessionIssue}。内置模型与自定义输入仍可使用。
            </p>
          ) : null}
          {saveError ? (
            <div
              role="alert"
              className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive"
            >
              <p className="break-words">{saveError}</p>
              {lastRequestBody ? (
                <p className="break-words font-mono text-[11px] text-muted-foreground">
                  请求：PUT /api/agentteams/workers/{encodeURIComponent(workerName)} · body{' '}
                  {lastRequestBody}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={!changed || updateWorker.isPending}
            onClick={() => {
              const trimmedModel = draft.trim();
              const trimmedProvider = provider.trim();
              const data: { model: string; modelProvider?: string } = {
                model: trimmedModel,
              };
              // 只在 provider 真的变化且非空时下发；未改/空 = 保持控制器现值。
              if (trimmedProvider && trimmedProvider !== initialProvider) {
                data.modelProvider = trimmedProvider;
              }
              const requestBody = JSON.stringify(data);
              setLastRequestBody(requestBody);
              setSaveError(null);
              updateWorker.mutate(
                { name: workerName, data },
                {
                  onSuccess: () => {
                    onOpenChange(false);
                    onSaved?.({ model: trimmedModel, provider: trimmedProvider });
                  },
                  onError: (err) => {
                    setSaveError(formatErrorMessage(err));
                    // 诊断：只记录方法/路径/脱敏 body（不含 token）。
                    console.error('[WorkerModelDialog] 更新模型失败', {
                      request: {
                        method: 'PUT',
                        path: `/api/agentteams/workers/${encodeURIComponent(workerName)}`,
                        body: data,
                      },
                      error: err,
                    });
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

'use client';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
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
import { useState } from 'react';
import type { UpdateManagerRequest } from '@/lib/agentteams-api';
import {
  buildModelCandidateCatalog,
  type ModelSelectionOption,
} from '@/lib/model-catalog';
import { ModelPicker } from '@/components/dashboard/sections/shared/model-picker';
import { CREATABLE_MANAGER_RUNTIMES, isLegacyCopaw } from '@/lib/runtime-options';
import { InfoTip } from '@/components/dashboard/info-tip';

export type ManagerEditForm = UpdateManagerRequest & { name?: string };

export function ManagerEditDialog({
  open,
  managerName,
  value,
  onChange,
  isPending,
  onOpenChange,
  onSubmit,
  modelOptions,
  modelProvider,
  sessionIssue,

}: {
  open: boolean;
  managerName: string | null;
  value: ManagerEditForm;
  onChange: (_next: ManagerEditForm) => void;
  isPending: boolean;
  onOpenChange: (_open: boolean) => void;
  onSubmit: () => void;
  modelOptions: ModelSelectionOption[];
  /** 控制器现值（未改不写回；只在表单里出现真变化的值）。 */
  modelProvider?: string;
  sessionIssue?: string | null;

}) {
  const initialProvider = (modelProvider ?? '').trim();
  const [provider, setProvider] = useState(initialProvider);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setProvider(initialProvider);
  }
  const modelCatalog = buildModelCandidateCatalog(modelOptions ?? []);
  const handleModelChange = (nextProvider: string, nextModel: string) => {
    const trimmed = nextProvider.trim();
    setProvider(nextProvider);
    const next: ManagerEditForm = { ...value, model: nextModel };
    // provider 真变化且非空才带；未改（或改回原值）= 不下发，沿用控制器现值。
    if (trimmed && trimmed !== initialProvider) next.modelProvider = trimmed;
    else delete next.modelProvider;
    onChange(next);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-w-[95vw]">
        <DialogHeader>
          <DialogTitle>编辑 Manager - {managerName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <div className="flex items-center gap-1">
              <Label>请求模型别名</Label>
              <InfoTip label="模型访问与验证说明">
                Manager 通过 AI 网关访问模型。已配置别名仅表示存在模型映射，请运行「已保存配置的网关验证」。
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
          <div className="space-y-2">
            <Label>运行时</Label>
            <Select
              value={value.runtime || ''}
              disabled
            >
              <SelectTrigger className="w-full min-w-0">
                <SelectValue placeholder="选择运行时" />
              </SelectTrigger>
              <SelectContent>
                {isLegacyCopaw(value.runtime) && (
                  <SelectItem value="copaw" disabled>
                    CoPaw（存量，请升级到 QwenPaw）
                  </SelectItem>
                )}
                {CREATABLE_MANAGER_RUNTIMES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              运行时切换暂不可用（上游运行时适配尚未就绪）
            </p>
            {isLegacyCopaw(value.runtime) && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                CoPaw 已停止新建。将运行时改为 QwenPaw 后保存即可升级；升级前请备份持久化数据。
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>镜像</Label>
            <Input
              value={value.image || ''}
              onChange={(e) => onChange({ ...value, image: e.target.value })}
              placeholder="容器镜像地址"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={onSubmit}
            disabled={isPending}
          >
            {isPending ? '更新中...' : '更新'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
import type { CreateManagerRequest } from '@/lib/agentteams-api';
import {
  buildModelCandidateCatalog,
  type ModelSelectionOption,
} from '@/lib/model-catalog';
import { ModelPicker } from '@/components/dashboard/sections/shared/model-picker';
import { CREATABLE_MANAGER_RUNTIMES } from '@/lib/runtime-options';
import { InfoTip } from '@/components/dashboard/info-tip';

export function ManagerCreateDialog({
  open,
  value,
  onChange,
  isPending,
  onOpenChange,
  onSubmit,
  modelOptions,
  sessionIssue,

}: {
  open: boolean;
  value: CreateManagerRequest;
  onChange: (_next: CreateManagerRequest) => void;
  isPending: boolean;
  onOpenChange: (_open: boolean) => void;
  onSubmit: () => void;
  modelOptions: ModelSelectionOption[];
  sessionIssue?: string | null;

}) {
  const modelCatalog = buildModelCandidateCatalog(modelOptions ?? []);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-w-[95vw]">
        <DialogHeader>
          <DialogTitle>创建 Manager</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>名称 *</Label>
            <Input
              value={value.name}
              onChange={(e) => onChange({ ...value, name: e.target.value })}
              placeholder="manager-name"
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-1">
              <Label>请求模型别名</Label>
              <InfoTip label="模型访问与验证说明">
                <span className="block">Manager 通过 AI 网关访问模型，使用 Consumer 凭证认证，无需提供真实 API Key。</span>
                <span className="mt-1 block">已配置别名仅表示存在模型映射。创建后请在编辑页运行「已保存配置的网关验证」。</span>
              </InfoTip>
            </div>
            <ModelPicker
              providers={modelCatalog.providers}
              provider={value.modelProvider ?? ''}
              model={value.model ?? ''}
              modelsByProvider={modelCatalog.modelsByProvider}
              allModels={modelCatalog.models}
              modelPlaceholder="例如 team-chat"
              providerPlaceholder="选择或输入 Provider（留空 = 跟随默认）"
              onChange={(provider, model) =>
                onChange({ ...value, model, modelProvider: provider.trim() || undefined })
              }
            />
            {sessionIssue ? (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-600 break-words">
                模型别名组暂不可用：{sessionIssue}。内置模型与自定义输入仍可使用。
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-1">
              <Label>运行时</Label>
              <InfoTip label="运行时选择说明">推荐 QwenPaw。CoPaw 已停止新建。</InfoTip>
            </div>
            <Select
              value={value.runtime || 'openclaw'}
              onValueChange={(runtime) => onChange({ ...value, runtime })}
            >
              <SelectTrigger className="w-full min-w-0">
                <SelectValue placeholder="选择运行时" />
              </SelectTrigger>
              <SelectContent>
                {CREATABLE_MANAGER_RUNTIMES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>镜像</Label>
            <Input
              value={value.image || ''}
              onChange={(e) => onChange({ ...value, image: e.target.value })}
              placeholder="容器镜像地址（可选）"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={onSubmit}
            disabled={!value.name || isPending}
          >
            {isPending ? '创建中...' : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

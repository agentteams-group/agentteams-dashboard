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
import type { ModelSelectionOption } from '@/lib/model-catalog';
import { ModelSelector } from '@/components/dashboard/sections/shared/model-selector';
import { CREATABLE_MANAGER_RUNTIMES } from '@/lib/runtime-options';

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
            <Label>请求模型别名</Label>
            <ModelSelector
              value={value.model}
              onChange={(model) => onChange({ ...value, model })}
              placeholder="例如 team-chat"
              options={modelOptions}
              sessionIssue={sessionIssue}
            />
            <p className="text-xs text-muted-foreground">
              Manager 通过 AI 网关访问模型，使用 Consumer 凭证认证，无需提供真实 API Key。
            </p>
          </div>
          <div className="space-y-2">
            <Label>运行时</Label>
            <Select
              value={value.runtime || 'openclaw'}
              onValueChange={(runtime) => onChange({ ...value, runtime })}
            >
              <SelectTrigger>
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
            <p className="text-xs text-muted-foreground">
              推荐 QwenPaw。CoPaw 已停止新建。
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={onSubmit}
            disabled={!value.name || isPending}
            className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:from-emerald-600 hover:to-teal-600"
          >
            {isPending ? '创建中...' : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

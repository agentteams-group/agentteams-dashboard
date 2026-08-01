'use client';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { UpdateManagerRequest } from '@/lib/agentteams-api';
import type { ModelSelectionOption } from '@/lib/model-catalog';
import { ModelSelector } from '@/components/dashboard/sections/shared/model-selector';

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
}: {
  open: boolean;
  managerName: string | null;
  value: ManagerEditForm;
  onChange: (_next: ManagerEditForm) => void;
  isPending: boolean;
  onOpenChange: (_open: boolean) => void;
  onSubmit: () => void;
  modelOptions: ModelSelectionOption[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-w-[95vw]">
        <DialogHeader>
          <DialogTitle>编辑 Manager - {managerName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>请求模型别名</Label>
            <ModelSelector
              value={value.model}
              onChange={(model) => onChange({ ...value, model })}
              placeholder="例如 team-chat"
              options={modelOptions}
            />
          </div>
          <div className="space-y-2">
            <Label>运行时</Label>
            <Input
              value={value.runtime || ''}
              onChange={(e) => onChange({ ...value, runtime: e.target.value })}
              placeholder="运行时名称"
            />
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
            className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:from-emerald-600 hover:to-teal-600"
          >
            {isPending ? '更新中...' : '更新'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

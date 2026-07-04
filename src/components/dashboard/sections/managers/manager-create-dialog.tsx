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
import type { CreateManagerRequest } from '@/lib/hiclaw-api';
import { ModelSelector } from '@/components/dashboard/sections/shared/model-selector';

export function ManagerCreateDialog({
  open,
  value,
  onChange,
  isPending,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  value: CreateManagerRequest;
  onChange: (_next: CreateManagerRequest) => void;
  isPending: boolean;
  onOpenChange: (_open: boolean) => void;
  onSubmit: () => void;
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
            <Label>模型</Label>
            <ModelSelector
              value={value.model}
              onChange={(model) => onChange({ ...value, model })}
              placeholder="选择模型"
            />
          </div>
          <div className="space-y-2">
            <Label>运行时</Label>
            <Input
              value={value.runtime || ''}
              onChange={(e) => onChange({ ...value, runtime: e.target.value })}
              placeholder="运行时名称（可选）"
            />
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
            className="bg-gradient-to-r from-orange-500 to-red-500 text-white hover:from-orange-600 hover:to-red-600"
          >
            {isPending ? '创建中...' : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

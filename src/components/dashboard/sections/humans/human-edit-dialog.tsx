'use client';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
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
import type { UpdateHumanRequest } from '@/lib/agentteams-api';
import { PERMISSION_LABELS, PERMISSION_LEVELS } from './human-types';

export type HumanEditForm = UpdateHumanRequest & { name?: string };

export function HumanEditDialog({
  open,
  humanName,
  value,
  onChange,
  isPending,
  errorMessage,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  humanName: string | null;
  value: HumanEditForm;
  onChange: (_next: HumanEditForm) => void;
  isPending: boolean;
  errorMessage?: string | null;
  onOpenChange: (_open: boolean) => void;
  onSubmit: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-w-[95vw]">
        <DialogHeader>
          <DialogTitle>编辑 Human - {humanName}</DialogTitle>
        </DialogHeader>
        {errorMessage && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-muted-foreground">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
            <p>{errorMessage}</p>
          </div>
        )}
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>显示名称</Label>
            <Input
              value={value.displayName || ''}
              onChange={(e) => onChange({ ...value, displayName: e.target.value })}
              placeholder="用户显示名称"
            />
          </div>
          <div className="space-y-2">
            <Label>邮箱</Label>
            <Input
              value={value.email || ''}
              onChange={(e) => onChange({ ...value, email: e.target.value || undefined })}
              placeholder="user@example.com"
            />
          </div>
          <div className="space-y-2">
            <Label>权限等级</Label>
            <Select
              value={String(value.permissionLevel || 1)}
              onValueChange={(v) =>
                onChange({ ...value, permissionLevel: Number(v) as 1 | 2 | 3 })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERMISSION_LEVELS.map((lvl) => (
                  <SelectItem key={lvl} value={String(lvl)}>
                    {lvl} - {PERMISSION_LABELS[lvl]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>可访问团队（逗号分隔）</Label>
            <Input
              value={value.accessibleTeams?.join(', ') || ''}
              onChange={(e) =>
                onChange({
                  ...value,
                  accessibleTeams: e.target.value
                    ? e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
                    : undefined,
                })
              }
              placeholder="team1, team2, team3"
            />
          </div>
          <div className="space-y-2">
            <Label>可访问 Workers（逗号分隔）</Label>
            <Input
              value={value.accessibleWorkers?.join(', ') || ''}
              onChange={(e) =>
                onChange({
                  ...value,
                  accessibleWorkers: e.target.value
                    ? e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
                    : undefined,
                })
              }
              placeholder="worker1, worker2, worker3"
            />
          </div>
          <div className="space-y-2">
            <Label>备注</Label>
            <Input
              value={value.note || ''}
              onChange={(e) => onChange({ ...value, note: e.target.value || undefined })}
              placeholder="备注信息"
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
            className="bg-gradient-to-r from-orange-500 to-red-500 text-white hover:from-orange-600 hover:to-red-600"
          >
            {isPending ? '更新中...' : '更新'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

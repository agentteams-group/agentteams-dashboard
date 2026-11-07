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
import type { CreateHumanRequest } from '@/lib/agentteams-api';
import { PERMISSION_LABELS, PERMISSION_LEVELS } from './human-types';

export function HumanCreateDialog({
  open,
  value,
  onChange,
  isPending,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  value: CreateHumanRequest;
  onChange: (_next: CreateHumanRequest) => void;
  isPending: boolean;
  onOpenChange: (_open: boolean) => void;
  onSubmit: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-w-[95vw]">
        <DialogHeader>
          <DialogTitle>创建 Human</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>名称 *</Label>
            <Input
              value={value.name}
              onChange={(e) => onChange({ ...value, name: e.target.value })}
              placeholder="human-name"
            />
          </div>
          <div className="space-y-2">
            <Label>显示名称 *</Label>
            <Input
              value={value.displayName}
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
              // CR 标尺（1=管理员 2=团队成员 3=Worker）：默认 2，不默认给管理员
              value={String(value.permissionLevel ?? 2)}
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={onSubmit}
            disabled={!value.name || !value.displayName || isPending}
          >
            {isPending ? '创建中...' : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

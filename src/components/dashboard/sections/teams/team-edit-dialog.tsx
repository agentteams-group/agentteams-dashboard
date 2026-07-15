'use client';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { UpdateTeamRequest } from '@/lib/agentteams-api';

export type TeamEditForm = UpdateTeamRequest & { name?: string };

export function TeamEditDialog({
  open,
  teamName,
  value,
  onChange,
  isPending,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  teamName: string | null;
  value: TeamEditForm;
  onChange: (_next: TeamEditForm) => void;
  isPending: boolean;
  onOpenChange: (_open: boolean) => void;
  onSubmit: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-w-[95vw]">
        <DialogHeader>
          <DialogTitle>编辑团队 - {teamName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>团队名称</Label>
            <Input
              value={value.teamName || ''}
              onChange={(e) => onChange({ ...value, teamName: e.target.value })}
              placeholder="显示名称"
            />
          </div>
          <div className="space-y-2">
            <Label>描述</Label>
            <Textarea
              value={value.description || ''}
              onChange={(e) => onChange({ ...value, description: e.target.value })}
              placeholder="团队描述"
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label>Worker 名称（逗号分隔）</Label>
            <Input
              value={value.workerNames?.join(', ') || ''}
              onChange={(e) =>
                onChange({
                  ...value,
                  workerNames: e.target.value
                    ? e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
                    : [],
                })
              }
              placeholder="worker1, worker2"
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
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {isPending ? '更新中...' : '更新'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

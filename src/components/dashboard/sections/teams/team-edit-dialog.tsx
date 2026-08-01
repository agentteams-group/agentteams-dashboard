'use client';

import { useState } from 'react';
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
import { parseWorkerNames } from './team-create-dialog';

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
  // Keep the raw worker list text locally so a trailing separator the user
  // types is preserved on screen; value.workerNames holds the parsed names.
  // Re-sync from the external value whenever the dialog opens.
  const [lastOpen, setLastOpen] = useState(open);
  const [workerInput, setWorkerInput] = useState(value.workerNames?.join(', ') ?? '');
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setWorkerInput(value.workerNames?.join(', ') ?? '');
    }
  }
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
            <Label>Worker 名称（中英文逗号分隔）</Label>
            <Input
              value={workerInput}
              onChange={(e) => {
                const text = e.target.value;
                setWorkerInput(text);
                onChange({
                  ...value,
                  workerNames: text ? parseWorkerNames(text) : [],
                });
              }}
              placeholder="worker1, worker2 或 worker1，worker2"
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

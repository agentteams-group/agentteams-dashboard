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
import type { CreateTeamRequest, WorkerResponse } from '@/lib/agentteams-api';

export function parseWorkerNames(value: string): string[] {
  return value.split(/[,，]/).map((name) => name.trim()).filter(Boolean);
}

export function TeamCreateDialog({
  open,
  value,
  onChange,
  isPending,
  onOpenChange,
  onSubmit,
  workers,
}: {
  open: boolean;
  value: CreateTeamRequest;
  onChange: (_next: CreateTeamRequest) => void;
  isPending: boolean;
  onOpenChange: (_open: boolean) => void;
  onSubmit: () => void;
  workers: WorkerResponse[];
}) {
  // Keep the raw worker list text locally so a trailing separator the user
  // types (e.g. "worker1,") is preserved on screen; value.workerNames always
  // holds the parsed, trimmed names. Re-sync from the external value whenever
  // the dialog opens.
  const [lastOpen, setLastOpen] = useState(open);
  const [workerInput, setWorkerInput] = useState(value.workerNames?.join(', ') ?? '');
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setWorkerInput(value.workerNames?.join(', ') ?? '');
    }
  }
  const selectedWorkers = workers.filter((worker) => value.workerNames?.includes(worker.name));
  const workersWithoutModel = selectedWorkers.filter((worker) => !worker.model?.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-w-[95vw]">
        <DialogHeader>
          <DialogTitle>创建团队</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>名称 *</Label>
            <Input
              value={value.name}
              onChange={(e) => onChange({ ...value, name: e.target.value })}
              placeholder="team-name"
            />
          </div>
          <div className="space-y-2">
            <Label>Leader 名称 *</Label>
            <Input
              value={value.leader?.name || ''}
              onChange={(e) => onChange({ ...value, leader: { name: e.target.value } })}
              placeholder="leader-name"
            />
          </div>
          <div className="space-y-2">
            <Label>团队名称</Label>
            <Input
              value={value.teamName || ''}
              onChange={(e) => onChange({ ...value, teamName: e.target.value })}
              placeholder="显示名称（可选）"
            />
          </div>
          <div className="space-y-2">
            <Label>描述</Label>
            <Textarea
              value={value.description || ''}
              onChange={(e) => onChange({ ...value, description: e.target.value })}
              placeholder="团队描述（可选）"
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
                  workerNames: text ? parseWorkerNames(text) : undefined,
                });
              }}
              placeholder="worker1, worker2 或 worker1，worker2"
            />
          </div>
          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
            <p>团队模型由 Leader 运行时与成员 Worker 的“请求模型别名”分别管理。</p>
            {workersWithoutModel.length > 0 ? (
              <p className="text-amber-600 dark:text-amber-400">
                以下已选 Worker 仍需配置模型：{workersWithoutModel.map((worker) => worker.name).join('、')}
              </p>
            ) : selectedWorkers.length > 0 ? (
              <p className="text-emerald-600 dark:text-emerald-400">已选 Worker 均已填写请求模型别名。</p>
            ) : (
              <p>添加成员后可在此检查成员模型配置。</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={onSubmit}
            disabled={!value.name || !value.leader?.name || isPending}
            className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:from-emerald-600 hover:to-teal-600"
          >
            {isPending ? '创建中...' : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { useState } from 'react';
import { Shield } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MemberPicker } from '@/components/dashboard/sections/shared/member-picker';
import { useUpdateHuman } from '@/hooks/use-agentteams-mutations';
import { ApiError, formatErrorMessage } from '@/lib/api-error';
import type { HumanConfigRecord, HumanResponse } from '@/lib/agentteams-api';
import {
  PERMISSION_BADGE_CLASSES,
  PERMISSION_LABELS,
  PERMISSION_LEVELS,
} from './human-types';

function recordList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export function HumanAccessDialog({
  open,
  human,
  record,
  teamNames,
  workerNames,
  canManage,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  human: HumanResponse;
  record: HumanConfigRecord | null;
  teamNames: string[];
  workerNames: string[];
  canManage: boolean;
  onOpenChange: (_open: boolean) => void;
  onSaved: () => void;
}) {
  const updateHuman = useUpdateHuman();
  const currentLevel = record?.permissionLevel ?? human.permissionLevel ?? 2;
  const currentTeams = recordList(record?.accessibleTeams ?? human.accessibleTeams);
  const currentWorkers = recordList(record?.accessibleWorkers ?? human.accessibleWorkers);

  const [level, setLevel] = useState<number>(currentLevel);
  const [teams, setTeams] = useState<string[]>(currentTeams);
  const [workers, setWorkers] = useState<string[]>(currentWorkers);
  const [error, setError] = useState('');

  const changed =
    level !== currentLevel ||
    teams.join('|') !== currentTeams.join('|') ||
    workers.join('|') !== currentWorkers.join('|');
  const pending = updateHuman.isPending;

  const save = async () => {
    if (!canManage || pending) return;
    setError('');
    try {
      await updateHuman.mutateAsync({
        name: human.name,
        data: {
          permissionLevel: level as 1 | 2 | 3,
          accessibleTeams: teams,
          accessibleWorkers: workers,
        },
      });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      const prefix = err instanceof ApiError && err.status === 403 ? '403 无权限：' : '保存失败：';
      setError(`${prefix}${formatErrorMessage(err)}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-w-[95vw] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            访问与权限 · {human.name}
          </DialogTitle>
          <DialogDescription>
            权限档位、可访问团队与可访问 Worker 一次保存；只改这三个字段。
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto py-1">
          {!canManage && (
            <p role="status" className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-600 dark:text-amber-400">
              只读（403）：需要 L1 管理员权限（Controller 管理员 token）才能保存。
            </p>
          )}
          {error && (
            <p role="alert" className="break-words rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="human-access-level">权限档位</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={String(level)}
                onValueChange={(value) => setLevel(Number(value))}
                disabled={!canManage || pending}
              >
                <SelectTrigger id="human-access-level" className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERMISSION_LEVELS.map((item) => (
                    <SelectItem key={item} value={String(item)}>
                      {item} - {PERMISSION_LABELS[item]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Badge variant="outline" className={`text-xs ${PERMISSION_BADGE_CLASSES[level] || ''}`}>
                L{level}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              L1 = 管理员（Controller 管理员 token）；L2 = 团队成员；L3 = Worker 级。
            </p>
          </div>

          <div className="space-y-2">
            <Label>可访问团队</Label>
            <MemberPicker
              options={teamNames.map((name) => ({ value: name, label: name }))}
              selected={teams}
              onAdd={(name) => setTeams((prev) => [...prev, name])}
              onRemove={(name) => setTeams((prev) => prev.filter((item) => item !== name))}
              placeholder="选择团队添加…"
            />
          </div>

          <div className="space-y-2">
            <Label>可访问 Workers</Label>
            <MemberPicker
              options={workerNames.map((name) => ({ value: name, label: name }))}
              selected={workers}
              onAdd={(name) => setWorkers((prev) => [...prev, name])}
              onRemove={(name) => setWorkers((prev) => prev.filter((item) => item !== name))}
              placeholder="选择 Worker 添加…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            取消
          </Button>
          <Button
            className="min-h-11"
            onClick={() => void save()}
            disabled={!canManage || pending || !changed}
          >
            {pending ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

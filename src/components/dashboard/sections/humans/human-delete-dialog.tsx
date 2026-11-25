'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function HumanDeleteDialog({
  open,
  humanName,
  isPending,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  humanName: string;
  isPending: boolean;
  onOpenChange: (_open: boolean) => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState('');
  const matched = typed.trim() === humanName;

  return (
    <Dialog open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <DialogContent className="max-w-[95vw] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            删除人员 {humanName}
          </DialogTitle>
          <DialogDescription className="break-words">
            删除 Human CR：Matrix 账号停用并离开全部房间；文件区对象保留。此操作不可撤销。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-1">
          <Label htmlFor="human-delete-confirm">
            输入 {humanName} 以确认删除
          </Label>
          <Input
            id="human-delete-confirm"
            value={typed}
            placeholder={humanName}
            autoComplete="off"
            disabled={isPending}
            onChange={(event) => setTyped(event.target.value)}
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            取消
          </Button>
          <Button
            variant="destructive"
            className="min-h-11"
            onClick={onConfirm}
            disabled={!matched || isPending}
          >
            {isPending ? '删除中…' : '删除'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

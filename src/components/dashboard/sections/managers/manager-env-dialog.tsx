'use client';

// Manager Env 弹窗：复用 Worker 的 kv 行编辑器（同校验：变量名格式 / 重复 /
// NUL）。保存为整表替换。
//
// 入口以 Controller 返回的 envEditable 为准；保存后由详情面板回读确认。

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { WorkerEnvEditor } from '@/components/dashboard/sections/workers/worker-env-editor';

export function ManagerEnvDialog({
  open,
  managerName,
  value,
  saving,
  onCancel,
  onSubmit,
  error,
}: {
  open: boolean;
  managerName: string;
  value: Record<string, string>;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (_env: Record<string, string>) => void;
  error?: string | null;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(value);
  const [valid, setValid] = useState(true);
  const [initMarker, setInitMarker] = useState(managerName);
  const [wasOpen, setWasOpen] = useState(open);
  if (initMarker !== managerName) {
    setInitMarker(managerName);
    setDraft(value);
  }
  // 每次打开都从当前 spec 重新起稿（取消后重开不留上次未保存的改动）。
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setDraft(value);
      setValid(true);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="max-w-[95vw] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>环境变量 - {managerName}</DialogTitle>
          <DialogDescription>
            每行一个环境变量；保存为整表替换（清空全部 = 保存空表）。
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto py-2">
          <WorkerEnvEditor value={value} onChange={setDraft} onValidityChange={setValid} resource="Manager" />
        </div>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button disabled={saving || !valid} onClick={() => onSubmit(draft)}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

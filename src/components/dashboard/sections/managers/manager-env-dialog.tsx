'use client';

// Manager Env 弹窗：复用 Worker 的 kv 行编辑器（同校验：变量名格式 / 重复 /
// NUL）。保存为整表替换。
//
// 注意契约缺口：Controller 的 UpdateManagerRequest 目前没有 env 字段，PUT 会
// 静默忽略——保存后回读不一致时由抽屉给出「未生效」提示（不假装成功）。

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
}: {
  open: boolean;
  managerName: string;
  value: Record<string, string>;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (_env: Record<string, string>) => void;
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
          <DialogTitle>Env 配置 - {managerName}</DialogTitle>
          <DialogDescription>
            每行一个环境变量；保存为整表替换（清空全部 = 保存空表）。
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto py-2">
          <WorkerEnvEditor value={value} onChange={setDraft} onValidityChange={setValid} />
        </div>

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

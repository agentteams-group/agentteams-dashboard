'use client';

// Manager 文档（SOUL.md / AGENTS.md）查看 + 编辑弹窗：等宽 textarea，保存前二次
// 确认。Controller 只在内容非空时写（UpdateManager: `if req.Soul != ""`），
// 空草稿清不掉既有内容——本地拦下并说明，不制造「已保存但没变」。

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export type ManagerDocKind = 'soul' | 'agents';

export const MANAGER_DOC_META: Record<ManagerDocKind, { file: string; hint: string }> = {
  soul: { file: 'SOUL.md', hint: '人格 / 身份定义（Manager 的自我描述）' },
  agents: { file: 'AGENTS.md', hint: '操作规则 / 纪律（Manager 的工作约束）' },
};

export function ManagerDocDialog({
  open,
  kind,
  initial,
  saving,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  kind: ManagerDocKind;
  initial: string;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (_draft: string) => void;
}) {
  const meta = MANAGER_DOC_META[kind];
  const [draft, setDraft] = useState(initial);
  const [initMarker, setInitMarker] = useState(initial);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (initMarker !== initial) {
    setInitMarker(initial);
    setDraft(initial);
  }
  // 每次打开都从当前 spec 重新起稿（取消后重开不留上次未保存的改动）。
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setDraft(initial);
      setLocalError(null);
      setConfirmOpen(false);
    }
  }

  const changed = draft !== initial;

  const requestSave = () => {
    if (draft.trim() === '' && initial.trim() !== '') {
      setLocalError('空内容无法清除既有值（Controller 仅应用非空值），已保留原值');
      return;
    }
    setLocalError(null);
    setConfirmOpen(true);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
        <DialogContent className="flex h-[86vh] max-w-none flex-col gap-0 overflow-hidden p-0 w-[min(96vw,960px)] max-sm:h-[100dvh] max-sm:w-full max-sm:rounded-none">
          <DialogHeader className="shrink-0 border-b px-5 py-3 text-left">
            <DialogTitle>编辑 {meta.file}</DialogTitle>
            <DialogDescription>{meta.hint}</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 p-4">
            <textarea
              aria-label={`${meta.file} 内容`}
              className="h-full min-h-[300px] w-full resize-none rounded-md border bg-background p-3 font-mono text-xs leading-relaxed"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={
                kind === 'soul'
                  ? 'SOUL.md 内容（人格 / 身份定义）'
                  : 'AGENTS.md 内容（操作规则 / 纪律）'
              }
            />
          </div>

          <DialogFooter className="shrink-0 border-t px-5 py-3">
            {localError ? (
              <p role="alert" className="mr-auto text-xs text-destructive">
                {localError}
              </p>
            ) : (
              <p className="mr-auto text-xs text-muted-foreground">
                {draft.length} 字符{changed ? ' · 有未保存修改' : ''}
              </p>
            )}
            <Button variant="outline" onClick={onCancel}>
              取消
            </Button>
            <Button disabled={!changed || saving} onClick={requestSave}>
              {saving ? (
                <>
                  <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden="true" />
                  保存中…
                </>
              ) : (
                '保存'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认覆盖 {meta.file}？</AlertDialogTitle>
            <AlertDialogDescription>
              保存会整篇覆盖该 Manager 的 {meta.file}，AgentTeams Controller 将在下次调谐时下发到容器。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={() => {
                setConfirmOpen(false);
                onSubmit(draft);
              }}
            >
              确认保存
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

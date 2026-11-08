'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import {
  bytesToQuotaInput,
  movePath,
  needsUnsavedConfirm,
  quotaExactText,
  quotaFormValid,
  quotaValueToBytes,
  renamePath,
  resolveTargetDir,
  validateFileName,
  type QuotaUnit,
  type QuotaView,
} from '@/lib/files-model';
import { filesErrorText } from '@/lib/files-model';
import { humanFilesApi, HumanFilesError } from '@/lib/human-files-api';

export interface FileOpTarget {
  path: string;
  name: string;
  isDir: boolean;
  size?: number;
}

interface ShellProps {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function DialogShell({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: ShellProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}

function ErrorLine({ text }: { text: string }) {
  if (!text) return null;
  return (
    <p role="alert" className="text-xs text-destructive">
      {text}
    </p>
  );
}

// ── 新建文件夹 ────────────────────────────────────────────────────────
export function NewFolderDialog({
  open,
  onOpenChange,
  targetDir,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  targetDir: string;
  onCreate: (_name: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setError('');
      setBusy(false);
    }
  }, [open]);

  const submit = async () => {
    const valid = validateFileName(name);
    if (!valid.ok) {
      setError(valid.issue === 'reserved' ? '该名称为系统保留名' : '名称不能包含 / 或 \\');
      return;
    }
    setBusy(true);
    try {
      await onCreate(valid.path);
      onOpenChange(false);
    } catch (err) {
      setError(filesErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="新建文件夹"
      description={targetDir ? `目标位置：${targetDir}/` : '目标位置：我的文件（根目录）'}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !name.trim()}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            创建
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <Label htmlFor="hf-new-folder">文件夹名称</Label>
        <Input
          id="hf-new-folder"
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
          placeholder="例如 docs"
        />
        <ErrorLine text={error} />
      </div>
    </DialogShell>
  );
}

// ── 重命名 ────────────────────────────────────────────────────────────
export function RenameDialog({
  open,
  onOpenChange,
  target,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  target: FileOpTarget | null;
  onSubmit: (_plan: { from: string; to: string }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && target) {
      setName(target.name);
      setError('');
      setBusy(false);
    }
  }, [open, target]);

  const submit = async () => {
    if (!target) return;
    const plan = renamePath(target.path, name);
    if (!plan.ok) {
      const text =
        plan.issue === 'same_name'
          ? '名称未变化'
          : plan.issue === 'invalid_name'
            ? '名称非法（不能包含 / 或 \\，不能是保留名）'
            : '路径非法';
      setError(text);
      return;
    }
    setBusy(true);
    try {
      await onSubmit({ from: plan.plan.from, to: plan.plan.to });
      onOpenChange(false);
    } catch (err) {
      setError(filesErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="重命名"
      description={target ? target.path : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !name.trim()}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            保存
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <Label htmlFor="hf-rename">新名称</Label>
        <Input
          id="hf-rename"
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />
        <ErrorLine text={error} />
      </div>
    </DialogShell>
  );
}

// ── 移动 ──────────────────────────────────────────────────────────────
export function MoveDialog({
  open,
  onOpenChange,
  target,
  currentDir,
  knownDirs,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  target: FileOpTarget | null;
  currentDir: string;
  knownDirs: readonly string[];
  onSubmit: (_plan: { from: string; to: string }) => Promise<void>;
}) {
  const [dir, setDir] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && target) {
      setDir(currentDir);
      setError('');
      setBusy(false);
    }
  }, [open, target, currentDir]);

  const submit = async () => {
    if (!target) return;
    const plan = movePath(target.path, dir, { isDir: target.isDir });
    if (!plan.ok) {
      const text =
        plan.issue === 'into_self'
          ? '不能移动到自身或自身的子目录'
          : plan.issue === 'same_dir'
            ? '目标与当前位置相同'
            : '路径非法（禁止 ../ 与绝对路径）';
      setError(text);
      return;
    }
    setBusy(true);
    try {
      await onSubmit({ from: plan.plan.from, to: plan.plan.to });
      onOpenChange(false);
    } catch (err) {
      setError(filesErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="移动到"
      description={target ? `将 ${target.name} 移动到目标目录` : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            移动
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <Label htmlFor="hf-move">目标目录（留空 = 根目录）</Label>
        <Input
          id="hf-move"
          autoFocus
          value={dir}
          list="hf-move-dirs"
          onChange={(e) => {
            setDir(e.target.value);
            setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
          placeholder="docs/archive"
        />
        <datalist id="hf-move-dirs">
          {knownDirs.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>
        <ErrorLine text={error} />
      </div>
    </DialogShell>
  );
}

// ── 删除确认 ──────────────────────────────────────────────────────────
export function DeleteConfirmDialog({
  open,
  onOpenChange,
  target,
  count = 1,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  target: FileOpTarget | null;
  count?: number;
  onConfirm: (_purge: boolean) => Promise<void>;
}) {
  const [soft, setSoft] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setSoft(true);
      setBusy(false);
      setError('');
    }
  }, [open]);

  const submit = async () => {
    setBusy(true);
    try {
      await onConfirm(count > 1 ? true : soft);
      onOpenChange(false);
    } catch (err) {
      setError(filesErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={count > 1 ? `删除 ${count} 项` : '删除文件'}
      description={target ? target.path : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button variant="destructive" onClick={() => void submit()} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            删除
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={soft}
            disabled={count > 1}
            onChange={(e) => setSoft(e.target.checked)}
          />
          移入回收站（可恢复）
        </label>
        {!soft && count === 1 && (
          <p className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            将立即彻底删除，不可恢复。
          </p>
        )}
        {count > 1 && (
          <p className="text-xs text-muted-foreground">
            批量删除统一移入回收站；目录会被跳过并提示。
          </p>
        )}
        <ErrorLine text={error} />
      </div>
    </DialogShell>
  );
}

// ── 配额编辑 ──────────────────────────────────────────────────────────
export function QuotaDialog({
  open,
  onOpenChange,
  quota,
  canAdmin,
  onSave,
}: {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  quota: QuotaView | null;
  canAdmin: boolean;
  onSave: (_bytes: number | null) => Promise<void>;
}) {
  const [raw, setRaw] = useState('');
  const [unit, setUnit] = useState<QuotaUnit>('MB');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const hit = bytesToQuotaInput(quota?.quotaBytes ?? null);
    setRaw(hit.value === null ? '' : String(hit.value));
    setUnit(hit.unit);
    setError('');
    setBusy(false);
  }, [open, quota?.quotaBytes]);

  const parsed = raw.trim() === '' ? null : Number(raw);
  const invalid = parsed !== null && (!Number.isFinite(parsed) || parsed < 0);

  const submit = async () => {
    if (invalid) {
      setError('请输入 ≥0 的数值，留空表示不限');
      return;
    }
    const form = { value: parsed, unit, files: null };
    if (!quotaFormValid(form)) {
      setError('配额值非法');
      return;
    }
    setBusy(true);
    try {
      await onSave(quotaValueToBytes(parsed, unit));
      onOpenChange(false);
    } catch (err) {
      setError(filesErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="编辑配额"
      description={
        canAdmin ? '留空 = 不限；0 = 零额度（十进制：1 MB = 1,000,000 bytes）' : '仅管理员可修改'
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !canAdmin}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            保存
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-2">
          <div className="space-y-2">
            <Label htmlFor="hf-quota">容量</Label>
            <Input
              id="hf-quota"
              inputMode="decimal"
              value={raw}
              disabled={!canAdmin}
              onChange={(e) => {
                setRaw(e.target.value);
                setError('');
              }}
              placeholder="留空 = 不限"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hf-quota-unit">单位</Label>
            <select
              id="hf-quota-unit"
              value={unit}
              disabled={!canAdmin}
              onChange={(e) => setUnit(e.target.value === 'GB' ? 'GB' : 'MB')}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            >
              <option value="MB">MB</option>
              <option value="GB">GB</option>
            </select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {raw.trim() === '' ? '不限' : quotaExactText(parsed, unit)}
        </p>
        <ErrorLine text={error} />
      </div>
    </DialogShell>
  );
}

// ── 文本在线编辑 ──────────────────────────────────────────────────────
export function TextEditorDialog({
  open,
  onOpenChange,
  humanName,
  target,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  humanName: string;
  target: FileOpTarget | null;
  onSaved: () => void;
}) {
  const [text, setText] = useState('');
  const [baseline, setBaseline] = useState('');
  const [etag, setEtag] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    if (!target) return;
    setLoading(true);
    setError('');
    setConflict(false);
    try {
      const r = await humanFilesApi.readText(humanName, target.path);
      setText(r.text);
      setBaseline(r.text);
      setEtag(r.etag);
    } catch (err) {
      setError(filesErrorText(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && target) {
      setText('');
      setBaseline('');
      setEtag(undefined);
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target?.path]);

  const save = async (force: boolean) => {
    if (!target) return;
    setBusy(true);
    setError('');
    try {
      const r = await humanFilesApi.writeFile(humanName, target.path, text, {
        ifMatch: force ? undefined : etag,
      });
      setEtag(r.etag || undefined);
      setBaseline(text);
      setConflict(false);
      onSaved();
      onOpenChange(false);
    } catch (err) {
      if (err instanceof HumanFilesError && err.status === 412) {
        setConflict(true);
        return;
      }
      setError(filesErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  const requestClose = (next: boolean) => {
    if (!next && needsUnsavedConfirm(text, baseline)) {
      if (!window.confirm('有未保存的修改，确定关闭？')) return;
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>编辑 {target?.name ?? ''}</DialogTitle>
          <DialogDescription>
            不超过 1 MiB 的文本文件；保存使用 If-Match，冲突（412）时选择重新加载或覆盖。
          </DialogDescription>
        </DialogHeader>
        {conflict && (
          <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
            <AlertTriangle className="size-4 shrink-0 text-amber-600" />
            <span className="min-w-0 flex-1">文件已被他人修改（412）。</span>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              重新加载
            </Button>
            <Button size="sm" variant="destructive" onClick={() => void save(true)}>
              覆盖保存
            </Button>
          </div>
        )}
        <div className="min-h-0 flex-1">
          {loading ? (
            <p className="py-8 text-center text-xs text-muted-foreground">加载中…</p>
          ) : (
            <textarea
              aria-label="文件内容"
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              className={cn(
                'h-[45vh] w-full resize-none rounded-md border bg-background p-3 font-mono text-xs leading-5',
                'focus-visible:outline-2 focus-visible:outline-primary',
              )}
            />
          )}
        </div>
        <ErrorLine text={error} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => requestClose(false)} disabled={busy}>
            取消
          </Button>
          <Button onClick={() => void save(false)} disabled={busy || loading}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 打开编辑前的大小/类型门（≤1MiB 且扩展名可编辑）。 */
export function editableReason(target: FileOpTarget | null, maxBytes: number): string | null {
  if (!target || target.isDir) return '目录不可编辑';
  if ((target.size ?? 0) > maxBytes) return '文件超过 1 MiB，无法在线编辑';
  return null;
}

/** 目标目录展示（上传/新建共用同一解析）。 */
export function displayTargetDir(uploadDir: string | null | undefined, dirPath: string): string {
  return resolveTargetDir(uploadDir, dirPath);
}

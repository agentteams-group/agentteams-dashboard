'use client';

import { useState } from 'react';
import { HardDrive } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { agentteamsApi, type HumanQuotaResponse } from '@/lib/agentteams-api';
import { ApiError, formatErrorMessage } from '@/lib/api-error';
import {
  formatQuotaValue,
  quotaExactText,
  quotaFormToPayload,
  quotaFormValid,
  quotaInputNumber,
  quotaToForm,
  type QuotaUnit,
} from '@/lib/quota-edit';
import { toast } from 'sonner';

function parseNumberInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return quotaInputNumber(Number(trimmed));
}

export function HumanQuotaDialog({
  open,
  humanName,
  quota,
  canManage,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  humanName: string;
  quota: HumanQuotaResponse | null;
  canManage: boolean;
  onOpenChange: (_open: boolean) => void;
  onSaved: () => void;
}) {
  const initial = quotaToForm(quota);
  const [value, setValue] = useState<number | null>(initial.value);
  const [unit, setUnit] = useState<QuotaUnit>(initial.unit);
  const [files, setFiles] = useState<number | null>(initial.files);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const form = { value, unit, files };
  const exact = quotaExactText(value, unit);

  const submit = async (payload: { quotaBytes: number | null; quotaFiles: number | null }) => {
    if (!canManage || busy) return;
    setBusy(true);
    setError('');
    try {
      await agentteamsApi.setHumanQuota(humanName, payload);
      toast.success('配额已保存');
      onSaved();
      onOpenChange(false);
    } catch (err) {
      const prefix = err instanceof ApiError && err.status === 403 ? '403 无权限：' : '保存失败：';
      setError(`${prefix}${formatErrorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!quotaFormValid(form)) {
      setError('请输入有效配额（容量与文件数须 ≥ 0，文件数为整数）');
      return;
    }
    void submit(quotaFormToPayload(form));
  };

  const clear = () => {
    if (!canManage || busy) return;
    void submit({ quotaBytes: null, quotaFiles: null });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-[95vw] sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            编辑配额 · {humanName}
          </DialogTitle>
          <DialogDescription>
            十进制：1 MB = 1,000,000 bytes，1 GB = 1,000,000,000 bytes；留空 = 不限，0 = 零额度。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {!canManage && (
            <p role="status" className="rounded-md border border-status-waiting/30 bg-status-waiting/5 p-2 text-xs text-status-waiting">
              只读（403）：需要 L1 管理员权限才能修改配额。
            </p>
          )}
          {error && (
            <p role="alert" className="break-words rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="human-quota-value">容量</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="human-quota-value"
                type="number"
                min={0}
                step={0.1}
                inputMode="decimal"
                value={value ?? ''}
                placeholder="留空 = 不限"
                disabled={!canManage || busy}
                onChange={(event) => setValue(parseNumberInput(event.target.value))}
                className="min-w-[140px] flex-1"
              />
              <Select
                value={unit}
                onValueChange={(next) => setUnit(next === 'GB' ? 'GB' : 'MB')}
                disabled={!canManage || busy}
              >
                <SelectTrigger className="w-[96px]" aria-label="配额单位">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MB">MB</SelectItem>
                  <SelectItem value="GB">GB</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">{exact || '留空 = 不限；0 = 零额度'}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="human-quota-files">文件数（可选）</Label>
            <Input
              id="human-quota-files"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={files ?? ''}
              placeholder="留空 = 不限"
              disabled={!canManage || busy}
              onChange={(event) => setFiles(parseNumberInput(event.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              {files === null ? '留空 = 不限；0 = 零额度' : `${files} 个文件`}
            </p>
          </div>

          {quota && (
            <p className="text-xs text-muted-foreground">
              当前已用 {formatQuotaValue(quota.usedBytes)}
            </p>
          )}
        </div>

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <Button
            variant="ghost"
            className="min-h-11 text-destructive hover:text-destructive"
            onClick={clear}
            disabled={!canManage || busy}
          >
            清除配额
          </Button>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              取消
            </Button>
            <Button className="min-h-11" onClick={save} disabled={!canManage || busy}>
              {busy ? '保存中…' : '保存'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

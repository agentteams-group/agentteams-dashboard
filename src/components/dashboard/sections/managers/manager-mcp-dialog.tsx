'use client';

// Manager MCP Servers 弹窗：name / url / transport 行编辑（插件
// ManagerDetailPane 同款）。保存为整表替换（空表 = 清空全部）。

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
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
import type { ManagerMcpServer } from '@/lib/agentteams-api';
import { normalizeMcpDraft } from './manager-drawer-logic';

export function ManagerMcpDialog({
  open,
  managerName,
  value,
  saving,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  managerName: string;
  value: ManagerMcpServer[];
  saving: boolean;
  onCancel: () => void;
  onSubmit: (_servers: ManagerMcpServer[]) => void;
}) {
  const [rows, setRows] = useState<ManagerMcpServer[]>(value.map((row) => ({ ...row })));
  const [error, setError] = useState<string | null>(null);
  const [initMarker, setInitMarker] = useState(managerName);
  const [wasOpen, setWasOpen] = useState(open);
  if (initMarker !== managerName) {
    setInitMarker(managerName);
    setRows(value.map((row) => ({ ...row })));
  }
  // 每次打开都从当前 spec 重新起稿（取消后重开不留上次未保存的行）。
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setRows(value.map((row) => ({ ...row })));
      setError(null);
    }
  }

  const setRow = (index: number, patch: Partial<ManagerMcpServer>) => {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const submit = () => {
    const normalized = normalizeMcpDraft(rows);
    if (normalized.error || !normalized.servers) {
      setError(normalized.error ?? '配置不完整');
      return;
    }
    setError(null);
    onSubmit(normalized.servers);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="max-w-[95vw] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>MCP Servers 配置 - {managerName}</DialogTitle>
          <DialogDescription>
            每行一个 MCP server；保存为整表替换（清空全部 = 保存空表）。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          {rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">暂无 MCP server。</p>
          ) : null}

          {rows.map((row, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <Input
                aria-label={`MCP name ${index + 1}`}
                className="w-32 shrink-0"
                placeholder="name"
                value={row.name}
                onChange={(event) => setRow(index, { name: event.target.value })}
              />
              <Input
                aria-label={`MCP url ${index + 1}`}
                className="min-w-32 flex-1 font-mono text-xs"
                placeholder="http://host/mcp"
                value={row.url}
                onChange={(event) => setRow(index, { url: event.target.value })}
              />
              <Input
                aria-label={`MCP transport ${index + 1}`}
                className="w-32 shrink-0 font-mono text-xs"
                placeholder="transport（可选）"
                value={row.transport ?? ''}
                onChange={(event) => setRow(index, { transport: event.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 w-9 shrink-0 p-0 text-destructive hover:text-destructive"
                aria-label={`删除 MCP ${index + 1}`}
                onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
              >
                <X className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          ))}

          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRows((current) => [...current, { name: '', url: '' }])}
          >
            <Plus className="mr-1 size-3.5" aria-hidden="true" />
            添加
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button disabled={saving} onClick={submit}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

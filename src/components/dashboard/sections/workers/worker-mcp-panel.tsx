'use client';

// MCP 分配以 Core 的 mcpServers 为准；原生注册表不参与配置读写。

import { useCallback, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { useMcpServers } from '@/hooks/use-agentteams-mcps';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import type { SelectedMcpServer } from '@/components/dashboard/sections/mcps/mcp-selector';
import { agentteamsApi, type WorkerResponse } from '@/lib/agentteams-api';
import { formatErrorMessage } from '@/lib/api-error';

export function WorkerMcpPanel({
  worker,
  workerName,
  workerTeam,
  canEdit,
  onChanged,
}: {
  worker: WorkerResponse;
  workerName: string;
  workerTeam?: string;
  canEdit: boolean;
  onChanged?: () => void;
}) {
  const { data: catalog = [] } = useMcpServers();
  const [policyName, setPolicyName] = useState<string>();
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState<SelectedMcpServer[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const rows = worker.mcpServers ?? [];

  const openEdit = useCallback((name?: string) => {
    setPolicyName(name);
    setDraft(worker.mcpServers ?? []);
    setSaveError('');
    setEditOpen(true);
  }, [worker.mcpServers]);

  const handleSave = useCallback(async (next = draft) => {
    if (saving) return;
    setSaving(true);
    setSaveError('');
    try {
      // 只提交 mcpServers：PUT /workers 是全字段更新，带整表单会冲掉别人刚
      // 改的 model/env 等字段。
      await agentteamsApi.updateWorker(workerName, { mcpServers: next });
    } catch (err) {
      // 403/400 的后端 message 原样展示（如控制器 RBAC / 校验失败原因）。
      setSaveError(formatErrorMessage(err));
      setSaving(false);
      return;
    }
    setSaving(false);
    setEditOpen(false);
    onChanged?.();
  }, [draft, onChanged, saving, workerName]);

  return (
    <div className="space-y-2 pt-2">
      <p className="text-xs text-muted-foreground">管理分配给此 Agent 的 MCP 服务及工具审批。</p>

      {canEdit && <Combobox value="" ariaLabel="添加 MCP 服务" placeholder="添加 MCP 服务" allowCustom={false}
        disabled={saving}
        options={catalog.filter(server => !worker.mcpServers?.some(item => item.name === server.name)).map(server => server.name)}
        onChange={name => {
          const server = catalog.find(item => item.name === name);
          if (server) void handleSave([...(worker.mcpServers || []), { name: server.name, url: server.url, transport: server.transport === 'streaminghttp' ? 'http' : server.transport }]);
        }} />}
      {saveError && !editOpen && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
      {rows.length === 0 && <p className="text-xs text-muted-foreground">尚未分配 MCP 服务</p>}

      {rows.length > 0 && (
        <ul aria-label="MCP 服务" className="divide-y rounded-md border">
          {rows.map((row) => (
            <li key={row.name} className="flex min-w-0 items-center gap-3 px-3 py-2">
              <span className="min-w-0 max-w-[22ch] truncate text-sm font-medium"
                title={row.name}>{row.name}</span>
              {canEdit && <Button variant="ghost" size="sm" disabled={saving} aria-label={`移除 ${row.name}`}
                onClick={() => void handleSave((worker.mcpServers || []).filter(item => item.name !== row.name))}><X className="size-4" /></Button>}
              {canEdit && (
                <Button variant="ghost" size="sm" className="ml-auto shrink-0" onClick={() => openEdit(row.name)}>
                  审批策略
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={editOpen}
        onOpenChange={(next) => {
          if (saving) return;
          setEditOpen(next);
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-[95vw] overflow-y-auto sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>{policyName ? '审批策略' : `MCP 分配 — ${workerName}`}</DialogTitle>
            <DialogDescription className="text-xs">
              {policyName ? '设置此 MCP 服务调用工具时的审批方式。' : '选择此 Agent 可使用的 MCP 服务。'}
              {!policyName && workerTeam ? `所属团队：${workerTeam}。` : ''}
            </DialogDescription>
          </DialogHeader>
          {policyName && draft.filter(server => server.name === policyName).map(server => (
            <label key={server.name} className="flex min-w-0 items-center justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="block max-w-[22ch] truncate font-medium" title={server.name}>{server.name}</span>
                <span className="text-xs text-muted-foreground">全部工具审批</span>
              </span>
              <select aria-label={`${server.name} · 全部工具审批`} className="shrink-0 rounded-md border bg-background px-2 py-1" value={server.approvals?.mode ?? ''}
                onChange={event => {
                  const mode = event.target.value;
                  setDraft(items => items.map(item => {
                    if (item.name !== server.name) return item;
                    const next = { ...item };
                    if (mode === 'allow' || mode === 'ask') next.approvals = { tools: '*', mode };
                    else delete next.approvals;
                    return next;
                  }));
                }}>
                <option value="">跟随 Agent 审批策略</option>
                <option value="ask">请求审批</option>
                <option value="allow">自动通过</option>
              </select>
            </label>
          ))}
          {saveError && (
            <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 break-words">{saveError}</span>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => setEditOpen(false)}
            >
              取消
            </Button>
            <Button disabled={saving} onClick={() => void handleSave()}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusDot } from '@/components/dashboard/status-dot';
import { PhaseBadge, RuntimeBadge } from '@/components/dashboard/phase-badge';
import { RUNTIME_LABELS } from '@/lib/phase-colors';
import type { WorkerResponse } from '@/lib/hiclaw-api';

const DETAIL_FIELDS: Array<[string, (_w: WorkerResponse) => string]> = [
  ['名称', (w) => w.name],
  ['状态', (w) => w.state],
  ['运行时', (w) => RUNTIME_LABELS[w.runtime] || w.runtime],
  ['模型', (w) => w.model || '-'],
  ['镜像', (w) => w.image || '-'],
  ['团队', (w) => w.team || '-'],
  ['角色', (w) => w.role || '-'],
  ['关联 Agents', (w) => w.agents || '-'],
  ['Matrix 用户', (w) => w.matrixUserID || '-'],
  ['房间 ID', (w) => w.roomID || '-'],
  ['容器管理', (w) => (w.containerManaged ? '是' : '否')],
  ['容器状态', (w) => w.containerState || '-'],
  ['消息', (w) => w.message || '-'],
];

export function WorkerDetailDialog({
  worker,
  onOpenChange,
}: {
  worker: WorkerResponse | null;
  onOpenChange: (_open: boolean) => void;
}) {
  return (
    <Dialog open={!!worker} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-w-[95vw] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Worker 详情 - {worker?.name}</DialogTitle>
        </DialogHeader>
        {worker && (
          <div className="space-y-3 py-4 text-sm">
            <div className="flex items-center gap-2 mb-3">
              <StatusDot phase={worker.phase} />
              <PhaseBadge kind="worker" phase={worker.phase} />
              <RuntimeBadge runtime={worker.runtime} />
            </div>
            {DETAIL_FIELDS.map(([label, read]) => (
              <div
                key={label}
                className="flex justify-between py-1 border-b border-border/50"
              >
                <span className="text-muted-foreground">{label}</span>
                <span className="font-mono text-xs max-w-[60%] text-right break-all">
                  {read(worker)}
                </span>
              </div>
            ))}
            {(worker.mcpServers?.length ?? 0) > 0 && (
              <div className="pt-2">
                <p className="text-muted-foreground mb-1">MCP Servers</p>
                {worker.mcpServers?.map((s, i) => (
                  <div key={i} className="text-xs font-mono flex items-center gap-2">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-muted-foreground">({s.transport})</span>
                    <span className="truncate">{s.url}</span>
                  </div>
                ))}
              </div>
            )}
            {(worker.exposedPorts?.length ?? 0) > 0 && (
              <div className="pt-2">
                <p className="text-muted-foreground mb-1">暴露端口</p>
                {worker.exposedPorts?.map((p, i) => (
                  <div key={i} className="text-xs font-mono">
                    {p.port} → {p.domain}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

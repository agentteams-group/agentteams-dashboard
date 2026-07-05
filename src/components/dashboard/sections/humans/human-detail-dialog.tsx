'use client';

import { useMemo } from 'react';
import { Lock, Mail, Shield, Eye, Play, Pencil, Trash2, Sun, Moon, CheckCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { CopyButton } from '@/components/dashboard/copy-button';
import { StatusDot } from '@/components/dashboard/status-dot';
import { PhaseBadge } from '@/components/dashboard/phase-badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { HumanResponse } from '@/lib/hiclaw-api';
import { PERMISSION_BADGE_CLASSES, PERMISSION_LABELS } from './human-types';
import { getAccessSummary } from '@/lib/rbac-engine';

const BASE_FIELDS: Array<[string, (_h: HumanResponse) => string]> = [
  ['名称', (h) => h.name],
  ['显示名称', (h) => h.displayName],
  ['阶段', (h) => h.phase],
];

function DetailRow({
  label,
  value,
  copy,
}: {
  label: string;
  value: string;
  copy?: string;
}) {
  return (
    <div className="flex justify-between py-1 border-b border-border/50">
      <span className="text-muted-foreground">{label}</span>
      {copy ? (
        <div className="flex items-center gap-1 min-w-0 max-w-[60%]">
          <span className="font-mono text-xs truncate">{value}</span>
          <CopyButton text={copy} />
        </div>
      ) : (
        <span className="font-mono text-xs max-w-[60%] text-right break-all">{value}</span>
      )}
    </div>
  );
}

function RoomBadge({ room }: { room: string }) {
  const display = room.length > 20 ? `${room.slice(0, 10)}...${room.slice(-4)}` : room;
  return (
    <Badge key={room} variant="secondary" className="text-[10px] font-mono">
      {display}
    </Badge>
  );
}

function TagList({ items, label }: { items: string[] | undefined; label: string }) {
  return (
    <div className="pt-2">
      <p className="text-muted-foreground mb-2">{label}</p>
      <div className="flex flex-wrap gap-1">
        {items && items.length > 0 ? (
          items.map((item) => (
            <Badge key={item} variant="outline" className="text-xs">
              {item}
            </Badge>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        )}
      </div>
    </div>
  );
}

export function HumanDetailDialog({
  human,
  onOpenChange,
}: {
  human: HumanResponse | null;
  onOpenChange: (_open: boolean) => void;
}) {
  return (
    <Dialog open={!!human} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-w-[95vw] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Human 详情 - {human?.name}</DialogTitle>
        </DialogHeader>
        {human && (
          <div className="space-y-3 py-4 text-sm">
            <div className="flex items-center gap-2 mb-3">
              <StatusDot phase={human.phase} />
              <PhaseBadge kind="human" phase={human.phase} />
            </div>
            {BASE_FIELDS.map(([label, read]) => (
              <DetailRow key={label} label={label} value={read(human)} />
            ))}
            <DetailRow
              label="Matrix 用户"
              value={human.matrixUserID || '-'}
              copy={human.matrixUserID || undefined}
            />
            <div className="flex justify-between py-1 border-b border-border/50">
              <span className="text-muted-foreground">初始密码</span>
              {human.initialPassword ? (
                <div className="flex items-center gap-1 min-w-0 max-w-[60%]">
                  <Badge
                    variant="outline"
                    className="text-[10px] gap-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 shrink-0"
                  >
                    <Lock className="w-2.5 h-2.5" aria-hidden="true" />
                    敏感
                  </Badge>
                  <span className="font-mono text-xs truncate">{human.initialPassword}</span>
                  <CopyButton text={human.initialPassword} />
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">-</span>
              )}
            </div>
            <div className="flex justify-between py-1 border-b border-border/50">
              <span className="text-muted-foreground">邮箱</span>
              {human.email ? (
                <div className="flex items-center gap-1 min-w-0 max-w-[60%]">
                  <Mail className="w-3 h-3 text-muted-foreground shrink-0" aria-hidden="true" />
                  <span className="text-xs truncate">{human.email}</span>
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">-</span>
              )}
            </div>
            <div className="flex justify-between py-1 border-b border-border/50">
              <span className="text-muted-foreground">权限等级</span>
              <Badge
                variant="outline"
                className={`text-xs ${
                  PERMISSION_BADGE_CLASSES[human.permissionLevel || 1] || ''
                }`}
              >
                <Shield className="w-3 h-3 mr-1" aria-hidden="true" />
                {human.permissionLevel || 1} - {PERMISSION_LABELS[human.permissionLevel || 1]}
              </Badge>
            </div>
            {human.message && (
              <DetailRow label="消息" value={human.message} />
            )}
            <RBACSummary human={human} />
            <TagList items={human.accessibleTeams} label="可访问团队" />
            <TagList items={human.accessibleWorkers} label="可访问 Workers" />
            <div className="pt-2">
              <p className="text-muted-foreground mb-2">房间 ({human.rooms?.length || 0})</p>
              <div className="max-h-32 overflow-y-auto custom-scrollbar">
                <div className="flex flex-wrap gap-1">
                  {human.rooms && human.rooms.length > 0 ? (
                    human.rooms.map((room) => <RoomBadge key={room} room={room} />)
                  ) : (
                    <span className="text-xs text-muted-foreground">-</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const PERM_ICONS: Record<string, React.ReactNode> = {
  view: <Eye className="w-3 h-3" />,
  create: <Play className="w-3 h-3" />,
  update: <Pencil className="w-3 h-3" />,
  delete: <Trash2 className="w-3 h-3" />,
  wake: <Sun className="w-3 h-3" />,
  sleep: <Moon className="w-3 h-3" />,
  'ensure-ready': <CheckCircle className="w-3 h-3" />,
};

const PERM_LABELS: Record<string, string> = {
  view: '查看',
  create: '创建',
  update: '编辑',
  delete: '删除',
  wake: '唤醒',
  sleep: '休眠',
  'ensure-ready': '就绪',
};

function RBACSummary({ human }: { human: HumanResponse }) {
  const summary = useMemo(() => getAccessSummary(human), [human]);

  return (
    <div className="p-3 rounded-lg bg-muted/30 border border-border/50 space-y-2">
      <div className="flex items-center gap-2">
        <Shield className="w-4 h-4 text-violet-500" />
        <span className="text-xs font-medium">权限摘要</span>
        <Badge variant="outline" className="text-[10px]">{summary.level}</Badge>
      </div>
      <div className="flex flex-wrap gap-1">
        {summary.permissions.map((perm) => (
          <Badge key={perm} variant="secondary" className="text-[10px] gap-1">
            {PERM_ICONS[perm]}
            {PERM_LABELS[perm] || perm}
          </Badge>
        ))}
      </div>
      <div className="text-[10px] text-muted-foreground space-y-0.5">
        <p>团队范围: {summary.teamScope}</p>
        <p>Worker 范围: {summary.workerScope}</p>
      </div>
    </div>
  );
}

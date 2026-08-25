'use client';

import { useMemo, useState } from 'react';
import {
  Filter,
  RefreshCw,
  AlertTriangle,
  ShieldAlert,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SectionHeader } from '@/components/dashboard/section-header';
import { useAuditEvents, type AuditEvent, type AuditQuery } from '@/hooks/use-audit-events';

type EntityFilter = AuditEvent['entity_type'] | 'all';

const ENTITY_OPTIONS: { id: EntityFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'worker', label: 'Worker' },
  { id: 'team', label: '团队' },
  { id: 'manager', label: 'Manager' },
  { id: 'human', label: 'Human' },
  { id: 'system', label: '系统' },
];

const SEVERITY_META: Record<AuditEvent['severity'], { label: string; icon: LucideIcon; className: string }> = {
  info: {
    label: '信息',
    icon: ShieldCheck,
    className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  },
  warning: {
    label: '警告',
    icon: AlertTriangle,
    className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  },
  error: {
    label: '错误',
    icon: ShieldAlert,
    className: 'bg-red-500/10 text-red-700 dark:text-red-300',
  },
};

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleDateString('zh-CN')} ${d.toLocaleTimeString('zh-CN')}`;
}

function actionLabel(action: string): string {
  if (action.startsWith('rbac.deny.')) return `拒绝：${action.slice('rbac.deny.'.length)}`;
  if (action.endsWith('-failed')) return `${action.replace(/-failed$/, '')} 失败`;
  return action;
}

export function AuditSection() {
  const [entityType, setEntityType] = useState<EntityFilter>('all');
  const query: AuditQuery = useMemo(() => {
    const out: AuditQuery = { limit: 200 };
    if (entityType !== 'all') out.entityType = entityType;
    return out;
  }, [entityType]);

  const { data, isLoading, isFetching, refetch } = useAuditEvents(query);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="审计日志"
        description="服务端记录的治理事件（mutation、RBAC 拒绝、登录等）。10 MB 自动 rotate，保留 30 份归档。"
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="text-base">最近事件</CardTitle>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" aria-hidden />
            <div className="flex flex-wrap gap-1">
              {ENTITY_OPTIONS.map((opt) => (
                <Button
                  key={opt.id}
                  type="button"
                  size="sm"
                  variant={entityType === opt.id ? 'default' : 'outline'}
                  onClick={() => setEntityType(opt.id)}
                  aria-pressed={entityType === opt.id}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => refetch()}
              aria-label="刷新"
              disabled={isFetching}
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} aria-hidden />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {data && data.success === false ? (
            <div className="flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
              <div>
                  <p className="font-medium text-amber-700 dark:text-amber-300">{data.error}</p>
                  <p className="text-xs text-muted-foreground">该视图仅对权限等级 ≥ 3 的管理员开放</p>
                </div>
            </div>
          ) : isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">加载中...</p>
          ) : !data?.events?.length ? (
            <p className="py-6 text-center text-sm text-muted-foreground">暂无审计事件</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-2">时间</th>
                    <th className="px-2 py-2">操作者</th>
                    <th className="px-2 py-2">实体</th>
                    <th className="px-2 py-2">动作</th>
                    <th className="px-2 py-2">严重度</th>
                    <th className="px-2 py-2">详情</th>
                  </tr>
                </thead>
                <tbody>
                  {data.events.map((event) => {
                    const meta = SEVERITY_META[event.severity];
                    const Icon = meta.icon;
                    return (
                      <tr key={event.id} className="border-b last:border-0 align-top">
                        <td className="px-2 py-2 font-mono text-xs whitespace-nowrap">{formatTimestamp(event.timestamp)}</td>
                        <td className="px-2 py-2">
                          <span className="font-medium">{event.actor ?? '系统'}</span>
                          {event.actor_level !== undefined ? (
                            <span className="ml-1 text-xs text-muted-foreground">L{event.actor_level}</span>
                          ) : null}
                          {event.source_ip ? (
                            <div className="text-xs text-muted-foreground">{event.source_ip}</div>
                          ) : null}
                        </td>
                        <td className="px-2 py-2">
                          <Badge variant="outline" className="font-mono text-xs">
                            {event.entity_type}
                          </Badge>
                          <div className="text-xs text-muted-foreground">{event.entity_name}</div>
                        </td>
                        <td className="px-2 py-2 font-mono text-xs">{actionLabel(event.action)}</td>
                        <td className="px-2 py-2">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${meta.className}`}>
                            <Icon className="h-3 w-3" aria-hidden />
                            {meta.label}
                          </span>
                        </td>
                        <td className="px-2 py-2 max-w-md break-words text-xs text-muted-foreground">
                          {event.details ?? '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Filter,
  RefreshCw,
  AlertTriangle,
  ShieldAlert,
  ShieldCheck,
  ExternalLink,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SectionEmptyState } from '@/components/dashboard/section-empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SectionHeader } from '@/components/dashboard/section-header';
import { currentHashParams } from '@/lib/nav-hash';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuditEvents, type AuditEvent, type AuditQuery } from '@/hooks/use-audit-events';
import { parseAuditRef, type ParsedAuditRef } from '@/lib/replay/audit-ref';

function AuditReplayLink({ auditRef }: { auditRef: ParsedAuditRef }) {
  const [opening, setOpening] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (!auditRef.roomId && !auditRef.replayId) return null;

  const handleOpen = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (auditRef.replayId) {
      const url = `/replay/${auditRef.replayId}${auditRef.eventId ? `?eventId=${encodeURIComponent(auditRef.eventId)}` : ''}`;
      window.open(url, '_blank');
      return;
    }
    if (auditRef.roomId) {
      setOpening(true);
      setNotice(null);
      try {
        const res = await fetch(`/api/agentteams/replay/export?room=${encodeURIComponent(auditRef.roomId)}`);
        if (res.ok) {
          const data = (await res.json()) as { found?: boolean; replayId?: string };
          if (data.replayId) {
            const url = `/replay/${data.replayId}${auditRef.eventId ? `?eventId=${encodeURIComponent(auditRef.eventId)}` : ''}`;
            window.open(url, '_blank');
            setOpening(false);
            return;
          }
        }
        // 未找到已导出的静态回放包时引导至空间对应房间
        setNotice('已指引至协作空间');
        setTimeout(() => {
          window.location.hash = `#workbench/space/${encodeURIComponent(auditRef.roomId!)}`;
        }, 600);
      } catch {
        setNotice('查询回放失败');
      } finally {
        setOpening(false);
      }
    }
  };

  return (
    <div className="mt-1 flex items-center gap-1.5 flex-wrap">
      <button
        onClick={handleOpen}
        disabled={opening}
        className="inline-flex items-center gap-1 text-xs text-primary hover:underline hover:text-primary/80 transition-colors disabled:opacity-50"
        title="在会话回放或空间中打开对应的消息上下文"
      >
        <ExternalLink className="h-3 w-3" />
        <span>{opening ? '定位中...' : '在回放中打开'}</span>
      </button>
      {notice && <span className="text-xs text-muted-foreground">{notice}</span>}
    </div>
  );
}

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

  // 深链消费（方案 v3 C-2）：命令面板命中审计事件后写的是
  // `#console/governance/audit?entity=<type>`，本视图把它读回筛选维度。
  // 只接受 ENTITY_OPTIONS 里已有的值：hash 是用户能手改的输入，乱值会把筛选
  // 卡成一个既不匹配选项又查不出东西的状态。
  useEffect(() => {
    const applyEntityParam = () => {
      const path = window.location.hash.replace(/^#/, '').split('?')[0];
      if (path !== 'console/governance/audit') return;
      const raw = currentHashParams()?.get('entity');
      if (!raw) return;
      if (ENTITY_OPTIONS.some((option) => option.id === raw)) setEntityType(raw as EntityFilter);
    };
    applyEntityParam();
    window.addEventListener('hashchange', applyEntityParam);
    return () => window.removeEventListener('hashchange', applyEntityParam);
  }, []);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="审计日志"
        description={
          data?.source === 'controller'
            ? data.scope === 'team'
              ? `Controller 记录的治理事件（MinIO 持久存储，覆盖全部入口）。你的视图限定在团队「${data.team ?? '?'}」。`
              : 'Controller 记录的治理事件（MinIO 持久存储，覆盖全部入口：dashboard、CLI、API）。'
            : data?.scope === 'self'
              ? '服务端记录的治理事件。L2 操作员视图仅显示你本人执行的操作；L3+ 平台管理员可查看全部。'
              : '服务端记录的治理事件（mutation、RBAC 拒绝、登录等）。10 MB 自动 rotate，保留 30 份归档。'
        }
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">最近事件</CardTitle>
            {data?.source === 'controller' ? (
              <Badge className="bg-blue-500/10 text-blue-700 dark:text-blue-300">
                数据源：Controller
              </Badge>
            ) : data?.source === 'local' ? (
              <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-300">
                数据源：本地日志
              </Badge>
            ) : null}
          </div>
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
          {data?.source === 'local' && data.note ? (
            <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              {data.note}
            </div>
          ) : null}
          {data && data.success === false ? (
            <div className="flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
              <div className="space-y-1">
                <p className="font-medium text-amber-700 dark:text-amber-300">{data.error}</p>
                <p className="text-xs text-muted-foreground">
                  {data.observedLevel == null
                    ? '服务端未收到身份头 — 当前可能处于 AGENTTEAMS_AUTH_DISABLED 本地模式或 Higress session 未透传'
                    : `服务端识别到权限等级 L${data.observedLevel}，审计视图要求 ≥ L${data.requiredLevel ?? 2}。L3+ 平台管理员可在 Higress Console 提权；L2 操作员只能看到自己执行的事件`}
                </p>
              </div>
            </div>
          ) : isLoading ? (
            <div className="space-y-2 py-1" role="status" aria-label="加载中">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : !data?.events?.length ? (
            <SectionEmptyState
              title="暂无审计事件"
              description={
                data?.scope === 'self' ? '视图已限定为你本人执行的治理操作' : undefined
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-9 px-2 text-xs uppercase tracking-wide">时间</TableHead>
                  <TableHead className="h-9 px-2 text-xs uppercase tracking-wide">操作者</TableHead>
                  <TableHead className="h-9 px-2 text-xs uppercase tracking-wide">实体</TableHead>
                  <TableHead className="h-9 px-2 text-xs uppercase tracking-wide">动作</TableHead>
                  <TableHead className="h-9 px-2 text-xs uppercase tracking-wide">严重度</TableHead>
                  <TableHead className="h-9 px-2 text-xs uppercase tracking-wide">详情</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.events.map((event) => {
                  const meta = SEVERITY_META[event.severity];
                  const Icon = meta.icon;
                  return (
                    <TableRow key={event.id} className="align-top">
                      <TableCell className="px-2 py-2 font-mono text-xs whitespace-nowrap">{formatTimestamp(event.timestamp)}</TableCell>
                      <TableCell className="px-2 py-2">
                        <span className="font-medium">{event.actor ?? '系统'}</span>
                        {event.actor_level !== undefined ? (
                          <span className="ml-1 text-xs text-muted-foreground">L{event.actor_level}</span>
                        ) : null}
                        {event.source_ip ? (
                          <div className="text-xs text-muted-foreground">{event.source_ip}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        <Badge variant="outline" className="font-mono text-xs">
                          {event.kind ?? event.entity_type}
                        </Badge>
                        <div className="text-xs text-muted-foreground">{event.entity_name}</div>
                        {event.team ? (
                          <div className="text-xs text-muted-foreground">团队：{event.team}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="px-2 py-2 font-mono text-xs">{actionLabel(event.action)}</TableCell>
                      <TableCell className="px-2 py-2">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${meta.className}`}>
                          <Icon className="h-3 w-3" aria-hidden />
                          {meta.label}
                        </span>
                      </TableCell>
                      <TableCell className="px-2 py-2 max-w-md break-words text-xs text-muted-foreground">
                        <div>{event.details ?? '—'}</div>
                        <AuditReplayLink auditRef={parseAuditRef(event)} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
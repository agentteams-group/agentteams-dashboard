'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ShieldAlert,
  ShieldCheck,
  ExternalLink,
  type LucideIcon,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
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
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { OverflowText } from '@/components/dashboard/overflow-text';
import { ListPagination, useListPagination } from '@/components/dashboard/list-pagination';
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
  { id: 'worker', label: 'Agent' },
  { id: 'team', label: '团队' },
  { id: 'manager', label: 'Manager' },
  { id: 'human', label: '用户' },
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
  const labels: Record<string, string> = { create: '创建', update: '编辑', delete: '删除', human_created: '创建用户', human_deleted: '删除用户', human_file_write: '写入用户文件', capability_grant: '授予权限', capability_revoke: '撤销权限', channel_update: '更新渠道配置' };
  if (labels[action]) return labels[action];
  if (action.startsWith('rbac.deny.')) return `拒绝：${action.slice('rbac.deny.'.length)}`;
  if (action.endsWith('-failed')) return `${action.replace(/-failed$/, '')} 失败`;
  return action;
}

function eventSummary(event: AuditEvent): string {
  if (!event.details || event.details === '—') return '无附加内容';
  if (/^\s*[{[]/.test(event.details)) return '已记录操作上下文，详情中可查看';
  return event.details.replaceAll('permission_level', '权限等级').replaceAll('accessible_teams', '可访问团队').replaceAll('∅', '无');
}

export function AuditSection() {
  const [entityType, setEntityType] = useState<EntityFilter>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<AuditEvent | null>(null);
  const query: AuditQuery = useMemo(() => ({ limit: 200, ...(entityType === 'all' ? {} : { entityType }) }), [entityType]);
  const { data, isLoading, isFetching, refetch } = useAuditEvents(query);
  const filtered = (data?.events ?? []).filter(event => [event.actor, event.entity_name, event.action, event.details].some(value => value?.toLowerCase().includes(search.toLowerCase())));
  const pagination = useListPagination(filtered, 20, `${entityType}:${search}`);
  const entityLabel = (type: string) => ENTITY_OPTIONS.find(option => option.id === type)?.label || type;

  useEffect(() => {
    const applyEntityParam = () => {
      if (window.location.hash.replace(/^#/, '').split('?')[0] !== 'console/governance/audit') return;
      const raw = currentHashParams()?.get('entity');
      if (raw && ENTITY_OPTIONS.some(option => option.id === raw)) setEntityType(raw as EntityFilter);
    };
    applyEntityParam();
    window.addEventListener('hashchange', applyEntityParam);
    return () => window.removeEventListener('hashchange', applyEntityParam);
  }, []);

  const scopeNote = data?.scope === 'team'
    ? `你的视图限定在团队「${data.team ?? '?'}」，展示已记录的操作。`
    : data?.scope === 'self' ? '视图限定为你本人执行的操作。' : '查看已接入的操作记录，当前最多读取最近 200 条。';
  return <div className="space-y-4">
    <SectionHeader title="操作审计" onRefresh={() => void refetch()} isRefreshing={isFetching}
      meta={<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{data?.events?.length ?? 0} 条记录</span>{data?.source && <Badge variant="outline">数据源：{data.source === 'controller' ? 'Controller' : '本地日志'}</Badge>}</div>} />
    <div className="flex flex-wrap items-center gap-3">
      <Input aria-label="搜索审计记录" placeholder="搜索操作者、资源或操作…" value={search} onChange={event => setSearch(event.target.value)} className="h-9 w-full sm:max-w-sm" />
      <select aria-label="资源类型" value={entityType} onChange={event => setEntityType(event.target.value as EntityFilter)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
        {ENTITY_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
      <OverflowText text={scopeNote} multiline className="min-w-0 flex-1 text-xs text-muted-foreground" />
    </div>
    {data?.source === 'local' && data.note && <p className="rounded-lg border border-amber-500/30 p-3 text-xs text-muted-foreground">{data.note}</p>}
    {data?.success === false ? <div className="rounded-lg border border-amber-500/30 p-4 text-sm">
      <p className="font-medium">{data.error}</p>
      <p className="mt-1 text-xs text-muted-foreground">{data.observedLevel == null ? '未收到身份头，请重新登录后再试。' : `当前权限 L${data.observedLevel}，需要 ≥ L${data.requiredLevel ?? 2}。`}</p>
    </div> : isLoading ? <div role="status" aria-label="加载中" className="space-y-2">{Array.from({length:6},(_,i)=><Skeleton key={i} className="h-10 w-full" />)}</div> :
      <Card className="gap-0 overflow-hidden rounded-lg py-0 shadow-none">
        {!filtered.length ? <SectionEmptyState title={search ? '没有匹配的审计记录' : '暂无审计事件'} /> :
          <Table className="min-w-[1000px] table-fixed"><TableHeader><TableRow>
            <TableHead className="w-[164px]">时间</TableHead><TableHead className="w-[140px]">操作者</TableHead><TableHead className="w-[180px]">资源</TableHead><TableHead className="w-[150px]">操作</TableHead><TableHead className="w-20">级别</TableHead><TableHead>摘要</TableHead><TableHead className="w-20 text-right">操作</TableHead>
          </TableRow></TableHeader><TableBody>{pagination.items.map(event => <TableRow key={event.id}>
            <TableCell className="py-3 text-xs text-muted-foreground">{formatTimestamp(event.timestamp)}</TableCell>
            <TableCell><OverflowText text={event.actor || '系统'} className="font-medium" />{event.actor_level !== undefined && <span className="text-xs text-muted-foreground">L{event.actor_level}</span>}</TableCell>
            <TableCell><OverflowText text={event.entity_name} className="font-medium" /><OverflowText text={`${entityLabel(event.entity_type)}${event.team ? ` · 团队：${event.team}` : ''}`} className="mt-1 text-xs text-muted-foreground" /></TableCell>
            <TableCell><OverflowText text={actionLabel(event.action)} /></TableCell>
            <TableCell><Badge variant="outline" className={SEVERITY_META[event.severity].className}>{SEVERITY_META[event.severity].label}</Badge></TableCell>
            <TableCell><OverflowText text={eventSummary(event)} className="text-xs text-muted-foreground" /></TableCell>
            <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => setSelected(event)}>详情</Button></TableCell>
          </TableRow>)}</TableBody></Table>}
      </Card>}
    {data?.success !== false && !isLoading && <ListPagination {...pagination} label="记录" />}
    <Sheet open={Boolean(selected)} onOpenChange={open => !open && setSelected(null)}>
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        <SheetHeader><SheetTitle>审计详情</SheetTitle><SheetDescription>查看操作来源和已记录的上下文。</SheetDescription></SheetHeader>
        {selected && <div className="space-y-5 p-5">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-3 text-sm">
            <dt className="text-muted-foreground">时间</dt><dd>{formatTimestamp(selected.timestamp)}</dd>
            <dt className="text-muted-foreground">操作者</dt><dd className="break-all">{selected.actor || '系统'}</dd>
            <dt className="text-muted-foreground">资源</dt><dd className="break-all">{entityLabel(selected.entity_type)} · {selected.entity_name}</dd>
            <dt className="text-muted-foreground">操作</dt><dd className="break-all">{actionLabel(selected.action)}</dd>
            {selected.kind && <><dt className="text-muted-foreground">事件类型</dt><dd className="break-all">{selected.kind}</dd></>}
            {selected.source_ip && <><dt className="text-muted-foreground">来源 IP</dt><dd>{selected.source_ip}</dd></>}
          </dl>
          <div><h3 className="mb-2 text-sm font-medium">记录内容</h3><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-xs leading-6">{selected.details || '此事件没有附加内容。'}</pre></div>
          <AuditReplayLink auditRef={parseAuditRef(selected)} />
        </div>}
      </SheetContent>
    </Sheet>
  </div>;
}

'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Trash2,
  RefreshCw,
  UserCheck,
  Bot,
  Users,
  Crown,
  Code2,
  X,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Layers,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { useTeams } from '@/hooks/use-agentteams-teams';
import { useHumans } from '@/hooks/use-agentteams-humans';
import { useManagers } from '@/hooks/use-agentteams-managers';
import { useCreateHuman, useDeleteHuman } from '@/hooks/use-agentteams-mutations';
import { useSearch } from '@/lib/search-context';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useCopyToClipboard } from '@/lib/use-copy-to-clipboard';
import { ApiErrorState } from '@/components/dashboard/api-error-state';
import { StatusDot } from '@/components/dashboard/status-dot';
import { SectionHeader } from '@/components/dashboard/section-header';
import { ConfirmDeleteDialog } from '@/components/dashboard/confirm-delete-dialog';
import {
  WORKER_PHASE_LABELS,
  WORKER_PHASE_BADGE_CLASSES,
  TEAM_PHASE_LABELS,
  TEAM_PHASE_BADGE_CLASSES,
  MANAGER_PHASE_LABELS,
  MANAGER_PHASE_BADGE_CLASSES,
  RUNTIME_LABELS,
} from '@/lib/phase-colors';
import type {
  CreateHumanRequest,
  WorkerResponse,
  TeamResponse,
  HumanResponse,
  ManagerResponse,
} from '@/lib/agentteams-api';

type CRDResource = {
  kind: string;
  name: string;
  phase: string;
  namespace?: string;
  raw: WorkerResponse | TeamResponse | HumanResponse | ManagerResponse;
};

function getPhaseLabel(kind: string, phase: string): string {
  switch (kind) {
    case 'Worker': return WORKER_PHASE_LABELS[phase] || phase;
    case 'Team': return TEAM_PHASE_LABELS[phase] || phase;
    case 'Manager': return MANAGER_PHASE_LABELS[phase] || phase;
    case 'Human': return phase === 'Active' ? '活跃' : phase === 'Pending' ? '等待中' : phase === 'Failed' ? '失败' : phase;
    default: return phase;
  }
}

function getPhaseBadgeClass(kind: string, phase: string): string {
  switch (kind) {
    case 'Worker': return WORKER_PHASE_BADGE_CLASSES[phase] || '';
    case 'Team': return TEAM_PHASE_BADGE_CLASSES[phase] || '';
    case 'Manager': return MANAGER_PHASE_BADGE_CLASSES[phase] || '';
    case 'Human': return phase === 'Active'
      ? 'bg-green-500/10 text-green-600 dark:text-green-400'
      : phase === 'Pending'
        ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
        : 'bg-red-500/10 text-red-600 dark:text-red-400';
    default: return '';
  }
}

function YamlPreviewDialog({
  open,
  onOpenChange,
  resource,
}: {
  open: boolean;
  onOpenChange: (_v: boolean) => void;
  resource: CRDResource | null;
}) {
  const { copied, copy } = useCopyToClipboard();
  if (!resource) return null;

  const jsonStr = JSON.stringify(resource.raw, null, 2);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-w-[95vw]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Code2 className="w-4 h-4" />
            YAML 预览 - {resource.kind}/{resource.name}
          </DialogTitle>
        </DialogHeader>
        <div className="relative">
          <pre className="bg-muted/80 rounded-lg p-4 text-xs font-mono overflow-auto max-h-[60vh] custom-scrollbar border border-border/50 whitespace-pre-wrap break-all">
            <code>{jsonStr}</code>
          </pre>
          <Button
            variant="ghost"
            size="sm"
            className="absolute top-3 right-3 h-7 gap-1.5 text-xs"
            onClick={() => copy(jsonStr)}
            aria-label={copied ? '已复制' : '复制全部'}
            title={copied ? '已复制' : '复制全部'}
          >
            {copied ? <Check className="w-3 h-3 text-emerald-500" aria-hidden="true" /> : <Copy className="w-3 h-3" aria-hidden="true" />}
            {copied ? '已复制' : '复制全部'}
          </Button>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="text-[10px]">{resource.kind}</Badge>
          <span>名称: <code className="font-mono">{resource.name}</code></span>
          <span>阶段: <Badge className={`text-[10px] ${getPhaseBadgeClass(resource.kind, resource.phase)}`} variant="secondary">{getPhaseLabel(resource.kind, resource.phase)}</Badge></span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CRDCard({
  resource,
  onYamlPreview,
  onDelete,
}: {
  resource: CRDResource;
  onYamlPreview: (_r: CRDResource) => void;
  onDelete: (_name: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const kindConfig: Record<string, { icon: typeof Bot; color: string;   extraInfo: (_r: CRDResource) => React.ReactNode }> = {
    Worker: {
      icon: Bot,
      color: 'text-primary',
      extraInfo: (r) => {
        const w = r.raw as WorkerResponse;
        return (
          <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
            {w.runtime && <Badge variant="outline" className="text-[10px]">{RUNTIME_LABELS[w.runtime] || w.runtime}</Badge>}
            {w.model && <span className="truncate max-w-[120px]" title={w.model}>{w.model}</span>}
            {w.team && <Badge variant="outline" className="text-[10px]">团队: {w.team}</Badge>}
            {w.role && <Badge variant="outline" className="text-[10px]">角色: {w.role}</Badge>}
          </div>
        );
      },
    },
    Team: {
      icon: Users,
      color: 'text-emerald-500',
      extraInfo: (r) => {
        const t = r.raw as TeamResponse;
        return (
          <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
            <span>就绪: {t.readyWorkers}/{t.totalWorkers}</span>
            {t.workerNames && t.workerNames.length > 0 && (
              <Badge variant="outline" className="text-[10px]">{t.workerNames.length} Worker</Badge>
            )}
          </div>
        );
      },
    },
    Human: {
      icon: UserCheck,
      color: 'text-cyan-500',
      extraInfo: (r) => {
        const h = r.raw as HumanResponse;
        return (
          <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
            <span>{h.displayName}</span>
            {h.rooms && h.rooms.length > 0 && (
              <Badge variant="outline" className="text-[10px]">{h.rooms.length} 房间</Badge>
            )}
          </div>
        );
      },
    },
    Manager: {
      icon: Crown,
      color: 'text-violet-500',
      extraInfo: (r) => {
        const m = r.raw as ManagerResponse;
        return (
          <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
            {m.model && <span className="truncate max-w-[120px]" title={m.model}>{m.model}</span>}
            {m.welcomeSent !== undefined && (
              <Badge variant="outline" className={`text-[10px] ${m.welcomeSent ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                {m.welcomeSent ? '✓ 已发送欢迎消息' : '✗ 未发送欢迎消息'}
              </Badge>
            )}
          </div>
        );
      },
    },
  };

  const config = kindConfig[resource.kind] || kindConfig.Worker;
  const IconComp = config.icon;

  return (
    <motion.div layout>
      <Card className="glass-card hover-lift transition-shadow">
        <CardContent className="p-3">
          <div className="flex items-start gap-3">
            <div className={`w-9 h-9 rounded-lg bg-muted/50 flex items-center justify-center shrink-0`}>
              <IconComp className={`w-5 h-5 ${config.color}`} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline" className="text-[10px] shrink-0">{resource.kind}</Badge>
                <span className="font-mono text-sm font-medium truncate">{resource.name}</span>
              </div>
              <div className="flex items-center gap-2 mb-1.5">
                <StatusDot phase={resource.phase as never} />
                <Badge className={`text-[10px] ${getPhaseBadgeClass(resource.kind, resource.phase)}`} variant="secondary">
                  {getPhaseLabel(resource.kind, resource.phase)}
                </Badge>
              </div>
              {config.extraInfo(resource)}

              {/* Expandable detail */}
              <AnimatePresence>
                {expanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-2 p-2 rounded-md bg-muted/30 text-xs space-y-1">
                      {Object.entries(resource.raw).map(([key, val]) => {
                        if (val === undefined || val === null || val === '' || key === 'message') return null;
                        const displayVal = typeof val === 'object' ? JSON.stringify(val) : String(val);
                        if (displayVal.length > 80) return null;
                        return (
                          <div key={key} className="flex justify-between gap-2">
                            <span className="text-muted-foreground shrink-0">{key}:</span>
                            <span className="font-mono truncate text-right">{displayVal}</span>
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setExpanded(!expanded)}
                title={expanded ? '收起' : '展开详情'}
              >
                {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => onYamlPreview(resource)}
                title="YAML 预览"
              >
                <Code2 className="w-3.5 h-3.5" />
              </Button>
              {resource.kind === 'Human' && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                  onClick={() => onDelete(resource.name)}
                  title="删除"
                  aria-label={`删除 ${resource.name}`}
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export function K8sSection() {
  const { data: workers, isLoading: workersLoading, isError: workersError, refetch: refetchWorkers } = useWorkers();
  const { data: teams, isLoading: teamsLoading, isError: teamsError, refetch: refetchTeams } = useTeams();
  const { data: humans, isLoading: humansLoading, isError: humansError, refetch: refetchHumans } = useHumans();
  const { data: managers, isLoading: managersLoading, isError: managersError, refetch: refetchManagers } = useManagers();
  const { searchQuery } = useSearch();
  const { isConnected } = useAgentTeamsStore();
  const createHuman = useCreateHuman();
  const deleteHuman = useDeleteHuman();

  const [createHumanOpen, setCreateHumanOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [yamlPreview, setYamlPreview] = useState<CRDResource | null>(null);
  const [filterKind, setFilterKind] = useState<string>('all');
  const [newHuman, setNewHuman] = useState<CreateHumanRequest>({
    name: '',
    displayName: '',
  });

  const isLoading = workersLoading || teamsLoading || humansLoading || managersLoading;
  const hasError = (workersError || teamsError || humansError || managersError) && !isConnected;

  const handleRefresh = useCallback(() => {
    refetchWorkers();
    refetchTeams();
    refetchHumans();
    refetchManagers();
  }, [refetchWorkers, refetchTeams, refetchHumans, refetchManagers]);

  const crdCounts = useMemo(() => ({
    Worker: workers?.length ?? 0,
    Team: teams?.length ?? 0,
    Human: humans?.length ?? 0,
    Manager: managers?.length ?? 0,
  }), [workers, teams, humans, managers]);

  const phaseCounts = useMemo(() => {
    const counts: Record<string, Record<string, number>> = {
      Worker: {},
      Team: {},
      Human: {},
      Manager: {},
    };
    workers?.forEach((w) => { counts.Worker[w.phase] = (counts.Worker[w.phase] || 0) + 1; });
    teams?.forEach((t) => { counts.Team[t.phase] = (counts.Team[t.phase] || 0) + 1; });
    humans?.forEach((h) => { counts.Human[h.phase] = (counts.Human[h.phase] || 0) + 1; });
    managers?.forEach((m) => { counts.Manager[m.phase] = (counts.Manager[m.phase] || 0) + 1; });
    return counts;
  }, [workers, teams, humans, managers]);

  const resources = useMemo(() => {
    const list: CRDResource[] = [];
    workers?.forEach((w) =>
      list.push({ kind: 'Worker', name: w.name, phase: w.phase, raw: w })
    );
    teams?.forEach((t) =>
      list.push({ kind: 'Team', name: t.name, phase: t.phase, raw: t })
    );
    humans?.forEach((h) =>
      list.push({ kind: 'Human', name: h.name, phase: h.phase, raw: h })
    );
    managers?.forEach((m) =>
      list.push({ kind: 'Manager', name: m.name, phase: m.phase, raw: m })
    );

    let filtered = list;
    if (filterKind !== 'all') {
      filtered = filtered.filter((r) => r.kind === filterKind);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          (r.name || '').toLowerCase().includes(q) ||
          (r.kind || '').toLowerCase().includes(q) ||
          (r.phase || '').toLowerCase().includes(q)
      );
    }
    return filtered;
  }, [workers, teams, humans, managers, filterKind, searchQuery]);

  const handleCreateHuman = () => {
    createHuman.mutate(newHuman, {
      onSuccess: () => {
        setCreateHumanOpen(false);
        setNewHuman({ name: '', displayName: '' });
      },
    });
  };

  const handleDelete = () => {
    if (deleteTarget) {
      deleteHuman.mutate(deleteTarget, {
        onSuccess: () => setDeleteTarget(null),
      });
    }
  };

  if (hasError) {
    return <ApiErrorState />;
  }

  const crdTypes = [
    { kind: 'Worker', count: crdCounts.Worker, icon: Bot, color: 'text-primary', bgColor: 'bg-primary/10' },
    { kind: 'Team', count: crdCounts.Team, icon: Users, color: 'text-emerald-500', bgColor: 'bg-emerald-500/10' },
    { kind: 'Human', count: crdCounts.Human, icon: UserCheck, color: 'text-cyan-500', bgColor: 'bg-cyan-500/10' },
    { kind: 'Manager', count: crdCounts.Manager, icon: Crown, color: 'text-violet-500', bgColor: 'bg-violet-500/10' },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader
        title="K8s 资源"
        description="Kubernetes CRD 资源管理"
        isLive={isConnected}
        onRefresh={handleRefresh}
        actions={
          <Button
            size="sm"
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={() => setCreateHumanOpen(true)}
          >
            <Plus className="w-4 h-4 mr-1" />
            创建 Human
          </Button>
        }
      />

      {/* CRD Type Overview Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {crdTypes.map((crd, i) => (
          <motion.div
            key={crd.kind}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            layout
          >
            <Card
              className={`glass-card cursor-pointer transition-all ${filterKind === crd.kind ? 'ring-2 ring-primary' : ''}`}
              onClick={() => setFilterKind(filterKind === crd.kind ? 'all' : crd.kind)}
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg ${crd.bgColor} flex items-center justify-center`}>
                    <crd.icon className={`w-5 h-5 ${crd.color}`} />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground">{crd.kind}</p>
                    <p className="text-2xl font-bold">{crd.count}</p>
                  </div>
                </div>
                {/* Phase breakdown */}
                {phaseCounts[crd.kind] && Object.keys(phaseCounts[crd.kind]).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {Object.entries(phaseCounts[crd.kind]).map(([phase, count]) => (
                      <Badge
                        key={phase}
                        className={`text-[10px] ${getPhaseBadgeClass(crd.kind, phase)}`}
                        variant="secondary"
                      >
                        {getPhaseLabel(crd.kind, phase)} {count}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Filter Bar */}
      {filterKind !== 'all' && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">筛选:</span>
          <Badge variant="secondary" className="gap-1">
            {filterKind}
            <button onClick={() => setFilterKind('all')} className="ml-1 hover:text-destructive">
              <X className="w-3 h-3" />
            </button>
          </Badge>
          <span className="text-xs text-muted-foreground">
            显示 {resources.length} 个资源
          </span>
        </div>
      )}

      {/* CRD Resources Card View */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Layers className="w-4 h-4" />
            CRD 资源列表
            <Badge variant="outline" className="text-[10px] ml-auto">{resources.length} 条</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-lg" />
              ))}
            </div>
          ) : resources.length === 0 ? (
            <div className="p-8 text-center">
              <Layers className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">暂无 CRD 资源</p>
              {filterKind !== 'all' && (
                <Button variant="link" size="sm" className="mt-2" onClick={() => setFilterKind('all')}>
                  清除筛选
                </Button>
              )}
            </div>
          ) : (
            <ScrollArea className="max-h-[600px]">
              <div className="space-y-2 pr-1">
                {resources.map((r, i) => (
                  <motion.div
                    key={`${r.kind}-${r.name}`}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.02 }}
                  >
                    <CRDCard
                      resource={r}
                      onYamlPreview={setYamlPreview}
                      onDelete={setDeleteTarget}
                    />
                  </motion.div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Reconcile Loop */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <RefreshCw className="w-4 h-4" />
            Controller 调谐循环
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>AgentTeams Controller 基于 Kubernetes Controller 模式，持续调谐 CRD 资源：</p>
            <ol className="list-decimal list-inside space-y-1 ml-2">
              <li>Watch 监听 Worker/Team/Human/Manager CRD 变更事件</li>
              <li>对比期望状态（Spec）与实际状态（Status）</li>
              <li>执行调谐逻辑：创建/更新/删除底层资源</li>
              <li>更新 CRD Status 反映当前阶段</li>
              <li>循环往复，确保最终一致性</li>
            </ol>
            <div className="mt-3 p-3 rounded-lg bg-muted/30 border border-border/50">
              <p className="text-xs">
                <strong className="text-foreground">CRD 类型说明：</strong>
                Worker、Team、Human、Manager 均为 AgentTeams 自定义资源定义（CRD），
                由 Controller 统一管理生命周期。点击上方卡片可按类型筛选，点击
                <Code2 className="w-3 h-3 inline mx-0.5" />
                按钮查看资源的 JSON 表示。
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* YAML Preview Dialog */}
      <YamlPreviewDialog
        open={!!yamlPreview}
        onOpenChange={(v) => { if (!v) setYamlPreview(null); }}
        resource={yamlPreview}
      />

      {/* Create Human Dialog */}
      <Dialog open={createHumanOpen} onOpenChange={setCreateHumanOpen}>
        <DialogContent className="sm:max-w-lg max-w-[95vw]">
          <DialogHeader>
            <DialogTitle>创建人类用户</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>名称 *</Label>
              <Input
                value={newHuman.name}
                onChange={(e) => setNewHuman({ ...newHuman, name: e.target.value })}
                placeholder="human-name"
              />
            </div>
            <div className="space-y-2">
              <Label>显示名称 *</Label>
              <Input
                value={newHuman.displayName}
                onChange={(e) => setNewHuman({ ...newHuman, displayName: e.target.value })}
                placeholder="张三"
              />
            </div>
            <div className="space-y-2">
              <Label>邮箱</Label>
              <Input
                value={newHuman.email || ''}
                onChange={(e) => setNewHuman({ ...newHuman, email: e.target.value })}
                placeholder="user@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label>权限等级</Label>
              <Input
                type="number"
                min={1}
                max={3}
                value={newHuman.permissionLevel || ''}
                onChange={(e) => setNewHuman({ ...newHuman, permissionLevel: Number(e.target.value) as 1 | 2 | 3 })}
                placeholder="1-3"
              />
              <p className="text-xs text-muted-foreground">1=观察者, 2=操作者, 3=管理员</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateHumanOpen(false)}>取消</Button>
            <Button
              onClick={handleCreateHuman}
              disabled={!newHuman.name || !newHuman.displayName || createHuman.isPending}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {createHuman.isPending ? '创建中...' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Human Confirmation */}
      <ConfirmDeleteDialog
        open={!!deleteTarget}
        onOpenChange={() => setDeleteTarget(null)}
        resourceType="用户"
        itemName={deleteTarget ?? ''}
        onConfirm={handleDelete}
      />
    </div>
  );
}

'use client';

import { useState, useMemo, useCallback } from 'react';
import { Plus, UserCheck, Download, ArrowUpDown, LayoutGrid, List } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useHumans } from '@/hooks/use-agentteams-humans';
import { useCreateHuman, useDeleteHuman } from '@/hooks/use-agentteams-mutations';
import { useSearch } from '@/lib/search-context';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useViewMode } from '@/lib/use-view-mode';
import { ApiErrorState } from '@/components/dashboard/api-error-state';
import { SectionHeader } from '@/components/dashboard/section-header';
import { ConfirmDeleteDialog } from '@/components/dashboard/confirm-delete-dialog';
import { toast } from 'sonner';
import type { CreateHumanRequest, HumanResponse } from '@/lib/agentteams-api';
import { SORT_OPTIONS, type SortKey } from './humans/human-types';
import {
  computePhaseStats,
  filterHumans,
  sortHumans,
} from './humans/human-selectors';
import { HumanCard } from './humans/human-card';
import { HumanTable } from './humans/human-table';
import { HumanCreateDialog } from './humans/human-create-dialog';
import { HumanDetailDialog } from './humans/human-detail-dialog';
import { PhaseDistribution } from './humans/human-phase-distribution';

function HumansSkeleton({ viewMode }: { viewMode: 'card' | 'table' | 'compact' }) {
  if (viewMode === 'card') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="glass-card">
            <CardContent className="p-4 space-y-3">
              <div className="h-5 w-32 rounded shimmer" />
              <div className="h-4 w-24 rounded shimmer" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }
  return (
    <Card className="glass-card">
      <CardContent className="p-4 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-8 w-full rounded shimmer" />
        ))}
      </CardContent>
    </Card>
  );
}

function EmptyState({ hasQuery, onCreate }: { hasQuery: boolean; onCreate: () => void }) {
  return (
    <Card className="glass-card">
      <CardContent className="p-12 text-center">
        <UserCheck className="w-12 h-12 text-muted-foreground mx-auto mb-4" aria-hidden="true" />
        <p className="text-muted-foreground">
          {hasQuery ? '没有匹配的 Human' : '暂无 Human'}
        </p>
        {!hasQuery && (
          <Button variant="outline" className="mt-4" onClick={onCreate}>
            <Plus className="w-4 h-4 mr-1" aria-hidden="true" />
            创建第一个 Human
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function HumansSection() {
  const { data: humans, isLoading, isError, refetch, isRefetching } = useHumans();
  const { searchQuery } = useSearch();
  const { isConnected } = useAgentTeamsStore();
  const createHuman = useCreateHuman();
  const deleteHuman = useDeleteHuman();

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [detailHuman, setDetailHuman] = useState<HumanResponse | null>(null);

  const [newHuman, setNewHuman] = useState<CreateHumanRequest>({
    name: '',
    displayName: '',
    permissionLevel: 1,
  });

  const [sortKey, setSortKey] = useState<SortKey>('name');
  const { viewMode, handleViewModeChange } = useViewMode('card');

  const filteredHumans = useMemo(
    () => filterHumans(humans, searchQuery),
    [humans, searchQuery],
  );
  const sortedHumans = useMemo(
    () => sortHumans(filteredHumans, sortKey),
    [filteredHumans, sortKey],
  );
  const phaseStats = useMemo(() => computePhaseStats(humans), [humans]);

  const handleExport = useCallback(() => {
    if (!humans) return;
    const data = JSON.stringify(humans, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agentteams-humans-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Humans 数据已导出');
  }, [humans]);

  const handleCreate = useCallback(() => {
    createHuman.mutate(newHuman, {
      onSuccess: () => {
        setCreateOpen(false);
        setNewHuman({ name: '', displayName: '', permissionLevel: 1 });
      },
    });
  }, [createHuman, newHuman]);

  const handleDelete = useCallback(() => {
    if (deleteTarget) {
      deleteHuman.mutate(deleteTarget, {
        onSuccess: () => setDeleteTarget(null),
      });
    }
  }, [deleteTarget, deleteHuman]);


  if (isError && !isConnected) {
    return <ApiErrorState />;
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Humans"
        description="管理人类用户和权限"
        isLive={isConnected}
        onRefresh={() => refetch()}
        isRefreshing={isRefetching}
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={!humans || humans.length === 0}
            >
              <Download className="w-4 h-4 mr-1" aria-hidden="true" />
              导出 JSON
            </Button>
            <Button
              size="sm"
              className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:from-emerald-600 hover:to-teal-600"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="w-4 h-4 mr-1" aria-hidden="true" />
              创建 Human
            </Button>
          </div>
        }
      />

      <PhaseDistribution stats={phaseStats} />

      {sortedHumans.length > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <ArrowUpDown className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3">
            <Tabs value={viewMode} onValueChange={handleViewModeChange}>
              <TabsList className="h-8">
                <TabsTrigger value="card" className="px-2 py-1 text-xs gap-1">
                  <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" />
                  卡片
                </TabsTrigger>
                <TabsTrigger value="table" className="px-2 py-1 text-xs gap-1">
                  <List className="w-3.5 h-3.5" aria-hidden="true" />
                  表格
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
      )}

      {isLoading ? (
        <HumansSkeleton viewMode={viewMode} />
      ) : sortedHumans.length === 0 ? (
        <EmptyState hasQuery={!!searchQuery} onCreate={() => setCreateOpen(true)} />
      ) : viewMode === 'card' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedHumans.map((human, i) => (
            <HumanCard
              key={human.name}
              human={human}
              index={i}
              onView={setDetailHuman}
              onDelete={setDeleteTarget}
            />
          ))}
        </div>
      ) : (
        <HumanTable
          humans={sortedHumans}
          onView={setDetailHuman}
          onDelete={setDeleteTarget}
        />
      )}

      <HumanCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        value={newHuman}
        onChange={setNewHuman}
        isPending={createHuman.isPending}
        onSubmit={handleCreate}
      />

      <HumanDetailDialog
        human={detailHuman}
        onOpenChange={(open) => !open && setDetailHuman(null)}
      />

      <ConfirmDeleteDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        resourceType="Human"
        itemName={deleteTarget ?? ''}
        onConfirm={handleDelete}
        isLoading={deleteHuman.isPending}
      />
    </div>
  );
}

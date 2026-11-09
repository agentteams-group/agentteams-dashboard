'use client';

import { useState, useMemo, useCallback } from 'react';
import { Plus, UserCheck, ArrowUpDown } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { SectionEmptyState } from '@/components/dashboard/section-empty-state';
import { Button } from '@/components/ui/button';
import { ResourceListMenu } from '@/components/dashboard/resource-list-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useHumans } from '@/hooks/use-agentteams-humans';
import { useTeams } from '@/hooks/use-agentteams-teams';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { useCreateHuman, useDeleteHuman } from '@/hooks/use-agentteams-mutations';
import { useSearch } from '@/lib/search-context';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { ApiErrorState } from '@/components/dashboard/api-error-state';
import { SectionHeader } from '@/components/dashboard/section-header';
import { ConfirmDeleteDialog } from '@/components/dashboard/confirm-delete-dialog';
import { toast } from 'sonner';
import type { CreateHumanRequest, HumanResponse } from '@/lib/agentteams-api';
import { SORT_OPTIONS, type SortKey } from './humans/human-types';
import {
  filterHumans,
  sortHumans,
} from './humans/human-selectors';
import { HumanTable } from './humans/human-table';
import { HumanCreateDialog } from './humans/human-create-dialog';
import { HumanDetailDialog } from './humans/human-detail-dialog';
import { HumanDrawer } from './humans/human-drawer';

function HumansSkeleton() {
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
      <CardContent className="p-0">
        <SectionEmptyState
          icon={UserCheck}
          title={hasQuery ? '没有匹配的用户' : '暂无用户'}
          // 搜不到不等于一个都没有：筛选出来的空页不推「创建第一个」。
          action={hasQuery ? undefined : { label: '创建第一个用户', onClick: onCreate }}
        />
      </CardContent>
    </Card>
  );
}

export function HumansSection() {
  const { data: allHumans, isLoading, isError, refetch, isRefetching } = useHumans();
  const humans = useMemo(() => allHumans?.filter(human => !human.systemAdmin), [allHumans]);
  const { data: teams } = useTeams();
  const { data: workers } = useWorkers();
  const { searchQuery } = useSearch();
  const { isConnected, userLevel } = useAgentTeamsStore();
  const createHuman = useCreateHuman();
  const deleteHuman = useDeleteHuman();

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  // 详情 = 只读弹窗；编辑 = 右侧抽屉（四卡）。
  const [detailHuman, setDetailHuman] = useState<HumanResponse | null>(null);
  const [drawerHuman, setDrawerHuman] = useState<HumanResponse | null>(null);

  const [newHuman, setNewHuman] = useState<CreateHumanRequest>({
    name: '',
    displayName: '',
    permissionLevel: 2,
  });

  const [sortKey, setSortKey] = useState<SortKey>('name');

  const filteredHumans = useMemo(
    () => filterHumans(humans, searchQuery),
    [humans, searchQuery],
  );
  const sortedHumans = useMemo(
    () => sortHumans(filteredHumans, sortKey),
    [filteredHumans, sortKey],
  );

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
        setNewHuman({ name: '', displayName: '', permissionLevel: 2 });
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
    <div className="space-y-3">
      <SectionHeader
        title={`用户${humans ? ` · ${humans.length}` : ''}`}
        isLive={isConnected}
        onRefresh={() => refetch()}
        isRefreshing={isRefetching}
        actions={
          <div className="flex items-center gap-2">
            {sortedHumans.length > 0 && (
              <div className="flex items-center gap-2">
                <ArrowUpDown className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
                  <SelectTrigger aria-label="用户排序" className="w-[140px] h-8 text-xs">
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
            )}
            <ResourceListMenu label="列表更多操作" items={[
              { label: '导出 JSON', onSelect: handleExport, disabled: !humans || humans.length === 0 },
            ]} />
            <Button
              size="sm"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="w-4 h-4 mr-1" aria-hidden="true" />
              创建用户
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <HumansSkeleton />
      ) : sortedHumans.length === 0 ? (
        <EmptyState hasQuery={!!searchQuery} onCreate={() => setCreateOpen(true)} />
      ) : (
        <HumanTable
          humans={sortedHumans}
          onView={setDetailHuman}
          onEdit={setDrawerHuman}
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

      <HumanDrawer
        human={drawerHuman}
        teams={(teams ?? []).map((team) => ({
          name: team.name,
          humanMembers: team.humanMembers,
        }))}
        workers={(workers ?? []).map((worker) => ({ name: worker.name }))}
        userLevel={userLevel}
        onOpenChange={(open) => !open && setDrawerHuman(null)}
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

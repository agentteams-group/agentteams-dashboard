'use client';

import { useState, useMemo, useCallback } from 'react';
import { Crown, Plus, Download, ArrowUpDown, LayoutGrid, List } from 'lucide-react';
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
import { useManagers } from '@/hooks/use-agentteams-managers';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { useTeams } from '@/hooks/use-agentteams-teams';
import { useCreateManager, useDeleteManager, useUpdateManager } from '@/hooks/use-agentteams-mutations';
import { useSearch } from '@/lib/search-context';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useViewMode } from '@/lib/use-view-mode';
import { ApiErrorState } from '@/components/dashboard/api-error-state';
import { SectionHeader } from '@/components/dashboard/section-header';
import { ConfirmDeleteDialog } from '@/components/dashboard/confirm-delete-dialog';
import { toast } from 'sonner';
import type {
  CreateManagerRequest,
  ManagerResponse,
  TeamResponse,
  UpdateManagerRequest,
  WorkerResponse,
} from '@/lib/agentteams-api';
import { SORT_OPTIONS, type SortKey } from './managers/manager-types';
import {
  filterManagers,
  sortManagers,
} from './managers/manager-selectors';
import { ManagerCard } from './managers/manager-card';
import { ManagerTable } from './managers/manager-table';
import { ManagerCreateDialog } from './managers/manager-create-dialog';
import { ManagerEditDialog, type ManagerEditForm } from './managers/manager-edit-dialog';
import { ManagerDetailDialog } from './managers/manager-detail-dialog';

function ManagersSkeleton({ viewMode }: { viewMode: 'card' | 'table' }) {
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
        <Crown className="w-12 h-12 text-muted-foreground mx-auto mb-4" aria-hidden="true" />
        <p className="text-muted-foreground">
          {hasQuery ? '没有匹配的 Manager' : '暂无 Manager'}
        </p>
        {!hasQuery && (
          <Button variant="outline" className="mt-4" onClick={onCreate}>
            <Plus className="w-4 h-4 mr-1" aria-hidden="true" />
            创建第一个 Manager
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function ManagersSection() {
  const { data: managers, isLoading, isError, refetch, isRefetching } = useManagers();
  const { data: workers } = useWorkers();
  const { data: teams } = useTeams();
  const { searchQuery } = useSearch();
  const { isConnected } = useAgentTeamsStore();
  const createManager = useCreateManager();
  const deleteManager = useDeleteManager();
  const updateManager = useUpdateManager();

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [detailManager, setDetailManager] = useState<ManagerResponse | null>(null);
  const [editManager, setEditManager] = useState<ManagerResponse | null>(null);

  const [newManager, setNewManager] = useState<CreateManagerRequest>({ name: '' });
  const [editForm, setEditForm] = useState<ManagerEditForm>({});

  const [sortKey, setSortKey] = useState<SortKey>('name');
  const { viewMode, handleViewModeChange } = useViewMode('card');

  const filteredManagers = useMemo(
    () => filterManagers(managers, searchQuery),
    [managers, searchQuery],
  );
  const sortedManagers = useMemo(
    () => sortManagers(filteredManagers, sortKey),
    [filteredManagers, sortKey],
  );

  const handleExport = useCallback(() => {
    if (!managers) return;
    const data = JSON.stringify(managers, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agentteams-managers-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Managers 数据已导出');
  }, [managers]);

  const handleCreate = useCallback(() => {
    createManager.mutate(newManager, {
      onSuccess: () => {
        setCreateOpen(false);
        setNewManager({ name: '' });
      },
    });
  }, [createManager, newManager]);

  const handleDelete = useCallback(() => {
    if (deleteTarget) {
      deleteManager.mutate(deleteTarget, {
        onSuccess: () => setDeleteTarget(null),
      });
    }
  }, [deleteTarget, deleteManager]);

  const openEdit = useCallback((manager: ManagerResponse) => {
    setEditManager(manager);
    setEditForm({
      name: manager.name,
      model: manager.model || '',
      runtime: manager.runtime || '',
      image: manager.image || '',
      state: manager.state,
    });
  }, []);

  const closeEdit = useCallback(() => {
    setEditManager(null);
    setEditForm({});
  }, []);

  const handleUpdate = useCallback(() => {
    if (!editManager) return;
    const { name: _ignored, state: _ignoredState, ...data } = editForm;
    void _ignored;
    void _ignoredState;
    updateManager.mutate(
      { name: editManager.name, data: data as UpdateManagerRequest },
      { onSuccess: closeEdit },
    );
  }, [editForm, editManager, updateManager, closeEdit]);

  const workersList: WorkerResponse[] = workers || [];
  const teamsList: TeamResponse[] = teams || [];

  if (isError && !isConnected) {
    return <ApiErrorState />;
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Managers"
        description="管理团队领导和协调者"
        isLive={isConnected}
        onRefresh={() => refetch()}
        isRefreshing={isRefetching}
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={!managers || managers.length === 0}
            >
              <Download className="w-4 h-4 mr-1" aria-hidden="true" />
              导出 JSON
            </Button>
            <Button
              size="sm"
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="w-4 h-4 mr-1" aria-hidden="true" />
              创建 Manager
            </Button>
          </div>
        }
      />

      {sortedManagers.length > 0 && (
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
        <ManagersSkeleton viewMode={viewMode} />
      ) : sortedManagers.length === 0 ? (
        <EmptyState hasQuery={!!searchQuery} onCreate={() => setCreateOpen(true)} />
      ) : viewMode === 'card' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedManagers.map((manager, i) => (
            <ManagerCard
              key={manager.name}
              manager={manager}
              index={i}
              onView={setDetailManager}
              onEdit={openEdit}
              onDelete={setDeleteTarget}
            />
          ))}
        </div>
      ) : (
        <ManagerTable
          managers={sortedManagers}
          onView={setDetailManager}
          onEdit={openEdit}
          onDelete={setDeleteTarget}
        />
      )}

      <ManagerCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        value={newManager}
        onChange={setNewManager}
        isPending={createManager.isPending}
        onSubmit={handleCreate}
      />

      <ManagerEditDialog
        open={!!editManager}
        managerName={editManager?.name ?? null}
        value={editForm}
        onChange={setEditForm}
        isPending={updateManager.isPending}
        onOpenChange={(open) => !open && closeEdit()}
        onSubmit={handleUpdate}
      />

      <ManagerDetailDialog
        manager={detailManager}
        workers={workersList}
        teams={teamsList}
        onOpenChange={(open) => !open && setDetailManager(null)}
      />

      <ConfirmDeleteDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        resourceType="Manager"
        itemName={deleteTarget ?? ''}
        onConfirm={handleDelete}
      />
    </div>
  );
}

'use client';

import { useState, useMemo, useCallback } from 'react';
import { Plus, Users, Download, ArrowUpDown, LayoutGrid, List } from 'lucide-react';
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
import { useTeams } from '@/hooks/use-agentteams-teams';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { useManagers } from '@/hooks/use-agentteams-managers';
import { useCreateTeam, useDeleteTeam, useUpdateTeam } from '@/hooks/use-agentteams-mutations';
import { useSearch } from '@/lib/search-context';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useViewMode } from '@/lib/use-view-mode';
import { ApiErrorState } from '@/components/dashboard/api-error-state';
import { SectionHeader } from '@/components/dashboard/section-header';
import { ConfirmDeleteDialog } from '@/components/dashboard/confirm-delete-dialog';
import { toast } from 'sonner';
import type { CreateTeamRequest, UpdateTeamRequest, TeamResponse, WorkerResponse, ManagerResponse } from '@/lib/agentteams-api';
import { ITEMS_PER_PAGE, SORT_OPTIONS, type SortKey } from './teams/team-types';
import {
  filterTeams,
  getAvailableWorkers,
  paginateTeams,
  sortTeams,
} from './teams/team-selectors';
import { TeamCard } from './teams/team-card';
import { TeamTable } from './teams/team-table';
import { TeamCreateDialog } from './teams/team-create-dialog';
import { TeamEditDialog, type TeamEditForm } from './teams/team-edit-dialog';
import { TeamDetailDialog } from './teams/team-detail-dialog';
import { TeamTopologyDialog } from './teams/team-topology-dialog';
import { TopologyOverview } from './teams/team-topology-overview';
import { PaginationFooter } from './teams/team-pagination';

function TeamsSkeleton({ viewMode }: { viewMode: 'card' | 'table' }) {
  if (viewMode === 'card') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
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
        <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" aria-hidden="true" />
        <p className="text-muted-foreground">
          {hasQuery ? '没有匹配的团队' : '暂无团队'}
        </p>
        {!hasQuery && (
          <Button variant="outline" className="mt-4" onClick={onCreate}>
            <Plus className="w-4 h-4 mr-1" aria-hidden="true" />
            创建第一个团队
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function TeamsSection() {
  const { data: teams, isLoading, isError, refetch, isRefetching } = useTeams();
  const { data: workers } = useWorkers();
  const { data: managers } = useManagers();
  const { searchQuery } = useSearch();
  const { isConnected } = useAgentTeamsStore();
  const createTeam = useCreateTeam();
  const deleteTeam = useDeleteTeam();
  const updateTeam = useUpdateTeam();

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [detailTeam, setDetailTeam] = useState<TeamResponse | null>(null);
  const [editTeam, setEditTeam] = useState<TeamResponse | null>(null);
  const [topologyTeam, setTopologyTeam] = useState<TeamResponse | null>(null);

  const [newTeam, setNewTeam] = useState<CreateTeamRequest>({ name: '', leader: { name: '' } });
  const [editForm, setEditForm] = useState<TeamEditForm>({});

  const [sortKey, setSortKey] = useState<SortKey>('name');
  const { viewMode, handleViewModeChange } = useViewMode('card');
  const [currentPage, setCurrentPage] = useState(1);

  const [addWorkerPopoverOpen, setAddWorkerPopoverOpen] = useState<string | null>(null);

  const filteredTeams = useMemo(() => filterTeams(teams, searchQuery), [teams, searchQuery]);
  const sortedTeams = useMemo(() => sortTeams(filteredTeams, sortKey), [filteredTeams, sortKey]);
  const { items: paginatedTeams, totalPages, safePage } = useMemo(
    () => paginateTeams(sortedTeams, currentPage, ITEMS_PER_PAGE),
    [sortedTeams, currentPage],
  );

  const pageSection = (
    <PaginationFooter
      pageKey={`${searchQuery}|${sortKey}`}
      currentPage={safePage}
      totalPages={totalPages}
      totalItems={sortedTeams.length}
      label="团队"
      onChange={setCurrentPage}
    />
  );

  const getAvailableFor = useCallback(
    (teamName: string, currentWorkerNames: string[]) =>
      getAvailableWorkers(workers, teamName, currentWorkerNames),
    [workers],
  );

  const handleExport = useCallback(() => {
    if (!teams) return;
    const data = JSON.stringify(teams, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agentteams-teams-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('团队数据已导出');
  }, [teams]);

  const handleCreate = useCallback(() => {
    createTeam.mutate(newTeam, {
      onSuccess: () => {
        setCreateOpen(false);
        setNewTeam({ name: '', leader: { name: '' } });
      },
    });
  }, [createTeam, newTeam]);

  const handleDelete = useCallback(() => {
    if (deleteTarget) {
      deleteTeam.mutate(deleteTarget, {
        onSuccess: () => setDeleteTarget(null),
      });
    }
  }, [deleteTarget, deleteTeam]);

  const openEdit = useCallback((team: TeamResponse) => {
    setEditTeam(team);
    setEditForm({
      name: team.name,
      teamName: team.teamName || '',
      description: team.description || '',
      workerNames: team.workerNames || [],
    });
  }, []);

  const closeEdit = useCallback(() => {
    setEditTeam(null);
    setEditForm({});
  }, []);

  const handleUpdate = useCallback(() => {
    if (!editTeam) return;
    const { name: _ignored, ...data } = editForm;
    void _ignored;
    updateTeam.mutate(
      { name: editTeam.name, data: data as UpdateTeamRequest },
      { onSuccess: closeEdit },
    );
  }, [editForm, editTeam, updateTeam, closeEdit]);

  const handleAddWorker = useCallback(
    (teamName: string, workerName: string) => {
      const team = teams?.find((t) => t.name === teamName);
      if (!team) return;
      const next = [...(team.workerNames || []), workerName];
      updateTeam.mutate(
        { name: teamName, data: { workerNames: next } },
        {
          onSuccess: () => {
            toast.success(`已将 Worker "${workerName}" 添加到团队 "${teamName}"`);
            setAddWorkerPopoverOpen(null);
          },
        },
      );
    },
    [teams, updateTeam],
  );

  const workersList: WorkerResponse[] = workers || [];
  const managersList: ManagerResponse[] = managers || [];

  if (isError && !isConnected) {
    return <ApiErrorState />;
  }

  return (
    <div className="space-y-6">
      <TopologyOverview />

      <SectionHeader
        title="团队"
        description="管理团队和协作配置"
        isLive={isConnected}
        onRefresh={() => refetch()}
        isRefreshing={isRefetching}
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={!teams || teams.length === 0}
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
              创建团队
            </Button>
          </div>
        }
      />

      {sortedTeams.length > 0 && (
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
        <TeamsSkeleton viewMode={viewMode} />
      ) : sortedTeams.length === 0 ? (
        <EmptyState hasQuery={!!searchQuery} onCreate={() => setCreateOpen(true)} />
      ) : (
        <>
          {viewMode === 'card' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {paginatedTeams.map((team, i) => (
                <TeamCard
                  key={team.name}
                  team={team}
                  index={i}
                  availableWorkers={getAvailableFor(team.name, team.workerNames || [])}
                  isAddWorkerOpen={addWorkerPopoverOpen === team.name}
                  onAddWorkerPopoverChange={(open) =>
                    setAddWorkerPopoverOpen(open ? team.name : null)
                  }
                  onView={setDetailTeam}
                  onEdit={openEdit}
                  onDelete={setDeleteTarget}
                  onAddWorker={handleAddWorker}
                  onShowTopology={setTopologyTeam}
                />
              ))}
            </div>
          ) : (
            <TeamTable
              teams={paginatedTeams}
              getAvailableFor={getAvailableFor}
              isAddWorkerOpen={(name) => addWorkerPopoverOpen === name}
              onAddWorkerPopoverChange={(name, open) =>
                setAddWorkerPopoverOpen(open ? name : null)
              }
              onView={setDetailTeam}
              onEdit={openEdit}
              onDelete={setDeleteTarget}
              onAddWorker={handleAddWorker}
              onShowTopology={setTopologyTeam}
            />
          )}
          {pageSection}
        </>
      )}

      <TeamCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        value={newTeam}
        onChange={setNewTeam}
        isPending={createTeam.isPending}
        onSubmit={handleCreate}
      />

      <TeamEditDialog
        open={!!editTeam}
        teamName={editTeam?.name ?? null}
        value={editForm}
        onChange={setEditForm}
        isPending={updateTeam.isPending}
        onOpenChange={(open) => !open && closeEdit()}
        onSubmit={handleUpdate}
      />

      <TeamDetailDialog
        team={detailTeam}
        workers={workersList}
        onOpenChange={(open) => !open && setDetailTeam(null)}
      />

      <TeamTopologyDialog
        team={topologyTeam}
        workers={workersList}
        managers={managersList}
        onOpenChange={(open) => !open && setTopologyTeam(null)}
      />

      <ConfirmDeleteDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        resourceType="团队"
        itemName={deleteTarget ?? ''}
        onConfirm={handleDelete}
      />
    </div>
  );
}

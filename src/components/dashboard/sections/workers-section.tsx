'use client';

import { useState, useMemo, useCallback } from 'react';
import { ArrowUpDown, Bot, CheckCircle, CheckSquare, Download, FileCode, LayoutGrid, List, Loader2, Plus, Square, Upload, X, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import {
  useCreateWorker,
  useDeleteWorker,
  useWakeWorker,
  useSleepWorker,
  useEnsureReadyWorker,
  useUpdateWorker,
} from '@/hooks/use-agentteams-mutations';
import { useSearch } from '@/lib/search-context';
import { agentteamsApi } from '@/lib/agentteams-api';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useViewMode } from '@/lib/use-view-mode';
import { RUNTIME_LABELS } from '@/lib/phase-colors';
import { useModels, useAiRoutes } from '@/hooks/use-agentteams-models';
import { buildModelBindings, hasUnavailableModelAliases } from '@/lib/model-bindings';
import { buildModelSelectionOptions } from '@/lib/model-catalog';
import { ApiErrorState } from '@/components/dashboard/api-error-state';
import { SectionHeader } from '@/components/dashboard/section-header';
import { ConfirmDeleteDialog } from '@/components/dashboard/confirm-delete-dialog';
import { describeWorkerDeleteError } from '@/lib/api-error';
import { toast } from 'sonner';
import type { CreateWorkerRequest, UpdateWorkerRequest, WorkerResponse } from '@/lib/agentteams-api';
import { SORT_OPTIONS, ITEMS_PER_PAGE, type SortKey } from './workers/worker-types';
import {
  computeRuntimeDist,
  filterWorkers,
  paginateWorkers,
  sortWorkers,
} from './workers/worker-selectors';
import { WorkerCard } from './workers/worker-card';
import { WorkerTable } from './workers/worker-table';
import { WorkerPagination } from './workers/worker-pagination';
import { WorkerBulkBar, WorkerBulkConfirm, type BulkAction } from './workers/worker-bulk-bar';
import { WorkerCreateDialog } from './workers/worker-create-dialog';
import {
  WorkerEditDialog,
  type WorkerEditForm,
} from './workers/worker-edit-dialog';
import { WorkerDetailDialog } from './workers/worker-detail-dialog';
import { WorkerConfigDialog } from './workers/worker-config-dialog';
import { WorkerUploadDialog } from './workers/worker-upload-dialog';

function RuntimeDistribution({ dist }: { dist: Record<string, number> }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {Object.entries(RUNTIME_LABELS).map(([key, label]) => (
        <Card key={key} className="glass-card">
          <CardContent className="p-3 flex items-center gap-3">
            <Bot className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
            <div>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-lg font-bold">{dist[key] || 0}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function WorkersSkeleton({ viewMode }: { viewMode: 'card' | 'table' }) {
  if (viewMode === 'card') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="glass-card">
            <CardContent className="p-4 space-y-3">
              <div className="h-5 w-32 rounded shimmer" />
              <div className="h-4 w-24 rounded shimmer" />
              <div className="h-4 w-20 rounded shimmer" />
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
        <Bot className="w-12 h-12 text-muted-foreground mx-auto mb-4" aria-hidden="true" />
        <p className="text-muted-foreground">
          {hasQuery ? '没有匹配的 Worker' : '暂无 Worker'}
        </p>
        {!hasQuery && (
          <Button variant="outline" className="mt-4" onClick={onCreate}>
            <Plus className="w-4 h-4 mr-1" aria-hidden="true" />
            创建第一个 Worker
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function runtimeModelUpdateMessage(runtime: CreateWorkerRequest['runtime'] | undefined): string {
  if (runtime === 'openclaw') return '模型配置已保存。OpenClaw 会在 Worker 重启后加载新模型。';
  if (runtime === 'qwenpaw') return '模型配置已保存。QwenPaw 会在约 5 秒的轮询周期内加载新模型。';
  return '模型配置已保存。Controller 将在下一次运行时调谐时加载新模型。';
}

export function WorkersSection() {
  const { data: workers, isLoading, isError, refetch, isRefetching } = useWorkers();
  const { isConnected } = useAgentTeamsStore();
  const { searchQuery } = useSearch();
  const createWorker = useCreateWorker();
  const deleteWorker = useDeleteWorker();
  const wakeWorker = useWakeWorker();
  const sleepWorker = useSleepWorker();
  const ensureReadyWorker = useEnsureReadyWorker();
  const updateWorker = useUpdateWorker();
  // Soft model alias validation (embedded mode): warn but allow submit.
  const { data: providers } = useModels();
  const { data: aiRoutes } = useAiRoutes();

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [detailWorker, setDetailWorker] = useState<WorkerResponse | null>(null);
  const [editWorker, setEditWorker] = useState<WorkerResponse | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ skillName: string; description: string; filesCount: number; note?: string } | null>(null);
  const [syncingSkills, setSyncingSkills] = useState<{ workerName: string; skills: string[]; done: string[]; failed: string[] } | null>(null);
  const [configText, setConfigText] = useState('');
  const [configError, setConfigError] = useState<string | null>(null);

  const { viewMode, handleViewModeChange } = useViewMode('card');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [currentPage, setCurrentPage] = useState(1);

  const [selectedWorkers, setSelectedWorkers] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<BulkAction | null>(null);
  const [deletingWorkerNames, setDeletingWorkerNames] = useState<Set<string>>(new Set());
  const [deleteError, setDeleteError] = useState<{ worker: string; message: string } | null>(null);

  const [newWorker, setNewWorker] = useState<CreateWorkerRequest>({ name: '', runtime: 'openclaw' });
  const [editForm, setEditForm] = useState<WorkerEditForm>({});
  const modelOptions = useMemo(
    () => buildModelSelectionOptions(aiRoutes ?? [], providers ?? []),
    [aiRoutes, providers],
  );

  const filtered = useMemo(() => filterWorkers(workers, searchQuery), [workers, searchQuery]);
  const sorted = useMemo(() => sortWorkers(filtered, sortKey), [filtered, sortKey]);
  const { totalPages, safePage, items: paginatedWorkers } = useMemo(
    () => paginateWorkers(sorted, currentPage, ITEMS_PER_PAGE),
    [sorted, currentPage]
  );
  const runtimeDist = useMemo(() => computeRuntimeDist(workers), [workers]);

  // Reset to first page when filters change (adjust state during render)
  const [prevFilters, setPrevFilters] = useState({ searchQuery, sortKey });
  if (prevFilters.searchQuery !== searchQuery || prevFilters.sortKey !== sortKey) {
    setPrevFilters({ searchQuery, sortKey });
    setCurrentPage(1);
  }

  const toggleSelect = useCallback((name: string) => {
    setSelectedWorkers((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    const availableNames = filtered
      .filter((worker) => !deletingWorkerNames.has(worker.name))
      .map((worker) => worker.name);
    setSelectedWorkers(new Set(availableNames));
  }, [filtered, deletingWorkerNames]);

  const deselectAll = useCallback(() => setSelectedWorkers(new Set()), []);

  const markWorkersDeleting = useCallback((names: string[]) => {
    setDeletingWorkerNames((previous) => new Set([...previous, ...names]));
    setSelectedWorkers((previous) => new Set([...previous].filter((name) => !names.includes(name))));
  }, []);

  const clearWorkerDeleting = useCallback((name: string) => {
    setDeletingWorkerNames((previous) => {
      if (!previous.has(name)) return previous;
      const next = new Set(previous);
      next.delete(name);
      return next;
    });
  }, []);

  const handleBulkAction = useCallback(() => {
    if (!bulkAction || selectedWorkers.size === 0) return;
    const names = Array.from(selectedWorkers).filter((name) => !deletingWorkerNames.has(name));
    if (names.length === 0) return;
    if (bulkAction === 'sleep') {
      names.forEach((name) => sleepWorker.mutate(name));
      toast.success(`已发送 ${names.length} 个休眠指令`);
    } else if (bulkAction === 'wake') {
      names.forEach((name) => wakeWorker.mutate(name));
      toast.success(`已发送 ${names.length} 个唤醒指令`);
    } else if (bulkAction === 'delete') {
      markWorkersDeleting(names);
      let settled = 0;
      let failed = 0;
      names.forEach((name) =>
        deleteWorker.mutate(name, {
          onError: (err) => {
            failed += 1;
            setDeleteError({ worker: name, message: describeWorkerDeleteError(err, name) });
          },
          onSettled: () => {
            settled += 1;
            clearWorkerDeleting(name);
            if (settled === names.length) {
              if (failed === 0) {
                toast.success(`已删除 ${names.length} 个 Worker`);
              } else {
                toast.error(`删除了 ${names.length - failed} 个，失败 ${failed} 个`);
              }
            }
          },
        }),
      );
    }
    setSelectedWorkers(new Set());
    setBulkAction(null);
  }, [
    bulkAction,
    selectedWorkers,
    deletingWorkerNames,
    sleepWorker,
    wakeWorker,
    deleteWorker,
    markWorkersDeleting,
    clearWorkerDeleting,
  ]);

  const handleExport = useCallback(() => {
    if (!workers) return;
    const data = JSON.stringify(workers, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agentteams-workers-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Workers 数据已导出');
  }, [workers]);

  // Soft model alias validation (embedded mode): warn but allow submit.
  // If the requested alias cannot be resolved through any configured AiRoute,
  // surface a toast.warning so the user knows the worker may fail to call LLMs,
  // but still let the mutation go through.
  const warnIfModelAliasUnbound = useCallback((model: string | undefined) => {
    if (!model || !aiRoutes || !providers) return;
    const bindings = buildModelBindings([model], aiRoutes, providers);
    if (hasUnavailableModelAliases([model], bindings)) {
      toast.warning(`请求模型别名 "${model}" 在当前 AI 路由中无可解析绑定，Worker 调用 LLM 可能失败。请在「AI 网关」中配置对应路由。`);
    }
  }, [aiRoutes, providers]);

  const syncWorkerSkills = useCallback(async (workerName: string, skillNames: string[]) => {
    if (!skillNames.length) return;
    setSyncingSkills({ workerName, skills: skillNames, done: [], failed: [] });
    for (const skillName of skillNames) {
      try {
        let file: File;
        try {
          file = await agentteamsApi.downloadSkill(skillName);
        } catch (downloadErr) {
          // Nacos skills return 403 from the generic download endpoint; fall back to Nacos-specific endpoint
          file = await agentteamsApi.downloadNacosSkill(skillName);
        }
        await agentteamsApi.uploadWorkerSkill(workerName, file);
        setSyncingSkills((prev) => prev && { ...prev, done: [...prev.done, skillName] });
      } catch {
        setSyncingSkills((prev) => prev && { ...prev, failed: [...prev.failed, skillName] });
        toast.warning(`技能 "${skillName}" 安装失败，已跳过`);
      }
    }
    setSyncingSkills(null);
  }, []);

  const handleCreate = useCallback(() => {
    warnIfModelAliasUnbound(newWorker.model);
    createWorker.mutate(newWorker, {
      onSuccess: (worker) => {
        setCreateOpen(false);
        setNewWorker({ name: '', runtime: 'openclaw' });
        const skills = newWorker.skills;
        if (skills?.length && worker) {
          void syncWorkerSkills(worker.name, skills);
        }
      },
    });
  }, [createWorker, newWorker, warnIfModelAliasUnbound, syncWorkerSkills]);

  const handleDelete = useCallback(() => {
    if (!deleteTarget) return;
    const workerName = deleteTarget;
    markWorkersDeleting([workerName]);
    setDeleteTarget(null);
    deleteWorker.mutate(workerName, {
      onSuccess: () => setDeleteError(null),
      onError: (err) => setDeleteError({ worker: workerName, message: describeWorkerDeleteError(err, workerName) }),
      onSettled: () => clearWorkerDeleting(workerName),
    });
  }, [deleteTarget, deleteWorker, markWorkersDeleting, clearWorkerDeleting]);

  const handleUpload = useCallback(
    async (file: File | null) => {
      if (!file) return;
      setUploadResult(null);
      setUploading(true);
      try {
        const result = await agentteamsApi.uploadPackage(file);
        setUploadResult({
          skillName: result.skillName,
          description: result.description,
          filesCount: result.filesCount,
          note: result.note,
        });
      } catch {
        // error is handled by the API layer
      } finally {
        setUploading(false);
      }
    },
    []
  );

  const openEdit = useCallback((worker: WorkerResponse) => {
    setEditWorker(worker);
    setEditForm({
      name: worker.name,
      model: worker.model || '',
      runtime: worker.runtime,
      image: worker.image || '',
      skills: worker.skills || [],
      agents: worker.agents,
      mcpServers: worker.mcpServers,
    });
  }, []);

  const closeEdit = useCallback(() => {
    setEditWorker(null);
    setEditForm({});
  }, []);

  const handleUpdate = useCallback(() => {
    if (!editWorker) return;
    const { name: _ignored, ...data } = editForm;
    void _ignored;
    warnIfModelAliasUnbound(editForm.model);
    updateWorker.mutate(
      { name: editWorker.name, data: data as UpdateWorkerRequest },
      {
        onSuccess: () => {
          closeEdit();
          if (editForm.model?.trim() && editForm.model !== editWorker.model) {
            toast.info(runtimeModelUpdateMessage(editForm.runtime ?? editWorker.runtime));
          }
          const skills = editForm.skills;
          if (skills?.length) {
            void syncWorkerSkills(editWorker.name, skills);
          }
        },
      }
    );
  }, [editForm, editWorker, updateWorker, closeEdit, warnIfModelAliasUnbound, syncWorkerSkills]);

  const handleConfigApply = useCallback(() => {
    setConfigError(null);
    try {
      const parsed = JSON.parse(configText);
      const createReq: CreateWorkerRequest = {
        name: parsed.name || '',
        runtime: parsed.runtime || 'openclaw',
        model: parsed.model || undefined,
        image: parsed.image || undefined,
        soul: parsed.soul || undefined,
        skills: parsed.skills || undefined,
      };
      createWorker.mutate(createReq, {
        onSuccess: () => {
          setConfigOpen(false);
          setConfigText('');
        },
      });
    } catch {
      setConfigError('JSON 格式无效，请检查输入');
    }
  }, [configText, createWorker]);

  if (isError && !isConnected) {
    return <ApiErrorState />;
  }

  return (
    <div className="space-y-6">
      {syncingSkills && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            <span>正在为 Worker <strong>{syncingSkills.workerName}</strong> 安装技能...</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {syncingSkills.skills.map((s) => {
              const done = syncingSkills.done.includes(s);
              const failed = syncingSkills.failed.includes(s);
              return (
                <span key={s} className={`flex items-center gap-1 px-2 py-0.5 rounded ${done ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : failed ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300'}`}>
                  {done ? <CheckCircle className="h-3 w-3" /> : failed ? <XCircle className="h-3 w-3" /> : <Loader2 className="h-3 w-3 animate-spin" />}
                  {s}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <SectionHeader
        title="Workers"
        description="管理和监控 AI Agent Workers"
        isLive={isConnected}
        onRefresh={() => refetch()}
        isRefreshing={isRefetching}
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={!workers || workers.length === 0}
            >
              <Download className="w-4 h-4 mr-1" aria-hidden="true" />
              导出 JSON
            </Button>
            <Button variant="outline" size="sm" onClick={() => setUploadOpen(true)}>
              <Upload className="w-4 h-4 mr-1" aria-hidden="true" />
              上传包
            </Button>
            <Button variant="outline" size="sm" onClick={() => setConfigOpen(true)}>
              <FileCode className="w-4 h-4 mr-1" aria-hidden="true" />
              JSON 应用
            </Button>
            <Button
              size="sm"
              className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:from-emerald-600 hover:to-teal-600"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="w-4 h-4 mr-1" aria-hidden="true" />
              创建 Worker
            </Button>
          </div>
        }
      />

      <RuntimeDistribution dist={runtimeDist} />

      <WorkerBulkBar
        count={selectedWorkers.size}
        onTrigger={setBulkAction}
        onClear={deselectAll}
      />
      <WorkerBulkConfirm
        action={bulkAction}
        count={selectedWorkers.size}
        onClose={() => setBulkAction(null)}
        onConfirm={handleBulkAction}
      />

      {filtered.length > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={selectAll}>
              <CheckSquare className="w-3 h-3 mr-1" aria-hidden="true" />
              全选
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={deselectAll}>
              <Square className="w-3 h-3 mr-1" aria-hidden="true" />
              取消全选
            </Button>
          </div>
          <div className="flex items-center gap-3">
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

      {deleteError && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <p className="leading-relaxed break-all">
            <span className="font-medium">Worker &quot;{deleteError.worker}&quot; 删除失败：</span>
            {deleteError.message}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 shrink-0 p-0"
            onClick={() => setDeleteError(null)}
            aria-label="关闭错误提示"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      )}

      {isLoading ? (
        <WorkersSkeleton viewMode={viewMode} />
      ) : filtered.length === 0 ? (
        <EmptyState hasQuery={!!searchQuery} onCreate={() => setCreateOpen(true)} />
      ) : (
        <>
          {viewMode === 'card' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {paginatedWorkers.map((worker, i) => (
                <WorkerCard
                  key={worker.name}
                  worker={worker}
                  index={i}
                  isSelected={selectedWorkers.has(worker.name)}
                  onToggleSelect={() => toggleSelect(worker.name)}
                  onView={() => setDetailWorker(worker)}
                  onEdit={() => openEdit(worker)}
                  onWake={() => wakeWorker.mutate(worker.name)}
                  onSleep={() => sleepWorker.mutate(worker.name)}
                  onEnsureReady={() => ensureReadyWorker.mutate(worker.name)}
                  onDelete={() => setDeleteTarget(worker.name)}
                  isActionPending={wakeWorker.isPending || sleepWorker.isPending || ensureReadyWorker.isPending}
                  isDeleting={deletingWorkerNames.has(worker.name)}
                />
              ))}
            </div>
          ) : (
            <WorkerTable
              workers={paginatedWorkers}
              selectedWorkers={selectedWorkers}
              onToggleSelect={toggleSelect}
              onView={setDetailWorker}
              onEdit={openEdit}
              onWake={(name) => wakeWorker.mutate(name)}
              onSleep={(name) => sleepWorker.mutate(name)}
              onEnsureReady={(name) => ensureReadyWorker.mutate(name)}
              onDelete={setDeleteTarget}
              isActionPending={
                wakeWorker.isPending || sleepWorker.isPending || ensureReadyWorker.isPending
              }
              deletingWorkerNames={deletingWorkerNames}
            />
          )}
          <WorkerPagination
            currentPage={safePage}
            totalPages={totalPages}
            totalItems={sorted.length}
            onChange={setCurrentPage}
          />
        </>
      )}

      <WorkerCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        value={newWorker}
        onChange={setNewWorker}
        isPending={createWorker.isPending}
        onSubmit={handleCreate}
        modelOptions={modelOptions}
      />

      <WorkerEditDialog
        open={!!editWorker}
        workerName={editWorker?.name ?? null}
        value={editForm}
        onChange={setEditForm}
        isPending={updateWorker.isPending}
        onOpenChange={(open) => !open && closeEdit()}
        onSubmit={handleUpdate}
        modelOptions={modelOptions}
      />

      <WorkerDetailDialog
        worker={detailWorker}
        onOpenChange={(open) => !open && setDetailWorker(null)}
      />

      <WorkerConfigDialog
        open={configOpen}
        value={configText}
        onChange={setConfigText}
        onOpenChange={(open) => {
          setConfigOpen(open);
          if (!open) setConfigError(null);
        }}
        onApply={handleConfigApply}
        isPending={createWorker.isPending}
        error={configError}
      />

      <WorkerUploadDialog
        open={uploadOpen}
        onOpenChange={(open) => { if (!open) setUploadResult(null); setUploadOpen(open); }}
        isUploading={uploading}
        onFileChange={handleUpload}
        result={uploadResult}
      />

      <ConfirmDeleteDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        resourceType="Worker"
        itemName={deleteTarget ?? ''}
        onConfirm={handleDelete}
        isLoading={deleteWorker.isPending}
      />
    </div>
  );
}

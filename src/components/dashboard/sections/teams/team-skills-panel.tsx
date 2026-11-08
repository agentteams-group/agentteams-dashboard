'use client';

// 团队技能分区（团队设置抽屉 B4）：目录搜索/上传/自定义/下载 + 成员分配
// 矩阵 + MCP 卡。全部复用 dashboard 既有资产（useSkills / SkillUploadDialog /
// SkillEditDialog / McpSelector / PUT /workers）：
//   · 分配矩阵 = worker × skill 勾选，保存写 PUT /workers {skills}（整字段
//     替换），按行独立提交；
//   · MCP 卡 = 成员行显示 mcpServers，编辑走统一 McpSelector，保存写
//     PUT /workers {mcpServers}；
//   · 两者都独立于抽屉「保存」按钮（与插件 CrdCfgModal 的团队技能节一致）。

import { useMemo, useState } from 'react';
import {
  Check,
  Download,
  Info,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Wifi,
  Wrench,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  McpSelector,
  type SelectedMcpServer,
} from '@/components/dashboard/sections/mcps/mcp-selector';
import { SkillEditDialog } from '@/components/dashboard/sections/skills/skill-edit-dialog';
import { SkillDetailDialog } from '@/components/dashboard/sections/skills/skill-detail-dialog';
import { SkillUploadDialog } from '@/components/dashboard/sections/skills/skill-upload-dialog';
import { useSkills } from '@/hooks/use-skill-center';
import { useUpdateWorker } from '@/hooks/use-agentteams-mutations';
import { agentteamsApi, type TeamResponse, type WorkerResponse } from '@/lib/agentteams-api';
import { formatErrorMessage } from '@/lib/api-error';
import type { SkillEntry } from '@/lib/skill-center-types';
import { toast } from 'sonner';
import {
  diffSkillAssignments,
  skillBaseline,
  skillColumns,
  skillValuesFor,
  type SkillMatrix,
} from './team-drawer-logic';

const PAGE_SIZE = 6;

function memberWorkers(team: TeamResponse, workers: WorkerResponse[]): WorkerResponse[] {
  const byName = new Map(workers.map((worker) => [worker.name, worker]));
  return (team.workerNames ?? [])
    .map((name) => byName.get(name))
    .filter((worker): worker is WorkerResponse => Boolean(worker));
}

export function TeamSkillsPanel({
  team,
  workers,
  onChanged,
}: {
  team: TeamResponse;
  workers: WorkerResponse[];
  onChanged?: () => void;
}) {
  const { data: catalog = { skills: [], total: 0 }, isFetching, refetch } = useSkills(
    undefined,
    null,
    1,
    10000,
  );
  const updateWorker = useUpdateWorker();

  const [search, setSearch] = useState('');
  const [source, setSource] = useState<'all' | 'custom' | 'nacos' | 'builtin'>('all');
  const [page, setPage] = useState(1);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editSkill, setEditSkill] = useState<SkillEntry | null>(null);
  const [detailSkill, setDetailSkill] = useState<SkillEntry | null>(null);
  const [matrix, setMatrix] = useState<SkillMatrix>({});
  const [savingSkills, setSavingSkills] = useState(false);
  const [skillError, setSkillError] = useState<string | null>(null);
  const [mcpTarget, setMcpTarget] = useState<WorkerResponse | null>(null);
  const [mcpDraft, setMcpDraft] = useState<SelectedMcpServer[]>([]);
  const [savingMcp, setSavingMcp] = useState(false);

  const members = useMemo(() => memberWorkers(team, workers), [team, workers]);
  const baseline = useMemo(() => skillBaseline(members), [members]);
  const columns = useMemo(
    () => skillColumns(catalog.skills.map((skill) => skill.name), matrix, baseline),
    [baseline, catalog.skills, matrix],
  );
  const changed = useMemo(() => diffSkillAssignments(baseline, matrix), [baseline, matrix]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalog.skills.filter((skill) => {
      if (source !== 'all' && skill.source !== source) return false;
      if (!q) return true;
      return (
        skill.name.toLowerCase().includes(q) ||
        (skill.description || '').toLowerCase().includes(q)
      );
    });
  }, [catalog.skills, search, source]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageSkills = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const toggleSkill = (workerName: string, skillName: string) => {
    setSkillError(null);
    setMatrix((previous) => {
      const current = skillValuesFor(previous, baseline, workerName);
      const next = current.includes(skillName)
        ? current.filter((name) => name !== skillName)
        : [...current, skillName];
      return { ...previous, [workerName]: next };
    });
  };

  const handleSaveSkills = async () => {
    if (changed.length === 0 || savingSkills) return;
    setSavingSkills(true);
    setSkillError(null);
    try {
      for (const change of changed) {
        await updateWorker.mutateAsync({ name: change.name, data: { skills: change.skills } });
      }
      setMatrix({});
      onChanged?.();
    } catch (err) {
      setSkillError(formatErrorMessage(err));
    } finally {
      setSavingSkills(false);
    }
  };

  const openMcp = (worker: WorkerResponse) => {
    setMcpTarget(worker);
    setMcpDraft([...(worker.mcpServers ?? [])]);
  };

  const handleSaveMcp = async () => {
    if (!mcpTarget || savingMcp) return;
    setSavingMcp(true);
    try {
      await updateWorker.mutateAsync({
        name: mcpTarget.name,
        data: { mcpServers: mcpDraft },
      });
      setMcpTarget(null);
      onChanged?.();
    } catch (err) {
      toast.error(formatErrorMessage(err));
    } finally {
      setSavingMcp(false);
    }
  };

  const handleDownload = async (skill: SkillEntry) => {
    try {
      const file =
        skill.source === 'nacos'
          ? await agentteamsApi.downloadNacosSkill(skill.name)
          : await agentteamsApi.downloadSkill(skill.name);
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(formatErrorMessage(err));
    }
  };

  return (
    <div className="space-y-4">
      {/* 技能目录：搜索 / 来源过滤 / 上传 / 下载 / 自定义编辑 */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="min-h-11 pl-8 text-xs sm:min-h-9"
              placeholder="搜索技能…"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <Select
            value={source}
            onValueChange={(value) => {
              setSource(value as typeof source);
              setPage(1);
            }}
          >
            <SelectTrigger className="min-h-11 w-28 text-xs sm:min-h-9" aria-label="技能来源">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              <SelectItem value="custom">自定义</SelectItem>
              <SelectItem value="nacos">Nacos</SelectItem>
              <SelectItem value="builtin">内置</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 text-xs sm:min-h-9"
            onClick={() => void refetch()}
            disabled={isFetching}
            aria-label="刷新技能目录"
          >
            <RefreshCw className={`size-3.5 ${isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
          </Button>
          <Button
            size="sm"
            className="min-h-11 text-xs sm:min-h-9"
            onClick={() => setUploadOpen(true)}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            上传技能
          </Button>
        </div>

        <div className="divide-y rounded-md border">
          {pageSkills.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">
              {catalog.skills.length === 0 ? '技能目录为空——可上传技能包。' : '没有匹配的技能。'}
            </p>
          ) : (
            pageSkills.map((skill) => (
              <div key={skill.name} className="flex min-w-0 items-center gap-2 p-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs" title={skill.name}>
                  {skill.name}
                </span>
                <Badge variant="secondary" className="shrink-0 text-xs">
                  {skill.source === 'custom' ? '自定义' : skill.source === 'nacos' ? 'Nacos' : '内置'}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 shrink-0 sm:size-9"
                  aria-label={`下载 ${skill.name}`}
                  onClick={() => void handleDownload(skill)}
                >
                  <Download className="size-3.5" aria-hidden="true" />
                </Button>
                {skill.source === 'custom' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11 shrink-0 sm:size-9"
                    aria-label={`编辑 ${skill.name}`}
                    onClick={() => setEditSkill(skill)}
                  >
                    <Pencil className="size-3.5" aria-hidden="true" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 shrink-0 sm:size-9"
                  aria-label={`查看 ${skill.name}`}
                  onClick={() => setDetailSkill(skill)}
                >
                  <Info className="size-3.5" aria-hidden="true" />
                </Button>
              </div>
            ))
          )}
        </div>
        {filtered.length > PAGE_SIZE && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              共 {filtered.length} 条，第 {safePage}/{totalPages} 页
            </span>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 text-xs sm:min-h-9"
                disabled={safePage <= 1}
                onClick={() => setPage(safePage - 1)}
              >
                上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 text-xs sm:min-h-9"
                disabled={safePage >= totalPages}
                onClick={() => setPage(safePage + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 分配矩阵 */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground">
          成员分配矩阵（勾选 = 分配给该成员；保存独立于团队保存）
        </p>
        {members.length === 0 ? (
          <p className="text-xs text-muted-foreground">团队暂无可用成员。</p>
        ) : columns.length === 0 ? (
          <p className="text-xs text-muted-foreground">技能目录为空，先上传技能。</p>
        ) : (
          <div className="min-w-0 overflow-hidden rounded-md border" data-testid="skill-matrix">
            <div className="max-h-64 overflow-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="sticky left-0 z-10 bg-muted/50 p-2 text-left font-medium">成员</th>
                    {columns.map((skill) => (
                      <th key={skill} className="p-2 text-center font-medium" title={skill}>
                        <span className="block max-w-[72px] truncate font-mono">{skill}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {members.map((worker) => (
                    <tr key={worker.name} className="border-t">
                      <td className="sticky left-0 z-10 max-w-[96px] truncate bg-background p-2 font-mono">
                        {worker.name}
                      </td>
                      {columns.map((skill) => (
                        <td key={skill} className="p-0 text-center">
                          <label className="flex size-11 items-center justify-center">
                            <input
                              type="checkbox"
                              className="accent-primary size-4"
                              aria-label={`${worker.name} ${skill}`}
                              checked={skillValuesFor(matrix, baseline, worker.name).includes(skill)}
                              onChange={() => toggleSkill(worker.name, skill)}
                            />
                          </label>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {skillError && (
          <p role="alert" className="text-xs text-destructive">
            {skillError}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="min-h-11 sm:min-h-9"
            data-testid="skills-save"
            disabled={changed.length === 0 || savingSkills}
            onClick={() => void handleSaveSkills()}
          >
            {savingSkills ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="size-3.5" aria-hidden="true" />
            )}
            保存分配
          </Button>
          <span className="text-xs text-muted-foreground">
            {changed.length > 0 ? `${changed.length} 个成员待保存` : '保存 = 按勾选全集覆盖 spec.skills'}
          </span>
        </div>
      </div>

      {/* MCP 卡 */}
      <div className="space-y-2">
        <p className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
          <Wrench className="size-3.5" aria-hidden="true" />
          成员 MCP（保存独立于团队保存）
        </p>
        <div className="space-y-1.5">
          {members.map((worker) => (
            <div
              key={worker.name}
              className="flex min-w-0 flex-wrap items-center gap-1.5 rounded-lg border p-2"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{worker.name}</span>
              {(worker.mcpServers ?? []).length === 0 ? (
                <span className="text-xs text-muted-foreground">未分配 MCP</span>
              ) : (
                (worker.mcpServers ?? []).map((server) => (
                  <Badge key={server.name} variant="secondary" className="shrink-0 gap-1 text-xs">
                    <Wifi className="size-3" aria-hidden="true" />
                    {server.name}
                  </Badge>
                ))
              )}
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 shrink-0 text-xs sm:min-h-9"
                aria-label={`编辑 ${worker.name} MCP`}
                onClick={() => openMcp(worker)}
              >
                编辑 MCP
              </Button>
            </div>
          ))}
        </div>
      </div>

      <SkillUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} onSuccess={() => {
        setUploadOpen(false);
        void refetch();
      }} />
      <SkillEditDialog
        key={editSkill?.name ?? 'none'}
        skill={editSkill}
        open={!!editSkill}
        onOpenChange={(open) => !open && setEditSkill(null)}
        onSuccess={() => {
          setEditSkill(null);
          void refetch();
        }}
      />
      <SkillDetailDialog
        skill={detailSkill}
        open={!!detailSkill}
        onOpenChange={(open) => !open && setDetailSkill(null)}
      />

      <Dialog open={!!mcpTarget} onOpenChange={(open) => !open && setMcpTarget(null)}>
        <DialogContent className="max-w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>编辑 MCP - {mcpTarget?.name}</DialogTitle>
            <DialogDescription>
              仅分配已登记的 MCP 地址；保存写 Worker 的 spec.mcpServers（全量替换）。
            </DialogDescription>
          </DialogHeader>
          <McpSelector value={mcpDraft} onChange={setMcpDraft} />
          <DialogFooter>
            <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setMcpTarget(null)}>
              取消
            </Button>
            <Button
              className="min-h-11 sm:min-h-9"
              data-testid="mcp-save"
              disabled={savingMcp}
              onClick={() => void handleSaveMcp()}
            >
              {savingMcp ? '保存中…' : '保存 MCP'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

'use client';

// 知识库 v3（9/17 装验定案「照插件做」三件：3D / 预览与图谱分离 /
// 团队聚合图谱 + v4 2D 簇块布局——workbench 插件 KnowledgeBase.tsx 同款结构）。
//   · 数据面（v2 不变）：/api/agentteams/workers/[name]/workspace-files/{tree|file-metadata|file-content}
//     后端=Controller Docker 代理 tarball 只读（route.ts 内注释）——
//     404=真实故障（容器/工作区缺失），直接显示服务端错误。
//   · 布局（插件同构）：左=KB 文件树（四分类）；右=**图谱卡常驻** +
//     **预览卡独立下置**——点节点/文件只更新预览卡，图谱永不消失
//     （修「点开预览再点回退退到空白」：单格视图互斥 → 双视图并存）。
//   · 图谱：2D 簇块布局（v4）+ 3D 双引擎（3D=knowledge-graph3d.tsx 插件
//     Graph3D 移植，3d-force-graph+three；**默认 3D**、偏好持久化；引擎经
//     next/dynamic ssr:false 按需分包——主 bundle 零 three 字节，切 3D 才拉
//     chunk；WebGL 不可用/初始化失败→降级提示 + 一键回 2D，图谱不炸 tab）。
//   · 团队聚合图谱（插件 fetchKbGraphMerged 的客户端等价物——dashboard
//     无插件同款服务端合并端点，改客户端按团队拉各 Worker md 合并建图）：
//     节点按 Worker 着色（AGENT_PALETTE 插件同值）、id=`worker::path`、
//     边保留各 Worker 内部；点聚合节点开**目标 Worker** 文件，不切换
//     当前 Worker（插件 agentOverride 同语义）。
//   · 选择记忆（插件 kbState 同款）：worker / graphMode / team / 3D-2D
//     localStorage 持久化，失效值回退默认。
//   · 预览：file-content 分块读（offset/eof 循环；v2 后端单块 ≤1MB 即 eof）
//
// A5 拆分（2026-09-28，纯重构）：本文件保留主 section 组件与模块入口；
// 实现按职责拆到 ./knowledge/ 子目录——types（类型）、shared（常量与
// 小工具）、api（数据面抓取）、graph（assembleGraph 纯函数）、view2d
// （2D 簇块布局纯函数族）、graph-2d（2D 图谱组件）、tree-rows（文件树行）。

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CircleAlert,
  Download,
  FileText,
  FolderOpen,
  Folder,
  Loader2,
  Network,
  RefreshCw,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SectionHeader } from '@/components/dashboard/section-header';
import { MarkdownMessage } from '@/components/dashboard/sections/chat/markdown-message';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import type { WorkerResponse } from '@/lib/agentteams-api';
import type { G3DNodeInput } from '@/components/dashboard/knowledge-graph3d';
import {
  AGENT_PALETTE,
  base,
  basename,
  CHUNK,
  MAX_CHUNKS,
  MAX_GRAPH_FILES,
  MAX_MERGED_FILES,
  readMem,
  writeMem,
} from './knowledge/shared';
import { buildAgentGraph, fetchFullContent, fetchTree } from './knowledge/api';
import { KnowledgeGraph } from './knowledge/graph-2d';
import { clusterGridLayout } from './knowledge/view2d';
import { DirRowReadOnly, FileRow, GroupLabel, TreeRow } from './knowledge/tree-rows';
import type { GEdge, GNode, GraphData, TreeEntry } from './knowledge/types';

// 拆分后公开面保持不变（测试与外部消费者兼容）。
export { KnowledgeGraph } from './knowledge/graph-2d';
export { assembleGraph } from './knowledge/graph';
export { chipWidth, clampZoomView, clusterGridLayout, focusView, KB2D } from './knowledge/view2d';
export type { GNode } from './knowledge/types';

// 3D 引擎按需分包（评审体积顾虑的解法）：type-only import 编译期擦除零运行时；
// ssr:false 保证 three 只在客户端 chunk 里，主 bundle 体积不变。
const KnowledgeGraph3D = dynamic(
  () => import('@/components/dashboard/knowledge-graph3d'),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[480px] items-center justify-center text-xs text-muted-foreground">
        3D 图谱引擎加载中…
      </div>
    ),
  },
);

// ── 主 section ─────────────────────────────────────────────────────────────
export function KnowledgeSection() {
  const { data: workers } = useWorkers();
  const [worker, setWorker] = useState('');
  // KB 数据面（workspace-files/{tree,file-metadata,file-content}）是
  // QwenPaw 专属能力（端点布局按 QwenPaw workspace_files.py 实锤形状定案，
  // 其他 runtime 404 或非约定形状 → 降级横幅/空树）。下拉只列 qwenpaw
  // Worker，聚合图谱同源收窄（FUNC-10，2026-09-20 用户确认口径）。
  const kbWorkers = useMemo(
    () => (workers ?? []).filter((wd) => wd.runtime === 'qwenpaw'),
    [workers],
  );
  // 默认 worker 漂移修复（9/16 真机 E2E 实锤）：Controller /api/v1/workers
  // 列表顺序不稳定（k8s list 序），未手动选择时每轮轮询跟 workers[0] 走会
  // 让整个视图静默重置换人（已展开的目录被清掉）。按任务看板同款「推导
  // 选中、不同步状态」惯例（tasks-section effectiveProjectId）：对列表做
  // 确定序（按名）推导默认，跨轮询稳定；用户手动选择后以选择为准。
  const sortedWorkers = useMemo(
    () =>
      [...kbWorkers].sort((a, b) =>
        a.name.localeCompare(b.name, 'en'),
      ),
    [kbWorkers],
  );
  const effectiveWorker = worker || sortedWorkers[0]?.name || '';

  // 选择记忆（插件 kbState 同款）：worker 列表落地后校验有效性再恢复
  // （失效值回退默认推导，不闪错人）。
  useEffect(() => {
    if (worker || sortedWorkers.length === 0) return;
    const saved = readMem('worker');
    if (saved && sortedWorkers.some((w) => w.name === saved)) {
      const t = setTimeout(() => setWorker(saved), 0);
      return () => clearTimeout(t);
    }
  }, [worker, sortedWorkers]);
  useEffect(() => { writeMem('worker', worker); }, [worker]);

  // 图谱模式 / 聚合团队 / 3D-2D 偏好（持久化）
  const [graphMode, setGraphMode] = useState<'worker' | 'merged'>(
    () => (readMem('graph-mode') === 'merged' ? 'merged' : 'worker'),
  );
  const [kbTeam, setKbTeam] = useState(() => readMem('team')); // ''=全部团队（记忆恢复：团队选择也持久化）
  const [viewMode, setViewMode] = useState<'3d' | '2d'>(
    () => (readMem('view-mode') === '2d' ? '2d' : '3d'),
  );
  const [graphVisible, setGraphVisible] = useState(true);
  const [selectedId3d, setSelectedId3d] = useState('');
  useEffect(() => { writeMem('graph-mode', graphMode === 'worker' ? '' : 'merged'); }, [graphMode]);
  useEffect(() => { writeMem('view-mode', viewMode === '3d' ? '' : '2d'); }, [viewMode]);

  const [topEntries, setTopEntries] = useState<TreeEntry[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(false);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [mergedGraph, setMergedGraph] = useState<GraphData | null>(null);
  const [mergedLoading, setMergedLoading] = useState(false);
  // 预览（v3：独立卡状态——{path, worker}，worker 可≠当前 Worker=聚合跨 Worker 打开）
  const [preview, setPreview] = useState<{ path: string; worker: string } | null>(null);
  const [previewText, setPreviewText] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [expanded, setExpanded] = useState<Record<string, TreeEntry[]>>({});
  const [treeDirsLoading, setTreeDirsLoading] = useState<Record<string, boolean>>({});
  const genRef = useRef(0);
  const mergedGenRef = useRef(0);

  // 团队透传：worker 选择器按 team 分组（optgroup），负责人标记
  // （loadMerged 聚合范围依赖此表，须先定义）。源=kbWorkers（qwenpaw 过滤，
  // 见上），聚合图谱的范围随之收窄。
  const teamGroups = useMemo(() => {
    const list: WorkerResponse[] = kbWorkers;
    const map = new Map<string, WorkerResponse[]>();
    for (const wd of list) {
      const team = wd.team || '';
      if (!map.has(team)) map.set(team, []);
      map.get(team)!.push(wd);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => (a === b ? 0 : a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
      .map(([team, list]) => ({
        team,
        workers: [...list].sort((x, y) => x.name.localeCompare(y.name)),
      }));
  }, [kbWorkers]);

  // 聚合团队有效值（派生——团队消失时回退全部团队，不同步 setState）。
  // 必须先于 loadMerged 定义（其 useCallback 依赖数组在渲染期求值，
  // const 后置声明会触发 TDZ ReferenceError）。
  const effectiveKbTeam = kbTeam && teamGroups.some((g) => g.team === kbTeam) ? kbTeam : '';
  // workers 列表落地前不写——首帧 teamGroups 为空，派生值必为 ''，
  // 若此时写会覆盖掉刚恢复的合法记忆值（G5 记忆竞态）。
  useEffect(() => {
    if (workers == null) return;
    writeMem('team', effectiveKbTeam);
  }, [workers, effectiveKbTeam]);

  const loadGraph = useCallback(async (w: string) => {
    const gen = ++genRef.current;
    setGraphLoading(true);
    setGraph(null);
    try {
      const ag = await buildAgentGraph(w, MAX_GRAPH_FILES);
      if (gen !== genRef.current) return;
      const pairs = ag.edges.map(
        (e) => [ag.nodes[e.s].id, ag.nodes[e.t].id] as [string, string],
      );
      const { pos, size, blocks, view, sectorOf, hubs } = clusterGridLayout(ag.nodes as GNode[], pairs);
      setGraph({ nodes: ag.nodes as GNode[], edges: ag.edges, pos, size, blocks, view, sectorOf, hubs });
    } catch (err) {
      if (gen === genRef.current) setLoadError(err instanceof Error ? err.message : '加载失败');
    } finally {
      if (gen === genRef.current) setGraphLoading(false);
    }
  }, []);

  // 团队聚合建图（客户端合并——插件 fetchKbGraphMerged 的等价物）：
  // 范围=effectiveKbTeam 团队成员（''=全部 Worker）；总预算 240 文件、单 Worker 60；
  // 节点 id 前缀 `worker::`，边保留各 Worker 内部（跨 Worker 无边=插件同款）。
  const loadMerged = useCallback(async () => {
    const gen = ++mergedGenRef.current;
    setMergedLoading(true);
    setMergedGraph(null);
    try {
      const scope = effectiveKbTeam
        ? teamGroups.find((g) => g.team === effectiveKbTeam)?.workers.map((wd) => wd.name) ?? []
        : sortedWorkers.map((wd) => wd.name);
      // 单 Worker 份额=总预算均分（封顶 150、保底 30）——首 Worker 大 KB 不再
      // 吃掉全员份额（旧版顺序扣减 60/Worker 的升级：4 Worker 仍各 60，
      // 2 Worker 各 120，1 Worker 150）。
      const perWorker = Math.min(
        MAX_GRAPH_FILES,
        Math.max(30, Math.floor(MAX_MERGED_FILES / Math.max(1, scope.length))),
      );
      const nodes: GNode[] = [];
      const edges: GEdge[] = [];
      let budget = MAX_MERGED_FILES;
      for (const w of scope) {
        if (budget <= 0) break;
        const ag = await buildAgentGraph(w, Math.min(perWorker, budget));
        budget -= ag.nodes.length;
        const offset = nodes.length;
        for (const n of ag.nodes) nodes.push({ ...n, id: `${w}::${n.id}`, agent: w });
        for (const e of ag.edges) edges.push({ s: e.s + offset, t: e.t + offset });
      }
      if (gen !== mergedGenRef.current) return;
      const pairs = edges.map(
        (e) => [nodes[e.s].id, nodes[e.t].id] as [string, string],
      );
      const { pos, size, blocks, view, sectorOf, hubs } = clusterGridLayout(nodes, pairs, scope);
      setMergedGraph({ nodes, edges, pos, size, blocks, view, sectorOf, hubs });
    } catch {
      if (gen === mergedGenRef.current) setMergedGraph(null);
    } finally {
      if (gen === mergedGenRef.current) setMergedLoading(false);
    }
  }, [effectiveKbTeam, teamGroups, sortedWorkers]);

  // 聚合范围签名（团队+成员名单）：真正变化才重拉。
  // workers 每 ~15s 轮询换新数组（teamGroups/sortedWorkers 身份随之变），
  // 旧版 effect 依赖身份 → 图谱周期自拉+重排（9/17 装验 G1「过一段时间
  // 就重新加载」根因）。签名不变=跳过；手动「刷新」按钮直调 loadMerged
  // 不经此门，不受影响。
  const mergedScopeKey = useMemo(() => {
    const scope = effectiveKbTeam
      ? teamGroups.find((g) => g.team === effectiveKbTeam)?.workers.map((wd) => wd.name) ?? []
      : sortedWorkers.map((wd) => wd.name);
    return `${effectiveKbTeam || '*'}::${scope.join(',')}`;
  }, [effectiveKbTeam, teamGroups, sortedWorkers]);
  const lastMergedKeyRef = useRef('');
  // 聚合模式：切模式/切团队/范围真变 → 重拉（loadMerged 入口自带清旧图）
  useEffect(() => {
    if (graphMode !== 'merged') return;
    if (mergedScopeKey === lastMergedKeyRef.current) return;
    lastMergedKeyRef.current = mergedScopeKey;
    // 宏任务触发（同 reload effect 模式：effect 内不同步 setState 链）
    const t = setTimeout(() => { void loadMerged(); }, 0);
    return () => clearTimeout(t);
  }, [graphMode, mergedScopeKey, loadMerged]);

  // 顶层文件树（四分类分组来源）+ 图谱，随 Worker 切换/刷新重载
  const reload = useCallback(async (w: string) => {
    setLoadError('');
    setTopEntries(null);
    setLoading(true);
    try {
      setTopEntries(await fetchTree(w, ''));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '文件树加载失败');
    } finally {
      setLoading(false);
    }
    void loadGraph(w);
  }, [loadGraph]);

  // 延迟一个宏任务（同 B5：避免 effect 同步阶段 setState 链）
  useEffect(() => {
    if (!effectiveWorker) return;
    const t = setTimeout(() => {
      setGraph(null);
      setExpanded({});
      setPreview(null);
      void reload(effectiveWorker);
    }, 0);
    return () => clearTimeout(t);
  }, [effectiveWorker, reload]);

  const loadDir = useCallback(async (dir: string) => {
    setTreeDirsLoading((m) => ({ ...m, [dir]: true }));
    try {
      const entries = await fetchTree(effectiveWorker, dir);
      setExpanded((m) => ({ ...m, [dir]: entries }));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '目录加载失败');
    } finally {
      setTreeDirsLoading((m) => ({ ...m, [dir]: false }));
    }
  }, [effectiveWorker]);

  // 下载（对齐插件 KB 文件下载）：file-content?raw=1 原始字节 → blob → a[download]
  const downloadFile = useCallback(async (worker: string, path: string) => {
    try {
      const qs = new URLSearchParams({ path, raw: '1' });
      const res = await fetch(`${base(worker)}/file-content?${qs.toString()}`, { cache: 'no-store' });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error || `下载失败（${res.status}）`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = basename(path);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : '下载失败');
    }
  }, []);

  // 打开预览（v3：agentOverride=聚合模式跨 Worker 打开目标文件，
  // **不切换当前 Worker**——插件 openFile(agentOverride) 同语义；
  // 图谱卡保持不动，只更新预览卡）。
  const openPreview = useCallback(async (path: string, agentOverride?: string) => {
    const w = agentOverride || effectiveWorker;
    setPreview({ path, worker: w });
    setPreviewText('');
    setPreviewError('');
    setPreviewLoading(true);
    try {
      setPreviewText(await fetchFullContent(w, path));
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : '读取失败');
    } finally {
      setPreviewLoading(false);
    }
  }, [effectiveWorker]);

  // 四分类分组（插件同款）：档案=顶层 md / 文件=其余顶层（只列不展开）/ 日记 memory / 知识库 digest
  const groups = useMemo(() => {
    if (topEntries === null) return null;
    const isMd = (e: TreeEntry) => e.kind === 'file' && e.name.toLowerCase().endsWith('.md');
    return {
      archive: topEntries.filter(isMd),
      files: topEntries.filter((e) => e.kind === 'file' && !isMd(e)),
      topDirs: topEntries.filter((e) => e.kind === 'directory' && e.path !== 'memory' && e.path !== 'digest'),
      memory: topEntries.find((e) => e.kind === 'directory' && e.path === 'memory') ?? null,
      digest: topEntries.find((e) => e.kind === 'directory' && e.path === 'digest') ?? null,
    };
  }, [topEntries]);

  // 当前生效图（单 Agent / 聚合）
  const currentGraph = graphMode === 'merged' ? mergedGraph : graph;
  const currentLoading = graphMode === 'merged' ? mergedLoading : graphLoading;
  const mergedScopeCount = graphMode === 'merged'
    ? (effectiveKbTeam
        ? teamGroups.find((g) => g.team === effectiveKbTeam)?.workers.length ?? 0
        : sortedWorkers.length)
    : 0;

  // 聚合图例（节点按 Worker 着色，插件 AGENT_PALETTE 顺序=首次出现序）
  const agentLegend = useMemo(() => {
    if (graphMode !== 'merged' || !currentGraph) return null;
    const order: string[] = [];
    for (const n of currentGraph.nodes) {
      if (n.agent && !order.includes(n.agent)) order.push(n.agent);
    }
    if (order.length === 0) return null;
    return order.map((name, i) => ({ name, color: AGENT_PALETTE[i % AGENT_PALETTE.length] }));
  }, [graphMode, currentGraph]);

  // 3D 输入（插件 G3DNodeInput 同构：id/name/path/agent）
  const g3dNodes = useMemo<G3DNodeInput[]>(() => {
    if (!currentGraph) return [];
    return currentGraph.nodes.map((n) => ({
      id: n.id,
      name: n.label,
      path: n.path,
      agent: n.agent,
      virtual: n.virtual,
      resolved: n.resolved,
    }));
  }, [currentGraph]);
  const g3dLinks = useMemo(() => {
    if (!currentGraph) return [];
    return currentGraph.edges.map((e) => ({
      source: currentGraph.nodes[e.s].id,
      target: currentGraph.nodes[e.t].id,
    }));
  }, [currentGraph]);
  const colorFor3d = useCallback(
    (n: G3DNodeInput): string => {
      // 插件 nodeColor 同序：聚合 Worker 色优先 → 分类根 → 未解析灰点
      // → MEMORY.md 琥珀 → 普通文件靛蓝。
      if (agentLegend && n.agent) {
        return agentLegend.find((l) => l.name === n.agent)?.color ?? '#8c8c8c';
      }
      if (n.virtual) return '#ff7f16'; // 分类根（QwenPaw --graph-3d-root 同值）
      if (n.resolved === false) return '#9ca3af'; // 未解析引用灰点（不可点开）
      return n.path === 'MEMORY.md' ? '#f59e0b' : '#6366f1';
    },
    [agentLegend],
  );

  // 3D 选中条（节点名 + 出/入链计数——插件 {panel} 的轻量版）
  const sel3d = useMemo(() => {
    if (!selectedId3d || !currentGraph) return null;
    const i = currentGraph.nodes.findIndex((n) => n.id === selectedId3d);
    if (i < 0) return null;
    let out = 0;
    let inn = 0;
    for (const e of currentGraph.edges) {
      if (e.s === i) out += 1;
      if (e.t === i) inn += 1;
    }
    return { node: currentGraph.nodes[i], out, inn };
  }, [selectedId3d, currentGraph]);

  // 3D 节点点击 → 开预览（聚合：`worker::path` 解析；单 Agent：path）
  const onOpenNode3d = useCallback(
    (n: G3DNodeInput) => {
      if (n.resolved === false) return; // 未解析灰点不可点开（插件同款）
      const sep = n.id.indexOf('::');
      if (graphMode === 'merged' && sep > 0) {
        void openPreview(n.id.slice(sep + 2), n.id.slice(0, sep));
        return;
      }
      if (n.path) void openPreview(n.path);
    },
    [graphMode, openPreview],
  );

  return (
    <div className="space-y-4 p-4">
      <SectionHeader
        title="知识库"
        description="集群 Worker 记忆只读视图（workbench 插件同款数据面：Controller Docker 代理）：档案 / 文件 / 日记 memory/** / 知识库 digest/** + wikilink 图谱（2D/3D · 团队聚合）"
        actions={
          <div className="flex items-center gap-2">
            <select
              className="h-8 max-w-[220px] rounded-md border bg-transparent px-2 text-xs"
              value={effectiveWorker}
              onChange={(e) => setWorker(e.target.value)}
              aria-label="选择 Worker（按团队分组）"
            >
              {teamGroups.length === 0 && <option value="">（无 QwenPaw Worker）</option>}
              {teamGroups.map((g) => (
                <optgroup key={g.team || 'ungrouped'} label={g.team || '未分组'}>
                  {g.workers.map((wd) => (
                    <option key={wd.name} value={wd.name}>
                      {wd.name}{/leader/i.test(wd.role || '') ? ' · 负责人' : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              disabled={loading || graphLoading || mergedLoading}
              onClick={() => {
                if (!effectiveWorker) return;
                void reload(effectiveWorker);
                if (graphMode === 'merged') void loadMerged();
              }}
            >
              <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading || graphLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
              刷新
            </Button>
          </div>
        }
        isRefreshing={loading || graphLoading}
      />

      {workers && workers.length > 0 && kbWorkers.length === 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400 flex items-start gap-2">
          <CircleAlert className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">知识库当前仅支持 QwenPaw 运行时的 Worker</p>
            <p className="text-xs opacity-80 mt-0.5">
              数据面（workspace-files）按 QwenPaw 工作区布局实现；检测到 {workers.length} 个其他运行时 Worker（openclaw / hermes / copaw / openhuman / deepseek-harness）不在列表中。
            </p>
          </div>
        </div>
      )}

      {loadError ? (
        <div className="flex items-center gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {loadError}
        </div>
      ) : (
        <>
          {/* 图谱模式行（插件同款：当前 Agent 图谱 | 团队聚合图谱 + 聚合团队选择） */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-0.5 rounded-md border border-border/60 bg-transparent p-0.5">
              <Button
                variant={graphMode === 'worker' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => { setSelectedId3d(''); setGraphMode('worker'); }}
              >
                当前 Worker 图谱
              </Button>
              <Button
                variant={graphMode === 'merged' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => { setSelectedId3d(''); setGraphMode('merged'); }}
              >
                <Users className="mr-1 h-3 w-3" aria-hidden="true" />
                团队聚合图谱
              </Button>
            </div>
            {graphMode === 'merged' && teamGroups.length > 0 && (
              <select
                className="h-8 rounded-md border bg-transparent px-2 text-xs"
                value={effectiveKbTeam}
                onChange={(e) => setKbTeam(e.target.value)}
                aria-label="聚合团队"
              >
                <option value="">全部团队（{sortedWorkers.length} Workers）</option>
                {teamGroups.map((g) => (
                  <option key={g.team} value={g.team}>
                    {g.team}（{g.workers.length}）
                  </option>
                ))}
              </select>
            )}
            <span className="ml-auto text-[10px] text-muted-foreground">
              {graphMode === 'merged'
                ? `聚合 ${mergedScopeCount} 个 Worker`
                : effectiveWorker || '—'}
            </span>
          </div>

          <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
            {/* 左：KB 文件树（四分类，常驻——图谱不再占用此格） */}
            <div className="rounded-md border border-border/60 p-2">
              <div className="mb-2 flex items-center gap-2">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                <span className="text-xs font-medium">知识文件</span>
                <span className="ml-auto truncate text-[10px] text-muted-foreground">{effectiveWorker || '—'}</span>
              </div>
              <div className="space-y-0.5">
                {groups === null ? (
                  <div className="flex items-center gap-2 px-1.5 py-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                    加载文件树…
                  </div>
                ) : (
                  <>
                    <GroupLabel text="档案" />
                    {groups.archive.map((e) => (
                      <FileRow key={e.path} entry={e} onFile={(p) => void openPreview(p)} />
                    ))}
                    {groups.archive.length === 0 && (
                      <p className="px-4 py-0.5 text-[10px] text-muted-foreground/70">（无顶层 md）</p>
                    )}
                    <GroupLabel text="文件" />
                    {groups.files.map((e) => (
                      <FileRow key={e.path} entry={e} onFile={(p) => void openPreview(p)} />
                    ))}
                    {groups.topDirs.map((e) => (
                      <DirRowReadOnly key={e.path} entry={e} />
                    ))}
                    {groups.files.length === 0 && groups.topDirs.length === 0 && (
                      <p className="px-4 py-0.5 text-[10px] text-muted-foreground/70">（无）</p>
                    )}
                    {(['memory', 'digest'] as const).map((d) => {
                      const root = d === 'memory' ? groups.memory : groups.digest;
                      if (!root) return null;
                      const entries = expanded[root.path];
                      const open = !!entries;
                      return (
                        <div key={root.path}>
                          <GroupLabel text={d === 'memory' ? '日记 memory' : '知识库 digest'} />
                          <button
                            type="button"
                            className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-xs hover:bg-accent"
                            onClick={() => {
                              if (!open) void loadDir(root.path);
                              else setExpanded((m) => ({ ...m, [root.path]: [] }));
                            }}
                          >
                            {open
                              ? <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                              : <Folder className="h-3.5 w-3.5" aria-hidden="true" />}
                            <span className="truncate font-medium">{root.name}/</span>
                            {treeDirsLoading[root.path] && (
                              <Loader2 className="ml-auto h-3 w-3 animate-spin" aria-hidden="true" />
                            )}
                          </button>
                          {open && (entries ?? []).map((e) => (
                            <TreeRow key={e.path} entry={e} depth={1} onFile={(p) => void openPreview(p)} onDir={(dir) => void loadDir(dir)} loading={treeDirsLoading} expandedMap={expanded} setExpanded={setExpanded} />
                          ))}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </div>

            {/* 右：图谱卡（常驻）+ 预览卡（独立下置） */}
            <div className="min-w-0 space-y-4">
              {/* 图谱卡 */}
              <div className="rounded-md border border-border/60">
                <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
                  <Network className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  <span className="text-xs font-medium">知识图谱（wikilink 引用网络）</span>
                  {currentGraph && (
                    <span className="text-[10px] text-muted-foreground">
                      {currentGraph.nodes.length} 节点 · {currentGraph.edges.length} 边
                    </span>
                  )}
                  {agentLegend ? (
                    <span className="flex items-center gap-2">
                      {agentLegend.map((l) => (
                        <span key={l.name} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                          <span className="inline-block h-2 w-2 rounded-full" style={{ background: l.color }} />
                          {l.name}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">→ 引用方向</span>
                  )}
                  <div className="ml-auto flex items-center gap-1">
                    <div className="flex gap-0.5 rounded-md border border-border/60 p-0.5">
                      <Button
                        variant={viewMode === '3d' ? 'secondary' : 'ghost'}
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => setViewMode('3d')}
                      >
                        3D
                      </Button>
                      <Button
                        variant={viewMode === '2d' ? 'secondary' : 'ghost'}
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => setViewMode('2d')}
                      >
                        2D
                      </Button>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => setGraphVisible((v) => !v)}
                    >
                      {graphVisible ? '收起' : '展开'}
                    </Button>
                  </div>
                </div>
                {graphVisible && (
                  <div className="p-3">
                    {currentLoading ? (
                      <div className="flex h-[280px] items-center justify-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        {graphMode === 'merged'
                          ? `构建团队聚合图谱（${mergedScopeCount} 个 Worker，抓取 ≤${MAX_MERGED_FILES} 个 md 文件）…`
                          : `构建 wikilink 图谱（抓取 ≤${MAX_GRAPH_FILES} 个 md 文件）…`}
                      </div>
                    ) : !currentGraph || currentGraph.nodes.length === 0 ? (
                      <div className="flex h-[280px] items-center justify-center text-xs text-muted-foreground">
                        {graphMode === 'merged' ? '团队内暂无知识库文件' : '点「刷新」加载图谱'}
                      </div>
                    ) : viewMode === '3d' ? (
                      <>
                        <KnowledgeGraph3D
                          nodes={g3dNodes}
                          links={g3dLinks}
                          colorFor={colorFor3d}
                          isRoot={(n) => n.virtual === true}
                          isDirect={() => false}
                          onOpenNode={onOpenNode3d}
                          onSelect={setSelectedId3d}
                          onExit3D={() => setViewMode('2d')}
                          height={480}
                        />
                        {sel3d && (
                          <div className="mt-1 px-1 text-[11px] text-muted-foreground">
                            选中：<span className="font-medium text-foreground">{sel3d.node.label}</span>
                            {sel3d.node.agent && (
                              <span className="ml-1 font-mono text-[10px]">{sel3d.node.agent}</span>
                            )}
                            <span className="ml-2">出链 {sel3d.out} · 入链 {sel3d.inn}</span>
                            <span className="ml-2">点节点打开预览 · 点空白取消选中</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="h-[420px]">
                        <KnowledgeGraph
                          nodes={currentGraph.nodes}
                          edges={currentGraph.edges}
                          pos={currentGraph.pos}
                          size={currentGraph.size}
                          blocks={currentGraph.blocks}
                          view={currentGraph.view}
                          sectorOf={currentGraph.sectorOf}
                          hubs={currentGraph.hubs}
                          onSelect={(p, agent) => {
                            // 分类根/未解析灰点不可点开（与 3D 守卫同款）。
                            if (p.startsWith('virtual:')) return;
                            const nd = currentGraph.nodes.find((x) => x.path === p);
                            if (nd?.resolved === false) return;
                            void openPreview(p, agent);
                          }}
                          agentPalette={agentLegend ?? undefined}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 预览卡（独立——图谱卡永不消失；点节点/文件只更新此卡） */}
              <div className="flex min-h-[140px] flex-col rounded-md border border-border/60">
                <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate text-xs font-medium">{preview ? preview.path : '预览'}</span>
                  {preview && preview.worker !== effectiveWorker && (
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {preview.worker}
                    </span>
                  )}
                  {preview && !previewLoading && !previewError && previewText && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto h-6 px-1.5 text-xs"
                      onClick={() => void downloadFile(preview.worker, preview.path)}
                    >
                      <Download className="mr-1 h-3 w-3" aria-hidden="true" />
                      下载
                    </Button>
                  )}
                </div>
                <div className="max-h-[560px] flex-1 overflow-auto p-4">
                  {!preview ? (
                    <p className="py-6 text-center text-xs text-muted-foreground">
                      点击左侧文件查看内容，或点图谱节点直接打开（预览与图谱相互独立）
                    </p>
                  ) : previewLoading ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      读取中（分块 ≤{MAX_CHUNKS * CHUNK / 1024}KB）…
                    </div>
                  ) : previewError ? (
                    <p className="text-xs text-red-600">{previewError}</p>
                  ) : previewText ? (
                    preview.path.toLowerCase().endsWith('.md') ? (
                      <MarkdownMessage content={previewText} />
                    ) : (
                      <pre className="whitespace-pre-wrap text-xs">{previewText}</pre>
                    )
                  ) : (
                    <p className="py-4 text-center text-xs text-muted-foreground">（空文件）</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

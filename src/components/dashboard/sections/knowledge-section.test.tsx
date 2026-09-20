import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// 可变 holder：⑥ 号用例模拟轮询重取后列表顺序漂移（Controller 顺序不稳定）
const workersHolder = vi.hoisted(() => ({
  list: [
    { name: 'w1', team: 't1', role: 'team_leader' },
    { name: 'w2', team: 't2', role: 'worker' },
  ],
}));
vi.mock('@/hooks/use-agentteams-workers', () => ({
  useWorkers: () => ({
    data: workersHolder.list,
    isLoading: false,
    error: null,
  }),
}));

// MarkdownMessage 替身（避免拉聊天栈；断言透传 content）
vi.mock('@/components/dashboard/sections/chat/markdown-message', () => ({
  MarkdownMessage: ({ content }: { content: string }) => <div data-testid="md">{content}</div>,
}));

import {
  KnowledgeSection,
  KnowledgeGraph,
  assembleGraph,
  clusterGridLayout,
  chipWidth,
  KB2D,
  focusView,
  clampZoomView,
  type GNode,
} from './knowledge-section';

const TREE_TOP = {
  directory: 'workspace',
  entries: [
    { kind: 'directory', name: 'memory', path: 'memory', size: null, modified_at: '', preview_kind: '' },
    { kind: 'directory', name: 'digest', path: 'digest', size: null, modified_at: '', preview_kind: '' },
    { kind: 'directory', name: 'nm-protocol', path: 'nm-protocol', size: null, modified_at: '', preview_kind: '' },
    { kind: 'file', name: 'MEMORY.md', path: 'MEMORY.md', size: 10, modified_at: '', preview_kind: 'markdown' },
    { kind: 'file', name: 'agent.json', path: 'agent.json', size: 20, modified_at: '', preview_kind: 'binary' },
  ],
  has_more: false,
  next_cursor: null,
};
const TREE_MEMORY = {
  directory: 'memory',
  entries: [
    { kind: 'file', name: 'a.md', path: 'memory/a.md', size: 10, modified_at: '', preview_kind: 'markdown' },
    { kind: 'file', name: 'b.md', path: 'memory/b.md', size: 10, modified_at: '', preview_kind: 'markdown' },
  ],
  has_more: false,
  next_cursor: null,
};
const TREE_DIGEST = { directory: 'digest', entries: [], has_more: false, next_cursor: null };

// a.md 链接 [[b]] 与 [[MEMORY]] → 每 Worker 2 条边
const CONTENTS: Record<string, string> = {
  'MEMORY.md': '# 总索引',
  'memory/a.md': 'see [[b]] and [[MEMORY]]',
  'memory/b.md': '',
};

function mockFetch(statuses?: { top?: number; memory?: number; digest?: number; content?: number; topError?: string }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = url as string;
      let status = 200;
      let body: unknown = {};
      if (u.includes('/tree')) {
        if (u.includes('path=memory')) { status = statuses?.memory ?? 200; body = TREE_MEMORY; }
        else if (u.includes('path=digest')) { status = statuses?.digest ?? 200; body = TREE_DIGEST; }
        else { status = statuses?.top ?? 200; body = TREE_TOP; }
      } else if (u.includes('/file-content')) {
        const m = u.match(/path=([^&]+)/);
        const p = m ? decodeURIComponent(m[1]) : '';
        status = statuses?.content ?? 200;
        body = { content: CONTENTS[p] ?? '', eof: true, offset: 0, next_offset: 0, etag: 'x' };
      }
      if (status >= 400 && statuses?.topError && u.includes('/tree') && !u.includes('path=memory') && !u.includes('path=digest')) {
        body = { error: statuses.topError };
      }
      return {
        ok: status < 400,
        status,
        headers: new Headers(),
        json: async () => body,
        blob: async () => new Blob([String(body)]),
      } as unknown as Response;
    }),
  );
}

/** 2D 图谱 SVG（2D 为唯一视图；3D 引擎按评审拆为 follow-up） */
async function graphSvg() {
  return (await screen.findByRole('img', { name: /wikilink 图谱/ })) as unknown as { querySelectorAll: (_s: string) => NodeListOf<SVGElement> };
}

describe('assembleGraph（v4 图谱模型——对齐插件 kb_graph / QwenPaw ReMe 同款）', () => {
  const label = (nodes: { id: string; label: string }[], id: string) =>
    nodes.find((n) => n.id === id)?.label;

  it('结构边：digest 三分类虚拟根（非空才生成）→ 分桶文件（任意深度）', () => {
    const paths = [
      'digest/wiki/a.md', 'digest/wiki/sub/e.md',
      'digest/personal/b.md', 'digest/procedure/c.md', 'digest/other/d.md',
    ];
    const { nodes, edges } = assembleGraph(paths, paths.map(() => ''));
    expect(nodes.some((n) => n.id === 'virtual:wiki')).toBe(true);
    expect(nodes.some((n) => n.id === 'virtual:personal')).toBe(true);
    expect(nodes.some((n) => n.id === 'virtual:procedure')).toBe(true);
    expect(nodes.some((n) => n.id === 'virtual:other')).toBe(false); // other 非三桶，无根
    const wi = nodes.findIndex((n) => n.id === 'virtual:wiki');
    expect(label(nodes, 'virtual:wiki')).toBe('wiki');
    const edgeOf = (t: string) => edges.find((e) => e.t === nodes.findIndex((n) => n.id === t) && e.s === wi);
    expect(edgeOf('digest/wiki/a.md')).toBeTruthy(); // 深度 1
    expect(edgeOf('digest/wiki/sub/e.md')).toBeTruthy(); // 深度 2（任意深度）
    expect(edges.some((e) => e.t === nodes.findIndex((n) => n.id === 'digest/other/d.md'))).toBe(false);
  });

  it('兜底 hub：无 digest 分桶时 MEMORY.md → depth-1 memory 文件（depth-2 不挂）', () => {
    const paths = ['MEMORY.md', 'memory/2026-01-01.md', 'memory/sub/x.md'];
    const { nodes, edges } = assembleGraph(paths, paths.map(() => ''));
    expect(nodes.some((n) => n.virtual)).toBe(false); // 无 digest 分桶 → 无虚拟根
    const mi = nodes.findIndex((n) => n.id === 'MEMORY.md');
    expect(edges.some((e) => e.s === mi && e.t === nodes.findIndex((n) => n.id === 'memory/2026-01-01.md'))).toBe(true);
    expect(edges.some((e) => e.s === mi && e.t === nodes.findIndex((n) => n.id === 'memory/sub/x.md'))).toBe(false);
  });

  it('wikilink：干名/大小写/|alias/#anchor 四种形态匹配 + 自链跳过', () => {
    const paths = ['x.md', 'y.md', 'z.md'];
    const contents = ['[[y]] [[Y|alias]] [[z#sec]] [[x]]', '', ''];
    const { nodes, edges } = assembleGraph(paths, contents);
    const xi = 0, yi = 1, zi = 2;
    const to = (t: number) => edges.filter((e) => e.s === xi && e.t === t);
    expect(to(yi).length).toBe(1); // [[y]] 与 [[Y|alias]] 去重为一条
    expect(to(zi).length).toBe(1); // #anchor 剥掉后匹配
    expect(edges.some((e) => e.s === xi && e.t === xi)).toBe(false); // 自链跳过
    expect(nodes.length).toBe(3); // 未产生灰点
  });

  it('→/← 路径块引用（ReMe inlinks/outlinks 行约定）', () => {
    const paths = ['x.md', 'y.md', 'z.md'];
    const contents = ['→ y.md\n← z\n→ not-exist', '', ''];
    const { nodes, edges } = assembleGraph(paths, contents);
    const xi = 0;
    expect(edges.some((e) => e.s === xi && e.t === 1)).toBe(true); // → y.md
    expect(edges.some((e) => e.s === xi && e.t === 2)).toBe(true); // ← z
    const ghost = nodes.find((n) => n.id === 'not-exist');
    expect(ghost?.resolved).toBe(false); // 未解析 → 灰点
    expect(edges.some((e) => e.s === xi && e.t === nodes.findIndex((n) => n.id === 'not-exist'))).toBe(true);
  });

  it('http / 绝对路径不成边不建点；完整路径（缺 .md）可解析', () => {
    const paths = ['x.md', 'memory/a.md'];
    const contents = ['[[http://x.com/a]] [[/abs/path]] [[memory/a]]', ''];
    const { nodes, edges } = assembleGraph(paths, contents);
    expect(nodes.length).toBe(2); // 无灰点
    expect(edges.length).toBe(1);
    expect(edges[0]).toEqual({ s: 0, t: 1 });
  });
});

describe('KnowledgeSection（v3：2D 图谱 / 预览与图谱分离 / 团队聚合 / 选择记忆）', () => {
  beforeEach(() => {
    vi.useRealTimers();
    workersHolder.list = [
      { name: 'w1', team: 't1', role: 'team_leader' },
      { name: 'w2', team: 't2', role: 'worker' },
    ];
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('① 顶层 404 → 显示服务端真实错误（容器/工作区缺失，非版本横幅）', async () => {
    mockFetch({ top: 404, topError: '容器 agentteams-worker-w1 不存在' });
    render(<KnowledgeSection />);
    expect(await screen.findByText(/容器 agentteams-worker-w1 不存在/)).toBeInTheDocument();
  });

  it('③ 点图谱节点 → 打开预览 且 图谱仍驻留（预览与图谱分离，回退不空白）', async () => {
    mockFetch();
    render(<KnowledgeSection />);
    const svg = await graphSvg();
    // v3 语义验证：该测试图无 virtual 根 → 度数 top 文件（a.md 等）=伪根 hub，
    // 伪根仍走预览（单击=文件预览语义保留；virtual 根才单击聚焦）。
    const nodeA = Array.from(svg.querySelectorAll('text')).find((t) => t.textContent === 'a')!;
    fireEvent.click(nodeA);
    // 预览卡更新
    expect(await screen.findByText('memory/a.md')).toBeInTheDocument();
    const md = await screen.findByTestId('md');
    expect(md.textContent).toBe('see [[b]] and [[MEMORY]]');
    // 图谱卡仍在（未切换视图、无空白态）
    expect(screen.getByRole('img', { name: /wikilink 图谱/ })).toBeInTheDocument();
    // 空预览提示消失
    expect(screen.queryByText(/点击左侧文件查看内容/)).not.toBeInTheDocument();
  });

  it('④ 四分类分组常驻左栏 + 展开 memory → 点文件预览（图谱卡并存）', async () => {
    mockFetch();
    render(<KnowledgeSection />);
    await screen.findByText('知识文件');
    // 四分类分组头常驻（左栏文件树，无需切视图）。
    // findByText：文件树在顶层 fetch 落地后渲染，同步断言在重渲染负载下会
    // 偶发抢跑（2D 图谱机件落地后首帧变重，实测 ~10% flake）。
    expect(await screen.findByText('档案')).toBeInTheDocument();
    expect(screen.getAllByText('文件', { selector: 'p' }).length).toBe(1);
    expect(screen.getByText('日记 memory')).toBeInTheDocument();
    expect(screen.getByText('知识库 digest')).toBeInTheDocument();
    // 档案=顶层 md（MEMORY.md 入档案组）；文件组=agent.json；顶层目录 nm-protocol 只列不展开
    expect(screen.getByText('MEMORY.md')).toBeInTheDocument();
    expect(screen.getByText('agent.json')).toBeInTheDocument();
    expect(screen.getByText('nm-protocol/')).toBeInTheDocument();
    // 展开 memory/ → 点 a.md 预览
    fireEvent.click(screen.getByText('memory/'));
    const fileBtn = await screen.findByText('a.md');
    fireEvent.click(fileBtn);
    expect(await screen.findByText('memory/a.md')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('md').textContent).toBe('see [[b]] and [[MEMORY]]'));
    // 图谱卡标题常驻
    expect(screen.getByText('知识图谱（wikilink 引用网络）')).toBeInTheDocument();
  });

  it('⑧ 502 → 错误横幅透出服务端详情（{message} 错误体）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 502,
        headers: new Headers(),
        json: async () => ({ message: 'worker workspace API unreachable' }),
      }) as unknown as Response),
    );
    render(<KnowledgeSection />);
    expect(
      await screen.findByText(/tree → worker workspace API unreachable/),
    ).toBeInTheDocument();
  });

  it('⑨ 200 + HTML 响应体 → 可读报错而非 SyntaxError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('<!doctype html><html><body>gateway page</body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
      ),
    );
    render(<KnowledgeSection />);
    expect(
      await screen.findByText(/tree → 服务返回了非预期的页面而非 JSON/),
    ).toBeInTheDocument();
  });

  it('⑩ 401 → 提示重新登录', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    render(<KnowledgeSection />);
    expect(await screen.findByText(/登录已过期，请刷新页面重新登录/)).toBeInTheDocument();
  });

  it('⑥ 默认 worker 钉住：轮询重取顺序漂移不重置视图（展开的目录保留）', async () => {
    mockFetch();
    render(<KnowledgeSection />);
    const select = screen.getByRole('combobox', { name: /选择 Worker/ }) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('w1')); // 首份列表钉住 w1
    // 展开 memory/（等文件树落地——顶层 fetch 是异步的）
    fireEvent.click(await screen.findByText('memory/'));
    await screen.findByText('a.md');
    // 轮询重取：列表顺序漂移（w2 变第一）+ 触发重渲染（折叠/展开图谱卡）
    workersHolder.list = [
      { name: 'w2', team: 't2', role: 'worker' },
      { name: 'w1', team: 't1', role: 'team_leader' },
    ];
    fireEvent.click(screen.getByRole('button', { name: '收起' }));
    await waitFor(() => expect(select.value).toBe('w1')); // 钉住不跟随 workers[0]
    expect(screen.getByText('a.md')).toBeInTheDocument(); // 展开状态保留
  });

  it('⑤ 团队透传：选择器按 team 分组（optgroup）+ 负责人标记', async () => {
    mockFetch();
    render(<KnowledgeSection />);
    const select = screen.getByRole('combobox', { name: /选择 Worker/ }) as HTMLSelectElement;
    const groups = Array.from(select.querySelectorAll('optgroup'));
    expect(groups.map((g) => g.label)).toEqual(['t1', 't2']);
    const g1 = Array.from(groups[0].querySelectorAll('option'));
    expect(g1.map((o) => o.textContent)).toEqual(['w1 · 负责人']);
    const g2 = Array.from(groups[1].querySelectorAll('option'));
    expect(g2.map((o) => o.textContent)).toEqual(['w2']);
  });

  it('⑦ 团队聚合图谱：跨 Worker 合并建图 + 按 Worker 着色图例 + 聚合范围标注', async () => {
    mockFetch();
    render(<KnowledgeSection />);
    expect(await screen.findByText('当前 Worker 图谱')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /团队聚合图谱/ }));
    // 聚合范围行（2 Workers）+ 聚合团队选择器（全部团队/t1/t2）
    expect(await screen.findByText('聚合 2 个 Worker')).toBeInTheDocument();
    const teamSel = screen.getByRole('combobox', { name: '聚合团队' }) as HTMLSelectElement;
    expect(Array.from(teamSel.options).map((o) => o.textContent)).toEqual([
      '全部团队（2 Workers）', 't1（1）', 't2（1）',
    ]);
    // 切 2D 断言合并图：w1+w2 各 3 文件 → 6 节点；
    // v4 每 Worker 4 边（MEMORY.md 兜底 hub→memory/a、memory/b 两条结构边
    // + a.md 的 [[b]]/[[MEMORY]] 两条 wikilink 边）→ 共 8 边
    const svg = await graphSvg();
    // v4：节点=chip（rect，无虚线框属性）；块框 rect 带 stroke-dasharray
    const chips = Array.from(svg.querySelectorAll('rect')).filter((r) => !r.getAttribute('stroke-dasharray'));
    expect(chips.length).toBe(6);
    expect(svg.querySelectorAll('line').length).toBe(8);
    // 图例=两个 Worker（按 Agent 着色）——option 文案带后缀/计数，图例为精确名
    expect(screen.getAllByText('w1').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('w2').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('→ 引用方向')).not.toBeInTheDocument();
  });

  it('⑧ 选择记忆：worker 选择持久化 + 失效值回退（列表落地后校验）', async () => {
    mockFetch();
    window.localStorage.setItem('agentteams:kb:worker', 'w2');
    render(<KnowledgeSection />);
    const select = screen.getByRole('combobox', { name: /选择 Worker/ }) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('w2')); // 记忆恢复
    // 手动切回 w1 → 持久化更新
    fireEvent.change(select, { target: { value: 'w1' } });
    expect(window.localStorage.getItem('agentteams:kb:worker')).toBe('w1');
  });

  it('⑨ 选择记忆：失效 worker（列表无此人）→ 回退默认推导，不卡死', async () => {
    mockFetch();
    window.localStorage.setItem('agentteams:kb:worker', 'ghost-worker');
    render(<KnowledgeSection />);
    const select = screen.getByRole('combobox', { name: /选择 Worker/ }) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('w1')); // 回退首名（推导默认）
    // 失效值不被当有效选择持久化——空选择=清除记忆键（回退=推导而非写入）
    expect(window.localStorage.getItem('agentteams:kb:worker')).toBeNull();
  });
});

// ── clusterGridLayout（2D v4 簇块网格布局——确定性几何单测）────────────────
describe('clusterGridLayout（2D v4 簇块网格布局）', () => {
  const node = (id: string, extra: Partial<GNode> = {}): GNode => ({
    id,
    path: id,
    label: id,
    deg: 0,
    isMemory: false,
    ...extra,
  });
  const pairsOf = (nodes: GNode[], edges: Array<[string, string]>) =>
    edges.filter(([a, b]) => nodes.some((n) => n.id === a) && nodes.some((n) => n.id === b));
  const chipBox = (r: { pos: Map<string, { x: number; y: number }>; size: Map<string, { w: number; h: number }> }, id: string) => {
    const p = r.pos.get(id)!;
    const s = r.size.get(id)!;
    return { x0: p.x - s.w / 2, x1: p.x + s.w / 2, y0: p.y - s.h / 2, y1: p.y + s.h / 2 };
  };
  const noOverlap = (r: { pos: Map<string, { x: number; y: number }>; size: Map<string, { w: number; h: number }> }, ids: string[]) => {
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = chipBox(r, ids[i]);
        const b = chipBox(r, ids[j]);
        const sep = a.x1 <= b.x0 + 1e-6 || b.x1 <= a.x0 + 1e-6 || a.y1 <= b.y0 + 1e-6 || b.y1 <= a.y0 + 1e-6;
        expect(sep, `${ids[i]} × ${ids[j]} 重叠`).toBe(true);
      }
    }
  };

  it('① 空图 → 默认视野，不炸', () => {
    const { view, blocks } = clusterGridLayout([], []);
    expect(view.width).toBeGreaterThan(0);
    expect(view.height).toBeGreaterThan(0);
    expect(blocks).toHaveLength(0);
  });

  it('② 单根 + 三文件 → hub 在上行，文件在下行，chip 互不重叠', () => {
    const nodes = [node('virtual:wiki', { virtual: true }), node('a.md'), node('b.md'), node('c.md')];
    const pairs: Array<[string, string]> = [
      ['virtual:wiki', 'a.md'],
      ['virtual:wiki', 'b.md'],
      ['virtual:wiki', 'c.md'],
    ];
    const r = clusterGridLayout(nodes, pairsOf(nodes, pairs));
    // 单簇 hub 在列顶（y 最小），文件行在其下
    const hub = r.pos.get('virtual:wiki')!;
    for (const f of ['a.md', 'b.md', 'c.md']) {
      expect(r.pos.get(f)!.y).toBeGreaterThan(hub.y);
      expect(Number.isFinite(r.pos.get(f)!.x)).toBe(true);
    }
    noOverlap(r, ['virtual:wiki', 'a.md', 'b.md', 'c.md']);
    // chip 尺寸齐备
    for (const n of nodes) expect(r.size.get(n.id)).toBeDefined();
  });

  it('③ 确定性：同输入两次 → 逐点相同', () => {
    const nodes = [
      node('virtual:wiki', { virtual: true }),
      node('virtual:personal', { virtual: true }),
      ...['a.md', 'b.md', 'c.md', 'd.md', 'e.md', 'f.md'].map((id) => node(id)),
    ];
    const pairs: Array<[string, string]> = [
      ['virtual:wiki', 'a.md'], ['virtual:wiki', 'b.md'], ['virtual:wiki', 'c.md'],
      ['virtual:personal', 'd.md'], ['virtual:personal', 'e.md'], ['virtual:personal', 'f.md'],
      ['a.md', 'd.md'], // 跨簇 wikilink（跨簇边走 hub 线层）
    ];
    const p = pairsOf(nodes, pairs);
    const r1 = clusterGridLayout(nodes, p);
    const r2 = clusterGridLayout(nodes, p);
    expect([...r1.pos.entries()]).toEqual([...r2.pos.entries()]);
    // v4 语义：a↔d 链接把两个 virtual 根连进同一分量 → 单簇单 hub（取首个 virtual）
    expect(r1.hubs).toEqual(['virtual:wiki']);
    // 断开链接 → 两个分量 → 两个 hub
    const p2 = pairs.filter(([a, b]) => !((a === 'a.md' && b === 'd.md') || (a === 'd.md' && b === 'a.md')));
    expect(clusterGridLayout(nodes, p2).hubs).toEqual(['virtual:wiki', 'virtual:personal']);
  });

  it('④ 孤立节点（无边）→ 自成单节点簇，位置有限', () => {
    const nodes = [node('virtual:wiki', { virtual: true }), node('a.md'), node('loner.md')];
    const r = clusterGridLayout(nodes, pairsOf(nodes, [['virtual:wiki', 'a.md']]));
    const l = r.pos.get('loner.md')!;
    expect(Number.isFinite(l.x)).toBe(true);
    // v4 语义：孤立=独立连通分量=独立簇（hub=自身），不再挂末簇
    expect(r.sectorOf.get('loner.md')).toBe('loner.md');
    expect(r.hubs).toEqual(['virtual:wiki', 'loner.md']);
  });

  it('⑤ 聚合模式（agentOrder）→ 每 Worker 一个块，hub 优先 virtual 根，块不重叠', () => {
    const nodes = [
      node('w1::virtual:wiki', { virtual: true, agent: 'w1' }),
      node('w1::memory/a.md', { agent: 'w1' }),
      node('w1::memory/b.md', { agent: 'w1' }),
      node('w2::MEMORY.md', { agent: 'w2' }),
      node('w2::memory/c.md', { agent: 'w2' }),
    ];
    const pairs: Array<[string, string]> = [
      ['w1::virtual:wiki', 'w1::memory/a.md'],
      ['w1::virtual:wiki', 'w1::memory/b.md'],
      ['w2::MEMORY.md', 'w2::memory/c.md'],
    ];
    const r = clusterGridLayout(nodes, pairsOf(nodes, pairs), ['w1', 'w2']);
    expect(r.hubs).toEqual(['w1::virtual:wiki', 'w2::MEMORY.md']); // w2 无 virtual 根→最高度数文件
    // 每簇成员位置互异（chip 网格天然成立——含 chip 尺寸判重叠）
    noOverlap(r, nodes.map((n) => n.id));
    // 两块包围盒不交（簇分离）
    const [b1, b2] = r.blocks;
    const sep =
      b1.minX + b1.w <= b2.minX + 1e-6 || b2.minX + b2.w <= b1.minX + 1e-6 ||
      b1.minY + b1.h <= b2.minY + 1e-6 || b2.minY + b2.h <= b1.minY + 1e-6;
    expect(sep, '两块包围盒重叠').toBe(true);
  });

  it('⑥ 视野自适应：viewBox 包住全部节点（含留白）', () => {
    const nodes = [node('virtual:wiki', { virtual: true }), ...['a.md', 'b.md'].map((id) => node(id))];
    const r = clusterGridLayout(nodes, pairsOf(nodes, [['virtual:wiki', 'a.md'], ['virtual:wiki', 'b.md']]));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    r.pos.forEach((p) => {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
    expect(r.view.minX).toBeLessThanOrEqual(minX);
    expect(r.view.minY).toBeLessThanOrEqual(minY);
    expect(r.view.minX + r.view.width).toBeGreaterThanOrEqual(maxX);
    expect(r.view.minY + r.view.height).toBeGreaterThanOrEqual(maxY);
  });
});

// ── 2D v4：簇块分离 / chip 尺寸 / sectorOf 契约 ─────────────────────────────
describe('clusterGridLayout v4（簇块分离 + chip 尺寸）', () => {
  const node = (id: string, extra: Partial<GNode> = {}): GNode => ({
    id,
    path: id,
    label: id,
    deg: 0,
    isMemory: false,
    ...extra,
  });

  it('⑦ R=3 三簇 → 三块，块内 chip 互不重叠，块间包围盒不交', () => {
    const nodes = [
      node('r1', { virtual: true, deg: 3 }),
      node('r2', { virtual: true, deg: 3 }),
      node('r3', { virtual: true, deg: 3 }),
      ...['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'c1', 'c2', 'c3'].map((id) => node(id)),
    ];
    const pairs: Array<[string, string]> = [
      ['r1', 'a1'], ['r1', 'a2'], ['r1', 'a3'],
      ['r2', 'b1'], ['r2', 'b2'], ['r2', 'b3'],
      ['r3', 'c1'], ['r3', 'c2'], ['r3', 'c3'],
    ];
    const r = clusterGridLayout(nodes, pairs);
    expect(r.hubs).toEqual(['r1', 'r2', 'r3']);
    expect(r.blocks).toHaveLength(3);
    for (const b of r.blocks) {
      for (const nd of nodes) {
        if (r.sectorOf.get(nd.id) !== b.hubId) continue;
        const p = r.pos.get(nd.id)!;
        expect(p.x).toBeGreaterThanOrEqual(b.minX - 1e-6);
        expect(p.x).toBeLessThanOrEqual(b.minX + b.w + 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(b.minY - 1e-6);
        expect(p.y).toBeLessThanOrEqual(b.minY + b.h + 1e-6);
      }
    }
  });

  it('⑧ chip 尺寸随标签宽度：长标签更宽且有上限', () => {
    const long = 'a-very-long-file-name-0123456789.md';
    const nodes = [node('hub', { virtual: true }), node(long), node('b.md')];
    const r = clusterGridLayout(nodes, [['hub', long], ['hub', 'b.md']]);
    const sl = r.size.get(long)!;
    const sb = r.size.get('b.md')!;
    expect(sl.w).toBeGreaterThan(sb.w);
    expect(sl.w).toBeLessThanOrEqual(KB2D.MAX_W + 1e-6);
    expect(sb.w).toBeGreaterThanOrEqual(KB2D.MIN_W);
  });

  it('⑩ 无 virtual 根 → hub=分量内最高度数文件（v3 升序 bug 回归）', () => {
    const nodes = [node('leaf.md'), node('MEMORY.md'), node('x.md'), node('y.md')];
    const r = clusterGridLayout(
      nodes,
      [
        ['MEMORY.md', 'leaf.md'],
        ['MEMORY.md', 'x.md'],
        ['MEMORY.md', 'y.md'],
      ],
    );
    expect(r.hubs).toEqual(['MEMORY.md']); // 星心=最高度，不是首字母序
    expect(r.sectorOf.get('leaf.md')).toBe('MEMORY.md');
  });

  it('⑨ sectorOf 全覆盖（每节点恰属一个簇）', () => {
    const nodes = [node('r1', { virtual: true }), node('a.md'), node('loner.md')];
    const { sectorOf, hubs } = clusterGridLayout(nodes, [['r1', 'a.md']]);
    expect(hubs).toEqual(['r1', 'loner.md']); // 孤立节点独立成簇
    expect(sectorOf.size).toBe(nodes.length);
    nodes.forEach((nd) => expect(sectorOf.get(nd.id)).toBeDefined());
    expect(sectorOf.get('loner.md')).toBe('loner.md');
  });
});

describe('2D 缩放/聚焦纯函数（v3）', () => {
  const fit = { minX: -100, minY: -50, width: 200, height: 100 };

  it('focusView：空集 → null；四点包围盒 + 留白精确', () => {
    expect(focusView([])).toBeNull();
    const v = focusView([
      { x: -10, y: -5 }, { x: 10, y: -5 }, { x: -10, y: 5 }, { x: 10, y: 5 },
    ], 70)!;
    expect(v.minX).toBe(-80);
    expect(v.minY).toBe(-75);
    expect(v.width).toBe(160);
    expect(v.height).toBe(150); // (5-(-5)) + 2*70
  });

  it('clampZoomView：范围内直通；超上限钳 8×（中心锚）；超下限钳 0.25×', () => {
    expect(clampZoomView(fit, fit)).toBe(fit);
    const zoomed = clampZoomView({ ...fit, width: fit.width / 16, height: fit.height / 16, minX: fit.minX + fit.width / 16 * 0.5, minY: fit.minY + fit.height / 16 * 0.5 }, fit);
    expect(zoomed.width).toBeCloseTo(fit.width / 8, 6);
    // 中心锚：钳制后中心不变
    const cx0 = fit.minX + fit.width / 16 * 0.5 + fit.width / 16 / 2;
    expect(zoomed.minX + zoomed.width / 2).toBeCloseTo(cx0, 6);
    const out = clampZoomView({ ...fit, width: fit.width * 8, height: fit.height * 8 }, fit);
    expect(out.width).toBeCloseTo(fit.width * 4, 6); // 0.25× = 视野 4× fit
  });
});

describe('KnowledgeGraph v3（缩放/聚焦交互）', () => {
  afterEach(cleanup); // 组件用例间清 DOM（文件级无全局 cleanup）
  function smallGraph() {
    const n = (id: string, extra: Partial<GNode> = {}): GNode => ({
      id, path: id, label: id, deg: 0, isMemory: false, ...extra,
    });
    const nodes = [
      n('virtual:wiki', { virtual: true, deg: 2 }),
      n('a.md', { deg: 1 }),
      n('b.md', { deg: 1 }),
      n('virtual:notes', { virtual: true, deg: 1 }),
      n('c.md', { deg: 1 }),
    ];
    const pairs: Array<[string, string]> = [
      ['virtual:wiki', 'a.md'],
      ['virtual:wiki', 'b.md'],
      ['virtual:notes', 'c.md'],
    ];
    const { pos, size, blocks, view, sectorOf, hubs } = clusterGridLayout(nodes, pairs);
    return { nodes, pos, size, blocks, view, sectorOf, hubs };
  }
  const svgOf = (container: HTMLElement) =>
    container.querySelector('svg') as unknown as {
      getAttribute: (_s: string) => string | null;
      querySelectorAll: (_s: string) => NodeListOf<Element>;
      dispatchEvent: (_e: Event) => boolean;
    };
  const labelParent = (svg: ReturnType<typeof svgOf>, label: string) => {
    const t = [...svg.querySelectorAll('text')].find((x) => x.textContent === label);
    expect(t, `label ${label} 未渲染`).toBeTruthy();
    return (t as unknown as { parentElement: Element }).parentElement;
  };

  it('⑩ wheel 缩放：宽度按 1/1.18 收缩；连缩多次钳制在 0.25×（fit*4）', () => {
    const g = smallGraph();
    const { container } = render(
      <KnowledgeGraph nodes={g.nodes} edges={[]} pos={g.pos} size={g.size} blocks={g.blocks} view={g.view} sectorOf={g.sectorOf} hubs={g.hubs} onSelect={() => {}} />,
    );
    const svg = svgOf(container);
    const w0 = g.view.width;
    act(() => {
      svg.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, cancelable: true }));
    });
    const vb1 = svg.getAttribute('viewBox')!.split(' ').map(Number);
    expect(vb1[2]).toBeCloseTo(w0 / 1.18, 6);
    for (let i = 0; i < 80; i += 1) {
      act(() => {
        svg.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true }));
      });
    }
    const vb2 = svg.getAttribute('viewBox')!.split(' ').map(Number);
    expect(vb2[2]).toBeLessThanOrEqual(w0 * 4 + 1e-6);
  });

  it('⑪ 点簇根=聚焦：chip 出现 + 非簇节点淡出 0.1（恰好 2 个）', () => {
    const g = smallGraph();
    const { container } = render(
      <KnowledgeGraph nodes={g.nodes} edges={[]} pos={g.pos} size={g.size} blocks={g.blocks} view={g.view} sectorOf={g.sectorOf} hubs={g.hubs} onSelect={() => {}} />,
    );
    const svg = svgOf(container);
    fireEvent.click(labelParent(svg, 'virtual:wiki'));
    const chip = screen.getByRole('button', { name: /退出/ });
    expect(chip.textContent).toContain('virtual:wiki');
    const dimmed = [...svg.querySelectorAll('rect')].filter((c) => c.getAttribute('fill-opacity') === '0.06');
    expect(dimmed.length).toBe(2); // virtual:notes + c.md
  });

  it('⑫ Esc 退出聚焦：chip 消失', () => {
    const g = smallGraph();
    const { container } = render(
      <KnowledgeGraph nodes={g.nodes} edges={[]} pos={g.pos} size={g.size} blocks={g.blocks} view={g.view} sectorOf={g.sectorOf} hubs={g.hubs} onSelect={() => {}} />,
    );
    const svg = svgOf(container);
    fireEvent.click(labelParent(svg, 'virtual:wiki'));
    expect(screen.getByRole('button', { name: /退出/ })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: /退出/ })).toBeNull();
  });

  it('⑬ 文件节点双击=邻域聚焦（chip 带节点名）', () => {
    const g = smallGraph();
    const { container } = render(
      <KnowledgeGraph nodes={g.nodes} edges={[]} pos={g.pos} size={g.size} blocks={g.blocks} view={g.view} sectorOf={g.sectorOf} hubs={g.hubs} onSelect={() => {}} />,
    );
    const svg = svgOf(container);
    fireEvent.doubleClick(labelParent(svg, 'a.md'));
    const chip = screen.getByRole('button', { name: /a\.md/ });
    expect(chip.textContent).toContain('a.md');
  });
});

// ── 12.12 回归：「簇重叠」行堆叠真根因 + CJK 字宽（双端同款修复）────────────
describe('clusterGridLayout 12.12 回归（簇重叠行堆叠 + CJK 字宽）', () => {
  const node = (id: string, extra: Partial<GNode> = {}): GNode => ({
    id, path: id, label: id, deg: 0, isMemory: false, ...extra,
  });
  const pairsOf = (nodes: GNode[], edges: Array<[string, string]>) =>
    edges.filter(([a, b]) => nodes.some((n) => n.id === a) && nodes.some((n) => n.id === b));

  it('⑭ 多行堆叠：行高不等 → 无跨行重叠（「簇重叠」真根因回归）', () => {
    const long = '系统架构与部署方案设计说明文档'; // 15 CJK → MAX_W clamp
    const nodes: GNode[] = [node('w-a'), node('w-b'), node('w-c'), node('w-d')];
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < 40; i += 1) { const id = `w-a/f${i}`; nodes.push(node(id, { label: `${long}A${i}` })); pairs.push(['w-a', id]); }
    nodes.push(node('w-b/f0', { label: `${long}B` })); pairs.push(['w-b', 'w-b/f0']);
    for (let i = 0; i < 8; i += 1) { const id = `w-c/f${i}`; nodes.push(node(id, { label: `${long}C${i}` })); pairs.push(['w-c', id]); }
    for (let i = 0; i < 4; i += 1) { const id = `w-d/f${i}`; nodes.push(node(id, { label: `${long}D${i}` })); pairs.push(['w-d', id]); }
    const r = clusterGridLayout(nodes, pairsOf(nodes, pairs));
    const ids = nodes.map((n) => n.id);
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const pa = r.pos.get(ids[i])!; const sa = r.size.get(ids[i])!;
        const pb = r.pos.get(ids[j])!; const sb = r.size.get(ids[j])!;
        const sep = pa.x + sa.w / 2 <= pb.x - sb.w / 2 + 1e-6 || pb.x + sb.w / 2 <= pa.x - sa.w / 2 + 1e-6
          || pa.y + sa.h / 2 <= pb.y - sb.h / 2 + 1e-6 || pb.y + sb.h / 2 <= pa.y - sa.h / 2 + 1e-6;
        expect(sep, `${ids[i]} × ${ids[j]} 重叠`).toBe(true);
      }
    }
    const bs = r.blocks;
    for (let i = 0; i < bs.length; i += 1) {
      for (let j = i + 1; j < bs.length; j += 1) {
        const sep = bs[i].minX + bs[i].w <= bs[j].minX + 1e-6 || bs[j].minX + bs[j].w <= bs[i].minX + 1e-6
          || bs[i].minY + bs[i].h <= bs[j].minY + 1e-6 || bs[j].minY + bs[j].h <= bs[i].minY + 1e-6;
        expect(sep, `${bs[i].hubId} × ${bs[j].hubId} 块重叠`).toBe(true);
      }
    }
  });

  it('⑮ CJK 字宽加权：中文名 chip 不再低估（与插件同款）', () => {
    expect(chipWidth('知识库')).toBe(3 * KB2D.FONT_W_CJK + KB2D.CHIP_PAD_X * 2);
    expect(chipWidth('知识库架构设计')).toBe(7 * KB2D.FONT_W_CJK + KB2D.CHIP_PAD_X * 2);
    // 纯拉丁维持原估宽；过短照旧钳到 MIN_W
    expect(chipWidth('ab')).toBe(KB2D.MIN_W);
  });
});

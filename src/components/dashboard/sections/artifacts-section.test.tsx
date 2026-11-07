import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ArtifactsSection } from './artifacts-section';
import type { ProjectSummary, WorkflowResponse } from '@/lib/agentteams-projects-api';

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  getProjectWorkflow: vi.fn(),
  getTaskArtifactUrl: vi.fn(),
  listTeams: vi.fn(),
  fetch: vi.fn(),
}));

const PROJECTS: ProjectSummary[] = [
  { project_id: 'proj-20260901-aaa', title: 'A 项目', status: 'active', team_id: 'sysdev' },
  { project_id: 'proj-20260914-bbb', title: 'B 项目', status: 'active', team_id: 'sysdev' },
];

function workflowFixture(): WorkflowResponse {
  return {
    project_id: 'proj-20260914-bbb',
    title: 'B 项目',
    status: 'active',
    nodes: [],
    edges: [],
    next: [],
    interrupts: [],
    tasks_detail: [
      {
        task_id: 't1',
        assigned_to: 'w1',
        deliverables: ['docs/report.md', 'img/pic.png', 'data.json'],
        result_path: 'result.md',
      },
    ],
  };
}

vi.mock('@/lib/agentteams-projects-api', () => ({
  listProjects: (...a: unknown[]) => mocks.listProjects(...a),
  getProjectWorkflow: (...a: unknown[]) => mocks.getProjectWorkflow(...a),
  getTaskArtifactUrl: (...a: unknown[]) => mocks.getTaskArtifactUrl(...a),
}));

vi.mock('@/lib/agentteams-api', () => ({
  agentteamsApi: {
    listTeams: (...a: unknown[]) => mocks.listTeams(...a),
  },
}));

vi.mock('@/components/dashboard/sections/chat/markdown-message', () => ({
  MarkdownMessage: ({ content }: { content: string }) => (
    <div data-testid="md">{content}</div>
  ),
}));

describe('ArtifactsSection（9/14 UX 对齐插件）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listProjects.mockResolvedValue({ projects: PROJECTS, total: PROJECTS.length });
    mocks.getProjectWorkflow.mockResolvedValue(workflowFixture());
    mocks.getTaskArtifactUrl.mockImplementation(
      (pid: string, tid: string, path?: string) =>
        `/api/agentteams/projects/${encodeURIComponent(pid)}/tasks/${encodeURIComponent(tid)}/artifact${path ? `?path=${encodeURIComponent(path)}` : ''}`,
    );
    mocks.listTeams.mockResolvedValue([]);
    mocks.fetch.mockImplementation((_url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'text/markdown' },
        blob: async () => ({
          size: 10,
          text: async () => '# hello md',
        }),
      }) as unknown as Promise<Response>,
    );
    vi.stubGlobal('fetch', mocks.fetch);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('① 时间排序：无时间戳项目按 project_id 内嵌日期兜底（0914 在 0901 前）', async () => {
    render(<ArtifactsSection />);
    const b = await screen.findByTitle('B 项目');
    expect(screen.getByTitle('A 项目')).toBeInTheDocument();
    // 默认 时间 新→旧：0914 的 B 在 0901 的 A 之前
    expect(
      b.compareDocumentPosition(screen.getByTitle('A 项目')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('⑤ 类型分类节点带计数，点击按 kind 过滤（自动预取后计数 = 全部项目）', async () => {
    render(<ArtifactsSection />);
    // 自动预取：两个项目的产物无需手动展开即已加载
    await waitFor(() => {
      expect(mocks.getProjectWorkflow).toHaveBeenCalledTimes(2);
    });
    // 「图片」现有多处（右栏文件行也有 kind 徽章）——取树分类节点（非 badge）
    const treeNode = (await screen.findAllByText('图片')).find(
      (el) => el.closest('[data-slot="badge"]') === null,
    ) as HTMLElement;
    fireEvent.click(treeNode);
    // 两个项目各一个 pic.png → 图片过滤后右栏 2 条
    expect((await screen.findAllByText('pic.png')).length).toBe(2);
    await waitFor(() => {
      expect(screen.queryByText('report.md')).not.toBeInTheDocument();
    });
    // 树分类行计数角标（图片/数据 各 2，两项目合计）
    for (const label of ['图片', '数据']) {
      const treeRow = screen
        .getAllByText(label)
        .find((el) => el.textContent === label);
      expect(treeRow?.closest('div')?.textContent).toContain('2');
    }
  });

  it('⑥ 分类自动加载：项目列表就绪后自动拉全部项目（无需展开），展开不重拉', async () => {
    render(<ArtifactsSection />);
    await screen.findByText('B 项目');
    await waitFor(() => {
      expect(mocks.getProjectWorkflow).toHaveBeenCalledTimes(2);
    });
    // 分类计数 = 两项目合计（文档 4：report.md×2 + result.md×2）
    const treeRow = screen
      .getAllByText('文档')
      .find((el) => el.textContent === '文档');
    expect(treeRow?.closest('div')?.textContent).toContain('4');
    // 展开项目 = 缓存命中，不重复拉取
    fireEvent.click(screen.getAllByLabelText('展开')[0]);
    await screen.findByText('t1');
    expect(mocks.getProjectWorkflow).toHaveBeenCalledTimes(2);
  });

  it('② 点文件行直接开预览（不再只选中）', async () => {
    render(<ArtifactsSection />);
    fireEvent.click(await screen.findByText('B 项目'));
    fireEvent.click(await screen.findByText('report.md'));
    await waitFor(() => {
      expect(mocks.fetch).toHaveBeenCalled();
      const url = (mocks.fetch.mock.calls[0] as unknown[])[0] as string;
      expect(url).toBe(
        '/api/agentteams/projects/proj-20260914-bbb/tasks/t1/artifact?path=docs%2Freport.md',
      );
    });
    await screen.findByText('report.md — 预览');
  });

  it('③ 面包屑回上级：任务 → 项目 → 全部产物', async () => {
    render(<ArtifactsSection />);
    // 等项目列表就绪，再展开 B 项目（chevron，不改选中）→ 任务行出现
    await screen.findByText('B 项目');
    fireEvent.click(screen.getAllByLabelText('展开')[0]);
    const taskRow = await screen.findByText('t1');
    fireEvent.click(taskRow);
    // 任务层：面包屑出现「B 项目」段（可点）与 active「t1」段
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'B 项目' }).length).toBeGreaterThanOrEqual(1);
    });
    // 点面包屑「B 项目」回项目层
    const projBtns = screen.getAllByRole('button', { name: 'B 项目' });
    const clickable = projBtns.find((b) => !b.hasAttribute('disabled'));
    expect(clickable).toBeTruthy();
    fireEvent.click(clickable as HTMLButtonElement);
    await waitFor(() => {
      // 任务段消失
      expect(screen.queryByRole('button', { name: 't1' })).not.toBeInTheDocument();
    });
    // 点面包屑「全部产物」回根
    const rootBtns = screen.getAllByRole('button', { name: '全部产物' });
    const rootClickable = rootBtns.find((b) => !b.hasAttribute('disabled'));
    expect(rootClickable).toBeTruthy();
    fireEvent.click(rootClickable as HTMLButtonElement);
    await waitFor(() => {
      // 回根后面包屑「全部产物」段变 active（disabled）
      const rootBtns = screen.getAllByRole('button', { name: '全部产物' });
      expect(rootBtns.length).toBeGreaterThanOrEqual(1);
      expect(rootBtns.some((b) => b.hasAttribute('disabled'))).toBe(true);
    });
  });

  it('④ 预览框加宽：DialogContent 带 sm:max-w-5xl', async () => {
    render(<ArtifactsSection />);
    fireEvent.click(await screen.findByText('B 项目'));
    fireEvent.click(await screen.findByText('report.md'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.className).toContain('sm:max-w-5xl');
    expect((await screen.findByTestId('md')).textContent).toBe('# hello md');
  });
});

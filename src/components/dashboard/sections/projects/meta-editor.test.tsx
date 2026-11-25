import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { MetaApiError } from '@/lib/meta-api';
import { MetaEditorEntry } from './meta-editor';

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <>{children}</> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/agentteams-api', () => ({
  agentteamsApi: {
    getProjectMeta: vi.fn(),
    getTaskMeta: vi.fn(),
    saveProjectMeta: vi.fn(),
    saveTaskMeta: vi.fn(),
  },
}));

import { toast } from 'sonner';
import { agentteamsApi } from '@/lib/agentteams-api';

const getProjectMeta = vi.mocked(agentteamsApi.getProjectMeta);
const saveProjectMeta = vi.mocked(agentteamsApi.saveProjectMeta);
const getTaskMeta = vi.mocked(agentteamsApi.getTaskMeta);

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  cleanup();
});

function openEditor(id: string, title = '项目 P') {
  render(<MetaEditorEntry kind="project" id={id} title={title} />);
  fireEvent.click(screen.getByRole('button', { name: /编辑 meta/ }));
}

describe('MetaEditorEntry / MetaEditorModal', () => {
  it('GET 405（老 Controller）→ 静默关闭并隐藏入口', async () => {
    getProjectMeta.mockRejectedValueOnce(new MetaApiError('HTTP 405', 405, '/projects/p-405/meta'));

    openEditor('p-405');

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /编辑 meta/ })).toBeNull();
    });
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('GET 空 meta 显示 {}，并展示 ETag', async () => {
    getProjectMeta.mockResolvedValueOnce({ raw: '  ', etag: 'W/"e1"' });

    openEditor('p-empty');

    const textarea = await screen.findByLabelText('项目 meta JSON');
    expect(textarea).toHaveValue('{}');
    expect(screen.getByText(/ETag: W\/"e1"/)).toBeInTheDocument();
  });

  it('保存走 PUT + If-Match，成功后 toast + 刷新（onSaved）', async () => {
    getProjectMeta.mockResolvedValueOnce({ raw: '{"a":1}', etag: 'W/"v1"' });
    saveProjectMeta.mockResolvedValueOnce({ raw: '{"a":2}', etag: 'W/"v2"' });
    const onSaved = vi.fn();

    render(<MetaEditorEntry kind="project" id="p-save" title="项目 P" onSaved={onSaved} />);
    fireEvent.click(screen.getByRole('button', { name: /编辑 meta/ }));

    const textarea = await screen.findByLabelText('项目 meta JSON');
    expect(textarea).toHaveValue('{\n  "a": 1\n}');
    fireEvent.change(textarea, { target: { value: '{"a":2}' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(saveProjectMeta).toHaveBeenCalledWith('p-save', '{"a":2}', 'W/"v1"'),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith('meta 已保存');
  });

  it('409 → 保留编辑内容 + 提示「已被他人修改」，覆盖时用新 ETag 重发', async () => {
    getProjectMeta
      .mockResolvedValueOnce({ raw: '{"a":1}', etag: 'W/"v1"' })
      .mockResolvedValueOnce({ raw: '{"a":9}', etag: 'W/"v9"' });
    saveProjectMeta
      .mockRejectedValueOnce(new MetaApiError('HTTP 409: conflict', 409, '/x', 'conflict'))
      .mockResolvedValueOnce({ raw: '{}', etag: 'W/"v10"' });

    openEditor('p-conflict');

    const textarea = await screen.findByLabelText('项目 meta JSON');
    fireEvent.change(textarea, { target: { value: '{"mine":true}' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await screen.findByText(/已被他人修改/);
    // 冲突自动重读只换 ETag，不覆盖用户文本。
    await waitFor(() =>
      expect(screen.getByLabelText('项目 meta JSON')).toHaveValue('{"mine":true}'),
    );
    expect(screen.getByText(/ETag: W\/"v9"/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '覆盖' }));

    await waitFor(() =>
      expect(saveProjectMeta).toHaveBeenLastCalledWith('p-conflict', '{"mine":true}', 'W/"v9"'),
    );
  });

  it('非法 JSON 行内报错并禁止保存', async () => {
    getProjectMeta.mockResolvedValueOnce({ raw: '{}', etag: 'W/"v1"' });

    openEditor('p-invalid');

    const textarea = await screen.findByLabelText('项目 meta JSON');
    fireEvent.change(textarea, { target: { value: '{bad' } });

    expect(screen.getByText('不是合法 JSON，无法保存')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    expect(saveProjectMeta).not.toHaveBeenCalled();
  });

  it('数组 / 标量同样拒绝保存', async () => {
    getProjectMeta.mockResolvedValueOnce({ raw: '{}', etag: 'W/"v1"' });

    openEditor('p-array');

    const textarea = await screen.findByLabelText('项目 meta JSON');
    fireEvent.change(textarea, { target: { value: '[1,2]' } });

    expect(screen.getByText('meta 必须是 JSON 对象（不接受数组/标量）')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
  });

  it('任务 meta 使用 getTaskMeta / saveTaskMeta 并透传 teamId', async () => {
    getTaskMeta.mockResolvedValueOnce({ raw: '{}', etag: 'W/"t1"' });
    vi.mocked(agentteamsApi.saveTaskMeta).mockResolvedValueOnce({
      raw: '{"x":1}',
      etag: 'W/"t2"',
    });

    render(<MetaEditorEntry kind="task" id="task-1" title="T1" teamId="biz-team" />);
    fireEvent.click(screen.getByRole('button', { name: /编辑 meta/ }));

    await screen.findByLabelText('任务 meta JSON');
    expect(getTaskMeta).toHaveBeenCalledWith('task-1', 'biz-team');

    fireEvent.change(screen.getByLabelText('任务 meta JSON'), {
      target: { value: '{"x":1}' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(agentteamsApi.saveTaskMeta).toHaveBeenCalledWith(
        'task-1',
        '{"x":1}',
        'W/"t1"',
        'biz-team',
      ),
    );
  });
});

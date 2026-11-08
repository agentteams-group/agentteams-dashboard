import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ApiError } from '@/lib/api-error';
import { humanFilesApi } from '@/lib/human-files-api';
import type { HumanConfigRecord } from '@/lib/agentteams-api';
import { HumanWorkspaceAccessDialog } from './human-workspace-access-dialog';

const record: HumanConfigRecord = {
  name: 'alice',
  displayName: 'Alice',
  phase: 'Active',
  permissionLevel: 2,
  matrixUserID: '@alice:owned.test',
  initialPassword: '',
  rooms: [],
  message: '',
  workspaceAccess: {
    grants: [{ team: 'team-a', paths: ['files/shared/**'], mode: 'read' }],
  },
};

function renderDialog(canManage = true) {
  const onOpenChange = vi.fn();
  render(
    <HumanWorkspaceAccessDialog
      open
      humanName="alice"
      record={record}
      teamNames={['team-a', 'team-b']}
      defaultTeams={['team-a']}
      canManage={canManage}
      onOpenChange={onOpenChange}
      onSaved={() => {}}
    />,
  );
  return { onOpenChange };
}

beforeEach(() => {
  vi.spyOn(humanFilesApi, 'listDirectory').mockImplementation(async (_name, dir = '') => {
    if (dir === '') {
      return {
        path: '',
        entries: [
          { name: 'docs', type: 'directory', size: 0 },
          { name: 'readme.md', type: 'file', size: 10 },
        ],
      };
    }
    return { path: dir, entries: [] };
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('HumanWorkspaceAccessDialog 浏览目录', () => {
  it('浏览… → 目录树 → 选择填入当前输入行 → 添加成规则路径', async () => {
    renderDialog();
    expect(screen.getByRole('button', { name: '浏览目录' })).toHaveClass('min-h-11');

    fireEvent.click(screen.getByRole('button', { name: '浏览目录' }));
    fireEvent.click(await screen.findByRole('treeitem', { name: 'docs' }));

    const input = screen.getByLabelText('添加路径') as HTMLInputElement;
    await waitFor(() => expect(input).toHaveValue('files/docs'));

    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    expect(screen.getByText('files/docs')).toBeInTheDocument();
    expect(input).toHaveValue('');
  });

  it('重复路径 → 行内提示，不重复添加', async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('添加路径'), {
      target: { value: 'files/shared/**' },
    });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('该路径已在列表中');
    expect(screen.getAllByText('files/shared/**')).toHaveLength(1);
  });

  it('非法路径 → 行内提示（files/ 前缀 / 绝对路径）', async () => {
    renderDialog();
    const input = screen.getByLabelText('添加路径');
    fireEvent.change(input, { target: { value: '/etc/passwd' } });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('不能用绝对路径');

    fireEvent.change(input, { target: { value: 'docs/**' } });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('路径必须在 files/ 下');
  });

  it('403 降级：提示目录列表不可用，手动输入仍可保存', async () => {
    vi.spyOn(humanFilesApi, 'listDirectory').mockRejectedValue(
      new ApiError('forbidden', 403, '/api/agentteams/humans/alice/files'),
    );
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: '浏览目录' }));
    expect(await screen.findByText('目录列表不可用')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(screen.queryByText('目录列表不可用')).not.toBeInTheDocument());

    const input = screen.getByLabelText('添加路径') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'files/manual/**' } });
    expect(input).toHaveValue('files/manual/**');
    fireEvent.click(screen.getByRole('button', { name: '添加' }));

    expect(screen.getByText('files/manual/**')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { HumanResponse } from '@/lib/agentteams-api';
import { HumanAccessDialog } from './human-access-dialog';

const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock('@/hooks/use-agentteams-mutations', () => ({
  useUpdateHuman: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <>{children}</> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

// shadcn Select → 原生 select（MemberPicker 不传 value，选中后靠重挂载复位）
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value?: string;
    onValueChange: (_v: string) => void;
    disabled?: boolean;
    children: React.ReactNode;
  }) => (
    <select value={value} disabled={disabled} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
}));

const baseHuman: HumanResponse = {
  name: 'alice',
  phase: 'Active',
  displayName: 'Alice',
  matrixUserID: '@alice:node1',
  initialPassword: '',
  rooms: [],
  message: '',
  permissionLevel: 2,
  accessibleTeams: ['team-a'],
  accessibleWorkers: [],
};

function renderDialog(props?: {
  human?: HumanResponse;
  teamNames?: string[];
  workerNames?: string[];
  teamsLoading?: boolean;
  teamsError?: boolean;
  canManage?: boolean;
  onRetryTeams?: () => void;
}) {
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <HumanAccessDialog
      open
      human={props?.human ?? baseHuman}
      record={null}
      teamNames={props?.teamNames ?? ['team-a', 'team-b']}
      workerNames={props?.workerNames ?? ['w-a']}
      teamsLoading={props?.teamsLoading}
      teamsError={props?.teamsError}
      onRetryTeams={props?.onRetryTeams}
      canManage={props?.canManage ?? true}
      onOpenChange={onOpenChange}
      onSaved={onSaved}
    />,
  );
  return { onSaved, onOpenChange };
}

/** DOM 顺序：权限档位 / 可访问团队 / 可访问 Workers。 */
function teamSelect(): HTMLSelectElement {
  return document.querySelectorAll('select')[1] as HTMLSelectElement;
}

function teamOptions(): string[] {
  return Array.from(teamSelect().options).map((option) => option.value);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('HumanAccessDialog 可访问团队候选选择器', () => {
  it('候选来自团队列表；无逗号手输入口', () => {
    renderDialog();
    expect(teamOptions()).toEqual(['team-b']);
    expect(screen.getByRole('button', { name: '移除 team-a' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/逗号分隔/)).toBeNull();
  });

  it('选择 → chip；保存请求体仍是 accessibleTeams', async () => {
    mocks.mutateAsync.mockResolvedValue(undefined);
    const { onSaved } = renderDialog();

    fireEvent.change(teamSelect(), { target: { value: 'team-b' } });
    expect(screen.getByRole('button', { name: '移除 team-b' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        name: 'alice',
        data: {
          permissionLevel: 2,
          accessibleTeams: ['team-a', 'team-b'],
          accessibleWorkers: [],
        },
      }),
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('去重：已选项不再进候选，chip 不会重复', () => {
    renderDialog();
    // team-a 已选 → 候选中只有 team-b。
    expect(teamOptions()).toEqual(['team-b']);
    fireEvent.change(teamSelect(), { target: { value: 'team-b' } });
    expect(screen.getAllByRole('button', { name: '移除 team-a' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '移除 team-b' })).toHaveLength(1);
    expect(screen.getByText('已选全部可访问团队')).toBeInTheDocument();
  });

  it('悬空团队保留可见警告，移除后才可保存（请求发 []）', async () => {
    mocks.mutateAsync.mockResolvedValue(undefined);
    renderDialog({ human: { ...baseHuman, accessibleTeams: ['ghost-team'] }, teamNames: ['team-a'] });

    expect(screen.getByRole('alert')).toHaveTextContent(/以下团队不存在或不可用/);
    expect(screen.getByRole('alert')).toHaveTextContent('ghost-team');
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '移除不可用团队' }));
    expect(screen.queryByText(/以下团队不存在或不可用/)).toBeNull();

    const save = screen.getByRole('button', { name: '保存' });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() =>
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        name: 'alice',
        data: { permissionLevel: 2, accessibleTeams: [], accessibleWorkers: [] },
      }),
    );
  });

  it('团队加载失败 → 降级提示 + 重试；已有值不清空、不误判悬空', async () => {
    mocks.mutateAsync.mockResolvedValue(undefined);
    const onRetryTeams = vi.fn();
    renderDialog({ teamNames: [], teamsError: true, onRetryTeams });

    expect(screen.getByRole('alert')).toHaveTextContent(/团队列表加载失败/);
    expect(screen.getByRole('button', { name: '移除 team-a' })).toBeInTheDocument();
    expect(screen.queryByText(/以下团队不存在或不可用/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /重试加载团队/ }));
    expect(onRetryTeams).toHaveBeenCalledTimes(1);

    // 加载失败不阻断保存：改权限档位即可保存，accessibleTeams 原样保留。
    fireEvent.change(document.querySelectorAll('select')[0], { target: { value: '3' } });
    const save = screen.getByRole('button', { name: '保存' });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() =>
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        name: 'alice',
        data: { permissionLevel: 3, accessibleTeams: ['team-a'], accessibleWorkers: [] },
      }),
    );
  });

  it('403 只读：保存禁用且给出提示', () => {
    renderDialog({ canManage: false });
    expect(screen.getByText(/只读（403）/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
  });
});

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import {
  HumanEditDialog,
  buildHumanUpdatePayload,
  type HumanEditDraft,
} from './human-edit-dialog';
import type { HumanResponse } from '@/lib/agentteams-api';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { TeamCandidateSource } from './team-access-field';

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <>{children}</> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

// shadcn Select → 原生 select（value 可选：MemberPicker 不传 value）
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange: (_v: string) => void;
    children: React.ReactNode;
  }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>
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
  accessibleTeams: ['biz-team'],
  accessibleWorkers: ['w1'],
};

const draft = (overrides: Partial<HumanEditDraft> = {}): HumanEditDraft => ({
  displayName: baseHuman.displayName,
  email: '',
  permissionLevel: 2,
  accessibleTeams: 'biz-team',
  accessibleWorkers: 'w1',
  note: '',
  ...overrides,
});

const renderDialog = (props?: {
  human?: HumanResponse | null;
  teams?: string[];
  workers?: string[];
  teamSource?: TeamCandidateSource;
  isPending?: boolean;
}) => {
  const onSubmit = vi.fn((_payload?: unknown) => {});
  const human = props?.human ?? baseHuman;
  const teams = props?.teams ?? ['biz-team'];
  const workers = props?.workers ?? ['w1'];
  const isPending = props?.isPending ?? false;
  const result = render(
    <TooltipProvider>
      <HumanEditDialog
        human={human}
        teams={teams}
        workers={workers}
        teamSource={props?.teamSource}
        isPending={isPending}
        onOpenChange={() => {}}
        onSubmit={onSubmit}
      />
    </TooltipProvider>,
  );
  return { onSubmit, container: result.container };
};

describe('buildHumanUpdatePayload (merge-patch diff, #1209 semantics)', () => {
  it('unchanged draft → empty payload (nothing sent, nothing clobbered)', () => {
    expect(buildHumanUpdatePayload(baseHuman, draft())).toEqual({});
  });

  it('changed level → only the level key', () => {
    expect(buildHumanUpdatePayload(baseHuman, draft({ permissionLevel: 3 }))).toEqual({
      permissionLevel: 3,
    });
  });

  it('cleared teams → explicit empty list (present = clear, not unchanged)', () => {
    expect(buildHumanUpdatePayload(baseHuman, draft({ accessibleTeams: '' }))).toEqual({
      accessibleTeams: [],
    });
  });

  it('whitespace/separator differences are not changes (parsed comparison)', () => {
    expect(buildHumanUpdatePayload(baseHuman, draft({ accessibleTeams: ' biz-team ,  ' }))).toEqual({});
  });

  it('missing level defaults to 2 (团队成员) — draft 2 → no diff', () => {
    const { permissionLevel: _drop, ...rest } = baseHuman;
    const noLevel = rest as HumanResponse;
    expect(buildHumanUpdatePayload(noLevel, draft({ permissionLevel: 2 }))).toEqual({});
  });

  it('missing level defaults to 2 — draft 1 (管理员) → explicit change', () => {
    const { permissionLevel: _drop, ...rest } = baseHuman;
    const noLevel = rest as HumanResponse;
    expect(buildHumanUpdatePayload(noLevel, draft({ permissionLevel: 1 }))).toEqual({
      permissionLevel: 1,
    });
  });
});

describe('HumanEditDialog', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('missing team → red warning and save blocked (pre-flight for the server 400)', () => {
    renderDialog({ human: { ...baseHuman, accessibleTeams: ['ghost-team'] }, teams: ['biz-team'] });
    expect(screen.getByText(/以下团队不存在/)).toHaveTextContent('ghost-team');
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
  });

  it('missing worker → red warning and save blocked', () => {
    renderDialog({
      human: { ...baseHuman, accessibleWorkers: ['ghost-w'] },
      workers: ['w1'],
    });
    expect(screen.getByText(/以下 Workers 不存在/)).toHaveTextContent('ghost-w');
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
  });

  it('no changes → save disabled', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    expect(screen.getByLabelText('权限等级说明')).toBeInTheDocument();
  });

  it('level select offers the controller-correct labels (1=管理员 2=团队成员 3=Worker)', () => {
    const { container } = renderDialog();
    const levelSelect = container.querySelectorAll('select')[0] as HTMLSelectElement;
    const labels = Array.from(levelSelect.options).map((o) => o.textContent);
    expect(labels).toEqual(['1 - 管理员', '2 - 团队成员', '3 - Worker']);
  });

  it('level change → save enabled, onSubmit receives the minimal diff', () => {
    const { onSubmit, container } = renderDialog();
    const levelSelect = container.querySelectorAll('select')[0] as HTMLSelectElement;
    fireEvent.change(levelSelect, { target: { value: '3' } });
    const save = screen.getByRole('button', { name: '保存' });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(onSubmit).toHaveBeenCalledWith({ permissionLevel: 3 });
  });

  it('team picker: select → chip appears, payload is the changed list only', () => {
    const { onSubmit, container } = renderDialog({
      human: { ...baseHuman, accessibleTeams: [], accessibleWorkers: [] },
      teams: ['biz-team', 'ops-team'],
      workers: ['w1', 'w2'],
    });
    // DOM 顺序：权限等级 / 可访问团队 / 可访问 Workers
    const teamPicker = container.querySelectorAll('select')[1] as HTMLSelectElement;
    expect(Array.from(teamPicker.options).map((o) => o.value)).toEqual(['biz-team', 'ops-team']);

    fireEvent.change(teamPicker, { target: { value: 'ops-team' } });
    // chip 出现 = 有"移除 ops-team"按钮（option 里也有同名文本，不直接用 getByText）
    expect(screen.getByRole('button', { name: '移除 ops-team' })).toBeInTheDocument();

    const save = screen.getByRole('button', { name: '保存' });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(onSubmit).toHaveBeenCalledWith({ accessibleTeams: ['ops-team'] });
  });

  it('team picker: chip × removes the member', () => {
    const { container } = renderDialog({
      human: { ...baseHuman, accessibleTeams: [], accessibleWorkers: [] },
      teams: ['biz-team', 'ops-team'],
      workers: ['w1', 'w2'],
    });
    const teamPicker = container.querySelectorAll('select')[1] as HTMLSelectElement;
    fireEvent.change(teamPicker, { target: { value: 'ops-team' } });
    expect(screen.getByRole('button', { name: '移除 ops-team' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '移除 ops-team' }));
    expect(screen.queryByRole('button', { name: '移除 ops-team' })).toBeNull();
  });

  it('picker offers only existing names — ghost can never be selected', () => {
    const { container } = renderDialog({
      human: { ...baseHuman, accessibleTeams: [], accessibleWorkers: [] },
      teams: ['biz-team'],
      workers: ['w1'],
    });
    const selects = container.querySelectorAll('select');
    for (const select of selects) {
      for (const option of Array.from((select as HTMLSelectElement).options)) {
        expect(option.value).not.toBe('ghost');
      }
    }
  });

  it('消除悬空团队：移除不可用团队 → chip 清除，保存发空列表（显式清空）', () => {
    const { onSubmit } = renderDialog({
      human: { ...baseHuman, accessibleTeams: ['ghost-team'], accessibleWorkers: [] },
      teams: ['biz-team'],
    });

    expect(screen.getByRole('alert')).toHaveTextContent('ghost-team');
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '移除不可用团队' }));
    expect(screen.queryByRole('button', { name: '移除 ghost-team' })).toBeNull();
    expect(screen.queryByText(/以下团队不存在/)).toBeNull();

    const save = screen.getByRole('button', { name: '保存' });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(onSubmit).toHaveBeenCalledWith({ accessibleTeams: [] });
  });

  it('团队列表加载失败 → 保留已有 chip、不误判悬空、可重试', () => {
    const onRetry = vi.fn();
    const { onSubmit } = renderDialog({
      human: { ...baseHuman, accessibleTeams: ['ghost-team'], accessibleWorkers: [] },
      teams: [],
      teamSource: { names: [], isError: true, onRetry },
    });

    expect(screen.getByRole('alert')).toHaveTextContent(/团队列表加载失败/);
    expect(screen.getByRole('button', { name: '移除 ghost-team' })).toBeInTheDocument();
    expect(screen.queryByText(/以下团队不存在/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /重试加载团队/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    // 列表不可读期间不做悬空拦截：改档位即可保存，团队字段原样不动。
    fireEvent.change(document.querySelectorAll('select')[0], { target: { value: '3' } });
    const save = screen.getByRole('button', { name: '保存' });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(onSubmit).toHaveBeenCalledWith({ permissionLevel: 3 });
  });
});

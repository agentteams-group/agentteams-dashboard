import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { CreateHumanRequest } from '@/lib/agentteams-api';
import { HumanCreateDialog } from './human-create-dialog';
import type { TeamCandidateSource } from './team-access-field';

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <>{children}</> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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

const candidateSource = (
  overrides: Partial<TeamCandidateSource> = {},
): TeamCandidateSource => ({
  names: ['biz-team', 'ops-team'],
  isLoading: false,
  isError: false,
  ...overrides,
});

function Harness({
  source,
  initial,
}: {
  source: TeamCandidateSource;
  initial?: Partial<CreateHumanRequest>;
}) {
  const [value, setValue] = useState<CreateHumanRequest>({
    name: 'alice',
    displayName: 'Alice',
    permissionLevel: 2,
    ...initial,
  });
  return (
    <>
      <HumanCreateDialog
        open
        value={value}
        onChange={setValue}
        isPending={false}
        teamSource={source}
        onOpenChange={() => {}}
        onSubmit={() => {}}
      />
      <div data-testid="draft">{JSON.stringify({ accessibleTeams: value.accessibleTeams })}</div>
    </>
  );
}

function draftTeams(): unknown {
  return JSON.parse(screen.getByTestId('draft').textContent ?? '{}').accessibleTeams;
}

/** DOM 顺序：权限等级 / 可访问团队。Workers 仍是文本框。 */
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

describe('HumanCreateDialog 可访问团队候选选择器', () => {
  it('渲染候选团队，不再是逗号手输框', () => {
    render(<Harness source={candidateSource()} />);

    expect(teamOptions()).toEqual(['biz-team', 'ops-team']);
    expect(screen.queryByPlaceholderText('team1, team2, team3')).toBeNull();
    expect(screen.queryByLabelText(/可访问团队（逗号分隔）/)).toBeNull();
    expect(screen.getByText('可访问团队')).toBeInTheDocument();
  });

  it('选择 → chip + accessibleTeams；候选项排除已选（去重）', () => {
    render(<Harness source={candidateSource()} />);

    fireEvent.change(teamSelect(), { target: { value: 'ops-team' } });

    expect(screen.getByRole('button', { name: '移除 ops-team' })).toBeInTheDocument();
    expect(teamOptions()).toEqual(['biz-team']);
    expect(draftTeams()).toEqual(['ops-team']);

    fireEvent.change(teamSelect(), { target: { value: 'biz-team' } });
    expect(draftTeams()).toEqual(['ops-team', 'biz-team']);
    expect(screen.getAllByRole('button', { name: /^移除 / })).toHaveLength(2);
    // 两项都已选完 → 不再有第三个同名候选，重复添加在输入层不可能。
    expect(screen.getByText('已选全部可访问团队')).toBeInTheDocument();
  });

  it('移除 chip → 回到候选，值清空', () => {
    render(<Harness source={candidateSource()} />);

    fireEvent.change(teamSelect(), { target: { value: 'ops-team' } });
    fireEvent.click(screen.getByRole('button', { name: '移除 ops-team' }));

    expect(screen.queryByRole('button', { name: '移除 ops-team' })).toBeNull();
    expect(teamOptions()).toEqual(['biz-team', 'ops-team']);
    expect(draftTeams()).toBeUndefined();
  });

  it('团队加载失败 → 可见降级态 + 重试；已有值保留且不误判悬空', () => {
    const onRetry = vi.fn();
    render(
      <Harness
        initial={{ accessibleTeams: ['legacy-team'] }}
        source={candidateSource({ names: [], isError: true, onRetry })}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/团队列表加载失败/);
    expect(screen.getByRole('button', { name: '移除 legacy-team' })).toBeInTheDocument();
    expect(screen.queryByText(/以下团队不存在/)).toBeNull();
    expect(draftTeams()).toEqual(['legacy-team']);

    fireEvent.click(screen.getByRole('button', { name: /重试加载团队/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('团队为空（已加载）→ 明确空态，而不是逗号手输兜底', () => {
    render(<Harness source={candidateSource({ names: [] })} />);
    expect(screen.getByText('暂无可选团队（先在团队页创建）')).toBeInTheDocument();
  });

  it('团队加载中 → 可见加载态', () => {
    render(<Harness source={candidateSource({ names: [], isLoading: true })} />);
    expect(screen.getByText('加载中…')).toBeInTheDocument();
  });

  it('44px：chip 移除按钮与重试按钮保持触控命中区', () => {
    render(
      <Harness
        initial={{ accessibleTeams: ['legacy-team'] }}
        source={candidateSource({ names: [], isError: true, onRetry: vi.fn() })}
      />,
    );
    expect(screen.getByRole('button', { name: '移除 legacy-team' })).toHaveClass('size-11');
    expect(screen.getByRole('button', { name: /重试加载团队/ })).toHaveClass('min-h-11');
  });
});

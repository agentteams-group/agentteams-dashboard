import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const mocks = vi.hoisted(() => ({
  useCodingRuns: vi.fn(),
  getCodingRunLog: vi.fn(),
}));

vi.mock('@/hooks/use-coding-runs', () => ({
  useCodingRuns: (...a: unknown[]) => mocks.useCodingRuns(...a),
}));

vi.mock('@/lib/agentteams-api', () => {
  return {
    agentteamsApi: {
      getCodingRunLog: (...a: unknown[]) => mocks.getCodingRunLog(...a),
    },
  };
});

import { ApiError } from '@/lib/api-error';
import { CodingRunsSection } from './coding-runs-section';

function queryResult(overrides: Record<string, unknown> = {}) {
  return {
    data: [],
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

describe('CodingRunsSection（#146 缺口 2）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCodingRunLog.mockResolvedValue('log line 1\nlog line 2\n');
  });

  afterEach(() => cleanup());

  it('渲染列表并把 run 文件名解析成时间', () => {
    mocks.useCodingRuns.mockReturnValue(
      queryResult({
        data: [{ task_id: 't1', run: 'run-20261015-131415.log', team: 'alpha' }],
      }),
    );
    render(<CodingRunsSection />);
    expect(screen.getByText('2026-10-15 13:14:15')).toBeInTheDocument();
    expect(screen.getByText('t1')).toBeInTheDocument();
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('run-20261015-131415.log')).toBeInTheDocument();
  });

  it('点查看日志拉取并展示原始日志', async () => {
    mocks.useCodingRuns.mockReturnValue(
      queryResult({
        data: [{ task_id: 't1', run: 'run-20261015-131415.log', team: 'alpha' }],
      }),
    );
    render(<CodingRunsSection />);
    fireEvent.click(screen.getByRole('button', { name: /查看日志/ }));
    await waitFor(() => expect(mocks.getCodingRunLog).toHaveBeenCalledWith('t1', 'run-20261015-131415.log', 'alpha'));
    expect(await screen.findByText(/log line 1/)).toBeInTheDocument();
  });

  it('空列表展示空态', () => {
    mocks.useCodingRuns.mockReturnValue(queryResult({ data: [] }));
    render(<CodingRunsSection />);
    expect(screen.getByText('暂无编码执行记录。')).toBeInTheDocument();
  });

  it('404 展示未部署占位', () => {
    mocks.useCodingRuns.mockReturnValue(
      queryResult({ error: new ApiError('not found', 404, '/coding-runs') }),
    );
    render(<CodingRunsSection />);
    expect(screen.getByText(/未提供编码执行记录/)).toBeInTheDocument();
  });

  it('其它错误展示错误信息', () => {
    mocks.useCodingRuns.mockReturnValue(
      queryResult({ error: new ApiError('boom', 500, '/coding-runs') }),
    );
    render(<CodingRunsSection />);
    expect(screen.getByText('boom')).toBeInTheDocument();
  });
});

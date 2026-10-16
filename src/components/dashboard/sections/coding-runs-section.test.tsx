import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const mocks = vi.hoisted(() => ({
  useCodingRuns: vi.fn(),
  getCodingRunView: vi.fn(),
}));

vi.mock('@/hooks/use-coding-runs', () => ({
  useCodingRuns: (...a: unknown[]) => mocks.useCodingRuns(...a),
}));

vi.mock('@/lib/agentteams-api', () => {
  return {
    agentteamsApi: {
      getCodingRunView: (...a: unknown[]) => mocks.getCodingRunView(...a),
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
    mocks.getCodingRunView.mockResolvedValue({
      detail: null,
      text: 'log line 1\nlog line 2\n',
    });
  });

  afterEach(() => cleanup());

  it('渲染 v1 列表项（无 v2 元数据）并把 run 文件名解析成时间', () => {
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

  it('渲染 v2 列表项（cli/worker/status/exit_code/size/started_at）', () => {
    mocks.useCodingRuns.mockReturnValue(
      queryResult({
        data: [
          {
            task_id: 't1',
            run: 'run-20261015-131415.log',
            team: 'alpha',
            cli: 'qwen',
            worker: 'sysdev-coder',
            status: 'ok',
            exit_code: 0,
            started_at: '2026-10-15T05:14:15Z',
            log_bytes: 2048,
          },
        ],
      }),
    );
    render(<CodingRunsSection />);
    expect(screen.getByText('qwen')).toBeInTheDocument();
    expect(screen.getByText('sysdev-coder')).toBeInTheDocument();
    expect(screen.getByText('成功')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
  });

  it('点查看日志拉取详情并展示结构化 meta 与原始日志', async () => {
    mocks.useCodingRuns.mockReturnValue(
      queryResult({
        data: [{ task_id: 't1', run: 'run-20261015-131415.log', team: 'alpha' }],
      }),
    );
    mocks.getCodingRunView.mockResolvedValue({
      detail: {
        task_id: 't1',
        run: 'run-20261015-131415.log',
        team: 'alpha',
        meta: { cli: 'qwen', worker: 'sysdev-coder', status: 'ok', exit_code: 0 },
        input: { prompt: 'do the thing', prompt_available: true },
        output: { transcript: 'log line 1\nlog line 2\n' },
      },
      text: 'log line 1\nlog line 2\n',
    });
    render(<CodingRunsSection />);
    fireEvent.click(screen.getByRole('button', { name: /查看日志/ }));
    await waitFor(() =>
      expect(mocks.getCodingRunView).toHaveBeenCalledWith(
        't1',
        'run-20261015-131415.log',
        'alpha',
      ),
    );
    expect(await screen.findByText('输入（Prompt）')).toBeInTheDocument();
    expect(screen.getByText('do the thing')).toBeInTheDocument();
    expect(screen.getByText('输出（原始日志）')).toBeInTheDocument();
    expect(screen.getByText(/log line 1/)).toBeInTheDocument();
  });

  it('详情降级：旧 Controller 返回 text/plain 时只展示原始日志', async () => {
    mocks.useCodingRuns.mockReturnValue(
      queryResult({
        data: [{ task_id: 't1', run: 'run-20261015-131415.log', team: 'alpha' }],
      }),
    );
    render(<CodingRunsSection />);
    fireEvent.click(screen.getByRole('button', { name: /查看日志/ }));
    await waitFor(() => expect(mocks.getCodingRunView).toHaveBeenCalled());
    expect(await screen.findByText('原始日志')).toBeInTheDocument();
    expect(screen.queryByText('输入（Prompt）')).not.toBeInTheDocument();
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

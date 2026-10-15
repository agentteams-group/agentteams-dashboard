import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const getWorker = vi.fn();
const updateWorker = vi.fn();
vi.mock('@/lib/agentteams-api', () => ({
  agentteamsApi: {
    getWorker: (...a: unknown[]) => getWorker(...a),
    updateWorker: (...a: unknown[]) => updateWorker(...a),
  },
}));

import { WorkerLlmTuningPanel } from './worker-llm-tuning-panel';

const input = (key: string) => document.getElementById(`llm-w1-${key}`) as HTMLInputElement;

describe('WorkerLlmTuningPanel（#146 缺口 3）', () => {
  beforeEach(() => {
    getWorker.mockReset();
    updateWorker.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('① 载入并回显当前值', async () => {
    getWorker.mockResolvedValue({ name: 'w1', llmMaxRetries: '5', llmMaxConcurrent: '20' });
    render(<WorkerLlmTuningPanel workerName="w1" />);
    await waitFor(() => expect(input('llmMaxRetries').value).toBe('5'));
    expect(input('llmMaxConcurrent').value).toBe('20');
    expect(input('llmStreamIdleTimeout').value).toBe('');
  });

  it('② 保存仅发字段级 diff', async () => {
    getWorker.mockResolvedValue({ name: 'w1', llmMaxRetries: '5' });
    updateWorker.mockResolvedValue({ name: 'w1', llmMaxRetries: '7' });
    render(<WorkerLlmTuningPanel workerName="w1" />);
    await waitFor(() => expect(input('llmMaxRetries').value).toBe('5'));
    fireEvent.change(input('llmMaxRetries'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: /保存改动/ }));
    await waitFor(() => expect(updateWorker).toHaveBeenCalledWith('w1', { llmMaxRetries: '7' }));
  });

  it('③ 非法输入 → 拦截保存并提示', async () => {
    getWorker.mockResolvedValue({ name: 'w1' });
    render(<WorkerLlmTuningPanel workerName="w1" />);
    await waitFor(() => expect(input('llmMaxRetries').value).toBe(''));
    fireEvent.change(input('llmMaxConcurrent'), { target: { value: '-1' } });
    expect(await screen.findByText(/须为非负数字/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /保存改动/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /保存改动/ }));
    expect(updateWorker).not.toHaveBeenCalled();
  });

  it('④ 清空字段 → diff 发送空串（清除回默认）', async () => {
    getWorker.mockResolvedValue({ name: 'w1', llmMaxRetries: '5' });
    updateWorker.mockResolvedValue({ name: 'w1' });
    render(<WorkerLlmTuningPanel workerName="w1" />);
    await waitFor(() => expect(input('llmMaxRetries').value).toBe('5'));
    fireEvent.change(input('llmMaxRetries'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /保存改动/ }));
    await waitFor(() => expect(updateWorker).toHaveBeenCalledWith('w1', { llmMaxRetries: '' }));
  });

  it('⑤ 载入失败 → 重试横幅', async () => {
    getWorker.mockRejectedValue(new Error('boom'));
    render(<WorkerLlmTuningPanel workerName="w1" />);
    expect(await screen.findByText(/boom/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MonitorPage } from './monitor-page';
import type { PluginDashboardServices } from '@/lib/plugins/types';
import type { RuntimeTarget } from '@/lib/runtime-monitoring';
import { TooltipProvider } from '@/components/ui/tooltip';

const target: RuntimeTarget = {
  kind: 'worker', name: 'dev-agent', model: 'qwen3.8-max', runtime: 'qwenpaw', availability: 'available',
  metrics: { state: 'running', cpuPercent: 0, memoryUsageBytes: 512 * 1024 ** 2, memoryLimitBytes: null, restartCount: 2, oomKilled: false, exitCode: 0, startedAt: '2026-11-14T00:00:00Z', sampledAt: '2026-11-14T01:00:00Z' },
};

function setup(items = [target]) {
  const getMonitoring = vi.fn().mockResolvedValue({ items, total: items.length, page: 1, totalPages: 1, limit: 12, mode: 'embedded', sampledAt: '2026-11-14T01:00:00Z' });
  const getMonitoringLogs = vi.fn().mockResolvedValue({ text: 'request started\nmodel timeout\n', truncated: true, tail: 300, sampledAt: '2026-11-14T01:00:00Z' });
  const dashboard = { getMonitoring, getMonitoringLogs } as unknown as PluginDashboardServices;
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><TooltipProvider><MonitorPage dashboard={dashboard} /></TooltipProvider></QueryClientProvider>);
  return { getMonitoring, getMonitoringLogs };
}

afterEach(cleanup);

describe('runtime monitoring', () => {
  it('shows actual zero CPU, memory and unlimited quota; queries logs on demand', async () => {
    const api = setup();
    expect(await screen.findByText('0.00%')).toBeInTheDocument();
    expect(screen.getByText('512.0 MiB')).toBeInTheDocument();
    expect(screen.getByText('配额未限制')).toBeInTheDocument();
    expect(api.getMonitoringLogs).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '查看 dev-agent 日志' }));
    expect(await screen.findByLabelText('容器日志内容')).toHaveTextContent('model timeout');
    expect(api.getMonitoringLogs).toHaveBeenCalledWith('worker', 'dev-agent', { tail: 300 });
    expect(screen.getByText(/内容已截断/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('筛选已加载日志'), { target: { value: 'timeout' } });
    expect(screen.getByLabelText('容器日志内容')).not.toHaveTextContent('request started');
    fireEvent.click(screen.getByRole('button', { name: '刷新日志' }));
    await waitFor(() => expect(api.getMonitoringLogs).toHaveBeenCalledTimes(2));
  });

  it('keeps missing data unavailable instead of showing zero', async () => {
    setup([{ ...target, availability: 'unsupported', metrics: null }]);
    expect(await screen.findByText('当前部署或外部 Agent 暂无容器数据源')).toBeInTheDocument();
    expect(screen.queryByText('0.00%')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看 dev-agent 日志' })).toBeDisabled();
  });

  it('searches through the Controller and displays query failures', async () => {
    const api = setup();
    await screen.findByText('512.0 MiB');
    api.getMonitoring.mockRejectedValue(new Error('HTTP 503'));
    fireEvent.change(screen.getByLabelText('搜索运行资源'), { target: { value: 'missing' } });
    await waitFor(() => expect(api.getMonitoring).toHaveBeenCalledWith({ page: 1, limit: 12, search: 'missing' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 503');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { WorkerRuntimeConfigSurface } from './worker-runtime-config-surface';

const surface = {
  runtime: 'openclaw',
  surfaceVersion: '1',
  faces: [
    {
      id: 'gateway',
      label: 'Gateway',
      fields: [
        { key: 'gateway.port', type: 'number', applies: 'restart', label: 'Gateway port' },
        { key: 'gateway.token', type: 'secret', applies: 'hot', sensitive: true, label: 'Gateway token' },
      ],
    },
    {
      id: 'models',
      label: 'Models',
      fields: [
        { key: 'models.default', type: 'string', applies: 'hot', label: 'Default model' },
        { key: 'models.retry_max', type: 'number', applies: 'hot', label: 'Retry max' },
      ],
    },
    { id: 'mcp', label: 'MCP', fields: [{ key: 'mcp.enabled', type: 'boolean', applies: 'hot', label: 'MCP enabled' }] },
  ],
};

type Config = {
  runtime: string;
  rev: string;
  values: Record<string, unknown>;
  applied: string;
  pendingRestart: string[];
};

function makeConfig(): Config {
  return {
    runtime: 'openclaw',
    rev: 'rev-1',
    values: {
      gateway: { port: 8080, token: '***' },
      models: { default: 'gpt' },
      mcp: { enabled: false },
    },
    applied: 'applied',
    pendingRestart: [],
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type FetchMock = ReturnType<typeof vi.fn>;

function installFetch(options: {
  config?: () => Config;
  surfaceStatus?: number;
  configStatus?: number;
  writeResult?: (_patch: Record<string, unknown>) => { status?: number; body: unknown };
}): FetchMock {
  const getConfig = options.config ?? makeConfig;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url.includes('/runtimes/openclaw/surface')) {
      return options.surfaceStatus && options.surfaceStatus !== 200
        ? json({ error: 'unknown runtime' }, options.surfaceStatus)
        : json(surface);
    }
    if (url.includes('/members/w1/config/rollback')) {
      return json({ ...getConfig(), rev: 'rev-rollback', applied: 'applied', pendingRestart: [] });
    }
    if (url.includes('/members/w1/config')) {
      if (method === 'PUT') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { patch: Record<string, unknown> };
        const next = getConfig();
        if (options.writeResult) {
          const result = options.writeResult(body.patch);
          return json(result.body, result.status ?? 200);
        }
        next.rev = 'rev-2';
        next.values = {
          ...next.values,
          gateway: { ...(next.values.gateway as object), ...((body.patch.gateway as object) ?? {}) },
        };
        return json({ ...next, unsupported: [], snapshot: {} });
      }
      if (options.configStatus && options.configStatus !== 200) {
        return json({ error: 'blocked' }, options.configStatus);
      }
      return json(getConfig());
    }
    if (url.includes('/runtime-config/restart')) {
      return json({ name: 'w1', phase: 'Running' });
    }
    return json({ error: 'not found' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderSurface(props: Partial<React.ComponentProps<typeof WorkerRuntimeConfigSurface>> = {}) {
  return render(
    <WorkerRuntimeConfigSurface
      workerName="w1"
      runtime="openclaw"
      canWrite
      {...props}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('WorkerRuntimeConfigSurface', () => {
  it('renders surface faces as tabs and supports search + advanced filtering', async () => {
    installFetch({});
    renderSurface();

    expect(await screen.findByLabelText('Gateway port')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '网关' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('搜索字段'), { target: { value: 'port' } });
    expect(screen.queryByRole('tab', { name: '模型' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Gateway port')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('搜索字段'), { target: { value: '' } });
    const modelsTab = screen.getByRole('tab', { name: '模型' });
    fireEvent.mouseDown(modelsTab, { button: 0 });
    fireEvent.click(modelsTab);
    expect(screen.getByLabelText('Default model')).toBeInTheDocument();
    expect(screen.queryByLabelText('Retry max')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch', { name: '显示高级字段' }));
    expect(screen.getByLabelText('Retry max')).toBeInTheDocument();
    expect(screen.getByText('4 个命中')).toBeInTheDocument();
  });

  it('sends only changed leaves with if-rev, then refetches and clears the change count', async () => {
    const fetchMock = installFetch({});
    renderSurface();

    const port = await screen.findByLabelText('Gateway port');
    fireEvent.change(port, { target: { value: '9090' } });
    expect(screen.getByText('已改 1 项')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /保存改动/ }));

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).includes('/members/w1/config') &&
          String((init as RequestInit | undefined)?.method).toUpperCase() === 'PUT',
      );
      expect(put).toBeTruthy();
      expect(String(put?.[0])).toContain('if-rev=rev-1');
      expect(JSON.parse(String((put?.[1] as RequestInit).body))).toEqual({
        patch: { gateway: { port: 9090 } },
      });
    });

    expect(await screen.findByText('已保存')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('已改 1 项')).not.toBeInTheDocument());
    // masked secret is never part of the write
    const body = fetchMock.mock.calls
      .filter(([, init]) => String((init as RequestInit | undefined)?.method).toUpperCase() === 'PUT')
      .map(([, init]) => String((init as RequestInit).body))
      .join('');
    expect(body).not.toContain('token');
    // config was refetched after the write
    const configGets = fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).includes('/members/w1/config') &&
        String((init as RequestInit | undefined)?.method ?? 'GET').toUpperCase() === 'GET',
    );
    expect(configGets.length).toBeGreaterThanOrEqual(2);
  });

  it('rolls back to the previous rev after a write', async () => {
    const fetchMock = installFetch({});
    renderSurface();

    const port = await screen.findByLabelText('Gateway port');
    fireEvent.change(port, { target: { value: '9091' } });
    fireEvent.click(screen.getByRole('button', { name: /保存改动/ }));
    await screen.findByText('已保存');

    const rollback = screen.getByRole('button', { name: /回滚到上次写入/ });
    await waitFor(() => expect(rollback).not.toBeDisabled());
    fireEvent.click(rollback);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) =>
        String(url).includes('/members/w1/config/rollback'),
      );
      expect(call).toBeTruthy();
      expect(String(call?.[0])).toContain('rev=rev-1');
    });
  });

  it('shows the restart entry for pending fields and restarts explicitly', async () => {
    const config = makeConfig();
    config.applied = 'pending';
    config.pendingRestart = ['gateway.port'];
    const fetchMock = installFetch({ config: () => config });
    renderSurface();

    expect(await screen.findByText(/已写入，重启后生效/)).toBeInTheDocument();
    const restart = screen.getByRole('button', { name: /立即重启/ });
    fireEvent.click(restart);

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes('/runtime-config/restart')),
      ).toBe(true),
    );
    expect(await screen.findByText('已发送重启，配置将重新加载')).toBeInTheDocument();
  });

  it('degrades honestly when the surface endpoint is missing (404/501)', async () => {
    installFetch({ surfaceStatus: 404 });
    renderSurface();
    expect(await screen.findByText(/endpoint unsupported/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument();

    cleanup();
    installFetch({ configStatus: 501 });
    renderSurface();
    expect(await screen.findByText(/endpoint unsupported/)).toBeInTheDocument();
  });

  it('renders a read failure with retry on 403 instead of a fake form', async () => {
    installFetch({ configStatus: 403 });
    renderSurface();
    expect(await screen.findByText(/读取配置失败/)).toBeInTheDocument();
    expect(screen.getByText(/无权限读取/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Gateway port')).not.toBeInTheDocument();
  });

  it('renders a capability bucket with only its mapped fields', async () => {
    installFetch({});
    renderSurface({ bucket: 'mcp' });
    expect(await screen.findByLabelText('MCP enabled')).toBeInTheDocument();
    expect(screen.queryByLabelText('Gateway port')).not.toBeInTheDocument();
  });
});

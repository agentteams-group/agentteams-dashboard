import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QwenpawRuntimeConfigPanel } from './qwenpaw-runtime-config-panel';
import type { Rc } from '@/lib/qwenpaw-runtime-config-model';

function baseConfig(): Rc {
  return {
    max_iters: 40,
    max_input_length: 131072,
    loop: {
      iteration: { enabled: true, max_iterations: 40 },
      doom_loop: {
        enabled: false,
        window_size: 3,
        similarity_threshold: 1,
        stages: [{ after: 3, action: 'modify_prompt', prompt: 'change strategy' }],
      },
      rubric: { enabled: false, prompt: '', max_interventions: 3 },
      goal: { max_iterations: 30, max_tokens: 100000 },
      mission: { max_iterations: 20, max_retries_per_story: 2 },
    },
    llm_retry_enabled: true,
    llm_max_retries: 3,
    llm_backoff_base: 1,
    llm_backoff_cap: 10,
    llm_max_concurrent: 10,
    llm_max_qpm: 600,
    llm_rate_limit_pause: 5,
    llm_rate_limit_jitter: 1,
    llm_acquire_timeout: 300,
    shell_command_timeout: 60,
    shell_command_executable: '',
    auto_title_config: { enabled: true },
    memory_manager_backend: 'remelight',
    context_manager_backend: 'light',
    light_context_config: {
      token_count_estimate_divisor: 4,
      context_compact_config: { enabled: true, compact_threshold_ratio: 0.8, reserve_threshold_ratio: 0.3 },
      tool_result_pruning_config: {
        enabled: true,
        pruning_recent_n: 10,
        pruning_old_msg_max_bytes: 1000,
        pruning_recent_msg_max_bytes: 2000,
        offload_retention_days: 7,
        exempt_file_extensions: ['.md'],
        exempt_tool_names: ['chat_with_agent'],
      },
    },
    reme_light_memory_config: {
      summarize_when_compact: true,
      inbox_push_enabled: false,
      auto_memory_interval: 60,
      dream_cron_enabled: false,
      dream_cron: '0 23 * * *',
      embedding_model_config: { api_key: 'sk-secret' },
    },
    adbpg_memory_config: { password: 'pg-secret' },
  };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

type FetchMock = ReturnType<typeof vi.fn>;

interface FetchOptions {
  config?: () => Rc;
  getStatus?: number;
  putStatus?: number;
  putBody?: unknown;
  customs?: Array<Record<string, unknown>>;
  onPut?: (_body: Rc, _headers: Record<string, string>) => void;
}

function installFetch(options: FetchOptions = {}): FetchMock {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url.includes('/runtimes/') && url.includes('/surface')) {
      throw new Error('surface endpoint must not be called for qwenpaw');
    }
    if (url.includes('/runtime-config/restart')) {
      return json({ name: 'w1', phase: 'Running' }, 201);
    }
    if (url.includes('/runtime-config')) {
      if (method === 'PUT') {
        const body = JSON.parse(String(init?.body ?? '{}')) as Rc;
        options.onPut?.(body, (init?.headers ?? {}) as Record<string, string>);
        if (options.putStatus && options.putStatus !== 200) {
          return json(options.putBody ?? { error: 'blocked' }, options.putStatus);
        }
        return json({ ...baseConfig(), ...body }, 200, { ETag: '"rev-2"' });
      }
      if (options.getStatus && options.getStatus !== 200) {
        return json({ error: 'blocked' }, options.getStatus);
      }
      return json((options.config ?? baseConfig)(), 200, { ETag: '"rev-1"' });
    }
    if (url.includes('/loops/custom')) {
      if (method === 'DELETE' || method === 'PUT') return json({}, 200);
      return json(options.customs ?? []);
    }
    if (url.includes('/loops')) return json([]);
    return json({ error: 'not found' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPanel(props: Partial<React.ComponentProps<typeof QwenpawRuntimeConfigPanel>> = {}) {
  return render(<QwenpawRuntimeConfigPanel workerName="w1" canWrite {...props} />);
}

function openTab(name: string) {
  const tab = screen.getByRole('tab', { name });
  fireEvent.mouseDown(tab, { button: 0 });
  fireEvent.click(tab);
}

function callsTo(fetchMock: FetchMock, fragment: string, method = 'GET') {
  return fetchMock.mock.calls.filter(
    ([url, init]) =>
      String(url).includes(fragment) &&
      String((init as RequestInit | undefined)?.method ?? 'GET').toUpperCase() === method,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('QwenpawRuntimeConfigPanel', () => {
  it('loads through the legacy runtime-config end and never calls the surface', async () => {
    const fetchMock = installFetch();
    renderPanel();

    expect(await screen.findByLabelText('最大输入长度')).toBeInTheDocument();
    expect(screen.getByTestId('max-iters')).toHaveTextContent('40');

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => url.includes('/runtime-config'))).toBe(true);
    expect(urls.some((url) => url.includes('/surface'))).toBe(false);
  });

  it('sends only the changed field with If-Match, then refetches', async () => {
    let sent: { body?: Rc; headers?: Record<string, string> } = {};
    const fetchMock = installFetch({
      onPut: (body, headers) => {
        sent = { body, headers };
      },
    });
    renderPanel();

    const input = await screen.findByLabelText('最大输入长度');
    fireEvent.change(input, { target: { value: '160000' } });
    expect(screen.getByText('已改 1 项')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /保存改动/ }));

    await waitFor(() => expect(callsTo(fetchMock, '/runtime-config', 'PUT')).toHaveLength(1));
    expect(sent.body).toEqual({ max_input_length: 160000 });
    expect(sent.headers?.['If-Match']).toBe('"rev-1"');

    expect(await screen.findByText(/已保存——重启后生效/)).toBeInTheDocument();
    expect(screen.getByText('已写入，重启后生效')).toBeInTheDocument();
    expect(callsTo(fetchMock, '/runtime-config', 'GET').length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the loop object whole and mirrors the iteration gate onto max_iters', async () => {
    let sent: Rc | undefined;
    const fetchMock = installFetch({ onPut: (body) => { sent = body; } });
    renderPanel();

    await screen.findByLabelText('最大输入长度');
    openTab('智能体 Loop 设置');

    const iteration = await screen.findByLabelText('迭代上限');
    fireEvent.change(iteration, { target: { value: '55' } });
    fireEvent.click(screen.getByRole('button', { name: /保存改动/ }));

    await waitFor(() => expect(callsTo(fetchMock, '/runtime-config', 'PUT')).toHaveLength(1));
    expect(sent?.max_iters).toBe(55);
    const loop = sent?.loop as Record<string, Record<string, unknown>>;
    expect(loop.iteration.max_iterations).toBe(55);
    // untouched gates survive the whole-object write
    expect(loop.doom_loop.window_size).toBe(3);
    expect(loop.goal.max_tokens).toBe(100000);
  });

  it('blocks invalid values client-side and sends nothing', async () => {
    const fetchMock = installFetch();
    renderPanel();

    await screen.findByLabelText('最大输入长度');
    openTab('智能体 Loop 设置');
    const iteration = await screen.findByLabelText('迭代上限');
    fireEvent.change(iteration, { target: { value: '999' } });
    fireEvent.click(screen.getByRole('button', { name: /保存改动/ }));

    expect((await screen.findAllByText('迭代上限须为 1..500 的整数')).length).toBeGreaterThan(0);
    expect(callsTo(fetchMock, '/runtime-config', 'PUT')).toHaveLength(0);
  });

  it('restarts explicitly from the pending banner', async () => {
    const fetchMock = installFetch();
    renderPanel();

    const input = await screen.findByLabelText('最大输入长度');
    fireEvent.change(input, { target: { value: '160000' } });
    fireEvent.click(screen.getByRole('button', { name: /保存改动/ }));
    await screen.findByText('已写入，重启后生效');

    fireEvent.click(screen.getByRole('button', { name: /立即重启/ }));
    expect(await screen.findByText('已发送重启，配置将重新加载')).toBeInTheDocument();
    expect(callsTo(fetchMock, '/runtime-config/restart', 'POST')).toHaveLength(1);
    expect(screen.queryByText('已写入，重启后生效')).not.toBeInTheDocument();
  });

  it.each([
    [409, { error: 'conflict' }, '配置已在别处更新，请重新加载后再保存'],
    [403, { error: 'forbidden' }, '无权限保存该配置（需要 Controller 管理 token，或字段超出 L2 白名单）'],
    [400, { message: 'approval_level is not writable via runtime-config' }, '保存被拒绝：approval_level is not writable via runtime-config'],
    [503, { error: 'worker runtime-config requires embedded mode' }, '当前部署模式不支持保存运行配置（需嵌入式模式）'],
  ] as const)('surfaces the %s write error honestly', async (status, body, copy) => {
    installFetch({ putStatus: status, putBody: body });
    renderPanel();

    const input = await screen.findByLabelText('最大输入长度');
    fireEvent.change(input, { target: { value: '160000' } });
    fireEvent.click(screen.getByRole('button', { name: /保存改动/ }));

    expect(await screen.findByText(copy)).toBeInTheDocument();
  });

  it('shows the load error with the real reason and a retry', async () => {
    installFetch({ getStatus: 404 });
    renderPanel();

    expect(await screen.findByText(/运行配置不可用/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('最大输入长度')).not.toBeInTheDocument();
  });

  it('renders custom loop modes and deletes one', async () => {
    const fetchMock = installFetch({
      customs: [
        { id: 'mode-a', name: '模式 A', slash_command: 'mode-a', enabled: true, gates: [{ id: 'g1', type: 'iteration', enabled: true }] },
      ],
    });
    renderPanel();

    await screen.findByLabelText('最大输入长度');
    openTab('智能体 Loop 设置');

    expect(await screen.findByText('模式 A')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '删除自定义 Loop mode-a' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, '/loops/custom/mode-a', 'DELETE')).toHaveLength(1),
    );
    expect(await screen.findByText('已删除')).toBeInTheDocument();
  });

  it('masks credentials in the read-only memory JSON view', async () => {
    installFetch();
    renderPanel();

    await screen.findByLabelText('最大输入长度');
    openTab('长期记忆');
    fireEvent.click(screen.getByRole('button', { name: '查看配置 JSON' }));

    const pre = await screen.findByText(/"reme_light_memory_config"/);
    expect(pre.textContent).not.toContain('sk-secret');
    expect(pre.textContent).not.toContain('pg-secret');
    expect(pre.textContent).toContain('***');
  });
});

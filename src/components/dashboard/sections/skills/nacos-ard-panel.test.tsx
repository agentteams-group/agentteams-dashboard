import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { NacosArdPanel } from './nacos-ard-panel';

const roster = vi.hoisted(() => ({ names: ['worker-a'] }));
vi.mock('@/hooks/use-agentteams-workers', () => ({
  useWorkers: () => ({ data: roster.names.map(name => ({ name })), isSuccess: true }),
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); roster.names = ['worker-a']; });

it('selects an enabled, unbound Worker and confirms the association without applying to the other Worker', async () => {
  roster.names = ['worker-a', 'worker-b'];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const skill = { name: 'check', source: 'registry/team/check', version: '1.1.0' };
  const applied: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const worker = new URL(input, 'http://dashboard').searchParams.get('worker');
    if (init?.method === 'POST') {
      const data = JSON.parse(String(init.body));
      expect(data).toMatchObject({ action: 'apply', source: skill.source, expected: skill.version, digest: 'hash-worker-a' });
      applied.push(data.worker);
      return Response.json({});
    }
    if (!worker) return Response.json({ skills: [skill], next: '' });
    const version = worker === 'worker-a' ? '1.1.0' : '1.0.0';
    return Response.json({ workspace: version, digest: 'hash-' + worker, bound: applied.includes(worker),
      observed: { enabled: true, installed: true, version } });
  }));
  render(<QueryClientProvider client={client}><NacosArdPanel /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'check · 1.1.0' }));
  await screen.findByText('版本相同，可关联来源');
  await screen.findByText('有可用更新');
  const a = screen.getByRole('checkbox', { name: 'worker-a' }) as HTMLInputElement;
  fireEvent.click(a);
  fireEvent.click(screen.getByRole('button', { name: '更新所选 Agent（1）' }));
  await screen.findByText('运行时已确认');
  await screen.findByText('已是上游版本');
  expect(a.disabled).toBe(true);
  expect(applied).toEqual(['worker-a']);
  expect((screen.getByRole('checkbox', { name: 'worker-b' }) as HTMLInputElement).checked).toBe(false);
});

it('previews changed files for the selected Worker before any deployment', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const skill = { name: 'release-check', source: 'registry/team/release-check', version: '1.1.0' };
  const fetcher = vi.fn(async (input: string, options?: RequestInit) => {
    expect(options?.method).not.toBe('POST');
    const p = new URL(input, 'http://dashboard').searchParams;
    if (!p.has('worker')) return Response.json({ skills: [skill], next: '' });
    expect(p.get('worker')).toBe('worker-a');
    if (!p.has('diff')) return Response.json({ workspace: '1.0.0', digest: 'local-hash', bound: true,
      observed: { enabled: true, installed: true, version: '1.0.0' } });
    expect(p.get('digest')).toBe('local-hash');
    expect(p.get('expected')).toBe('1.1.0');
    if (p.get('file') === 'guide.md') return Response.json({ before: { size: 3, text: 'old' }, after: { size: 3, text: 'new' } });
    if (p.get('file') === 'empty.txt') return Response.json({ before: { size: 0, text: '' }, after: null });
    return Response.json({ changes: [{ path: 'guide.md', change: 'modified' }, { path: 'empty.txt', change: 'removed' }] });
  });
  vi.stubGlobal('fetch', fetcher);
  render(<QueryClientProvider client={client}><NacosArdPanel /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'release-check · 1.1.0' }));
  await screen.findByText('有可用更新');
  fireEvent.click(screen.getByRole('button', { name: '查看差异' }));
  await screen.findByText('old');
  await screen.findByText('new');
  fireEvent.change(screen.getByLabelText('变更文件'), { target: { value: 'empty.txt' } });
  await screen.findByText('文件不存在');
  expect((screen.getByRole('checkbox', { name: 'worker-a' }) as HTMLInputElement).checked).toBe(false);
});

it('keeps the publishing workspace open while ARD reindexes the newly published version', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const old = { name: 'release-check', source: 'registry/team/release-check', version: '1.2.0' };
  const next = { ...old, version: '1.3.0' };
  let status = '', reindexing = false, submitFailure = true, uploads = 0;
  const fetcher = vi.fn(async (input: string, options?: RequestInit) => {
    const p = new URL(input, 'http://dashboard').searchParams;
    if (options?.method === 'POST') {
      const { action } = JSON.parse(options.body as string);
      if (action === 'publish') { status = 'draft'; uploads++; }
      if (action === 'finish') {
        if (submitFailure) return Response.json({ error: 'Nacos 503' }, { status: 503 });
        status = 'online'; reindexing = true;
      }
      return Response.json({ status });
    }
    if (p.has('receipt')) return Response.json({ registry: 'registry', receipt: status ? {
      version: next.version, base: old.version, message: 'Update the checklist', status,
      discovered: status === 'online' && !reindexing, latest: status === 'online' ? next.version : old.version,
      upstream: reindexing ? '' : next.version, source: old.source,
    } : null });
    if (p.has('edit')) return Response.json({ paths: ['SKILL.md'], text: 'initial', digest: 'test' });
    if (p.has('worker')) return Response.json({ workspace: old.version, digest: 'test',
      observed: { enabled: true, installed: true, version: old.version } });
    return Response.json({ skills: reindexing ? [] : [status === 'online' ? next : old], next: '' });
  });
  vi.stubGlobal('fetch', fetcher);
  render(<QueryClientProvider client={client}><NacosArdPanel /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'release-check · 1.2.0' }));
  const open = await screen.findByRole('button', { name: '编辑并发布' });
  await waitFor(() => expect((open as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(open);
  fireEvent.change(await screen.findByLabelText('文件内容'), { target: { value: 'changed text' } });
  fireEvent.change(screen.getByLabelText('新版本号'), { target: { value: next.version } });
  fireEvent.change(screen.getByLabelText('变更说明'), { target: { value: 'Update the checklist' } });
  fireEvent.click(screen.getByRole('button', { name: '创建草稿' }));
  fireEvent.click(await screen.findByRole('button', { name: '提交发布' }));
  await screen.findByText('Nacos 503');
  await waitFor(() => expect((screen.getByText('关闭编辑') as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByText('关闭编辑'));
  fireEvent.click(open);
  submitFailure = false;
  fireEvent.click(await screen.findByRole('button', { name: '提交发布' }));
  await screen.findByText('1.3.0 · 已上线 · 等待 ARD 索引');
  await screen.findByText('没有可发现的 Skill');
  expect(uploads).toBe(1);
  reindexing = false;
  await screen.findByText('1.3.0 · 已上线 · ARD 已发现', {}, { timeout: 5000 });
  expect(await screen.findByRole('button', { name: 'release-check · 1.3.0' })).toBeTruthy();
});

it.each([
  { workspace: '1.1.0', latest: '1.1.0', mayPublish: true },
  { workspace: '1.0.0', latest: '1.1.0', mayPublish: false },
  { workspace: '1.1.0', latest: '1.2.0', mayPublish: false },
])('publishes after another Worker advances the same Skill only on the current baseline ($workspace, $latest)', async ({ workspace, latest, mayPublish }) => {
  const skill = { name: 'check', source: 'registry/team/check', version: '1.1.0' };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const publish = vi.fn();
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const p = new URL(input, 'http://dashboard').searchParams;
    if (init?.method === 'POST') {
      publish(JSON.parse(String(init.body)));
      return Response.json({ status: 'draft' });
    }
    if (p.has('receipt')) return Response.json({ registry: 'registry', receipt: {
      version: '1.0.0', base: '0.9.0', status: 'online', discovered: false,
      upstream: skill.version, latest, source: skill.source, message: 'Earlier release',
    } });
    if (p.has('edit')) return Response.json({ paths: ['SKILL.md'], text: 'Update me', digest: 'current-package' });
    if (p.has('worker')) return Response.json({ workspace, bound: true, observed: { installed: true, enabled: true, version: workspace } });
    return Response.json({ skills: [skill], next: '' });
  });
  render(<QueryClientProvider client={client}><NacosArdPanel /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'check · 1.1.0' }));
  await screen.findByText(workspace === skill.version ? '已是上游版本' : '有可用更新');
  fireEvent.click(screen.getByRole('button', { name: workspace === skill.version ? '编辑并发布' : '查看发布记录' }));
  await screen.findByText('Earlier release');
  const next = screen.queryByRole('button', { name: '发布下一版本' });
  if (!mayPublish) {
    expect(next).toBeNull();
    expect(publish).not.toHaveBeenCalled();
    return;
  }
  expect(next).toBeTruthy();
  fireEvent.click(next!);
  fireEvent.change(await screen.findByLabelText('文件内容'), { target: { value: 'Updated' } });
  fireEvent.change(screen.getByLabelText('新版本号'), { target: { value: '1.2.0' } });
  fireEvent.change(screen.getByLabelText('变更说明'), { target: { value: 'Continue from 1.1.0' } });
  fireEvent.click(screen.getByRole('button', { name: '创建草稿' }));
  await waitFor(() => expect(publish).toHaveBeenCalledWith(expect.objectContaining({
    action: 'publish', worker: 'worker-a', source: skill.source, expected: '1.1.0', version: '1.2.0', digest: 'current-package',
  })));
});

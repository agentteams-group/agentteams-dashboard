import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { WorkerWorkspaceFilesPanel } from './worker-workspace-files-panel';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('WorkerWorkspaceFilesPanel', () => {
  it('degrades to 不支持 on 404 / 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(403, { error: 'forbidden' })));
    render(<WorkerWorkspaceFilesPanel workerName="w1" />);
    expect(await screen.findByText(/暂不支持工作区文件/)).toBeInTheDocument();
  });

  it('lists files and saves text edits', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ url, method });
      if (url.includes('/tree')) {
        return json(200, {
          entries: [
            { kind: 'file', name: 'MEMORY.md', path: 'MEMORY.md', size: 5, preview_kind: 'markdown' },
          ],
        });
      }
      if (method === 'GET' && url.includes('/file-content')) {
        return json(200, { content: 'hello', etag: 'e1', preview_kind: 'markdown' });
      }
      if (method === 'PUT') {
        return json(200, { etag: 'e2', path: 'MEMORY.md', size: 5 });
      }
      return json(404, {});
    }));

    render(<WorkerWorkspaceFilesPanel workerName="w1" />);
    fireEvent.click(await screen.findByRole('button', { name: /MEMORY\.md/ }));
    const editor = await screen.findByLabelText('编辑 MEMORY.md');
    fireEvent.change(editor, { target: { value: 'hello world' } });
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));

    expect(await screen.findByText('已保存')).toBeInTheDocument();
    const put = calls.find((call) => call.method === 'PUT');
    expect(put?.url).toContain('/file-content?path=MEMORY.md');
  });

  it('degrades to read-only when PUT returns 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.includes('/tree')) {
        return json(200, { entries: [{ kind: 'file', name: 'MEMORY.md', path: 'MEMORY.md', preview_kind: 'markdown' }] });
      }
      if (method === 'GET') return json(200, { content: 'hello', etag: 'e1' });
      return json(404, { error: 'not found' });
    }));

    render(<WorkerWorkspaceFilesPanel workerName="w1" />);
    fireEvent.click(await screen.findByRole('button', { name: /MEMORY\.md/ }));
    const editor = await screen.findByLabelText('编辑 MEMORY.md');
    fireEvent.change(editor, { target: { value: 'changed' } });
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));
    expect(await screen.findByText(/暂不支持在线编辑/)).toBeInTheDocument();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render as renderComponent, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AttachmentCard } from './attachment-card';
import { AttachmentPreviewContext } from './attachment-preview';

vi.mock('@/lib/matrix-store', () => ({
  useMatrixStore: () => ({ homeserver: 'https://hs.test' }),
}));

vi.mock('@/components/dashboard/document-preview', () => ({
  DocumentPreview: ({ filename }: { filename: string }) => <div>分页预览 {filename}</div>,
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function render(ui: React.ReactElement) {
  return renderComponent(ui, {
    wrapper: ({ children }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>,
  });
}

function makePayload(overrides: Partial<{ url: string; filename: string; mimetype: string }> = {}) {
  return {
    url: 'mxc://example.com/abc123',
    filename: 'full-reply.txt',
    mimetype: 'text/plain',
    ...overrides,
  };
}

describe('AttachmentCard', () => {
  it.each(['pdf', 'pptx', 'ppt'])('opens a %s file through the existing room preview', (extension) => {
    const open = vi.fn();
    render(<AttachmentPreviewContext.Provider value={open}><AttachmentCard payload={makePayload({ filename: `report.${extension}`, mimetype: 'application/octet-stream' })} compact /></AttachmentPreviewContext.Provider>);
    fireEvent.click(screen.getByRole('button', { name: `查看 report.${extension}` }));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ filename: `report.${extension}` }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('uses the document renderer in the standalone preview without a text fetch', async () => {
    const read = vi.fn();
    vi.stubGlobal('fetch', read);
    render(<AttachmentCard payload={makePayload({ filename: 'report.pdf', mimetype: 'application/pdf' })} />);
    fireEvent.click(screen.getByRole('button', { name: '查看 report.pdf' }));
    expect(await screen.findByText('分页预览 report.pdf')).toBeInTheDocument();
    expect(read).not.toHaveBeenCalled();
  });
  it('renders filename, friendly type and download link', () => {
    render(<AttachmentCard payload={makePayload()} />);

    expect(screen.getByText('full-reply.txt')).toBeInTheDocument();
    expect(screen.getByText('文本')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存到我的文件' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /下载/ });
    // Media is proxied through the Next.js API (browsers cannot reach the
    // homeserver directly); ?download=true forces Content-Disposition.
    expect(link).toHaveAttribute(
      'href',
      '/api/matrix/media/v3/download/example.com/abc123/?homeserver=https%3A%2F%2Fhs.test&download=true'
    );
  });

  it('renders an http url as the download link directly', () => {
    render(<AttachmentCard payload={makePayload({ url: 'https://cdn.test/full.txt' })} />);

    const link = screen.getByRole('link', { name: /下载/ });
    expect(link).toHaveAttribute('href', 'https://cdn.test/full.txt?download=true');
  });

  it('shows no download link for an unusable url', () => {
    render(<AttachmentCard payload={makePayload({ url: 'not-a-matrix-uri' })} />);

    expect(screen.queryByRole('link', { name: /下载/ })).toBeNull();
  });

  it('opens the room preview from a compact attachment', () => {
    const open = vi.fn();
    render(<AttachmentPreviewContext.Provider value={open}><AttachmentCard payload={makePayload()} compact /></AttachmentPreviewContext.Provider>);
    expect(screen.getByText('full-reply.txt')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /下载/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存到我的文件' })).toHaveAttribute('title', '添加到个人文件区');
    fireEvent.click(screen.getByRole('button', { name: '查看 full-reply.txt' }));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ filename: 'full-reply.txt' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders Markdown returned with a binary MIME type as headings and tables', async () => {
    const read = vi.fn().mockResolvedValue(new Response('# 项目计划\n\n| 名称 | 状态 |\n|---|---|\n| 验收 | 完成 |'));
    vi.stubGlobal('fetch', read);
    render(<AttachmentCard payload={makePayload({ filename: 'plan.md', mimetype: 'application/octet-stream' })} />);
    expect(read).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '查看 plan.md' }));
    expect(await screen.findByRole('heading', { name: '项目计划' })).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent('完成');
  });

  it('shows authenticated screenshots inside the report preview without separate file cards', async () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/agentteams');
    const source = '/api/agentteams/tasks/exec-test/files?team=own&artifactId=image&version=frozen';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(`# 测试报告\n\n![桌面功能界面](${source})`)));
    render(<AttachmentCard payload={makePayload({ filename: 'test-report.md', mimetype: 'text/markdown' })} />);
    fireEvent.click(screen.getByRole('button', { name: '查看 test-report.md' }));
    expect(await screen.findByRole('img', { name: '桌面功能界面' })).toHaveAttribute('src',
      '/agentteams/api/agentteams/tasks/exec-test/files/?team=own&artifactId=image&version=frozen');
    expect(screen.queryByRole('button', { name: '查看 desktop.png' })).toBeNull();
  });

  it('bounds text preview size', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x'.repeat(530 * 1024))));
    render(<AttachmentCard payload={makePayload()} />);
    fireEvent.click(screen.getByRole('button', { name: '查看 full-reply.txt' }));
    expect(await screen.findByText(/内容已截断/)).toBeInTheDocument();
  });

  it('shows a retryable error when the preview download fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    render(<AttachmentCard payload={makePayload()} />);
    fireEvent.click(screen.getByRole('button', { name: '查看 full-reply.txt' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('预览加载失败');
    expect(screen.getByRole('button', { name: '重试' })).toBeEnabled();
  });

  it('renders an HTML attachment in a script-free sandbox after clicking View', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html><body><h1>Hello</h1></body></html>')));
    render(<AttachmentCard payload={makePayload({ filename: 'index.html', mimetype: 'application/octet-stream' })} />);
    expect(document.querySelector('iframe')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查看 index.html' }));
    const frame = await waitFor(() => {
      const iframe = document.querySelector('iframe[title="index.html"]');
      expect(iframe).not.toBeNull();
      return iframe!;
    });
    expect(frame).toHaveAttribute('sandbox', '');
    expect(frame.getAttribute('srcdoc')).toContain('<h1>Hello</h1>');
    fireEvent.click(screen.getByRole('button', { name: '关闭文件预览' }));
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('only offers download for binary formats without a preview renderer', () => {
    render(<AttachmentCard payload={makePayload({ filename: 'backup.zip', mimetype: 'application/zip' })} />);
    expect(screen.queryByRole('button', { name: /查看/ })).toBeNull();
    expect(screen.getByText('压缩包')).toBeInTheDocument();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AttachmentCard } from './attachment-card';

vi.mock('@/lib/matrix-store', () => ({
  useMatrixStore: () => ({ homeserver: 'https://hs.test' }),
}));

afterEach(cleanup);

function makePayload(overrides: Partial<{ url: string; filename: string; mimetype: string }> = {}) {
  return {
    url: 'mxc://example.com/abc123',
    filename: 'full-reply.txt',
    mimetype: 'text/plain',
    ...overrides,
  };
}

describe('AttachmentCard', () => {
  it('renders filename, friendly type and download link', () => {
    render(<AttachmentCard payload={makePayload()} />);

    expect(screen.getByText('full-reply.txt')).toBeInTheDocument();
    expect(screen.getByText('文本 · 全文附件')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /下载/ });
    expect(link).toHaveAttribute(
      'href',
      'https://hs.test/_matrix/media/v3/download/example.com/abc123'
    );
  });

  it('renders an http url as the download link directly', () => {
    render(<AttachmentCard payload={makePayload({ url: 'https://cdn.test/full.txt' })} />);

    const link = screen.getByRole('link', { name: /下载/ });
    expect(link).toHaveAttribute('href', 'https://cdn.test/full.txt');
  });

  it('shows no download link for an unusable url', () => {
    render(<AttachmentCard payload={makePayload({ url: 'not-a-matrix-uri' })} />);

    expect(screen.queryByRole('link', { name: /下载/ })).toBeNull();
  });

  it('expands a text preview on demand and truncates above the limit', async () => {
    const longBody = 'x'.repeat(300 * 1024);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => longBody,
    }) as unknown as typeof fetch;

    render(<AttachmentCard payload={makePayload()} />);
    fireEvent.click(screen.getByRole('button', { name: /预览/ }));

    expect(await screen.findByText(/内容已截断/)).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      'https://hs.test/_matrix/media/v3/download/example.com/abc123'
    );
  });

  it('shows an inline error when the preview download fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }) as unknown as typeof fetch;

    render(<AttachmentCard payload={makePayload()} />);
    fireEvent.click(screen.getByRole('button', { name: /预览/ }));

    expect(await screen.findByText('预览加载失败')).toBeInTheDocument();
  });

  it('does not offer preview for binary mime types', () => {
    render(<AttachmentCard payload={makePayload({ mimetype: 'application/zip' })} />);

    expect(screen.queryByRole('button', { name: /预览/ })).toBeNull();
    expect(screen.getByText('压缩包 · 全文附件')).toBeInTheDocument();
  });
});

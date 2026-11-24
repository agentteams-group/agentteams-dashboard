import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { DocumentPreview } from './document-preview';

vi.mock('next/dynamic', () => ({
  default: () => function Slides({ page, onLoad }: { page: number; onLoad: (_count: number) => void }) {
    React.useEffect(() => onLoad(3), [onLoad]);
    return <div>页面内容 {page + 1}</div>;
  },
}));
import React from 'react';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockDownload() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    headers: new Headers(),
    arrayBuffer: async () => new ArrayBuffer(8),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('DocumentPreview', () => {
  it('forwards the Matrix credential when opening authenticated media', async () => {
    const download = mockDownload();
    render(<DocumentPreview url="/api/matrix/media/report" filename="report.pdf" accessToken="preview-token" />);
    await screen.findByRole('button', { name: '下一页' });
    expect(download).toHaveBeenCalledWith('/api/matrix/media/report', expect.objectContaining({ headers: { Authorization: 'Bearer preview-token' } }));
  });
  it('supports next, previous and clicking a page, with bounded navigation', async () => {
    mockDownload();
    render(<DocumentPreview url="/report.pdf" filename="report.pdf" />);
    await screen.findByText('页面内容 1');
    expect(await screen.findByRole('button', { name: '上一页' })).toBeDisabled();
    fireEvent.click(await screen.findByRole('button', { name: '下一页' }));
    expect(screen.getByText('页面内容 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '第 3 页' }));
    expect(screen.getByText('页面内容 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '上一页' }));
    expect(screen.getByText('页面内容 2')).toBeInTheDocument();
  });

  it('resets the page and aborts the previous download when switching files', async () => {
    const fetchMock = mockDownload();
    const { rerender } = render(<DocumentPreview url="/first.pptx" filename="first.pptx" />);
    await screen.findByText('页面内容 1');
    fireEvent.click(await screen.findByRole('button', { name: '下一页' }));
    const previousSignal = fetchMock.mock.calls[0][1].signal;
    rerender(<DocumentPreview url="/second.ppt" filename="second.ppt" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(previousSignal.aborted).toBe(true);
    await screen.findByText('页面内容 1');
  });

  it('shows a download fallback when loading fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    render(<DocumentPreview url="/denied.pdf" filename="denied.pdf" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 403');
    expect(screen.getByRole('link', { name: '下载原文件' })).toHaveAttribute('href', '/denied.pdf');
    expect(screen.queryByRole('button', { name: '下一页' })).not.toBeInTheDocument();
  });

  it('turns pages with the wheel inside the canvas and throttles momentum', async () => {
    mockDownload();
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    render(<DocumentPreview url="/report.pdf" filename="report.pdf" />);
    await screen.findByRole('button', { name: '下一页' });
    const stage = screen.getByLabelText('幻灯片画布');
    const wheel = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
    fireEvent(stage, wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(screen.getByText('页面内容 2')).toBeInTheDocument();
    fireEvent.wheel(stage, { deltaY: 120 });
    expect(screen.getByText('页面内容 2')).toBeInTheDocument();
    now.mockReturnValue(1500);
    fireEvent.wheel(stage, { deltaY: -120 });
    expect(screen.getByText('页面内容 1')).toBeInTheDocument();
    fireEvent.mouseEnter(screen.getByRole('button', { name: '第 3 页' }));
    expect(screen.getByText('页面内容 3')).toBeInTheDocument();
  });

  it('accepts mouse-wheel deltas expressed in lines', async () => {
    mockDownload();
    render(<DocumentPreview url="/report.pdf" filename="report.pdf" />);
    await screen.findByRole('button', { name: '下一页' });
    await act(async () => {});
    const wheel = new WheelEvent('wheel', { deltaY: 3, deltaMode: 1, bubbles: true, cancelable: true });
    fireEvent(screen.getByLabelText('幻灯片画布'), wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(screen.getByText('页面内容 2')).toBeInTheDocument();
  });
});

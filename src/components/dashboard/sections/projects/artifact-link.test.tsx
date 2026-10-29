import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ArtifactLink } from './artifact-link';

// 图片坐标锚点（E-1）的端到端接线：产物芯片 → 预览对话框 → 点击图片任意位置
// → 坐标锚点传给评论面板。jsdom 没有布局，getBoundingClientRect 必须自己桩，
// 否则宽高为 0 会被当成无效点击直接丢弃。

vi.mock('@/lib/matrix-store', () => ({
  useMatrixStore: (selector: (_s: { userId: string }) => unknown) =>
    selector({ userId: '@me:server' }),
}));

vi.mock('@/lib/matrix-write', () => ({
  matrixProxyFetch: vi.fn(async () =>
    new Response(JSON.stringify({ chunk: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ArtifactLink 图片坐标锚点（E-1）', () => {
  it('点击图片后按相对坐标锚定，并把锚点传给评论面板', async () => {
    vi.stubGlobal(
      'fetch',
      // jsdom Blob 没有 stream()；Response(Blob) 会抛 object.stream is not a function。
      // 图片预览只读 content-type，字符串 body 即可。
      vi.fn(async () =>
        new Response('png-bytes', {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
      ),
    );

    renderWithClient(<ArtifactLink href="/artifacts/shot.png" label="shot.png" roomId="!r:server" />);

    fireEvent.click(screen.getByText('shot.png'));

    const img = await screen.findByRole('img', { name: 'shot.png' });
    img.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0 }) as DOMRect;

    // 点击 (100, 50) → 相对坐标 (50%, 50%)
    fireEvent.click(img, { clientX: 100, clientY: 50 });

    await waitFor(() => {
      expect(screen.getByText(/已锚定 \(50%, 50%\)/)).toBeInTheDocument();
    });
    // 面板输入框的占位符跟随锚点，说明评论会挂到该坐标上
    expect(screen.getByPlaceholderText('评论 (50%, 50%)…')).toBeInTheDocument();
  });
});

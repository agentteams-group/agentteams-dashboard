import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { McpServerDialog } from './mcp-server-dialog';

// 只验证表单控件形态（枚举走 Select、名称/URL 保持自由输入），不需要真拨号。
vi.mock('@/hooks/use-agentteams-mcps', () => ({
  useCreateMcpServer: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateMcpServer: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTestMcpServer: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

// Radix Select 打开时用 ResizeObserver 量宽度。
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!('ResizeObserver' in window)) {
  Object.defineProperty(window, 'ResizeObserver', {
    value: ResizeObserverStub,
    configurable: true,
  });
}

describe('McpServerDialog 字段控件形态', () => {
  afterEach(cleanup);

  function renderDialog() {
    render(
      <TooltipProvider>
        <McpServerDialog open onOpenChange={() => {}} />
      </TooltipProvider>,
    );
  }

  it('传输方式 / 服务器类型是可选择的 Select（不是裸 Input）', () => {
    renderDialog();

    for (const label of [/^传输方式 \*/, /^服务器类型/]) {
      const trigger = screen.getByLabelText(label);
      expect(trigger.tagName).toBe('BUTTON');
      expect(trigger).toHaveAttribute('role', 'combobox');
    }
  });

  it('传输方式候选为 SSE / Streamable HTTP', () => {
    renderDialog();
    fireEvent.click(screen.getByLabelText(/^传输方式 \*/));

    expect(screen.getByRole('option', { name: 'SSE' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Streamable HTTP (推荐)' })).toBeInTheDocument();
  });

  it('名称 / URL / 超时保持自由输入', () => {
    renderDialog();

    expect((screen.getByLabelText(/服务器名称/) as HTMLElement).tagName).toBe('INPUT');
    expect((screen.getByLabelText(/服务端点 URL/) as HTMLElement).tagName).toBe('INPUT');
    expect((screen.getByLabelText(/超时/) as HTMLElement).tagName).toBe('INPUT');
  });
});

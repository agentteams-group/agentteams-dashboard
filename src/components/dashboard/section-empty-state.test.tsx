import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Bot } from 'lucide-react';
import { SectionEmptyState } from './section-empty-state';

afterEach(cleanup);

describe('SectionEmptyState（A-4 空态统一件）', () => {
  it('带主行动：渲染可点击的按钮，点它走传入的 onClick', () => {
    const onClick = vi.fn();
    render(
      <SectionEmptyState
        icon={Bot}
        title="暂无 Worker"
        description="Manager 创建后会写入 shared/workers/"
        action={{ label: '创建第一个 Worker', onClick }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '创建第一个 Worker' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('无主行动：只有列表为空、下一步不在这里时不硬造按钮', () => {
    render(<SectionEmptyState title="暂无审计事件" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('暂无审计事件')).toBeInTheDocument();
  });

  it('description 可选：不传就不渲染这层文案', () => {
    const { rerender } = render(<SectionEmptyState title="暂无团队数据" description="至少一个团队才会出图" />);
    expect(screen.getByText('至少一个团队才会出图')).toBeInTheDocument();
    rerender(<SectionEmptyState title="暂无团队数据" />);
    expect(screen.queryByText('至少一个团队才会出图')).not.toBeInTheDocument();
  });

  it('role=status：内容变化要以 polite 播报，图标只做装饰', () => {
    render(<SectionEmptyState icon={Bot} title="暂无 Human" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    const svg = screen.getByRole('status').querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });
});

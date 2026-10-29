import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { MobileQuickBar } from './mobile-quick-bar';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import { useInviteStore } from '@/lib/matrix-invite-store';
import { useRoomMetaStore } from '@/hooks/use-matrix';
import { useSectionStore } from '@/lib/section-store';

afterEach(() => {
  cleanup();
  useSectionStore.getState().setActiveSection('chat');
  window.location.hash = '';
});

/**
 * 造「等我」计数用 Matrix 邀请：selectPendingTally 里 invites 就是 map 的
 * 键数，和 usePendingTally 走的同一个 selector（不在测试里另拼口径）。
 */
function setPendingCount(count: number): void {
  const invites: Record<string, { roomId: string; sender: string }> = {};
  for (let i = 0; i < count; i++) {
    invites[`!r${i}:x`] = { roomId: `!r${i}:x`, sender: '@agent:x' };
  }
  useInviteStore.setState({ invites });
}

describe('MobileQuickBar（C-6 移动端底部常驻栏）', () => {
  beforeEach(() => {
    useHitlInboxStore.setState({ confirmations: {} });
    useInviteStore.setState({ invites: {} });
    useRoomMetaStore.setState({ meta: {} });
  });

  it('窄屏三项常驻：等我 / 空间 / 搜索', () => {
    render(<MobileQuickBar onSearch={() => {}} />);
    expect(screen.getByRole('navigation', { name: '快捷导航' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '等我' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '空间' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '搜索' })).toBeInTheDocument();
  });

  it('计数为 0 不显示徽标', () => {
    setPendingCount(0);
    render(<MobileQuickBar onSearch={() => {}} />);
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.getByRole('button', { name: '等我' })).toHaveTextContent('等我');
  });

  it('计数为 3 原样显示', () => {
    setPendingCount(3);
    render(<MobileQuickBar onSearch={() => {}} />);
    expect(screen.getByRole('button', { name: /等我/ })).toHaveTextContent('3');
  });

  it('计数 120 收成 99+', () => {
    setPendingCount(120);
    render(<MobileQuickBar onSearch={() => {}} />);
    expect(screen.getByText('99+')).toBeInTheDocument();
    expect(screen.queryByText('120')).toBeNull();
  });

  it('点「等我」只写 hash：#workbench/me', () => {
    render(<MobileQuickBar onSearch={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /等我/ }));
    expect(window.location.hash).toBe('#workbench/me');
  });

  it('点「空间」只写 hash：#workbench/space', () => {
    render(<MobileQuickBar onSearch={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '空间' }));
    expect(window.location.hash).toBe('#workbench/space');
  });

  it('当前分区那一项带 aria-current="page"，其余不带', () => {
    useSectionStore.getState().setActiveSection('my-workbench');
    render(<MobileQuickBar onSearch={() => {}} />);
    expect(screen.getByRole('button', { name: /等我/ })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.getByRole('button', { name: '空间' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: '搜索' })).not.toHaveAttribute('aria-current');
  });

  it('点「搜索」回调打开命令面板，不动 hash', () => {
    const onSearch = vi.fn();
    render(<MobileQuickBar onSearch={onSearch} />);
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('');
  });
});

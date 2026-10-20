import { describe, expect, it, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { PendingBanner } from './pending-banner';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import { useInviteStore } from '@/lib/matrix-invite-store';
import { useRoomMetaStore } from '@/hooks/use-matrix';
import { useSectionStore } from '@/lib/section-store';

afterEach(cleanup);

describe('PendingBanner（F4.3 待办聚合横幅）', () => {
  beforeEach(() => {
    useHitlInboxStore.setState({ confirmations: {} });
    useInviteStore.setState({ invites: {} });
    useRoomMetaStore.setState({ meta: {} });
  });

  it('零待办不渲染', () => {
    const { container } = render(<PendingBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('按优先级聚合：干预 > 审批 > @我的，点击直达我的工作台', () => {
    useHitlInboxStore.setState({
      confirmations: {
        iv1: {
          id: 'iv1', roomId: '!r1:x', eventId: '$1', sender: '@agent:x', toolName: 'ask_human',
          question: '泳道维度？', approveReply: '/approve', rejectReply: '拒绝', timestamp: Date.now(),
        },
        ap1: {
          id: 'ap1', roomId: '!r1:x', eventId: '$2', sender: '@agent:x', toolName: 'browser.click',
          approveReply: '/approve', rejectReply: '拒绝', timestamp: Date.now(),
        },
      },
    });
    useInviteStore.setState({
      invites: { '!r9:x': { roomId: '!r9:x', sender: '@agent:x' } },
    });
    useRoomMetaStore.setState({
      meta: {
        '!r2:x': { unreadHighlightCount: 3, updatedAt: 1, roomName: '设计空间' },
        '!r3:x': { unreadCount: 5, updatedAt: 1, roomName: '无提及' },
      },
    });
    render(<PendingBanner />);
    const banner = screen.getByRole('status');
    expect(banner.textContent).toContain('4 条待你处理');
    expect(banner.textContent).toContain('1 条待干预');
    expect(banner.textContent).toContain('2 条待审批');
    expect(banner.textContent).toContain('1 个房间 @你');
    fireEvent.click(screen.getByRole('button', { name: '去处理' }));
    expect(useSectionStore.getState().activeSection).toBe('my-workbench');
  });
});

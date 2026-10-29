import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { NotificationPopover } from './notification-popover';
import { useNotificationStore, type NewNotification } from '@/lib/notification-store';

/**
 * C-1「通知点击直达上下文」的验收：通知不只是被读掉，还要把用户带到
 * 发出这条通知的房间 / 资源分区。跳转本身只写 hash，解析交给
 * use-active-section 的 hashchange 监听器，所以这里断言到 hash 即可。
 */

function pushNotification(notification: NewNotification) {
  useNotificationStore.getState().addNotification(notification);
}

async function openPopoverAndClick(titlePattern: RegExp) {
  render(<NotificationPopover />);
  fireEvent.click(screen.getByRole('button', { name: /条未读）$/ }));
  fireEvent.click(await screen.findByRole('button', { name: titlePattern }));
}

afterEach(() => {
  cleanup();
  useNotificationStore.setState({ notifications: [] });
  window.location.hash = '';
});

describe('NotificationPopover（C-1 通知点击直达上下文）', () => {
  beforeEach(() => {
    window.location.hash = '#workbench/me';
  });

  it('带房间定位的通知：跳房间深链并标记已读', async () => {
    pushNotification({
      type: 'warning',
      title: '干预请求已超时',
      message: '「泳道维度？」在 30 分钟内未获答复。',
      origin: 'system',
      roomId: '!roomA:hs.example',
    });

    await openPopoverAndClick(/干预请求已超时/);

    expect(window.location.hash).toBe('#workbench/space/!roomA:hs.example');
    expect(useNotificationStore.getState().notifications[0].read).toBe(true);
  });

  it('只有 actionUrl 的通知：跳到该分区深链', async () => {
    pushNotification({
      type: 'info',
      title: 'Worker "coder" 状态变更',
      message: 'Running → Failed',
      origin: 'system',
      actionUrl: '#console/resources/workers',
    });

    await openPopoverAndClick(/Worker "coder" 状态变更/);

    expect(window.location.hash).toBe('#console/resources/workers');
  });

  it('房间定位优先于 actionUrl：干预通知要回到房间，不是资源 tab', async () => {
    pushNotification({
      type: 'error',
      title: '审批超时',
      message: '浏览器审批未响应',
      roomId: '!roomB:hs.example',
      actionUrl: '#console/resources/managers',
    });

    await openPopoverAndClick(/审批超时/);

    expect(window.location.hash).toBe('#workbench/space/!roomB:hs.example');
  });

  it('没有跳转上下文的通知：只标记已读，不动 URL', async () => {
    pushNotification({
      type: 'success',
      title: '团队已删除',
      message: '团队 "agents" 已删除',
    });

    await openPopoverAndClick(/团队已删除/);

    expect(window.location.hash).toBe('#workbench/me');
    expect(useNotificationStore.getState().notifications[0].read).toBe(true);
  });

  it('可跳转的通知给出「查看上下文」提示，普通通知没有', async () => {
    pushNotification({
      type: 'warning',
      title: '可跳转',
      message: '有房间定位',
      roomId: '!roomC:hs.example',
    });
    pushNotification({ type: 'info', title: '不可跳转', message: '纯提示' });

    render(<NotificationPopover />);
    fireEvent.click(screen.getByRole('button', { name: /条未读）$/ }));
    const jumpable = await screen.findByRole('button', { name: /有房间定位/ });
    const plain = screen.getByRole('button', { name: /纯提示/ });

    expect(within(jumpable).getByText('查看上下文')).toBeInTheDocument();
    expect(within(plain).queryByText('查看上下文')).not.toBeInTheDocument();
  });
});

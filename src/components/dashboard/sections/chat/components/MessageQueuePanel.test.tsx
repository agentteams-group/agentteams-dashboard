import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MessageQueuePanel } from './MessageQueuePanel';

afterEach(cleanup);
it('shows ordered summaries, full text, and per-message insert/delete actions', async () => {
  const onSend = vi.fn(), onRemove = vi.fn();
  const messages = ['先整理订单数据', '只保留杭州的数据\n并检查退单记录。\n不要覆盖原文件。', '最后输出 CSV'].map((body, index) => ({
    id: String(index), request: { roomId: '!room:test', body },
  }));
  render(<MessageQueuePanel messages={messages} onSend={onSend} onRemove={onRemove} />);
  fireEvent.click(screen.getByRole('button', { name: '3 条排队中' }));
  const queue = screen.getByRole('dialog', { name: '待发送消息队列' });
  expect(within(queue).getAllByRole('listitem').map(item => item.textContent)).toEqual([
    expect.stringContaining('先整理订单数据'), expect.stringContaining('只保留杭州的数据'), expect.stringContaining('最后输出 CSV'),
  ]);
  fireEvent.focus(screen.getByRole('button', { name: '查看第 2 条排队消息全文' }));
  expect((await screen.findByRole('dialog', { name: '排队消息全文' })).textContent).toContain(messages[1].request.body);
  fireEvent.click(screen.getByRole('button', { name: '插队发送第 2 条消息' }));
  expect(onSend).toHaveBeenCalledWith('1');
  fireEvent.click(screen.getByRole('button', { name: '删除第 3 条排队消息' }));
  expect(onRemove).toHaveBeenCalledWith('2');
});

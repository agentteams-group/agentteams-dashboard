import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import { RoomSearchBar } from './room-search-bar';
import type { MatrixEvent } from '@/lib/matrix-api';
import type { RoomSearchResult } from '@/lib/matrix-search';

// 搜索条只负责「hook 给什么结果就渲染什么」；上游请求由代理路由与 matrix-search 各自的测试覆盖。
// 名字必须以 mock 开头：vi.mock 工厂会被提升，引用普通外部变量会炸。
const mockSearch = vi.fn();
vi.mock('@/hooks/use-matrix', () => ({
  useMatrixRoomSearch: (roomId: string | null, term: string, options?: { enabled?: boolean }) =>
    mockSearch(roomId, term, options),
}));

function messageEvent(id: string, body: string, sender = '@worker:hs.example'): MatrixEvent {
  return {
    event_id: id,
    sender,
    type: 'm.room.message',
    origin_server_ts: 1_730_000_000_000,
    content: { msgtype: 'm.text', body },
  };
}

function result(over: Partial<RoomSearchResult> = {}): RoomSearchResult {
  return { hits: [], unsupported: false, ...over };
}

function ok(data: RoomSearchResult) {
  mockSearch.mockReturnValue({ data, isError: false, isFetching: false });
}

function renderBar(props: {
  loadedEvents?: MatrixEvent[];
  onReveal?: (_eventId: string) => boolean;
  onLoadEarlier?: () => Promise<unknown>;
} = {}) {
  const onReveal = props.onReveal ?? vi.fn(() => true);
  const onLoadEarlier = props.onLoadEarlier ?? vi.fn(async () => undefined);
  render(
    <RoomSearchBar
      roomId="!room:hs.example"
      loadedEvents={props.loadedEvents ?? []}
      memberMap={{ '@worker:hs.example': '小工' }}
      onReveal={onReveal}
      onLoadEarlier={onLoadEarlier}
      onClose={vi.fn()}
    />,
  );
  return { onReveal, onLoadEarlier };
}

async function typeTerm(term: string) {
  fireEvent.change(screen.getByLabelText('搜索房间消息内容'), { target: { value: term } });
}

// vitest 配置里没有 globals，RTL 不会自动 cleanup；不清掉的话下一个用例查同名输入框会命中多个。
afterEach(cleanup);

beforeEach(() => {
  mockSearch.mockReset();
  // 未被打字前没有任何结果，别用到别的用例留下的返回值。
  mockSearch.mockReturnValue({ data: undefined, isError: false, isFetching: false });
});

describe('RoomSearchBar（方案 v3 B-1）', () => {
  it('服务端命中：渲染发送者与 <mark> 片段，并给出「第几条/共几条·约总数」', async () => {
    ok(result({ hits: [{ event: messageEvent('$1', '要先清缓存再发布') }], totalHits: 3 }));
    renderBar();
    typeTerm('缓存');

    expect(await screen.findByText('小工')).toBeInTheDocument();
    expect(screen.getByRole('mark').textContent).toBe('缓存');
    expect(await screen.findByText('1/1·约3')).toBeInTheDocument();
  });

  it('不足两个字符不发起检索，也不说「无命中」', async () => {
    renderBar();
    typeTerm('缓');

    // hook 收的是去抖后的词，所以首轮调用带空串；要等的是去抖到期后那一次。
    await waitFor(() =>
      expect(mockSearch).toHaveBeenCalledWith('!room:hs.example', '缓', { enabled: false }),
    );
    expect(screen.queryByText('无命中')).not.toBeInTheDocument();
  });

  it('服务端不支持检索：明写降级原因，并退回已加载消息的本地匹配', async () => {
    ok(result({ unsupported: true, reason: 'Searching is not enabled' }));
    const { onReveal } = renderBar({ loadedEvents: [messageEvent('$9', '上周那条讲 cache 的记录')] });
    typeTerm('cache');

    const notice = await screen.findByText(/该服务端不支持内容检索/);
    expect(notice.textContent).toContain('Searching is not enabled');
    expect(notice.textContent).toContain('已退回只搜索已加载的消息');
    expect(await screen.findByRole('mark')).toHaveTextContent('cache');
    await waitFor(() => expect(onReveal).toHaveBeenCalledWith('$9'));
  });

  it('命中不在已加载窗口时往前翻页去找，翻到上限就停（不打穿上游）', async () => {
    ok(result({ hits: [{ event: messageEvent('$far', '很久以前的缓存讨论') }] }));
    const { onReveal, onLoadEarlier } = renderBar({ onReveal: vi.fn(() => false) });
    typeTerm('缓存');

    await waitFor(() => expect(onLoadEarlier).toHaveBeenCalledTimes(8), { timeout: 3000 });
    // 翻页上限就是这里：先试定位 1 次 + 每页加载后再试 1 次，共 9 次；第 9 页不会去打上游。
    expect(onReveal).toHaveBeenCalledTimes(9);
  });

  it('Enter 跳下一条、Shift+Enter 跳上一条，计数跟着走', async () => {
    ok(result({ hits: [{ event: messageEvent('$a', '缓存一') }, { event: messageEvent('$b', '缓存二') }] }));
    const { onReveal } = renderBar();
    typeTerm('缓存');
    await waitFor(() => expect(onReveal).toHaveBeenCalledWith('$a'));

    const input = screen.getByLabelText('搜索房间消息内容');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('2/2')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(onReveal).toHaveBeenLastCalledWith('$a');
  });

  it('Esc 关掉搜索条', async () => {
    const onClose = vi.fn();
    render(
      <RoomSearchBar
        roomId="!room:hs.example"
        loadedEvents={[]}
        onReveal={() => true}
        onLoadEarlier={async () => undefined}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(screen.getByLabelText('搜索房间消息内容'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

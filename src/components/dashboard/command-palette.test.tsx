import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import { CommandPalette, useGlobalSearch } from './command-palette';
import type { MatrixEvent } from '@/lib/matrix-api';
import type { RoomMeta } from '@/hooks/use-matrix';
import type { RoomSearchResult } from '@/lib/matrix-search';
import { roomHash } from '@/lib/nav-hash';

// 面板只负责「hook 给什么就渲染什么」；上游 /search 的请求与解析由
// matrix-search、代理路由各自的测试覆盖。外部变量名必须以 mock 开头：
// vi.mock 工厂会被提升到文件顶部，引用普通变量会炸。
const mockMessageSearch = vi.fn();
const mockRoomMeta: Record<string, RoomMeta> = {
  '!team:hs.example': { roomName: '项目小队', updatedAt: 1_730_000_000_000 },
};
const mockBoard = { tasks: [], projects: [] };
const mockAudit = { data: { events: [] } };
const mockOnSelect = vi.fn();

vi.mock('@/hooks/use-matrix', () => ({
  // 面板要的是「房间 id → 房间名」这份现成的取法（和 room 实体同一个来源）。
  useRoomMetaStore: (selector: (_state: { meta: Record<string, RoomMeta> }) => unknown) =>
    selector({ meta: mockRoomMeta }),
  useMatrixMessageSearch: (term: string, options?: { enabled?: boolean }) =>
    mockMessageSearch(term, options),
}));

vi.mock('@/hooks/use-task-board', () => ({ useMergedTaskBoard: () => mockBoard }));
vi.mock('@/hooks/use-audit-events', () => ({ useAuditEvents: () => mockAudit }));
// 循环草案读的是 localStorage，面板测试不关心它，也别真去读。
vi.mock('@/components/dashboard/sections/loops-section', () => ({ readDrafts: () => [] }));

function messageEvent(eventId: string, body: string, roomId?: string): MatrixEvent {
  return {
    event_id: eventId,
    sender: '@worker:hs.example',
    type: 'm.room.message',
    origin_server_ts: 1_730_000_000_000,
    room_id: roomId,
    content: { msgtype: 'm.text', body },
  };
}

function ok(data: RoomSearchResult) {
  mockMessageSearch.mockReturnValue({ data, isError: false, isFetching: false });
}

/** 把面板的两个出口接起来：真实顶栏就是这么用的（hook → 渲染 → onSelect）。 */
function renderPalette(query: string) {
  function Harness() {
    const results = useGlobalSearch(query, undefined, undefined, undefined, undefined, {
      enabled: true,
    });
    return <CommandPalette results={results} onSelect={mockOnSelect} onClose={vi.fn()} />;
  }
  render(<Harness />);
}

// vitest 配置里没有 globals，RTL 不会自动 cleanup。
afterEach(cleanup);

// jsdom 不实现 Element.prototype.scrollIntoView：面板高亮后的滚动定位
// 在测试环境里只能是空操作（浏览器里这行本来就有）。
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  mockMessageSearch.mockReset();
  mockOnSelect.mockReset();
  // 默认：还没发过请求（词太短 / 面板没开）。
  mockMessageSearch.mockReturnValue({ data: undefined, isError: false, isFetching: false });
});

describe('CommandPalette 跨房间消息（方案 v3 B-1 延伸）', () => {
  it('命中渲染成可点的结果，点开带上房间与检索词深链', () => {
    ok({
      hits: [{ event: messageEvent('$a', '我们是不是要先删缓存再发布？', '!team:hs.example') }],
      unsupported: false,
    });
    renderPalette('缓存');

    const hit = screen.getByRole('button', { name: /删缓存/ });
    // 副标题用的是 roomMeta 里那个房间名，和 room 实体同一个来源。
    expect(hit).toHaveTextContent('项目小队');
    fireEvent.click(hit);
    expect(mockOnSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'message',
        roomId: '!team:hs.example',
        hash: `${roomHash('!team:hs.example')}?q=${encodeURIComponent('缓存')}`,
      }),
    );
  });

  it('定位不到所属房间的命中直接不给：宁少一条，也不要跳到错的会话', () => {
    ok({ hits: [{ event: messageEvent('$b', '缓存已清空', undefined) }], unsupported: false });
    renderPalette('缓存');
    expect(screen.queryByRole('button', { name: /缓存/ })).not.toBeInTheDocument();
  });

  it('服务端没有全文索引：显示降级状态行，而不是伪装成「没有命中」', () => {
    ok({ hits: [], unsupported: true, reason: 'Searching is not enabled' });
    renderPalette('缓存');
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('该服务端不支持内容检索（Searching is not enabled）');
    // 状态行不是可点结果，否则键盘高亮会整体错一位。
    expect(screen.queryByRole('button', { name: /不支持内容检索/ })).not.toBeInTheDocument();
  });

  it('检索请求失败：明写失败，别让用户以为房间里没有这句话', () => {
    mockMessageSearch.mockReturnValue({ data: undefined, isError: true, isFetching: false });
    renderPalette('缓存');
    expect(screen.getByRole('status')).toHaveTextContent('消息检索失败');
  });
});

import { describe, expect, it } from 'vitest';

import {
  buildRoomSearchFilter,
  buildSearchProxyPath,
  detectSearchUnsupported,
  highlightSnippet,
  parseRoomSearchResponse,
  searchErrorMessage,
  searchInLoadedMessages,
} from './matrix-search';
import type { MatrixEvent } from './matrix-api';

function messageEvent(eventId: string, body: string, type = 'm.room.message'): MatrixEvent {
  return {
    event_id: eventId,
    sender: '@worker:hs.example',
    type,
    origin_server_ts: 1_730_000_000_000,
    content: { msgtype: 'm.text', body },
  };
}

describe('buildRoomSearchFilter（方案 v3 B-1）', () => {
  it('同时给出早期与 1.2+ 两种形状，并把范围钉在当前房间', () => {
    const filter = JSON.parse(buildRoomSearchFilter('!room:hs.example', '缓存', 20));
    expect(filter.search_terms).toEqual(['缓存']);
    // 早期形状：category + filter（Synapse 一直在收）
    expect(filter.category).toBe('room');
    expect(filter.filter.rooms).toEqual(['!room:hs.example']);
    expect(filter.filter.types).toEqual(['m.room.message']);
    expect(filter.filter.limit).toBe(20);
    // 1.2+ 形状：room_events 子对象
    expect(filter.room_events.order_by).toBe('recent');
    expect(filter.room_events.filter.rooms).toEqual(['!room:hs.example']);
  });

  it('roomId 传 null = 跨房间：两种形状都不能带 rooms 字段', () => {
    // 空数组在 Synapse 上是「不匹配任何房间」，会被当成搜不到，所以必须整个省掉。
    const filter = JSON.parse(buildRoomSearchFilter(null, '缓存', 20));
    expect(filter.filter.rooms).toBeUndefined();
    expect(filter.room_events.filter.rooms).toBeUndefined();
    expect(filter.filter.types).toEqual(['m.room.message']);
    expect(filter.room_events.limit).toBe(20);
  });

  it('limit 越界收到 1..100，非整数向下取整', () => {
    expect(JSON.parse(buildRoomSearchFilter('!r:h', 'x', 0)).filter.limit).toBe(1);
    expect(JSON.parse(buildRoomSearchFilter('!r:h', 'x', 9999)).filter.limit).toBe(100);
    expect(JSON.parse(buildRoomSearchFilter('!r:h', 'x', 37.8)).filter.limit).toBe(37);
  });
});

describe('detectSearchUnsupported', () => {
  it('404 与带检索相关错误码的 4xx 判为「服务端不支持」', () => {
    expect(detectSearchUnsupported(404, null)).toBe(true);
    expect(detectSearchUnsupported(400, { errcode: 'M_SEARCH_DISABLED', error: 'Searching is not enabled' })).toBe(true);
    expect(detectSearchUnsupported(400, { errcode: 'M_UNRECOGNIZED' })).toBe(true);
    // 400 但没给 errcode：上游没按 Matrix 错误体回答，同样不能当成搜到了 0 条。
    expect(detectSearchUnsupported(400, 'not json')).toBe(true);
  });

  it('登录失效与服务端故障不是降级，要照常抛错', () => {
    expect(detectSearchUnsupported(401, { errcode: 'M_UNKNOWN_TOKEN' })).toBe(false);
    expect(detectSearchUnsupported(403, { errcode: 'M_FORBIDDEN' })).toBe(false);
    expect(detectSearchUnsupported(500, null)).toBe(false);
    expect(detectSearchUnsupported(200, { results: {} })).toBe(false);
  });

  it('searchErrorMessage 只取字符串 error', () => {
    expect(searchErrorMessage({ errcode: 'M_SEARCH_DISABLED', error: 'Searching is not enabled' })).toBe(
      'Searching is not enabled',
    );
    expect(searchErrorMessage({ error: 42 })).toBeUndefined();
    expect(searchErrorMessage(null)).toBeUndefined();
  });
});

describe('parseRoomSearchResponse', () => {
  it('吃早期形状 results.results', () => {
    const parsed = parseRoomSearchResponse({
      results: { results: [{ rank: 1, event: messageEvent('$a', 'x') }], next_batch: 'tok-2' },
    });
    expect(parsed.hits).toHaveLength(1);
    expect(parsed.hits[0].rank).toBe(1);
    expect(parsed.nextBatch).toBe('tok-2');
    expect(parsed.unsupported).toBe(false);
  });

  it('吃 1.2+ 形状 results.room_events.results，并读出总命中数', () => {
    const parsed = parseRoomSearchResponse({
      results: {
        room_events: {
          hits: 17,
          next_batch: 'tok-3',
          results: [{ event: messageEvent('$b', 'y') }, { event: messageEvent('$c', 'z') }],
        },
      },
    });
    expect(parsed.totalHits).toBe(17);
    expect(parsed.hits.map((h) => h.event.event_id)).toEqual(['$b', '$c']);
    expect(parsed.nextBatch).toBe('tok-3');
  });

  it('丢掉没有 event_id 的条目，缺 results 时按空结果而不是报错', () => {
    const parsed = parseRoomSearchResponse({
      results: { results: [{ event: { sender: '@a:h', type: 'm.room.message', content: {} } }, { event: messageEvent('$d', 'w') }] },
    });
    expect(parsed.hits).toHaveLength(1);
    expect(parseRoomSearchResponse({}).hits).toEqual([]);
    expect(parseRoomSearchResponse(null).hits).toEqual([]);
  });

  it('空字符串的 next_batch 不算还有分页', () => {
    expect(parseRoomSearchResponse({ results: { results: [], next_batch: '' } }).nextBatch).toBeUndefined();
  });
});

describe('buildSearchProxyPath', () => {
  it('filter 整体 URL 编码，next_batch 缺省时不拼空参数', () => {
    const path = buildSearchProxyPath('{"search_terms":["缓存"]}');
    expect(path).toContain('/_matrix/client/v3/search?filter=');
    expect(path).not.toContain('next_batch');
    expect(decodeURIComponent(path.split('filter=')[1])).toBe('{"search_terms":["缓存"]}');
    expect(buildSearchProxyPath('f', 'tok').toString()).toContain('next_batch=tok');
  });
});

describe('searchInLoadedMessages（本地降级）', () => {
  const events = [
    messageEvent('$1', 'Need to flush the CACHE before deploy'),
    messageEvent('$2', 'cache 已清空'),
    { ...messageEvent('$3', 'CACHE'), type: 'm.room.topic' },
    messageEvent('$4', '别的', 'm.notice'),
  ];

  it('大小写不敏感，且只匹配消息类事件', () => {
    expect(searchInLoadedMessages(events, 'cache').map((h) => h.event.event_id)).toEqual(['$1', '$2']);
    expect(searchInLoadedMessages(events, '  CACHE  ').map((h) => h.event.event_id)).toEqual(['$1', '$2']);
  });

  it('空检索词不返回全量', () => {
    expect(searchInLoadedMessages(events, '')).toEqual([]);
    expect(searchInLoadedMessages(events, '   ')).toEqual([]);
  });

  it('没有可匹配正文的事件类型不炸', () => {
    const odd = [
      { ...messageEvent('$x', ''), type: 'm.room.message', content: { msgtype: 'm.image' } },
    ] as MatrixEvent[];
    expect(searchInLoadedMessages(odd, 'x')).toEqual([]);
  });
});

describe('highlightSnippet', () => {
  it('给出前缀/命中/后缀三段，越界时补省略号', () => {
    const text = '我们是不是要先删缓存再发布？';
    const hit = highlightSnippet(text, '缓存');
    expect(hit?.match).toBe('缓存');
    expect(text.startsWith(hit!.before.replace(/^…/, ''))).toBe(true);
    expect(hit?.after).toContain('发布');
    const long = `${'开'.repeat(80)}目标${'尾'.repeat(80)}`;
    const snip = highlightSnippet(long, '目标');
    expect(snip!.before.startsWith('…')).toBe(true);
    expect(snip!.after.endsWith('…')).toBe(true);
    expect(snip!.before.length).toBeLessThanOrEqual(29 + 1);
  });

  it('命中不在文本里、检索词为空时返回 null', () => {
    expect(highlightSnippet('abc', 'xyz')).toBeNull();
    expect(highlightSnippet('abc', '  ')).toBeNull();
  });
});

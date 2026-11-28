import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { MatrixEvent } from '@/lib/matrix-api';
import { formatMatrixEvents } from '@/hooks/use-matrix';
import { useIncrementalMatrixTimeline } from './use-incremental-matrix-timeline';

vi.mock('@/hooks/use-matrix', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-matrix')>();
  return {
    ...actual,
    formatMatrixEvents: vi.fn(actual.formatMatrixEvents),
  };
});

const formatMock = vi.mocked(formatMatrixEvents);

function message(eventId: string, timestamp: number, extra: Record<string, unknown> = {}): MatrixEvent {
  return {
    event_id: eventId,
    sender: '@agent:test',
    type: 'm.room.message',
    origin_server_ts: timestamp,
    content: { msgtype: 'm.text', body: `message ${eventId}`, ...extra },
  };
}

function renderTimeline(events: MatrixEvent[], roomId = '!room:test') {
  return renderHook(
    ({ timeline }) => useIncrementalMatrixTimeline(roomId, timeline, '@me:test'),
    { initialProps: { timeline: events } },
  );
}

describe('useIncrementalMatrixTimeline', () => {
  beforeEach(() => {
    formatMock.mockClear();
  });

  it('formats immutable history once and reuses it on tick-like rerenders', () => {
    const events = [message('$one', 1000), message('$two', 2000)];
    const { result, rerender } = renderTimeline(events);
    const initial = result.current;
    expect(formatMock).toHaveBeenCalledTimes(1);
    expect(formatMock.mock.calls[0][0]).toBe(events);

    rerender({ timeline: events });
    expect(result.current).toBe(initial);
    expect(formatMock).toHaveBeenCalledTimes(1);

    rerender({ timeline: [...events] });
    expect(result.current).toBe(initial);
    expect(formatMock).toHaveBeenCalledTimes(1);
  });

  it('formats only appended events and incrementally merges them', () => {
    const one = message('$one', 1000);
    const two = message('$two', 2000);
    const three = message('$three', 3000);
    const { result, rerender } = renderTimeline([one, two]);
    const initial = result.current;

    rerender({ timeline: [one, two, three] });
    expect(formatMock).toHaveBeenCalledTimes(2);
    expect(formatMock.mock.calls[1][0]).toEqual([three]);
    expect(result.current.map(item => item.id)).toEqual(['$one', '$two', '$three']);
    expect(result.current[0]).toBe(initial[0]);
    expect(result.current[1]).toBe(initial[1]);
  });

  it('formats only an older-page prepend while preserving timestamp order', () => {
    const recent = message('$recent', 3000);
    const { result, rerender } = renderTimeline([recent]);
    const older = message('$older', 1000);

    rerender({ timeline: [older, recent] });
    expect(formatMock).toHaveBeenCalledTimes(2);
    expect(formatMock.mock.calls[1][0]).toEqual([older]);
    expect(result.current.map(item => item.id)).toEqual(['$older', '$recent']);
  });

  it('rebuilds when an existing event object is replaced', () => {
    const original = message('$one', 1000);
    const { result, rerender } = renderTimeline([original]);
    rerender({ timeline: [{ ...original, content: { msgtype: 'm.text', body: 'edited' } }] });
    expect(result.current[0].content).toBe('edited');
    expect(formatMock).toHaveBeenCalledTimes(2);
  });

  it('rebuilds for edits, redactions, and late thread roots', () => {
    const root = message('$root', 1000);
    const edit = message('$edit', 2000, {
      'm.relates_to': { rel_type: 'm.replace', event_id: '$root' },
    });
    const redaction: MatrixEvent = {
      event_id: '$redaction', sender: '@mod:test', type: 'm.room.redaction',
      origin_server_ts: 3000, redacts: '$root', content: {},
    };
    const reply = message('$reply', 1500, {
      'm.relates_to': { rel_type: 'm.thread', event_id: '$late-root' },
    });
    const { rerender } = renderTimeline([root]);
    rerender({ timeline: [root, edit] });
    expect(formatMock).toHaveBeenCalledTimes(2);
    rerender({ timeline: [root, edit, redaction] });
    expect(formatMock).toHaveBeenCalledTimes(3);
    rerender({ timeline: [root, edit, redaction, reply] });
    expect(formatMock).toHaveBeenCalledTimes(4);
    rerender({ timeline: [root, edit, redaction, reply, message('$late-root', 500)] });
    expect(formatMock).toHaveBeenCalledTimes(5);
  });

  it('rebuilds when the room or reader changes', () => {
    const events = [message('$one', 1000)];
    const { result, rerender } = renderTimeline(events);
    rerender({ timeline: events });
    expect(formatMock).toHaveBeenCalledTimes(1);

    const otherRoom = renderTimeline(events, '!other:test');
    expect(otherRoom.result.current).not.toBe(result.current);
    expect(formatMock).toHaveBeenCalledTimes(2);
  });

  it('keeps 5,000-event preprocessing p95 within 50 ms', () => {
    const events = Array.from({ length: 5000 }, (_, index) => message(`$event-${index}`, index * 1000));
    for (let index = 0; index < 3; index += 1) {
      const warmup = renderTimeline(events);
      warmup.unmount();
    }

    const samples: number[] = [];
    for (let index = 0; index < 15; index += 1) {
      const start = performance.now();
      const rendered = renderTimeline(events);
      samples.push(performance.now() - start);
      rendered.unmount();
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
    expect(p95).toBeLessThanOrEqual(50);
  });
});

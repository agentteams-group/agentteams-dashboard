'use client';

import { useState } from 'react';
import type { MatrixEvent } from '@/lib/matrix-api';
import {
  formatMatrixEvents,
  mergeAnswerFragments,
  type DisplayMessage,
} from '@/hooks/use-matrix';

interface TimelineState {
  roomId?: string;
  events: MatrixEvent[];
  currentUserId: string;
  result: TimelineResult;
}

interface TimelineResult {
  cache: TimelineCache;
  messages: DisplayMessage[];
}

interface TimelineCache {
  roomId?: string;
  currentUserId: string;
  events: MatrixEvent[];
  byId: Map<string, MatrixEvent>;
  threadRootIds: Set<string>;
  messages: DisplayMessage[];
}

function relationOf(event: MatrixEvent): { rel_type?: string; event_id?: string } | undefined {
  return event.content?.['m.relates_to'] as { rel_type?: string; event_id?: string } | undefined;
}

function collectThreadRoots(events: MatrixEvent[]): Set<string> {
  const roots = new Set<string>();
  for (const event of events) {
    const relation = relationOf(event);
    if (relation?.rel_type === 'm.thread' && relation.event_id) roots.add(relation.event_id);
  }
  return roots;
}

function needsFullRebuild(previous: TimelineCache, events: MatrixEvent[]): boolean {
  const nextIds = new Set(events.map(event => event.event_id));
  for (const event of previous.events) {
    if (!nextIds.has(event.event_id)) return true;
  }
  for (const event of events) {
    if (previous.byId.has(event.event_id) && previous.byId.get(event.event_id) !== event) return true;
  }
  for (const event of events) {
    if (previous.byId.has(event.event_id)) continue;
    const relation = relationOf(event);
    if (event.type === 'm.room.redaction' || relation?.rel_type === 'm.replace' || relation?.rel_type === 'm.thread') {
      return true;
    }
    // A late thread root changes how already-formatted orphan replies project.
    if (previous.threadRootIds.has(event.event_id)) return true;
  }
  return false;
}

function buildCache(roomId: string | undefined, events: MatrixEvent[], currentUserId: string): TimelineCache {
  return {
    roomId,
    currentUserId,
    events: [...events],
    byId: new Map(events.map(event => [event.event_id, event])),
    threadRootIds: collectThreadRoots(events),
    messages: formatMatrixEvents(events, currentUserId),
  };
}

export function computeTimeline(
  previous: TimelineCache | null,
  roomId: string | undefined,
  events: MatrixEvent[],
  currentUserId: string,
): TimelineResult {
  if (!previous || previous.roomId !== roomId || previous.currentUserId !== currentUserId) {
    const cache = buildCache(roomId, events, currentUserId);
    return { cache, messages: cache.messages };
  }

  const unchanged = previous.events.length === events.length
    && previous.events.every((event, index) => events[index] === event);
  if (unchanged) return { cache: previous, messages: previous.messages };

  if (needsFullRebuild(previous, events)) {
    const cache = buildCache(roomId, events, currentUserId);
    return { cache, messages: cache.messages };
  }

  const added = events.filter(event => !previous.byId.has(event.event_id));
  if (added.length === 0) return { cache: previous, messages: previous.messages };
  const formattedAdded = formatMatrixEvents(added, currentUserId);
  const messages = mergeAnswerFragments(
    [...previous.messages, ...formattedAdded].sort((a, b) => a.timestamp - b.timestamp),
  );
  return {
    cache: {
      ...previous,
      events: [...events],
      byId: new Map(events.map(event => [event.event_id, event])),
      threadRootIds: new Set([...previous.threadRootIds, ...collectThreadRoots(added)]),
      messages,
    },
    messages,
  };
}

/**
 * Formats immutable Matrix history once. Ordinary appended/prepended events are
 * formatted independently and merged into the cached display timeline. Edits,
 * redactions and thread-root changes invalidate the cache because they can
 * rewrite earlier messages; those exceptional paths retain full correctness.
 */
export function useIncrementalMatrixTimeline(
  roomId: string | undefined,
  events: MatrixEvent[],
  currentUserId: string,
): DisplayMessage[] {
  const [state, setState] = useState<TimelineState>(() => ({
    roomId,
    events,
    currentUserId,
    result: computeTimeline(null, roomId, events, currentUserId),
  }));
  if (state.roomId !== roomId || state.events !== events || state.currentUserId !== currentUserId) {
    const next: TimelineState = {
      roomId,
      events,
      currentUserId,
      result: computeTimeline(state.result.cache, roomId, events, currentUserId),
    };
    setState(next);
    return next.result.messages;
  }
  return state.result.messages;
}

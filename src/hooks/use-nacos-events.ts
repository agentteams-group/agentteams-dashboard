'use client';

import { apiUrl } from '@/lib/api-base';

import { useEffect, useState, useRef } from 'react';
import { SyncEvent } from '@/lib/nacos-sync-engine';

const INITIAL_DELAY = 5000;
const MAX_DELAY = 60_000;

export function useNacosEvents() {
  const [events, setEvents] = useState<SyncEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let backoff = INITIAL_DELAY;
    let disposed = false;

    function connect() {
      if (disposed) return;
      const es = new EventSource(apiUrl('/api/agentteams/skills/nacos/events'));
      esRef.current = es;

      es.onopen = () => {
        setConnected(true);
        backoff = INITIAL_DELAY;
      };

      es.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as SyncEvent;
          setEvents((prev) => [...prev.slice(-99), event]);
        } catch { /* ignore parse errors */ }
      };

      es.onerror = () => {
        setConnected(false);
        es.close();
        if (disposed) return;
        reconnectTimer = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, MAX_DELAY);
      };
    }

    connect();

    return () => {
      disposed = true;
      // Close the *latest* instance (a reconnect may have replaced the
      // original one) — see FUNC-08 cleanup race.
      esRef.current?.close();
      esRef.current = null;
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);

  return { events, connected };
}

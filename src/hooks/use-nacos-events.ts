'use client';

import { useEffect, useState, useRef } from 'react';
import { SyncEvent } from '@/lib/nacos-sync-engine';

export function useNacosEvents() {
  const [events, setEvents] = useState<SyncEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let es: EventSource;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      es = new EventSource('/api/agentteams/skills/nacos/events');
      esRef.current = es;

      es.onopen = () => setConnected(true);

      es.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as SyncEvent;
          setEvents((prev) => [...prev.slice(-99), event]);
        } catch { /* ignore parse errors */ }
      };

      es.onerror = () => {
        setConnected(false);
        es.close();
        reconnectTimer = setTimeout(connect, 5000);
      };
    }

    connect();

    return () => {
      es?.close();
      clearTimeout(reconnectTimer);
    };
  }, []);

  return { events, connected };
}

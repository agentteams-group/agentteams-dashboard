// Audit Event Store
// Persistent log of all governance events (mutations, phase changes, policy violations)

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuditEvent {
  id: string;
  timestamp: number;
  entityType: 'worker' | 'team' | 'manager' | 'human' | 'system';
  entityName: string;
  action: string;
  details?: string;
  actor?: string;   // 'dashboard-user' or system
  severity: 'info' | 'warning' | 'error';
}

interface AuditState {
  events: AuditEvent[];
  addEvent: (_event: Omit<AuditEvent, 'id' | 'timestamp'>) => void;
  clearOld: () => void;
}

const MAX_EVENTS = 500;
const PERSIST_MAX = 200;
let eventCounter = 0;

export const useAuditStore = create<AuditState>()(
  persist(
    (set, _get) => ({
      events: [],

      addEvent: (event) => {
        const newEvent: AuditEvent = {
          ...event,
          id: `audit-${Date.now()}-${++eventCounter}`,
          timestamp: Date.now(),
        };
        set((state) => ({
          events: [newEvent, ...state.events].slice(0, MAX_EVENTS),
        }));
      },

      clearOld: () => {
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days
        set((state) => ({
          events: state.events.filter((e) => e.timestamp > cutoff),
        }));
      },
    }),
    {
      name: 'agentteams-audit',
      version: 1,
      partialize: (state) => ({
        events: state.events.slice(0, PERSIST_MAX),
      }),
    }
  )
);

/** Helper to record a mutation audit event */
export function auditMutation(
  entityType: AuditEvent['entityType'],
  entityName: string,
  action: string,
  details?: string,
  severity: AuditEvent['severity'] = 'info'
) {
  useAuditStore.getState().addEvent({
    entityType,
    entityName,
    action,
    details,
    severity,
    actor: 'dashboard-user',
  });
}

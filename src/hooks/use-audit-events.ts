import { useQuery } from '@tanstack/react-query';

export interface AuditEvent {
  id: string;
  timestamp: number;
  actor?: string;
  actor_level?: number;
  entity_type: 'worker' | 'team' | 'manager' | 'human' | 'system';
  entity_name: string;
  action: string;
  details?: string;
  severity: 'info' | 'warning' | 'error';
  source_ip?: string;
}

export interface AuditQuery {
  from?: number;
  to?: number;
  entityType?: AuditEvent['entity_type'];
  limit?: number;
}

export interface AuditEventsResponse {
  success: boolean;
  events?: AuditEvent[];
  error?: string;
}

/**
 * Fetch server-side audit events. The endpoint is admin-only and returns
 * 403 for non-admin sessions — surfaced via `error` rather than thrown so
 * the UI can render an inline notice instead of crashing.
 */
export function useAuditEvents(query: AuditQuery = {}) {
  return useQuery<AuditEventsResponse>({
    queryKey: ['audit-events', query],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (query.from !== undefined) params.set('from', String(query.from));
      if (query.to !== undefined) params.set('to', String(query.to));
      if (query.entityType) params.set('entityType', query.entityType);
      if (query.limit !== undefined) params.set('limit', String(query.limit));

      const qs = params.toString();
      const res = await fetch(`/api/agentteams/audit${qs ? `?${qs}` : ''}`, {
        credentials: 'same-origin',
      });
      if (res.status === 403) {
        return { success: false, error: '需要管理员权限' };
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { success: false, error: text || `HTTP ${res.status}` };
      }
      return (await res.json()) as AuditEventsResponse;
    },
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
}
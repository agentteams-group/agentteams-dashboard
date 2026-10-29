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
  /** Controller-sourced events only: event category (capability /
   * approval_level / channel / source / exact action for unknown kinds). */
  kind?: string;
  /** Controller-sourced events only: team attribution (targetTeam). */
  team?: string;
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
  observedLevel?: number | null;
  requiredLevel?: number;
  scope?: 'all' | 'self' | 'team';
  /** B6 data-plane provenance: 'controller' (durable cross-entry store,
   * upstream #1270) or 'local' (this instance's JSONL fallback). */
  source?: 'controller' | 'local';
  /** L2 controller-scope: the team the view is restricted to. */
  team?: string;
  /** Human-readable reason the local fallback was used. */
  note?: string;
  upstreamStatus?: number;
}

/**
 * Fetch server-side audit events. The endpoint is admin-only and returns
 * 403 for non-admin sessions — surfaced via `error` rather than thrown so
 * the UI can render an inline notice instead of crashing.
 */
export function useAuditEvents(
  query: AuditQuery = {},
  options: { enabled?: boolean; refetchInterval?: number | false } = {},
) {
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
        const body = (await res.json().catch(() => ({}))) as Partial<AuditEventsResponse>;
        return {
          success: false,
          error: '需要管理员权限',
          observedLevel: body.observedLevel ?? null,
          requiredLevel: body.requiredLevel ?? 3,
        };
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { success: false, error: text || `HTTP ${res.status}` };
      }
      return (await res.json()) as AuditEventsResponse;
    },
    // 默认给审计页的 15s 轮询；命令面板这类「只在打开时读一眼」的调用方
    // 需要把 enabled 关掉、同轮询也关掉，否则顶栏会常驻一个后台拉取。
    refetchInterval: options.refetchInterval ?? 15_000,
    staleTime: 10_000,
    enabled: options.enabled ?? true,
  });
}
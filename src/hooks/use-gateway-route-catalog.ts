'use client';

import { apiUrl } from '@/lib/api-base';

import { useEffect, useState } from 'react';

// Read-only model gateway route catalog (Controller
// `GET /api/v1/gateway/ai-routes`, upstream #1242, L1-only).
//
// This is the degraded read-only fallback for the Models tab when the
// Higress Console session is stale/absent. The route catalog is served by
// the Controller (token-authenticated, always available for L1), so the tab
// can still show what routes/providers/consumers are configured even when
// the Console session is down. CRUD still requires a live Console session.
//
// Status semantics (older / lower-privilege controllers degrade gracefully):
// - 200 → routes rendered (L1 + Controller with the endpoint)
// - 404 → endpoint not deployed (older Controller) → panel hidden (off)
// - 403 → caller lacks permission (L2) → panel shows a notice (noAccess)

export interface GatewayRouteUpstream {
  provider: string;
  weight?: number;
}

export interface GatewayRouteInfo {
  name: string;
  upstreams?: GatewayRouteUpstream[];
  allowedConsumers?: string[];
}

export interface GatewayRouteCatalogState {
  /** true when the endpoint is absent (older Controller) → hide the panel. */
  off: boolean;
  /** true when the caller has no permission (L2) → show a notice. */
  noAccess: boolean;
  loading: boolean;
  routes: GatewayRouteInfo[];
}

export function useGatewayRouteCatalog(): GatewayRouteCatalogState {
  const [state, setState] = useState<GatewayRouteCatalogState>({
    off: false,
    noAccess: false,
    loading: true,
    routes: [],
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl('/api/agentteams/gateway/ai-routes'), {
          cache: 'no-store',
        });
        if (cancelled) return;
        if (res.status === 404) {
          setState({ off: true, noAccess: false, loading: false, routes: [] });
          return;
        }
        if (res.status === 403) {
          setState({ off: false, noAccess: true, loading: false, routes: [] });
          return;
        }
        if (!res.ok) {
          setState({ off: false, noAccess: false, loading: false, routes: [] });
          return;
        }
        const data = (await res.json()) as { routes?: GatewayRouteInfo[] };
        if (!cancelled) {
          setState({
            off: false,
            noAccess: false,
            loading: false,
            routes: Array.isArray(data.routes) ? data.routes : [],
          });
        }
      } catch {
        if (!cancelled) {
          setState({ off: false, noAccess: false, loading: false, routes: [] });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

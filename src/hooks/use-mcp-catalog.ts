'use client';

import { useEffect, useState } from 'react';

// MCP deployment catalog (Controller `GET /api/v1/mcp-servers`, upstream
// #1250) — read-only, carries per-server `workers[]` (which workers wire to
// it). The MinIO-based MCP registry (CRUD) does not carry wiring, so this
// Controller catalog is the authoritative source for the "wired workers"
// column in the MCP section.
//
// Older Controllers (predating the endpoint) return 404 → `off: true` and
// the UI hides the workers column (graceful degradation).

export interface MCPWorkerRef {
  name: string;
  team?: string;
}

export interface MCPCatalogServer {
  name: string;
  source?: string;
  transport?: string;
  url?: string;
  timeout?: number;
  trusted?: boolean;
  workers?: MCPWorkerRef[];
}

export interface MCPCatalogState {
  /** true when the endpoint is absent (older Controller) → hide the column. */
  off: boolean;
  loading: boolean;
  /** server name → workers that wire to it. */
  workersByServer: Map<string, MCPWorkerRef[]>;
  /** Full catalog entries (B7 21.1: trusted flag drives default selection). */
  servers: MCPCatalogServer[];
}

export function useMcpCatalog(): MCPCatalogState {
  const [state, setState] = useState<MCPCatalogState>({
    off: false,
    loading: true,
    workersByServer: new Map(),
    servers: [],
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/agentteams/mcp-catalog', { cache: 'no-store' });
        if (cancelled) return;
        if (res.status === 404) {
          setState({ off: true, loading: false, workersByServer: new Map(), servers: [] });
          return;
        }
        if (!res.ok) {
          setState({ off: false, loading: false, workersByServer: new Map(), servers: [] });
          return;
        }
        const data = (await res.json()) as { servers?: MCPCatalogServer[] };
        if (cancelled) return;
        const map = new Map<string, MCPWorkerRef[]>();
        const servers: MCPCatalogServer[] = [];
        for (const s of Array.isArray(data.servers) ? data.servers : []) {
          if (s && typeof s.name === 'string') {
            map.set(s.name, Array.isArray(s.workers) ? s.workers : []);
            servers.push(s);
          }
        }
        setState({ off: false, loading: false, workersByServer: map, servers });
      } catch {
        if (!cancelled) {
          setState({ off: false, loading: false, workersByServer: new Map(), servers: [] });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

/**
 * Names of catalog servers marked trusted — the default-selection source
 * for new Worker creation (B7 21.1): a fresh worker wires to every trusted
 * server unless the operator unchecks it.
 */
export function trustedCatalogServerNames(state: MCPCatalogState): string[] {
  return state.servers.filter((s) => s.trusted === true).map((s) => s.name);
}

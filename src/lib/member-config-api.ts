// Member-config / runtime-surface API client (dashboard side).
//
// Mirrors the workbench plugin `api/domains/memberConfig.ts` contract, but goes
// through the dashboard's Next proxy routes:
//   GET  /api/agentteams/runtimes/{runtime}/surface
//   GET  /api/agentteams/members/{name}/config
//   PUT  /api/agentteams/members/{name}/config?if-rev=...
//   POST /api/agentteams/members/{name}/config/rollback?rev=...
//
// Error bodies are preserved whole (status + code + full body): the panel needs
// `fields` / `unsupported` / `current` / `supported` to explain a rejected
// write, and `readHttpError` must not flatten them into one string.

import { apiUrl } from './api-base';
import {
  normalizeSurface,
  type ConfigState,
  type ConfigWriteResult,
  type RuntimeSurface,
} from './runtime-surface';

export class MemberConfigError extends Error {
  status: number;
  /** Body error code (stale_rev / unknown_field / no_writable_keys / invalid_value / runtime_unknown). */
  code?: string;
  /** Full JSON body or plain-text body. */
  detail?: unknown;

  constructor(status: number, message: string, code?: string, detail?: unknown) {
    super(message);
    this.name = 'MemberConfigError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

async function readHttpError(resp: Response): Promise<MemberConfigError> {
  let text = '';
  try {
    text = (await resp.text()).trim();
  } catch {
    /* body read failed → treat as empty */
  }
  if (text) {
    try {
      const body = JSON.parse(text) as Record<string, unknown>;
      const code = typeof body.error === 'string' ? body.error : undefined;
      return new MemberConfigError(
        resp.status,
        code ? `HTTP ${resp.status}: ${code}` : `HTTP ${resp.status}`,
        code,
        body,
      );
    } catch {
      /* not JSON → plain text body */
    }
  }
  return new MemberConfigError(
    resp.status,
    text ? `HTTP ${resp.status}: ${text}` : `HTTP ${resp.status}`,
    undefined,
    text || undefined,
  );
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(apiUrl(path), init);
  if (!resp.ok) throw await readHttpError(resp);
  return (await resp.json()) as T;
}

/** Field declarations for a runtime (authenticated read only). */
export async function fetchRuntimeSurface(runtime: string): Promise<RuntimeSurface> {
  const surface = await call<RuntimeSurface>(
    `/api/agentteams/runtimes/${encodeURIComponent(runtime)}/surface`,
  );
  return normalizeSurface(surface);
}

export async function fetchMemberConfig(name: string): Promise<ConfigState> {
  return call<ConfigState>(`/api/agentteams/members/${encodeURIComponent(name)}/config`);
}

export async function putMemberConfig(
  name: string,
  patch: Record<string, unknown>,
  ifRev?: string,
): Promise<ConfigWriteResult> {
  const q = ifRev ? `?if-rev=${encodeURIComponent(ifRev)}` : '';
  return call<ConfigWriteResult>(
    `/api/agentteams/members/${encodeURIComponent(name)}/config${q}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patch }),
    },
  );
}

export async function rollbackMemberConfig(name: string, rev: string): Promise<ConfigWriteResult> {
  return call<ConfigWriteResult>(
    `/api/agentteams/members/${encodeURIComponent(name)}/config/rollback?rev=${encodeURIComponent(rev)}`,
    { method: 'POST' },
  );
}

import { readObservabilityConfig } from './observability-config';
import * as langfuse from './langfuse-server';
import type { TraceScope } from './tracing-types';
export { TracingError } from './tracing-error';

async function backend() {
  return (await readObservabilityConfig()).backend === 'agentloop' ? await import('./agentloop-server') : langfuse;
}

export async function listTraces(search: URLSearchParams, scope: TraceScope) { return (await backend()).listTraces(search, scope); }
export async function getTrace(id: string, scope: TraceScope) { return (await backend()).getTrace(id, scope); }

export interface MonitoringTarget {
  section: 'monitoring';
  kind?: 'worker' | 'manager' | 'component';
  name?: string;
  view?: 'logs';
  since?: string;
  tail: number;
}

export interface TracingTarget {
  section: 'tracing';
  worker: string;
  trace: string;
  span: string;
  session: string;
  task: string;
  team: string;
  room: string;
}

const RESOURCE_NAME = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/;
const TRACE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/;

/** Only same-app, read-only evidence destinations receive special treatment.
 * The destination APIs still enforce the signed-in user's permissions. */
export function parseObservabilityLink(href: string | undefined): MonitoringTarget | TracingTarget | null {
  if (!href?.startsWith('#')) return null;
  const [path, query = ''] = href.slice(1).split('?');
  const params = new URLSearchParams(query);
  if (path === 'console/governance/monitoring') {
    const kind = params.get('kind') || undefined;
    const name = params.get('name') || undefined;
    const view = params.get('view') || undefined;
    const since = params.get('since') || undefined;
    const tail = Number(params.get('tail') || 300);
    if (kind && !['worker', 'manager', 'component'].includes(kind)) return null;
    if (name && !RESOURCE_NAME.test(name)) return null;
    if (Boolean(kind) !== Boolean(name)) return null;
    if (view && (view !== 'logs' || !kind || !name)) return null;
    if (since && (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(since) || !Number.isFinite(Date.parse(since)))) return null;
    if (!Number.isInteger(tail) || tail < 1 || tail > 1000) return null;
    return { section: 'monitoring', kind: kind as MonitoringTarget['kind'], name, view: view as MonitoringTarget['view'], since, tail };
  }
  if (path === 'console/governance/tracing') {
    const values = Object.fromEntries(['worker', 'trace', 'span', 'session', 'task', 'team', 'room'].map(key => [key, params.get(key) || ''])) as Omit<TracingTarget, 'section'>;
    if ((values.trace && !TRACE_ID.test(values.trace)) || (values.span && (!values.trace || !TRACE_ID.test(values.span)))) return null;
    if (Object.values(values).some(value => value.length > 512 || /[\u0000-\u001f\u007f]/.test(value))) return null;
    return { section: 'tracing', ...values };
  }
  return null;
}

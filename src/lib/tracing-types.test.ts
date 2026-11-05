import { expect, it } from 'vitest';
import { diagnoseTrace, traceRows, type TraceObservation } from './tracing-types';

it('calculates parent depth and real time offsets, including overlapping spans', () => {
  const span = (id: string, parent: string | null, start: number, end: number): TraceObservation => ({
    id, parentObservationId: parent, name: id, type: 'SPAN', level: 'DEFAULT',
    startTime: new Date(start).toISOString(), endTime: new Date(end).toISOString(),
  });
  const rows = traceRows([span('child', 'root', 250, 750), span('root', null, 0, 1000)]);
  expect(rows.map((r) => r.observation.id)).toEqual(['root', 'child']);
  expect(rows[1]).toMatchObject({ depth: 1, left: 25, width: 50, duration: 500 });
  expect(traceRows([])).toEqual([]);
});

it('distinguishes failed attempts from tool errors and flags repeated tool inputs', () => {
  const rows = [
    { id: 'one', name: 'tool read', type: 'TOOL', level: 'ERROR', input: { path: '/a' } },
    { id: 'two', name: 'tool read', type: 'TOOL', level: 'DEFAULT', input: { path: '/a' } },
    { id: 'http', name: 'http.request', type: 'SPAN', level: 'ERROR', metadata: { 'http.response.status_code': 429 } },
  ].map((o) => ({ ...o, parentObservationId: null, startTime: new Date(0).toISOString(), endTime: new Date(500).toISOString() })) as TraceObservation[];
  expect(diagnoseTrace(rows)).toMatchObject({ errors: 2, tools: 2, failedRequests: 1, repeatedTools: 1 });
});

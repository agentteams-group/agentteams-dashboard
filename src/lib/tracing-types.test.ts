import { expect, it } from 'vitest';
import { diagnoseTrace, summarizeTrace, traceRows, type TraceObservation } from './tracing-types';

const generation = (id: string, usage: Partial<TraceObservation> = {}): TraceObservation => ({
  id, parentObservationId: 'root', name: `chat ${id}`, model: 'qwen', type: 'GENERATION', level: 'DEFAULT',
  startTime: new Date(100).toISOString(), endTime: new Date(800).toISOString(), ...usage,
});

it('summarizes model usage once and measures wall time including delivery after the root ends', () => {
  const summary = summarizeTrace([
    generation('root', { type: 'AGENT', parentObservationId: null, startTime: new Date(0).toISOString(),
      endTime: new Date(1000).toISOString(), usage: { total: 9999 } }),
    generation('small', { usage: { input: 20, output: 10, total: 30 } }),
    generation('large', { model: 'hermes', usageDetails: { input: 80, output: 20, total: 100, input_cached: 40 }, usage: { total: 100 } }),
    generation('delivery', { type: 'SPAN', startTime: new Date(1000).toISOString(), endTime: new Date(1200).toISOString() }),
  ]);
  expect(summary).toMatchObject({ tokens: 130, input: 100, output: 30, completeCalls: 2, durationMs: 1200 });
  expect(summary.models.map((m) => [m.model, m.tokens])).toEqual([['hermes', 100], ['qwen', 30]]);
  expect(summary.calls.map((c) => c.observation.id)).toEqual(['large', 'small']);
});

it('distinguishes missing usage, partial usage, total-only usage and a reported zero', () => {
  const summary = summarizeTrace([
    generation('missing'), generation('partial', { usageDetails: { input: 10 } }),
    generation('total', { usage: { total: 50 } }), generation('zero', { usageDetails: { input: 0, output: 0 } }),
  ]);
  expect(summary).toMatchObject({ tokens: 60, input: 10, output: 0, reportedCalls: 3, completeCalls: 2, breakdownCalls: 1 });
  expect(summary.models[0]).toMatchObject({ tokens: 60, calls: 4, complete: false });
  expect(summarizeTrace([])).toMatchObject({ tokens: 0, durationMs: null, calls: [], models: [] });
});

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

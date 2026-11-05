import { expect, it } from 'vitest';
import { traceRows, type TraceObservation } from './tracing-types';

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

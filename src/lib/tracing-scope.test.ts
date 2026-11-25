import { expect, it } from 'vitest';
import { traceInScope } from './tracing-scope';
import type { TraceSummary } from './tracing-types';
it('requires consistent Worker and Team attribution, including standalone workers', () => {
  const scope = { teams: [{ name: 't', label: 'T' }], workers: [{ name: 'alice', team: 't' }] };
  const trace = { userId: 'alice', tags: ['agentteams', 'worker-turn', 'team:t'], metadata: {} } as TraceSummary;
  expect(traceInScope(trace, scope)).toBe(true);
  expect(traceInScope({ ...trace, metadata: { attributes: { 'agentteams.team.id': 'old' } } }, scope)).toBe(false);
  expect(traceInScope({ ...trace, metadata: { 'agentteams.worker.name': 'secret' } }, scope)).toBe(false);
  expect(traceInScope({ ...trace, tags: ['agentteams', 'worker-turn'] }, scope)).toBe(false);
  expect(traceInScope({ ...trace, tags: ['agentteams', 'worker-turn'] }, { teams: [], workers: [{ name: 'alice', team: '' }] })).toBe(true);
});

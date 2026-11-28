import { expect, it } from 'vitest';
import { summarizeTaskTraces, type TaskTraceBundle } from './task-tracing';

it('summarizes all Agents without adding overlapping durations or duplicated spans', () => {
  const bundle: TaskTraceBundle = { task_id: 'main', team_id: 'team', queried_at: '2026-11-27T00:00:10Z', retrieval_complete: true, tasks: [], causal_links: [], gaps: [], traces: [] };
  const generation = { id: 'model', name: 'chat', parentObservationId: null, type: 'GENERATION', level: 'DEFAULT', startTime: '2026-11-27T00:00:00Z', endTime: '2026-11-27T00:00:10Z', usage: { total: 100 } };
  bundle.traces = [
    { trace: { id: 'one', name: 'one', userId: 'developer', sessionId: null, timestamp: generation.startTime, tags: [], metadata: { 'agentteams.run.id': 'run' } }, observations: [generation, generation, { ...generation, id: 'failed-tool', type: 'TOOL', level: 'ERROR', usage: undefined }] },
    { trace: { id: 'two', name: 'two', userId: 'tester', sessionId: null, timestamp: generation.startTime, tags: [], metadata: {} }, observations: [{ ...generation, usage: { input: 20, output: 30 } }] },
    { trace: { id: 'three', name: 'three', userId: 'tester', sessionId: null, timestamp: generation.startTime, tags: [], metadata: {} }, observations: [{ ...generation, id: 'missing', usage: undefined }] },
  ];
  const summary = summarizeTaskTraces(bundle);
  expect(summary.tokens).toBe(150);
  expect(summary.durationMs).toBe(10000);
  expect(summary.observationCount).toBe(4);
  expect(summary.toolCount).toBe(1);
  expect(summary.agents[0].tools).toBe(1);
  expect(summary.agents[0].failedTools).toBe(1);
  expect(summary.usageComplete).toBe(false);
  expect(summary.agents.map((agent) => [agent.name, agent.tokens])).toEqual([['developer', 100], ['tester', 50]]);
});


it('reads returned reasoning without treating ordinary answers or encrypted data as reasoning', async () => {
  const { traceReasoning } = await import('./task-tracing');
  expect(traceReasoning({ stream: [{ type: 'reasoning-delta', text: 'first' }, { type: 'reasoning-delta', text: ' second' }, { type: 'text-delta', text: 'answer' }] })).toBe('first second');
  expect(traceReasoning([{ type: 'thinking', thinking: 'native thinking' }, { type: 'text', text: 'answer' }])).toBe('native thinking');
  expect(traceReasoning({ choices: [{ message: { reasoning_content: 'returned reasoning', content: 'answer' } }] })).toBe('returned reasoning');
  expect(traceReasoning({ type: 'reasoning', summary: [{ type: 'summary_text', text: 'returned summary' }], encrypted_content: 'opaque' })).toBe('returned summary');
  expect(traceReasoning('ordinary answer')).toBe('');
  expect(traceReasoning({ type: 'reasoning', encrypted_content: 'opaque' })).toBe('');
});

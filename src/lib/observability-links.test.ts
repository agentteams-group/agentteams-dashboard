import { describe, expect, it } from 'vitest';
import { parseObservabilityLink } from './observability-links';
import { currentHashParams, hashForActiveSection, hashForSection, resolveHash } from './nav-hash';

describe('observability evidence destinations', () => {
  it('round trips monitoring resources and log windows through canonical navigation', () => {
    const href = '#console/governance/monitoring?kind=worker&name=dev&view=logs&since=2026-11-14T03%3A00%3A00Z&tail=20';
    expect(parseObservabilityLink(href)).toMatchObject({ section: 'monitoring', kind: 'worker', name: 'dev', view: 'logs', since: '2026-11-14T03:00:00Z', tail: 20 });
    expect(resolveHash(href.slice(1), () => true)?.section).toBe('plugin-route:monitor-panel/monitor');
    expect(hashForSection('plugin-route:monitor-panel/monitor')).toBe('console/governance/monitoring');
    expect(hashForActiveSection('plugin-route:monitor-panel/monitor', href)).toBe(href.slice(1));
    window.history.replaceState(null, '', href);
    expect(currentHashParams()?.get('name')).toBe('dev');
    window.history.replaceState(null, '', '/');
  });

  it('keeps exact trace/span ids and optional resource filters', () => {
    expect(parseObservabilityLink('#console/governance/tracing?worker=dev&trace=abc123&span=model-2')).toMatchObject({ section: 'tracing', worker: 'dev', trace: 'abc123', span: 'model-2' });
  });

  it('rejects foreign links, unsupported resources and invalid query windows', () => {
    for (const href of ['javascript:alert(1)', 'https://example.com/#console/governance/monitoring', '#console/governance/monitoring-other', '#console/governance/monitoring?kind=host&name=other&view=logs', '#console/governance/monitoring?kind=worker&name=..%2Fsecret&view=logs', '#console/governance/monitoring?view=logs', '#console/governance/monitoring?kind=worker&name=dev&since=yesterday', '#console/governance/monitoring?kind=worker&name=dev&tail=1001', '#console/governance/tracing?trace=..%2Fsecret']) {
      expect(parseObservabilityLink(href), href).toBeNull();
    }
  });
});

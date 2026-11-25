import { expect, it } from 'vitest';
import { observabilityUrl, validateAgentLoopConfig, type ObservabilityConfig } from './observability-config';

it('rejects credential-bearing service URLs and metadata targets', () => {
  for (const url of ['file:///tmp/secret', 'http://user:secret@host', 'http://169.254.169.254', 'http://metadata.google.internal']) {
    expect(() => observabilityUrl(url, 'Service')).toThrow();
  }
});
it('validates Controller-provided AgentLoop query coordinates', () => {
  const config = { agentloop: { region: 'cn-hangzhou', workspace: 'workspace', project: 'trace-project', logstore: 'traces' } } as ObservabilityConfig;
  expect(() => validateAgentLoopConfig(config)).not.toThrow();
  expect(() => validateAgentLoopConfig({ ...config, agentloop: { ...config.agentloop, project: '../other' } })).toThrow();
});

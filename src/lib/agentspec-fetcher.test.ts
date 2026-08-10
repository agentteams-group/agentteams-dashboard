import { describe, it, expect } from 'vitest';
import { mapAgentSpecToWorker, sanitizeWorkerName } from '@/lib/agentspec-fetcher';

describe('sanitizeWorkerName', () => {
  it('lowercases and strips invalid characters', () => {
    expect(sanitizeWorkerName('ZK_Steward')).toBe('zk-steward');
    expect(sanitizeWorkerName('Agent 1.x')).toBe('agent-1-x');
    expect(sanitizeWorkerName('--abc--')).toBe('abc');
  });

  it('truncates to 63 characters', () => {
    expect(sanitizeWorkerName('a'.repeat(100))).toHaveLength(63);
  });
});

describe('mapAgentSpecToWorker', () => {
  const baseInput = {
    specName: 'zk-steward',
    version: '0.0.1',
    from: 'github.com/jnMetaCode/agency-agents-zh',
    content: {
      version: '1.0',
      source: { repository: 'https://github.com/jnMetaCode/agency-agents-zh', openclaw_mode: true },
      description: '知识库管家',
      worker: {
        suggested_name: 'zk-steward',
        base_image: 'hiclaw/worker-agent:latest',
        apt_packages: [],
        pip_packages: [],
        npm_packages: [],
      },
    },
  };

  it('maps suggested_name, base_image and SOUL.md to worker fields', () => {
    const mapping = mapAgentSpecToWorker({
      ...baseInput,
      resources: {
        config_SOUL__md: { name: 'SOUL.md', type: 'config', content: '## 你的身份\n结构优先' },
        config_IDENTITY__md: { name: 'IDENTITY.md', type: 'config', content: '# ZK 管家' },
      },
    });
    expect(mapping.name).toBe('zk-steward');
    expect(mapping.image).toBe('hiclaw/worker-agent:latest');
    expect(mapping.runtime).toBe('openclaw');
    expect(mapping.soul).toBe('## 你的身份\n结构优先');
    expect(mapping.from).toBe('github.com/jnMetaCode/agency-agents-zh');
  });

  it('falls back to IDENTITY.md when SOUL.md is missing', () => {
    const mapping = mapAgentSpecToWorker({
      ...baseInput,
      resources: {
        config_IDENTITY__md: { name: 'IDENTITY.md', type: 'config', content: '# ZK 管家身份' },
      },
    });
    expect(mapping.soul).toBe('# ZK 管家身份');
  });

  it('falls back to description and spec name when no resources exist', () => {
    const mapping = mapAgentSpecToWorker(baseInput);
    expect(mapping.soul).toBe('知识库管家');

    const emptyDesc = mapAgentSpecToWorker({
      ...baseInput,
      content: { ...baseInput.content, description: '', worker: undefined },
    });
    expect(emptyDesc.name).toBe('zk-steward');
    expect(emptyDesc.soul).toBe('zk-steward');
    expect(emptyDesc.image).toBeUndefined();
  });

  it('sanitizes weird suggested names', () => {
    const mapping = mapAgentSpecToWorker({
      ...baseInput,
      content: {
        ...baseInput.content,
        worker: { suggested_name: 'My Agent_01', base_image: '' },
      },
    });
    expect(mapping.name).toBe('my-agent-01');
    expect(mapping.image).toBeUndefined();
  });
});

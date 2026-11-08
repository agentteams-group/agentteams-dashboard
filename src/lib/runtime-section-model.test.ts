import { describe, expect, it } from 'vitest';
import type { RuntimeSurface } from './runtime-surface';
import {
  advancedFields,
  buildSections,
  diffDraft,
  faceBucket,
  fieldBucket,
  filterByBucket,
  filterSection,
} from './runtime-section-model';

const qwenpawStyle: RuntimeSurface = {
  runtime: 'qwenpaw',
  faces: [
    {
      id: 'main',
      fields: [
        { key: 'agentLoop.max_iterations', type: 'number', applies: 'hot', group: 'agentLoop' },
        { key: 'llm.retry_max', type: 'number', applies: 'hot', group: 'llmRetry' },
        { key: 'memory.enabled', type: 'boolean', applies: 'hot' },
        { key: 'mcp.enabled', type: 'boolean', applies: 'hot' },
        { key: 'weird_key', type: 'string', applies: 'hot' },
      ],
    },
  ],
};

describe('runtime config section model', () => {
  it('groups fields by explicit group, key prefix and top-level alias', () => {
    const sections = buildSections(qwenpawStyle);
    expect(sections.map((section) => section.id)).toEqual(['config', 'mcp', 'other']);
    const config = sections[0];
    expect(config.subSections.map((sub) => sub.id)).toEqual(['agentLoop', 'llmRetry', 'memory']);
    expect(sections[1].fields.map((field) => field.key)).toEqual(['mcp.enabled']);
    expect(sections[2].fields.map((field) => field.key)).toEqual(['weird_key']);
  });

  it('filters a section by query while pruning empty sub-sections', () => {
    const [config] = buildSections(qwenpawStyle);
    const filtered = filterSection(config, 'retry');
    expect(filtered.fields.map((field) => field.key)).toEqual(['llm.retry_max']);
    expect(filtered.subSections.map((sub) => sub.id)).toEqual(['llmRetry']);
    expect(filterSection(config, '').fields).toHaveLength(3);
  });

  it('flags advanced fields by name token or explicit marker', () => {
    const [config] = buildSections(qwenpawStyle);
    expect(advancedFields(config).map((field) => field.key)).toEqual(['llm.retry_max']);
    const [explicit] = buildSections({
      runtime: 'x',
      faces: [{ id: 'f', fields: [{ key: 'plain', type: 'string', applies: 'hot', advanced: true }] }],
    });
    expect(advancedFields(explicit).map((field) => field.key)).toEqual(['plain']);
  });

  it('diffDraft reports changed keys and ignores undefined sentinels', () => {
    expect(diffDraft({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual(['b']);
    expect(diffDraft({ a: undefined }, { a: 1 })).toEqual([]);
  });

  it('maps faces and field groups to capability buckets', () => {
    expect(faceBucket('openclaw', 'mcp')).toBe('mcp');
    expect(faceBucket('openclaw', 'security')).toBe('approval');
    expect(faceBucket('hermes', 'toolsets')).toBe('tools');
    expect(faceBucket('qwenpaw', 'mcp')).toBe('config');
    expect(fieldBucket('openclaw', 'gateway', 'gateway.mcp')).toBe('mcp');
    expect(fieldBucket('openclaw', 'gateway', 'messages.groupChat')).toBe('channels');
    expect(fieldBucket('openclaw', 'gateway', 'gateway.auth')).toBe('config');
  });

  it('filters a surface down to one bucket without dropping other faces', () => {
    const surface: RuntimeSurface = {
      runtime: 'openclaw',
      faces: [
        {
          id: 'gateway',
          fields: [
            { key: 'gateway.port', type: 'number', applies: 'hot' },
            { key: 'gateway.mcp', type: 'boolean', applies: 'hot', group: 'gateway.mcp' },
          ],
        },
        { id: 'mcp', fields: [{ key: 'mcp.enabled', type: 'boolean', applies: 'hot' }] },
      ],
    };
    const mcp = filterByBucket('openclaw', surface, 'mcp');
    expect(mcp.map((face) => face.id)).toEqual(['gateway', 'mcp']);
    expect(mcp[0].fields.map((field) => field.key)).toEqual(['gateway.mcp']);
    expect(filterByBucket('openclaw', surface, 'approval')).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  hashForSection,
  isLayeredHash,
  needsHashNormalization,
  resolveHash,
} from './nav-hash';

const allSections = new Set([
  'overview', 'chat', 'tasks', 'artifacts', 'coding-runs', 'loops',
  'workers', 'managers', 'teams', 'humans', 'skills', 'models',
  'knowledge', 'audit',
]);
const isKnown = (s: string) => allSections.has(s) || s.startsWith('plugin-route:');

describe('isLayeredHash', () => {
  it('accepts workbench and console prefixes', () => {
    expect(isLayeredHash('workbench/space')).toBe(true);
    expect(isLayeredHash('console/resources/workers')).toBe(true);
  });

  it('rejects flat and plugin hashes', () => {
    expect(isLayeredHash('chat')).toBe(false);
    expect(isLayeredHash('plugin-route:foo/bar')).toBe(false);
  });
});

describe('hashForSection', () => {
  it('returns the canonical layered hash for each section (附录 A)', () => {
    expect(hashForSection('chat')).toBe('workbench/space');
    expect(hashForSection('tasks')).toBe('workbench/tasks');
    expect(hashForSection('artifacts')).toBe('workbench/tasks/artifacts');
    expect(hashForSection('coding-runs')).toBe('workbench/tasks/coding-runs');
    expect(hashForSection('loops')).toBe('workbench/loop');
    expect(hashForSection('workers')).toBe('console/resources/workers');
    expect(hashForSection('managers')).toBe('console/resources/managers');
    expect(hashForSection('teams')).toBe('console/resources/teams');
    expect(hashForSection('humans')).toBe('console/resources/humans');
    expect(hashForSection('skills')).toBe('console/resources/skills');
    expect(hashForSection('models')).toBe('console/resources/models');
    expect(hashForSection('knowledge')).toBe('console/resources/knowledge');
    expect(hashForSection('audit')).toBe('console/governance/audit');
    expect(hashForSection('overview')).toBe('console/system/overview');
  });
});

describe('resolveHash — layered hashes', () => {
  it('resolves the workbench space hash to chat', () => {
    expect(resolveHash('workbench/space', isKnown)).toEqual({ section: 'chat' });
  });

  it('extracts the room id from a space deep link (F1.1)', () => {
    expect(resolveHash('workbench/space/!abcRoom:example.org', isKnown)).toEqual({
      section: 'chat',
      roomId: '!abcRoom:example.org',
    });
  });

  it('resolves task-center hashes', () => {
    expect(resolveHash('workbench/tasks', isKnown)).toEqual({ section: 'tasks' });
    expect(resolveHash('workbench/tasks/artifacts', isKnown)).toEqual({ section: 'artifacts' });
    expect(resolveHash('workbench/tasks/coding-runs', isKnown)).toEqual({ section: 'coding-runs' });
  });

  it('parses query params on task deep links', () => {
    const resolved = resolveHash('workbench/tasks?project=p1', isKnown);
    expect(resolved?.section).toBe('tasks');
    expect(resolved?.params?.get('project')).toBe('p1');
  });

  it('maps the loop hash to the loops section (F5.2 作者画布)', () => {
    expect(resolveHash('workbench/loop/l1', isKnown)?.section).toBe('loops');
  });

  it('resolves console hashes (附录 A)', () => {
    expect(resolveHash('console/resources/workers', isKnown)?.section).toBe('workers');
    expect(resolveHash('console/governance/audit', isKnown)?.section).toBe('audit');
    expect(resolveHash('console/system/overview', isKnown)?.section).toBe('overview');
  });

  it('returns null for unknown layered paths', () => {
    expect(resolveHash('workbench/nope', isKnown)).toBeNull();
    expect(resolveHash('console/resources/nope', isKnown)).toBeNull();
  });
});

describe('resolveHash — legacy flat hashes stay reachable (PRD §5.4)', () => {
  it('resolves every legacy flat hash', () => {
    const legacy = [
      'overview', 'chat', 'tasks', 'artifacts', 'coding-runs',
      'workers', 'managers', 'teams', 'humans', 'skills', 'models',
      'knowledge', 'audit',
    ];
    for (const hash of legacy) {
      expect(resolveHash(hash, isKnown)?.section).toBe(hash);
    }
  });

  it('keeps the projects alias resolving to the task board', () => {
    expect(resolveHash('projects', isKnown)?.section).toBe('tasks');
  });

  it('passes plugin route hashes through untouched', () => {
    expect(resolveHash('plugin-route:foo/bar', isKnown)).toEqual({
      section: 'plugin-route:foo/bar',
    });
  });

  it('returns null for unknown flat hashes', () => {
    expect(resolveHash('unknown-section', isKnown)).toBeNull();
    expect(resolveHash('agents/workers', isKnown)).toBeNull();
  });
});

describe('needsHashNormalization', () => {
  it('flags legacy flat hashes for in-place normalization', () => {
    expect(needsHashNormalization('chat')).toBe(true);
    expect(needsHashNormalization('workers')).toBe(true);
    expect(needsHashNormalization('projects')).toBe(true);
  });

  it('skips layered and plugin hashes', () => {
    expect(needsHashNormalization('workbench/space')).toBe(false);
    expect(needsHashNormalization('workbench/space/!room:example.org')).toBe(false);
    expect(needsHashNormalization('plugin-route:foo/bar')).toBe(false);
    expect(needsHashNormalization('')).toBe(false);
  });
});

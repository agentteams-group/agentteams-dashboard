import { describe, expect, it } from 'vitest';
import {
  auditHash,
  currentHashParams,
  hashForActiveSection,
  hashForSection,
  isLayeredHash,
  loopHash,
  needsHashNormalization,
  resolveHash,
  tasksHash,
} from './nav-hash';

const allSections = new Set([
  'overview', 'chat', 'tasks', 'artifacts', 'coding-runs', 'loops', 'my-workbench',
  'resources', 'workers', 'managers', 'teams', 'humans', 'skills', 'models',
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
    expect(hashForSection('my-workbench')).toBe('workbench/me');
    expect(hashForSection('resources')).toBe('console/resources');
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

describe('hashForActiveSection', () => {
  it('keeps a valid resource tab deep link', () => {
    expect(hashForActiveSection('resources', '#console/resources/humans')).toBe(
      'console/resources/humans'
    );
    expect(hashForActiveSection('resources', '#console/resources/workers')).toBe(
      'console/resources/workers'
    );
  });

  it('collapses to the canonical hash when the tab is absent or unknown', () => {
    expect(hashForActiveSection('resources', '#console/resources')).toBe('console/resources');
    expect(hashForActiveSection('resources', '#console/resources/nope')).toBe(
      'console/resources'
    );
    expect(hashForActiveSection('resources', '#workbench/space')).toBe('console/resources');
  });

  it('never preserves a third segment for non-resource sections', () => {
    expect(hashForActiveSection('chat', '#console/resources/humans')).toBe('workbench/space');
  });

  it('keeps the deep-link query that belongs to the section we land on', () => {
    // C-2 / B-1：面板、通知的深链都靠这几个参数选中东西，section 同步不能抹掉它。
    expect(hashForActiveSection('tasks', '#workbench/tasks?project=run-1')).toBe(
      'workbench/tasks?project=run-1',
    );
    expect(hashForActiveSection('audit', '#console/governance/audit?entity=worker')).toBe(
      'console/governance/audit?entity=worker',
    );
    // 房间段照旧收敛（roomId 走 store 手渡），但词得留在地址里。
    expect(hashForActiveSection('chat', '#workbench/space/!abc:hs.example?q=%E7%BC%93%E5%AD%98')).toBe(
      'workbench/space?q=%E7%BC%93%E5%AD%98',
    );
    expect(
      hashForActiveSection('resources', '#console/resources/humans?project=run-1'),
    ).toBe('console/resources/humans?project=run-1');
  });

  it('drops a query that belongs to another section', () => {
    expect(hashForActiveSection('chat', '#workbench/tasks?project=run-1')).toBe('workbench/space');
    expect(hashForActiveSection('resources', '#workbench/space?q=x')).toBe('console/resources');
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

  it('resolves console hashes (附录 A；F7.1 资源路径进容器)', () => {
    expect(resolveHash('console/resources', isKnown)?.section).toBe('resources');
    expect(resolveHash('console/resources/workers', isKnown)?.section).toBe('resources');
    expect(resolveHash('console/resources/humans', isKnown)?.section).toBe('resources');
    expect(resolveHash('console/resources/skills', isKnown)?.section).toBe('skills');
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

describe('深链构造器与参数读取（方案 v3 C-2）', () => {
  it('不带 id 时只给规范的 section hash（不会留一个空参数）', () => {
    expect(tasksHash()).toBe('#workbench/tasks');
    expect(loopHash()).toBe('#workbench/loop');
    expect(auditHash()).toBe('#console/governance/audit');
    expect(resolveHash('workbench/tasks', isKnown)?.params).toBeUndefined();
  });

  it('写出的 hash 能被反向解析回同一 section 与参数（id 带分隔符也不能碎）', () => {
    const cases = [
      { build: tasksHash('p/1&x'), section: 'tasks', key: 'project', value: 'p/1&x' },
      { build: loopHash('l 1'), section: 'loops', key: 'loop', value: 'l 1' },
      { build: auditHash('worker'), section: 'audit', key: 'entity', value: 'worker' },
    ];
    for (const { build, section, key, value } of cases) {
      const resolved = resolveHash(build.replace(/^#/, ''), isKnown);
      expect(resolved?.section).toBe(section);
      expect(resolved?.params?.get(key)).toBe(value);
    }
  });

  it('currentHashParams 读的是当前 hash 上的查询参数', () => {
    window.location.hash = tasksHash('p-9');
    expect(currentHashParams()?.get('project')).toBe('p-9');
    window.location.hash = '#workbench/tasks';
    // URLSearchParams.get 对不存在的 key 返回 undefined（不是 null）
    expect(currentHashParams()?.get('project')).toBeUndefined();
  });

  it('路径型深链（房间）与查询参数互不干扰', () => {
    window.location.hash = '#workbench/space/!abc:hs.example?project=p-1';
    expect(currentHashParams()?.get('project')).toBe('p-1');
    expect(resolveHash(window.location.hash.replace(/^#/, ''), isKnown)).toMatchObject({
      section: 'chat',
      roomId: '!abc:hs.example',
    });
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

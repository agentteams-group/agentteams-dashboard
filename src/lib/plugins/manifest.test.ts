// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { validatePluginManifest, validateContributionId, PluginManifestError } from './manifest';

describe('validatePluginManifest', () => {
  const base = {
    id: 'demo',
    name: 'Demo',
    version: '1.0.0',
    entry: { dashboard: 'index.js' },
  };

  it('accepts a minimal valid manifest', () => {
    const m = validatePluginManifest(base);
    expect(m.id).toBe('demo');
    expect(m.version).toBe('1.0.0');
    expect(m.entry.dashboard).toBe('index.js');
  });

  it('accepts upstream AgentTeams envelope fields and backend entry', () => {
    const m = validatePluginManifest({
      ...base,
      apiVersion: 'agentteams.agentteam/v1alpha1',
      kind: 'AgentTeamPlugin',
      entry: { dashboard: 'index.js', backend: 'plugin.py' },
    });
    expect(m.entry.backend).toBe('plugin.py');
    expect(m.kind).toBe('AgentTeamPlugin');
  });

  it('rejects non-object input', () => {
    expect(() => validatePluginManifest(null)).toThrow(PluginManifestError);
    expect(() => validatePluginManifest('x')).toThrow(PluginManifestError);
  });

  it('rejects invalid ids', () => {
    for (const id of ['Demo', '-x', 'a b', '']) {
      expect(() => validatePluginManifest({ ...base, id })).toThrow(PluginManifestError);
    }
  });

  it('rejects invalid versions', () => {
    expect(() => validatePluginManifest({ ...base, version: 'latest' })).toThrow(/version/);
    expect(() => validatePluginManifest({ ...base, version: 123 as unknown as string })).toThrow();
  });

  it('rejects missing dashboard entry', () => {
    expect(() => validatePluginManifest({ ...base, entry: {} })).toThrow(/entry.dashboard/);
    expect(() => validatePluginManifest({ ...base, entry: 'index.js' as unknown as object })).toThrow();
  });

  it('validates extensionPoints against the known list', () => {
    const ok = validatePluginManifest({ ...base, extensionPoints: ['sidebar-menu', 'route'] });
    expect(ok.extensionPoints).toEqual(['sidebar-menu', 'route']);
    expect(() => validatePluginManifest({ ...base, extensionPoints: ['nope'] })).toThrow(/扩展点/);
  });

  it('validates permissions and dependencies are string arrays', () => {
    expect(() => validatePluginManifest({ ...base, permissions: 'net' as unknown as string[] })).toThrow();
    expect(() => validatePluginManifest({ ...base, dependencies: [1] as unknown as string[] })).toThrow();
    const ok = validatePluginManifest({ ...base, permissions: ['network'], dependencies: ['other'] });
    expect(ok.permissions).toEqual(['network']);
    expect(ok.dependencies).toEqual(['other']);
  });

  describe('dashboard version gating', () => {
    it('passes when the dashboard version satisfies the range', () => {
      const m = validatePluginManifest(
        { ...base, dashboardVersion: '>=0.2.0' },
        { dashboardVersion: '0.2.0' }
      );
      expect(m.id).toBe('demo');
    });

    it('throws when the dashboard version is too old', () => {
      expect(() =>
        validatePluginManifest({ ...base, dashboardVersion: '>=1.0.0' }, { dashboardVersion: '0.2.0' })
      ).toThrow(/Dashboard 版本/);
    });

    it('treats min_version as a lower bound (upstream compat)', () => {
      expect(() =>
        validatePluginManifest({ ...base, min_version: '1.0.0' }, { dashboardVersion: '0.2.0' })
      ).toThrow(/Dashboard 版本/);
      const ok = validatePluginManifest({ ...base, min_version: '0.1.0' }, { dashboardVersion: '0.2.0' });
      expect(ok.min_version).toBe('0.1.0');
    });

    it('skips the check when instructed', () => {
      const m = validatePluginManifest(
        { ...base, dashboardVersion: '>=9.0.0' },
        { dashboardVersion: '0.2.0', skipVersionCheck: true }
      );
      expect(m.id).toBe('demo');
    });
  });
});

describe('validateContributionId', () => {
  it('accepts valid ids', () => {
    expect(validateContributionId('p', 'my-widget')).toBe('my-widget');
    expect(validateContributionId('p', 'Widget1')).toBe('Widget1');
  });
  it('rejects invalid ids', () => {
    expect(() => validateContributionId('p', '-x')).toThrow();
    expect(() => validateContributionId('p', 5 as unknown as string)).toThrow();
    expect(() => validateContributionId('p', 'has space')).toThrow();
  });
});

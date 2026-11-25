import { describe, expect, it } from 'vitest';
import { hashForActiveSection, hashForSection, resolveHash } from './nav-hash';

const known = () => true;
describe('member navigation migration', () => {
  it.each(['workers', 'teams'])('gives %s an independent route', section => {
    expect(resolveHash(hashForSection(section), known)?.section).toBe(section);
  });
  it.each([
    ['agents&agent=alice&edit=true', 'workers', 'agent', 'alice'],
    ['teams&team=alpha&edit=true', 'teams', 'team', 'alpha'],
  ])('preserves the selected resource in old merged links: %s', (query, section, key, name) => {
    const hash = `console/resources/team-agents?tab=${query}`;
    expect(resolveHash(hash, known)?.section).toBe(section);
    const canonical = hashForActiveSection(section, hash);
    expect(canonical).toContain(`${key}=${name}`);
    expect(canonical).toContain('edit=true');
    expect(canonical).not.toContain('tab=');
  });
  it('moves Manager deep links into platform assistant settings', () => {
    const hash = 'console/resources/managers?manager=second';
    expect(resolveHash(hash, known)?.section).toBe('platform-assistant-settings');
    expect(hashForActiveSection('platform-assistant-settings', hash)).toBe('workbench/assistant/settings?manager=second');
    expect(resolveHash('console/resources/team-agents?tab=agents&manager=second', known)?.section).toBe('platform-assistant-settings');
  });
});

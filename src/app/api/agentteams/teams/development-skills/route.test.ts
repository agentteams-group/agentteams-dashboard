import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEVELOPMENT_ROLES, DEVELOPMENT_SQUAD_SKILL_BASE } from '@/lib/development-squad-template';
import { GET } from './route';

afterEach(() => vi.unstubAllGlobals());
describe('development squad website skills', () => {
  it('reads fixed versioned URLs and validates each skill name', async () => {
    const fetcher = vi.fn(async (url: string) => {
      const role = DEVELOPMENT_ROLES.find(item => url.includes(`/${item.skillName}/`))!;
      return new Response(`---\nname: ${role.skillName}\ndescription: role skill\n---\nYou execute your role.`);
    });
    vi.stubGlobal('fetch', fetcher);
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).skills).toHaveLength(4);
    for (const role of DEVELOPMENT_ROLES) {
      expect(fetcher).toHaveBeenCalledWith(`${DEVELOPMENT_SQUAD_SKILL_BASE}/${role.skillName}/SKILL.md`, expect.objectContaining({ redirect: 'error' }));
    }
  });
  it('fails before deployment if a published file is missing or malformed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('missing', { status: 404 })));
    expect((await GET()).status).toBe(502);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>not a skill</html>')));
    expect((await GET()).status).toBe(502);
  });
});

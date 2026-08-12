// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GET } from './route';

describe('GET /api/dashboard/theme', () => {
  let dir: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'theme-config-'));
    for (const key of ['AGENTTEAMS_THEME_CONFIG', 'AGENTTEAMS_DEFAULT_THEME', 'AGENTTEAMS_THEME_LOCKED']) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  });

  it('returns 404 when nothing is configured', async () => {
    // Point at an empty dir so the default cwd lookups are bypassed deterministically.
    process.env.AGENTTEAMS_THEME_CONFIG = path.join(dir, 'missing.json');
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it('serves themes from a theme.config.json file', async () => {
    const configPath = path.join(dir, 'theme.config.json');
    await writeFile(
      configPath,
      JSON.stringify({
        themes: [{ id: 'brand', name: 'Brand', base: 'light', variables: { '--primary': '#1677ff' } }],
        defaultTheme: 'brand',
        locked: true,
      })
    );
    process.env.AGENTTEAMS_THEME_CONFIG = configPath;

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.themes).toHaveLength(1);
    expect(body.themes[0].id).toBe('brand');
    expect(body.defaultTheme).toBe('brand');
    expect(body.locked).toBe(true);
  });

  it('accepts a bare single-theme document', async () => {
    const configPath = path.join(dir, 'theme.config.json');
    await writeFile(configPath, JSON.stringify({ id: 'solo', base: 'dark' }));
    process.env.AGENTTEAMS_THEME_CONFIG = configPath;

    const res = await GET();
    const body = await res.json();
    expect(body.themes).toHaveLength(1);
    expect(body.themes[0].id).toBe('solo');
  });

  it('env default/lock layer on top of file config', async () => {
    const configPath = path.join(dir, 'theme.config.json');
    await writeFile(configPath, JSON.stringify({ themes: [], defaultTheme: 'file-theme' }));
    process.env.AGENTTEAMS_THEME_CONFIG = configPath;
    process.env.AGENTTEAMS_DEFAULT_THEME = 'env-theme';
    process.env.AGENTTEAMS_THEME_LOCKED = 'true';

    const res = await GET();
    const body = await res.json();
    expect(body.defaultTheme).toBe('env-theme');
    expect(body.locked).toBe(true);
  });

  it('returns 500 for invalid JSON', async () => {
    const configPath = path.join(dir, 'theme.config.json');
    await writeFile(configPath, '{not json');
    process.env.AGENTTEAMS_THEME_CONFIG = configPath;

    const res = await GET();
    expect(res.status).toBe(500);
  });

  it('drops invalid theme entries with a warning', async () => {
    const configPath = path.join(dir, 'theme.config.json');
    await writeFile(
      configPath,
      JSON.stringify({ themes: [{ id: 'good', base: 'light' }, { id: 'BAD ID', base: 'light' }] })
    );
    process.env.AGENTTEAMS_THEME_CONFIG = configPath;

    const res = await GET();
    const body = await res.json();
    expect(body.themes.map((t: { id: string }) => t.id)).toEqual(['good']);
    expect(body.warnings).toHaveLength(1);
  });
});

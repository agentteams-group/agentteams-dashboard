import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeThemeDefinition, ThemeConfigError } from '@/lib/theme/config';
import type { ThemeDefinition } from '@/lib/theme/types';

export const dynamic = 'force-dynamic';

/**
 * Enterprise theme injection.
 *
 * Sources (first hit wins):
 *   1. $AGENTTEAMS_THEME_CONFIG        — explicit path to a JSON file
 *   2. <cwd>/theme.config.json         — repo/container-root config
 *   3. <cwd>/public/theme.config.json  — served copy
 *
 * Env overrides layered on top of the file:
 *   AGENTTEAMS_DEFAULT_THEME  — default theme id
 *   AGENTTEAMS_THEME_LOCKED   — 'true' locks the user out of switching
 *
 * The config file shape:
 *   {
 *     "themes": [ThemeDefinition, ...],
 *     "defaultTheme": "brand",
 *     "locked": false
 *   }
 * A bare ThemeDefinition object is accepted too (treated as a single theme).
 *
 * Changes require a Dashboard restart (read on request but baked into the
 * deployment), and 404 is returned when nothing is configured.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readFirstExisting(candidates: string[]): Promise<string | null> {
  for (const file of candidates) {
    try {
      return await readFile(file, 'utf8');
    } catch {
      // try next candidate
    }
  }
  return null;
}

export async function GET() {
  const cwd = process.cwd();
  const candidates: string[] = [];
  if (process.env.AGENTTEAMS_THEME_CONFIG) {
    candidates.push(path.resolve(process.env.AGENTTEAMS_THEME_CONFIG));
  }
  candidates.push(path.join(cwd, 'theme.config.json'));
  candidates.push(path.join(cwd, 'public', 'theme.config.json'));

  const raw = await readFirstExisting(candidates);

  const envDefault = process.env.AGENTTEAMS_DEFAULT_THEME || '';
  const envLocked = process.env.AGENTTEAMS_THEME_LOCKED === 'true';

  if (!raw) {
    if (!envDefault && !envLocked) {
      return NextResponse.json({ error: 'no theme configuration' }, { status: 404 });
    }
    return NextResponse.json({ themes: [], defaultTheme: envDefault || null, locked: envLocked });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { error: 'theme.config.json is not valid JSON' },
      { status: 500 }
    );
  }

  let themeCandidates: unknown[] = [];
  let defaultTheme: string | undefined;
  let locked: boolean | undefined;

  if (Array.isArray(parsed)) {
    themeCandidates = parsed;
  } else if (isRecord(parsed)) {
    if (Array.isArray(parsed.themes)) {
      themeCandidates = parsed.themes;
    } else if (typeof parsed.id === 'string' && typeof parsed.base === 'string') {
      // Bare single-theme document.
      themeCandidates = [parsed];
    }
    if (typeof parsed.defaultTheme === 'string') defaultTheme = parsed.defaultTheme;
    if (typeof parsed.locked === 'boolean') locked = parsed.locked;
  }

  const themes: ThemeDefinition[] = [];
  const errors: string[] = [];
  for (const candidate of themeCandidates) {
    try {
      themes.push(normalizeThemeDefinition(candidate, { allowEnterprise: true }));
    } catch (err) {
      if (err instanceof ThemeConfigError) errors.push(err.message);
    }
  }

  const body = {
    themes,
    defaultTheme: envDefault || defaultTheme || null,
    locked: envLocked || locked === true,
    ...(errors.length > 0 ? { warnings: errors } : {}),
  };
  return NextResponse.json(body);
}

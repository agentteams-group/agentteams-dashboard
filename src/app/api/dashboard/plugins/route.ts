import { NextResponse } from 'next/server';
import { readdir, access } from 'node:fs/promises';
import path from 'node:path';

export const dynamic = 'force-dynamic';

/**
 * Discovers plugins served from the Dashboard's own `public/plugins/`
 * directory. Each sub-directory containing a `plugin.json` is exposed as an
 * installable plugin via its manifest URL.
 *
 * Response: { plugins: [{ id, manifestUrl }] }
 */
export async function GET() {
  const pluginsDir = path.join(process.cwd(), 'public', 'plugins');
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

  try {
    const entries = await readdir(pluginsDir, { withFileTypes: true });
    const plugins: Array<{ id: string; manifestUrl: string }> = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(pluginsDir, entry.name, 'plugin.json');
      try {
        await access(manifestPath);
      } catch {
        continue; // directory without a manifest is not a plugin
      }
      plugins.push({
        id: entry.name,
        manifestUrl: `${basePath}/plugins/${entry.name}/plugin.json`,
      });
    }

    return NextResponse.json({ plugins });
  } catch {
    // public/plugins does not exist → nothing to discover.
    return NextResponse.json({ plugins: [] });
  }
}

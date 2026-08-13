import AdmZip from 'adm-zip';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validatePluginManifest, PluginManifestError } from './manifest';
import type { PluginManifest } from './types';

/**
 * Server-side plugin package handling.
 *
 * A plugin package is a zip containing `plugin.json` plus the built entry
 * code (the Dashboard cannot compile plugin sources, so authors package the
 * output of `vite build`). Packages are unpacked into `public/plugins/<id>/`
 * where the existing `GET /api/dashboard/plugins` discovery route picks them
 * up and they are served as static assets alongside the Dashboard.
 *
 * Security: zip-slip (path traversal via entry names) is rejected, and both
 * the compressed and expanded sizes are bounded.
 */

const PLUGINS_DIR_NAME = 'plugins';
/** Compressed upload cap. */
export const MAX_ZIP_BYTES = 5 * 1024 * 1024;
/** Expanded package cap. */
export const MAX_EXPANDED_BYTES = 20 * 1024 * 1024;
/** Fallback entry candidates, tried when manifest.entry.dashboard is missing. */
const ENTRY_FALLBACKS = [
  'dist/main.js',
  'dist/index.js',
  'dist/main.mjs',
  'dist/index.mjs',
  'main.js',
  'index.js',
  'out/main.js',
  'build/main.js',
];

function safeEntryName(entryName: string, pluginId: string, pluginsDir: string): string {
  if (!entryName || entryName.includes('\\')) {
    throw new PluginManifestError(`插件 ${pluginId}: 压缩包内含非法条目名 "${entryName}"`);
  }
  const normalized = entryName.split('/').filter(Boolean);
  if (normalized.some((seg) => seg === '..' || seg.includes('\0'))) {
    throw new PluginManifestError(`插件 ${pluginId}: 压缩包内含路径穿越条目 "${entryName}"`);
  }
  const dest = path.join(pluginsDir, ...normalized);
  if (!dest.startsWith(pluginsDir + path.sep)) {
    throw new PluginManifestError(`插件 ${pluginId}: 压缩包内条目越界 "${entryName}"`);
  }
  return dest;
}

/** Locates `plugin.json` inside the package (root, or any single top-level dir). */
function findManifestEntry(zip: AdmZip): AdmZip.IZipEntry | null {
  const candidates = zip
    .getEntries()
    .filter(
      (e) => !e.isDirectory && (e.entryName === 'plugin.json' || e.entryName.endsWith('/plugin.json'))
    );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.entryName.length - b.entryName.length);
  return candidates[0];
}

/**
 * Unpacks a plugin package zip into `public/plugins/<id>/` and returns the
 * plugin id plus the manifest URL it is now served from.
 */
export async function installPluginPackage(
  zipBuffer: Buffer,
  options: { pluginsDir?: string } = {}
): Promise<{
  id: string;
  manifestUrl: string;
  manifest: PluginManifest;
}> {
  const pluginsDir = options.pluginsDir ?? path.join(process.cwd(), 'public', PLUGINS_DIR_NAME);
  if (zipBuffer.length === 0) {
    throw new PluginManifestError('上传的插件包是空的');
  }
  if (zipBuffer.length > MAX_ZIP_BYTES) {
    throw new PluginManifestError(`插件包超过大小限制（${Math.round(MAX_ZIP_BYTES / 1024 / 1024)}MB）`);
  }

  let zip: AdmZip;
  try {
    zip = new AdmZip(zipBuffer);
  } catch {
    throw new PluginManifestError('上传的文件不是合法的 zip 插件包');
  }

  // Locate + validate the manifest first, so a bad package is rejected before
  // anything touches disk.
  const manifestEntry = findManifestEntry(zip);
  if (!manifestEntry) {
    throw new PluginManifestError('插件包中未找到 plugin.json');
  }
  let manifest: PluginManifest;
  try {
    const raw = JSON.parse(manifestEntry.getData().toString('utf8'));
    manifest = validatePluginManifest(raw);
  } catch (err) {
    if (err instanceof PluginManifestError) throw err;
    throw new PluginManifestError(`plugin.json 不是合法的 JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
  const pluginDir = path.join(pluginsDir, manifest.id);

  // Reject path traversal / oversized expansion before writing.
  let expandedBytes = 0;
  for (const entry of zip.getEntries()) {
    safeEntryName(entry.entryName, manifest.id, pluginDir);
    if (!entry.isDirectory) expandedBytes += entry.header.size;
    if (expandedBytes > MAX_EXPANDED_BYTES) {
      throw new PluginManifestError(
        `插件 ${manifest.id} 解压后超过大小限制（${Math.round(MAX_EXPANDED_BYTES / 1024 / 1024)}MB）`
      );
    }
  }

  // Write the package (id already validated by the manifest rules).
  await rm(pluginDir, { recursive: true, force: true });
  await mkdir(pluginDir, { recursive: true });
  try {
    for (const entry of zip.getEntries()) {
      const dest = safeEntryName(entry.entryName, manifest.id, pluginDir);
      if (entry.isDirectory) {
        await mkdir(dest, { recursive: true });
        continue;
      }
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, entry.getData());
    }
  } catch (err) {
    await rm(pluginDir, { recursive: true, force: true });
    throw new PluginManifestError(`解压插件包失败: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Ensure the entry file actually exists; if not, fall back to a built entry
  // found in the package (common when authors forget to update plugin.json
  // after `vite build`).
  try {
    await ensureEntry(pluginDir, manifest);
  } catch (err) {
    await rm(pluginDir, { recursive: true, force: true });
    throw err;
  }

  return {
    id: manifest.id,
    manifestUrl: `${basePath}/plugins/${manifest.id}/plugin.json`,
    manifest,
  };
}

async function ensureEntry(pluginDir: string, manifest: PluginManifest): Promise<void> {
  const entry = manifest.entry.dashboard;
  const manifestPath = path.join(pluginDir, 'plugin.json');

  if (entry) {
    const candidate = path.resolve(pluginDir, ...entry.split('/').filter(Boolean));
    if (candidate.startsWith(pluginDir + path.sep)) {
      try {
        const s = await stat(candidate);
        if (s.isFile()) return; // declared entry exists — nothing to do
      } catch {
        // fall through to fallback scan
      }
    }
  }

  for (const fallback of ENTRY_FALLBACKS) {
    try {
      const s = await stat(path.join(pluginDir, fallback));
      if (s.isFile()) {
        manifest.entry.dashboard = fallback;
        await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
        return;
      }
    } catch {
      // keep scanning
    }
  }

  throw new PluginManifestError(
    `插件 ${manifest.id}: 入口文件 "${entry}" 不在插件包中，且未找到构建产物（${ENTRY_FALLBACKS.join(' / ')}）。请先执行 vite build 后打包 dist/ 与 plugin.json。`
  );
}

/** Removes an installed server plugin package from `public/plugins/<id>/`. */
export async function removePluginPackage(
  id: string,
  options: { pluginsDir?: string } = {}
): Promise<void> {
  if (!/^[a-z0-9][a-z0-9-_]{0,63}$/.test(id)) {
    throw new PluginManifestError('插件 id 非法');
  }
  const pluginsDir = options.pluginsDir ?? path.join(process.cwd(), 'public', PLUGINS_DIR_NAME);
  const pluginDir = path.join(pluginsDir, id);
  await rm(pluginDir, { recursive: true, force: true });
}

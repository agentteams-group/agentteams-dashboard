// @vitest-environment node
import AdmZip from 'adm-zip';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installPluginPackage, removePluginPackage } from './server-package';
import type { PluginManifest } from './types';

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'agentteams-plugins-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function baseManifest(id: string): PluginManifest {
  return {
    id,
    name: id,
    version: '1.0.0',
    entry: { dashboard: 'dist/main.js' },
    extensionPoints: ['sidebar-menu'],
  };
}

function buildZip(files: Record<string, Buffer | string>): Buffer {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(name, Buffer.isBuffer(content) ? content : Buffer.from(content));
  }
  return zip.toBuffer();
}

describe('installPluginPackage', () => {
  it('unpacks a valid package and returns the manifest URL', async () => {
    const buffer = buildZip({
      'plugin.json': JSON.stringify(baseManifest('alpha')),
      'dist/main.js': 'export default { activate() {} };',
    });

    const result = await installPluginPackage(buffer, { pluginsDir: tmp });

    expect(result.id).toBe('alpha');
    expect(result.manifestUrl).toContain('/plugins/alpha/plugin.json');
    const written = await readFile(path.join(tmp, 'alpha', 'dist', 'main.js'), 'utf8');
    expect(written).toContain('activate()');
  });

  it('rewrites a stale entry to the built artifact found in the package', async () => {
    const manifest = baseManifest('beta');
    manifest.entry.dashboard = 'src/main.jsx'; // source path, not in the package
    const buffer = buildZip({
      'plugin.json': JSON.stringify(manifest),
      'dist/main.js': 'export default { activate() {} };',
    });

    const result = await installPluginPackage(buffer, { pluginsDir: tmp });

    expect(result.manifest.entry.dashboard).toBe('dist/main.js');
    const rewritten = JSON.parse(await readFile(path.join(tmp, 'beta', 'plugin.json'), 'utf8'));
    expect(rewritten.entry.dashboard).toBe('dist/main.js');
  });

  it('rejects a package whose entry is missing and no build artifact exists', async () => {
    const manifest = baseManifest('gamma');
    manifest.entry.dashboard = 'src/main.jsx';
    const buffer = buildZip({
      'plugin.json': JSON.stringify(manifest),
      'readme.md': 'no build output',
    });

    await expect(installPluginPackage(buffer, { pluginsDir: tmp })).rejects.toThrow(
      /未找到构建产物/
    );
    expect(readdir(tmp)).resolves.toEqual([]);
  });

  it('rejects a path-traversal entry (zip-slip)', async () => {
    // adm-zip normalises '../' in addFile(), so forge a real zip whose central
    // directory records the malicious entry name.
    const zip = new AdmZip();
    zip.addFile('plugin.json', Buffer.from(JSON.stringify(baseManifest('evil'))));
    zip.addFile('dist/main.js', Buffer.from('x'));
    const evil = zip.getEntries().find((e) => e.entryName === 'dist/main.js');
    evil!.entryName = '../outside.txt';
    evil!.header.fileNameLength = Buffer.byteLength(evil!.entryName);

    await expect(installPluginPackage(zip.toBuffer(), { pluginsDir: tmp })).rejects.toThrow(
      /路径穿越/
    );
    expect(await readdir(tmp)).toEqual([]);
  });

  it('rejects a package without plugin.json', async () => {
    const buffer = buildZip({ 'dist/main.js': 'x' });
    await expect(installPluginPackage(buffer, { pluginsDir: tmp })).rejects.toThrow(
      /未找到 plugin\.json/
    );
  });

  it('rejects an empty payload', async () => {
    await expect(installPluginPackage(Buffer.alloc(0), { pluginsDir: tmp })).rejects.toThrow(
      /空/
    );
  });

  it('rejects a non-zip payload', async () => {
    await expect(
      installPluginPackage(Buffer.from('not a zip'), { pluginsDir: tmp })
    ).rejects.toThrow(/不是合法的 zip/);
  });

  it('rejects an invalid manifest', async () => {
    const buffer = buildZip({ 'plugin.json': JSON.stringify({ not: 'a manifest' }) });
    await expect(installPluginPackage(buffer, { pluginsDir: tmp })).rejects.toThrow();
  });
});

describe('removePluginPackage', () => {
  it('removes the unpacked plugin directory', async () => {
    const buffer = buildZip({
      'plugin.json': JSON.stringify(baseManifest('zeta')),
      'dist/main.js': 'export default { activate() {} };',
    });
    await installPluginPackage(buffer, { pluginsDir: tmp });
    expect(await readdir(tmp)).toContain('zeta');

    await removePluginPackage('zeta', { pluginsDir: tmp });
    expect(await readdir(tmp)).toEqual([]);
  });

  it('rejects an unsafe id', async () => {
    await expect(removePluginPackage('../../etc', { pluginsDir: tmp })).rejects.toThrow(
      /非法/
    );
  });
});

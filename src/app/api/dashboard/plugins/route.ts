import { NextRequest, NextResponse } from 'next/server';
import { readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { installPluginPackage, MAX_ZIP_BYTES } from '@/lib/plugins/server-package';
import { PluginManifestError } from '@/lib/plugins/manifest';
import { validateHigressSession } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/**
 * Dashboard-served plugin packages.
 *
 * `public/plugins/` holds unpacked plugin packages (plugin.json + built entry
 * code). Each sub-directory containing a `plugin.json` is exposed as an
 * installable plugin via its manifest URL.
 *
 * - GET  — discover installed server plugins.
 * - POST — upload a plugin package zip; unpack it under `public/plugins/<id>/`.
 */

async function listPlugins() {
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

    return plugins;
  } catch {
    // public/plugins does not exist → nothing to discover.
    return [];
  }
}

export async function GET() {
  return NextResponse.json({ plugins: await listPlugins() });
}

export async function POST(request: NextRequest) {
  // Plugin packages become executable frontend code for every dashboard user.
  // Require the same Higress Console session gate as /api/agentteams/* writes.
  const authorized = await validateHigressSession(request);
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json({ error: '请使用 multipart/form-data 上传插件包' }, { status: 415 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: '无法解析上传内容' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: '缺少 file 字段' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: '插件包是空文件' }, { status: 400 });
  }
  if (file.size > MAX_ZIP_BYTES) {
    return NextResponse.json(
      { error: `插件包超过大小限制（${Math.round(MAX_ZIP_BYTES / 1024 / 1024)}MB）` },
      { status: 413 }
    );
  }

  let zipBuffer: Buffer;
  try {
    zipBuffer = Buffer.from(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ error: '读取插件包失败' }, { status: 400 });
  }

  try {
    const { manifestUrl } = await installPluginPackage(zipBuffer);
    return NextResponse.json({ manifestUrl });
  } catch (err) {
    if (err instanceof PluginManifestError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[plugins] 上传插件包失败:', err);
    return NextResponse.json({ error: '上传插件包失败' }, { status: 500 });
  }
}


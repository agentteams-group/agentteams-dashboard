import { NextRequest, NextResponse } from 'next/server';
import { createMinioClient, getMinioBucket } from '@/lib/minio-client';
import {
  parseSkillPackage,
  SKILL_PACKAGE_MAX_BYTES,
} from '@/lib/skill-package';
import {
  ensureSkillsBucket,
  getSkillMetadata,
  saveSkillMetadata,
  listSkills,
  listGlobalSkills,
} from '@/lib/skill-center-storage';
import {
  SkillEntry,
  SKILLS_BUCKET,
} from '@/lib/skill-center-types';

export async function GET(request: NextRequest) {
  const bucket = getMinioBucket();
  if (!bucket) {
    return NextResponse.json({ error: 'MinIO 未配置' }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search') || '';
  const source = searchParams.get('source') || null;
  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || '50', 10);

  try {
    const client = createMinioClient();
    await ensureSkillsBucket(client);

    const [metadataSkills, globalSkills] = await Promise.all([
      listSkills(client),
      listGlobalSkills(client, bucket),
    ]);

    // Merge: metadata (custom/nacos) takes precedence over global (builtin)
    // entries with the same name.
    const byName = new Map<string, SkillEntry>();
    for (const s of globalSkills) byName.set(s.name, s);
    for (const s of metadataSkills) byName.set(s.name, s);
    const allSkills = Array.from(byName.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    // Filter by source
    let filtered = allSkills;
    if (source) {
      filtered = allSkills.filter((s) => s.source === source);
    }

    // Filter by search
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q)
      );
    }

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const paged = filtered.slice(start, start + pageSize);

    return NextResponse.json({ skills: paged, total });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const bucket = getMinioBucket();
  if (!bucket) {
    return NextResponse.json({ error: 'MinIO 未配置' }, { status: 503 });
  }

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json({ error: '需要 multipart/form-data 请求' }, { status: 400 });
  }

  try {
    const form = await request.formData();
    const file = form.get('file') as File | null;
    if (!file || !file.name) {
      return NextResponse.json({ error: '缺少技能包文件' }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith('.zip')) {
      return NextResponse.json({ error: '技能包须为 .zip 文件' }, { status: 400 });
    }
    if (file.size > SKILL_PACKAGE_MAX_BYTES) {
      return NextResponse.json({ error: '技能包超过 64 MB 大小限制' }, { status: 400 });
    }

    const overwrite = form.get('overwrite') === 'true';

    const bytes = new Uint8Array(await file.arrayBuffer());
    let parsed;
    try {
      parsed = parseSkillPackage(bytes);
    } catch (err) {
      const message = err instanceof Error ? err.message : '技能包校验失败';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const client = createMinioClient();
    await ensureSkillsBucket(client);

    // Check for name conflict with ANY existing skill (custom or nacos)
    const existing = await getSkillMetadata(client, parsed.skillName);
    if (existing) {
      if (!overwrite) {
        return NextResponse.json(
          {
            error: `技能 "${parsed.skillName}" 已存在`,
            conflict: true,
            existing: existing,
          },
          { status: 409 }
        );
      }

      if (existing.source === 'nacos') {
        return NextResponse.json(
          { error: 'Nacos 来源的技能不可覆盖' },
          { status: 403 }
        );
      }

      // Delete old skill files before overwriting
      const oldPrefix = `${parsed.skillName}/`;
      const oldStream = client.listObjects(SKILLS_BUCKET, oldPrefix, false);
      for await (const obj of oldStream) {
        if (obj.name) {
          await client.removeObject(SKILLS_BUCKET, obj.name);
        }
      }
    }

    const now = new Date().toISOString();
    const metadata: SkillEntry = {
      name: parsed.skillName,
      description: parsed.description,
      source: 'custom',
      version: parsed.version,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      fileCount: parsed.files.length,
    };

    await saveSkillMetadata(client, metadata);

    // Save skill files
    for (const f of parsed.files) {
      const key = `${parsed.skillName}/${f.relativePath}`;
      await client.putObject(
        SKILLS_BUCKET,
        key,
        Buffer.from(f.data),
        f.data.byteLength,
        { 'Content-Type': 'application/octet-stream' }
      );
    }

    return NextResponse.json({ success: true, ...metadata }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown storage error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { createMinioClient, getMinioBucket } from '@/lib/minio-client';
import {
  parseSkillPackage,
  SKILL_PACKAGE_MAX_BYTES,
  isValidNameSegment,
} from '@/lib/skill-package';
import {
  SkillEntry,
  SKILLS_BUCKET,
  SKILLS_METADATA_PREFIX,
  SKILL_NAME_PATTERN,
} from '@/lib/skill-center-types';

/**
 * Ensure the skills bucket exists, creating it if necessary
 */
async function ensureSkillsBucket(client: any): Promise<void> {
  const exists = await client.bucketExists(SKILLS_BUCKET);
  if (!exists) {
    await client.makeBucket(SKILLS_BUCKET);
  }
}

/**
 * Parse metadata from MinIO object or return null if not found
 */
async function getSkillMetadata(client: any, skillName: string): Promise<SkillEntry | null> {
  const key = `${SKILLS_METADATA_PREFIX}${skillName}.json`;
  try {
    const stream = await client.getObject(SKILLS_BUCKET, key);
    const data = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
    return JSON.parse(data.toString('utf-8')) as SkillEntry;
  } catch {
    return null;
  }
}

/**
 * List all custom skills from MinIO
 */
async function listCustomSkills(client: any): Promise<SkillEntry[]> {
  const skills: SkillEntry[] = [];
  const stream = client.listObjects(SKILLS_BUCKET, SKILLS_METADATA_PREFIX, true);

  for await (const obj of stream) {
    if (!obj.objectName.endsWith('.json')) continue;
    const name = obj.objectName.replace(SKILLS_METADATA_PREFIX, '').replace('.json', '');
    if (!isValidNameSegment(name) || !SKILL_NAME_PATTERN.test(name)) continue;

    const metadata = await getSkillMetadata(client, name);
    if (metadata) {
      skills.push(metadata);
    }
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

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

    const customSkills = await listCustomSkills(client);

    // Filter by source
    let filtered = customSkills;
    if (source === 'nacos') {
      filtered = []; // Nacos skills will be added from external sync
    } else if (source === 'custom') {
      filtered = customSkills;
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

    // Check for name conflict with existing custom skill
    const existing = await getSkillMetadata(client, parsed.skillName);
    if (existing && existing.source === 'custom') {
      return NextResponse.json(
        {
          error: `技能 "${parsed.skillName}" 已存在`,
          conflict: true,
          existing: existing,
        },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();
    const metadata: SkillEntry = {
      name: parsed.skillName,
      description: parsed.description,
      source: 'custom',
      version: parsed.version,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
      fileCount: parsed.files.length,
    };

    // Save metadata
    const metadataKey = `${SKILLS_METADATA_PREFIX}${parsed.skillName}.json`;
    const metadataBuffer = Buffer.from(JSON.stringify(metadata, null, 2));
    await client.putObject(
      SKILLS_BUCKET,
      metadataKey,
      metadataBuffer,
      metadataBuffer.length,
      { 'Content-Type': 'application/json' }
    );

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

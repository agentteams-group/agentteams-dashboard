import { NextRequest, NextResponse } from 'next/server';
import { createMinioClient, getMinioBucket } from '@/lib/minio-client';
import { isValidNameSegment } from '@/lib/skill-package';
import {
  SkillEntry,
  SKILLS_BUCKET,
  SKILLS_METADATA_PREFIX,
} from '@/lib/skill-center-types';

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

async function listSkillFiles(client: any, skillName: string): Promise<string[]> {
  const prefix = `${skillName}/`;
  const files: string[] = [];
  const stream = client.listObjects(SKILLS_BUCKET, prefix, false);

  for await (const obj of stream) {
    if (obj?.objectName?.endsWith('/')) continue;
    files.push(obj.objectName.replace(prefix, ''));
  }

  return files.sort();
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  if (!isValidNameSegment(name)) {
    return NextResponse.json({ error: '非法技能名称' }, { status: 400 });
  }

  const bucket = getMinioBucket();
  if (!bucket) {
    return NextResponse.json({ error: 'MinIO 未配置' }, { status: 503 });
  }

  try {
    const client = createMinioClient();
    const metadata = await getSkillMetadata(client, name);
    if (!metadata) {
      return NextResponse.json({ error: '技能不存在' }, { status: 404 });
    }

    const files = await listSkillFiles(client, name);

    return NextResponse.json({ skill: metadata, files });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  if (!isValidNameSegment(name)) {
    return NextResponse.json({ error: '非法技能名称' }, { status: 400 });
  }

  const bucket = getMinioBucket();
  if (!bucket) {
    return NextResponse.json({ error: 'MinIO 未配置' }, { status: 503 });
  }

  let body: { description?: string; version?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }

  try {
    const client = createMinioClient();
    const metadata = await getSkillMetadata(client, name);
    if (!metadata) {
      return NextResponse.json({ error: '技能不存在' }, { status: 404 });
    }

    // Nacos skills cannot be edited
    if (metadata.source === 'nacos') {
      return NextResponse.json({ error: 'Nacos 来源的技能不可编辑' }, { status: 403 });
    }

    const updated: SkillEntry = {
      ...metadata,
      description: body.description ?? metadata.description,
      version: body.version ?? metadata.version,
      updatedAt: new Date().toISOString(),
    };

    const key = `${SKILLS_METADATA_PREFIX}${name}.json`;
    const data = Buffer.from(JSON.stringify(updated, null, 2));
    await client.putObject(SKILLS_BUCKET, key, data, data.length, {
      'Content-Type': 'application/json',
    });

    return NextResponse.json({ success: true, ...updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  if (!isValidNameSegment(name)) {
    return NextResponse.json({ error: '非法技能名称' }, { status: 400 });
  }

  const bucket = getMinioBucket();
  if (!bucket) {
    return NextResponse.json({ error: 'MinIO 未配置' }, { status: 503 });
  }

  try {
    const client = createMinioClient();
    const metadata = await getSkillMetadata(client, name);
    if (!metadata) {
      return NextResponse.json({ error: '技能不存在' }, { status: 404 });
    }

    // Nacos skills cannot be deleted
    if (metadata.source === 'nacos') {
      return NextResponse.json({ error: 'Nacos 来源的技能不可删除' }, { status: 403 });
    }

    // Delete metadata
    const metadataKey = `${SKILLS_METADATA_PREFIX}${name}.json`;
    await client.removeObject(SKILLS_BUCKET, metadataKey);

    // Delete all skill files
    const prefix = `${name}/`;
    const stream = client.listObjects(SKILLS_BUCKET, prefix, false);
    for await (const obj of stream) {
      if (!obj?.objectName?.endsWith('/')) {
        await client.removeObject(SKILLS_BUCKET, obj.objectName);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

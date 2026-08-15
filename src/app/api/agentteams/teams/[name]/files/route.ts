import { NextRequest, NextResponse } from 'next/server';
import { createMinioClient, getMinioBucket } from '@/lib/minio-client';
import { isValidNameSegment } from '@/lib/skill-package';
import type { StorageObject } from '@/lib/agentteams-api';

// AgentTeams team workspace layout (see team-tasks/route.ts):
//   teams/{team}/shared/tasks/{task-id}/meta.json
//   teams/{team}/shared/projects/{project-id}/meta.json
// This route browses the same `teams/{team}/` tree non-recursively so the
// team room can show its shared workspace files.

function listFiles(
  client: ReturnType<typeof createMinioClient>,
  bucket: string,
  prefix: string,
): Promise<StorageObject[]> {
  return new Promise((resolve, reject) => {
    const objects: StorageObject[] = [];
    const stream = client.listObjects(bucket, prefix, false);
    stream.on('data', (obj: Record<string, unknown>) => {
      if (typeof obj.prefix === 'string') {
        objects.push({ key: obj.prefix, size: 0, isPrefix: true });
      } else if (typeof obj.name === 'string') {
        objects.push({
          key: obj.name,
          size: typeof obj.size === 'number' ? obj.size : 0,
          lastModified: obj.lastModified ? String(obj.lastModified) : undefined,
          etag: typeof obj.etag === 'string' ? obj.etag : undefined,
        });
      }
    });
    stream.on('error', reject);
    stream.on('end', () => resolve(objects));
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const subPrefix = request.nextUrl.searchParams.get('prefix') ?? '';
  if (!isValidNameSegment(name)) {
    return NextResponse.json({ error: '非法 Team 名' }, { status: 400 });
  }

  const bucket = getMinioBucket();
  if (!bucket) {
    return NextResponse.json({ error: 'MinIO 未配置' }, { status: 503 });
  }

  try {
    const client = createMinioClient();
    const teamRoot = `teams/${name}/`;
    // The client tracks prefixes as full keys; accept either a full key or a
    // path relative to the team root, then always list under teams/{name}/.
    const base = subPrefix.startsWith(teamRoot) ? subPrefix : `${teamRoot}${subPrefix}`;
    const objects = await listFiles(client, bucket, base);
    const trimmed = objects.filter((obj) => obj.key === base || obj.key.startsWith(base));
    return NextResponse.json({
      objects: trimmed,
      prefix: subPrefix,
      root: teamRoot,
    });
  } catch {
    return NextResponse.json({ error: '无法读取 Team 文件' }, { status: 502 });
  }
}

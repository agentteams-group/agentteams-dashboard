import { NextRequest, NextResponse } from 'next/server';
import { createMinioClient, getMinioBucket } from '@/lib/minio-client';
import { isValidNameSegment } from '@/lib/skill-package';
import { enforceServerSideRbac } from '@/lib/server-auth';
import { isSensitiveObjectKey, isSensitiveStoragePrefix, normalizeStorageKey, normalizeStorageBucket } from '@/lib/sensitive-files';
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

  // SEC-03：对齐 workers/[name]/files 读入口——list 同样加服务端 RBAC 门，
  // 并过滤敏感条目（credentials/.ssh 等），不向范围外用户暴露文件 key。
  const denied = await enforceServerSideRbac(request, 'view', 'team', name);
  if (denied) return denied;

  const bucket = getMinioBucket();
  if (!bucket) {
    return NextResponse.json({ error: 'MinIO 未配置' }, { status: 503 });
  }

  try {
    const teamRoot = `teams/${name}/`;
    const candidate = subPrefix.startsWith('teams/') ? subPrefix : `${teamRoot}${subPrefix}`;
    let base: string;
    try {
      base = normalizeStorageKey(candidate);
      normalizeStorageBucket(bucket);
    } catch {
      return NextResponse.json({ error: '非法 Team 文件路径' }, { status: 400 });
    }
    if (base !== teamRoot.slice(0, -1) && !base.startsWith(teamRoot)) {
      return NextResponse.json({ error: '非法 Team 文件路径' }, { status: 400 });
    }
    if (isSensitiveStoragePrefix(bucket, base)) {
      return NextResponse.json({ error: '文件不存在' }, { status: 404 });
    }
    // The client tracks prefixes as full keys; always list under teams/{name}/.
    const client = createMinioClient();
    const objects = await listFiles(client, bucket, base);
    // 范围收敛 + 敏感条目过滤：credentials/.ssh 等不进列表。
    const trimmed = objects.filter((obj) => {
      if (obj.key !== base && !obj.key.startsWith(base)) return false;
      return !isSensitiveObjectKey(obj.key);
    });
    return NextResponse.json({
      objects: trimmed,
      prefix: subPrefix,
      root: teamRoot,
    });
  } catch {
    return NextResponse.json({ error: '无法读取 Team 文件' }, { status: 502 });
  }
}

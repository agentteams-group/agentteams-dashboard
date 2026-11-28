import { NextRequest, NextResponse } from 'next/server';
import { createMinioClient, getMinioBucket } from '@/lib/minio-client';
import { isValidNameSegment } from '@/lib/skill-package';
import type { StorageObject } from '@/lib/agentteams-api';
import { enforceServerSideRbac } from '@/lib/server-auth';
import { isSensitiveObjectKey, isSensitiveStoragePrefix, normalizeStorageBucket, normalizeStorageKey } from '@/lib/sensitive-files';

function listFiles(client: ReturnType<typeof createMinioClient>, bucket: string, prefix: string): Promise<StorageObject[]> {
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

function stripAgentsPrefix(name: string, objects: StorageObject[]): StorageObject[] {
  const prefix = `${name}/`;
  return objects
    .map((obj) => {
      if (obj.key.startsWith('agents/')) {
        return { ...obj, key: obj.key.slice('agents/'.length) };
      }
      return obj;
    })
    .filter((obj) => obj.key === prefix || obj.key.startsWith(prefix))
    // B1：敏感文件不进入文件列表（服务端过滤，不是藏按钮）
    .filter((obj) => !isSensitiveObjectKey(obj.key));
}

/** B1：按 {name}/ 前缀剥离后过滤敏感条目（非 agents/ 直列路径复用）。 */
function filterSensitive(name: string, objects: StorageObject[]): StorageObject[] {
  const prefix = `${name}/`;
  return objects.filter((obj) => {
    if (!obj.key.startsWith(prefix)) return true;
    return !isSensitiveObjectKey(obj.key);
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const subPrefix = request.nextUrl.searchParams.get('prefix') ?? '';
  if (!isValidNameSegment(name)) {
    return NextResponse.json({ error: '非法 Worker 名' }, { status: 400 });
  }

  // B1（维护者 1.2.4 联调验收报告）：list 入口同样无可见性判定——
  // 受限用户可列出范围外 Worker 的全部文件 key。加 RBAC 门 +
  // 敏感条目过滤（与 download 同定义）。
  const denied = await enforceServerSideRbac(request, 'view', 'worker', name);
  if (denied) return denied;

  const bucket = getMinioBucket();
  if (!bucket) {
    return NextResponse.json({ error: 'MinIO 未配置' }, { status: 503 });
  }

  let normalizedSubPrefix: string;
  try {
    normalizeStorageBucket(bucket);
    normalizedSubPrefix = normalizeStorageKey(subPrefix);
  } catch {
    return NextResponse.json({ error: '非法 Worker 文件路径' }, { status: 400 });
  }
  const withoutAgents = normalizedSubPrefix.startsWith('agents/')
    ? normalizedSubPrefix.slice('agents/'.length)
    : normalizedSubPrefix;
  if (withoutAgents && !withoutAgents.startsWith(`${name}/`)) {
    return NextResponse.json({ error: '非法 Worker 文件路径' }, { status: 400 });
  }
  const directPrefix = withoutAgents || `${name}/`;
  if (isSensitiveStoragePrefix(bucket, directPrefix)) {
    return NextResponse.json({ error: '文件不存在' }, { status: 404 });
  }

  try {
    const client = createMinioClient();
    const tryList = async (prefix: string) => await listFiles(client, bucket, prefix);

    if (normalizedSubPrefix) {
      const direct = await tryList(directPrefix);
      if (direct.length > 0) return NextResponse.json({ objects: filterSensitive(name, direct), prefix: subPrefix });

      const agentsFallback = stripAgentsPrefix(name, await tryList(`agents/${directPrefix}`));
      return NextResponse.json({ objects: agentsFallback, prefix: subPrefix });
    }

    const rootPrefix = `${name}/`;
    const rootObjects = await tryList(rootPrefix);
    if (rootObjects.length > 0) {
      return NextResponse.json({ objects: filterSensitive(name, rootObjects), prefix: '' });
    }

    const agentsObjects = stripAgentsPrefix(name, await tryList(`agents/${rootPrefix}`));
    return NextResponse.json({ objects: agentsObjects, prefix: '' });
  } catch {
    return NextResponse.json({ error: '无法读取 Worker 文件' }, { status: 502 });
  }
}

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { enforceStorageObjectRbac } from '@/lib/server-auth';
import type { Permission } from '@/lib/rbac-engine';
import {
  StoragePathNormalizationError,
  decodeStoragePath,
  isSensitiveStorageObject,
  isSensitiveStoragePrefix,
  normalizeStorageBucket,
  normalizeStorageKey,
} from '@/lib/sensitive-files';

export const STORAGE_NOT_FOUND = () => NextResponse.json({ error: '文件不存在' }, { status: 404 });

/** 所有 MinIO 对象操作共享：规范化 → 秘密 404 → 资源级 RBAC。 */
export async function guardStorageObject(
  request: NextRequest,
  action: Permission,
  bucket: string,
  key: string,
): Promise<{ bucket: string; key: string; response?: never } | { response: NextResponse; bucket?: never; key?: never }> {
  if (!bucket || !key) {
    return { response: NextResponse.json({ error: 'bucket and key are required' }, { status: 400 }) };
  }
  let bucketName: string;
  let objectKey: string;
  try {
    bucketName = normalizeStorageBucket(bucket);
    objectKey = normalizeStorageKey(key);
  } catch (error) {
    if (error instanceof StoragePathNormalizationError) return { response: STORAGE_NOT_FOUND() };
    throw error;
  }
  if (!bucketName || !objectKey || isSensitiveStorageObject(bucketName, objectKey)) {
    return { response: STORAGE_NOT_FOUND() };
  }
  const denied = await enforceStorageObjectRbac(request, action, objectKey);
  return denied ? { response: denied } : { bucket: bucketName, key: objectKey };
}

/** list 在创建 MinIO client 前验证 bucket/prefix，并拒绝集合前缀越权。 */
export async function guardStoragePrefix(
  request: NextRequest,
  bucket: string,
  prefix: string,
): Promise<{ bucket: string; prefix: string; response?: never } | { response: NextResponse; bucket?: never; prefix?: never }> {
  let bucketName: string;
  let normalizedPrefix: string;
  try {
    bucketName = normalizeStorageBucket(bucket);
    const canonicalPrefix = normalizeStorageKey(prefix);
    // S3 delimiter listing relies on the trailing slash to list children.
    // Path canonicalization removes it, so restore exactly one directory separator.
    normalizedPrefix = canonicalPrefix && /[\\/\u2044\u2215\uFF0F\uFF3C]$/.test(decodeStoragePath(prefix).normalize('NFKC'))
      ? `${canonicalPrefix}/`
      : canonicalPrefix;
  } catch (error) {
    if (error instanceof StoragePathNormalizationError) return { response: STORAGE_NOT_FOUND() };
    throw error;
  }
  if (!bucketName || isSensitiveStoragePrefix(bucketName, normalizedPrefix)) {
    return { response: STORAGE_NOT_FOUND() };
  }
  const denied = await enforceStorageObjectRbac(request, 'view', normalizedPrefix);
  return denied ? { response: denied } : { bucket: bucketName, prefix: normalizedPrefix };
}

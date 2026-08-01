/**
 * Worker resource name validation.
 *
 * Embedded-mode MinIO provisions one user per Worker and uses the Worker name
 * as the MinIO user access key, so the name must satisfy the MinIO access-key
 * rule: 3-20 characters. Shorter or longer names fail provisioning with
 * "access key length should be between 3 and 20".
 */
export const WORKER_NAME_MIN_LENGTH = 3;
export const WORKER_NAME_MAX_LENGTH = 20;

/** Returns a user-facing error message, or null when the name is acceptable. */
export function workerNameError(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (trimmed.length < WORKER_NAME_MIN_LENGTH) {
    return `名称至少 ${WORKER_NAME_MIN_LENGTH} 个字符（Worker 名用作 MinIO 访问密钥，长度要求 ${WORKER_NAME_MIN_LENGTH}-${WORKER_NAME_MAX_LENGTH}）。`;
  }
  if (trimmed.length > WORKER_NAME_MAX_LENGTH) {
    return `名称最多 ${WORKER_NAME_MAX_LENGTH} 个字符（Worker 名用作 MinIO 访问密钥，长度要求 ${WORKER_NAME_MIN_LENGTH}-${WORKER_NAME_MAX_LENGTH}）。`;
  }
  return null;
}

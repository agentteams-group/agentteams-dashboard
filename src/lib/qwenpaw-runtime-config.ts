// QwenPaw legacy runtime-config client (dashboard side).
//
// QwenPaw workers expose their running config through the controller's
// `GET/PUT /api/v1/workers/{name}/runtime-config` end (upstream #1231), which
// the dashboard already proxies at
// `src/app/api/agentteams/workers/[name]/runtime-config/route.ts`.
//
// This is deliberately NOT the member-config surface: the controller only
// registers surface adapters for openclaw + hermes, so a QwenPaw worker answers
// 429/404 "endpoint unsupported" there. The legacy endpoint is the one the
// workbench plugin uses for QwenPaw and the only one that carries
// AgentsRunningConfig.
//
// Write contract (controller enforced):
//   · PUT body = changed top-level keys only; nested keys are merged upstream
//     read-merge-write.
//   · If-Match = the ETag read with GET; stale/missing → 409/412/428.
//   · 403 = L2 caller writing a key outside the whitelist (or missing token).
//   · 503 = controller not in embedded mode.

import { ApiError, NetworkError, shortErrorMessage } from '@/lib/api-error';
import { apiUrl, extractErrorDetail } from '@/lib/api-base';
import type { Rc } from './qwenpaw-runtime-config-model';

export interface QwenpawRuntimeConfigSnapshot {
  config: Rc;
  etag: string | null;
}

const configPath = (workerName: string) =>
  apiUrl(`/api/agentteams/workers/${encodeURIComponent(workerName)}/runtime-config`);

export async function fetchQwenpawRuntimeConfig(
  workerName: string,
): Promise<QwenpawRuntimeConfigSnapshot> {
  const url = configPath(workerName);
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch (err) {
    throw new NetworkError(url, err);
  }
  if (!res.ok) {
    const detail = await extractErrorDetail(res, `HTTP ${res.status}`);
    throw new ApiError(detail, res.status, url);
  }
  const config = (await res.json()) as Rc;
  return { config: config && typeof config === 'object' ? config : {}, etag: res.headers.get('ETag') };
}

/** PUT the diff; the controller returns the merged config (ignored — callers
 * refetch so the UI shows the authoritative values). */
export async function putQwenpawRuntimeConfig(
  workerName: string,
  patch: Rc,
  ifMatch: string | null,
): Promise<void> {
  const url = configPath(workerName);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        ...(ifMatch ? { 'If-Match': ifMatch } : {}),
      },
      body: JSON.stringify(patch),
    });
  } catch (err) {
    throw new NetworkError(url, err);
  }
  if (!res.ok) {
    const detail = await extractErrorDetail(res, `HTTP ${res.status}`);
    throw new ApiError(detail, res.status, url);
  }
}

export const STALE_CONFIG_STATUSES = [409, 412, 428] as const;

export function isStaleConfigError(err: unknown): boolean {
  return err instanceof ApiError && (STALE_CONFIG_STATUSES as readonly number[]).includes(err.status);
}

/** Load-failure copy: every branch keeps the real reason and offers a retry. */
export function describeQwenpawLoadError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 404:
        return '运行配置不可用：Controller 未提供该端点，或当前账号无该 Worker 访问权';
      case 400:
        return `该 Worker 不支持运行配置（仅 qwenpaw）：${shortErrorMessage(err)}`;
      case 403:
        return '无权限读取该 Worker 配置';
      case 503:
        return '当前部署模式不支持运行配置（需嵌入式模式）';
      default:
        return `读取配置失败：${shortErrorMessage(err)}`;
    }
  }
  return err instanceof Error ? err.message : '读取配置失败';
}

/** Write-failure copy (409/403/400/503 are the contract's meaningful cases). */
export function describeQwenpawWriteError(err: unknown): string {
  if (err instanceof ApiError) {
    if (isStaleConfigError(err)) return '配置已在别处更新，请重新加载后再保存';
    switch (err.status) {
      case 403:
        return '无权限保存该配置（需要 Controller 管理 token，或字段超出 L2 白名单）';
      case 400:
        return `保存被拒绝：${shortErrorMessage(err)}`;
      case 503:
        return '当前部署模式不支持保存运行配置（需嵌入式模式）';
      case 404:
        return '保存失败：该 Worker 或运行配置端点不存在';
      default:
        return `保存失败：${shortErrorMessage(err)}`;
    }
  }
  return err instanceof Error ? err.message : '保存失败';
}

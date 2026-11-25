import { agentteamsApi, type ManagerResponse } from '@/lib/agentteams-api';

// Manager 详情抽屉的写前读：列表投影只带标量列，抽屉打开时重读单个 Manager，
// 让每张配置卡的摘要（文档字符数 / skills / MCP / env / config）有据可依。
// 15s TTL 与 Worker 详情同档——抽屉反复开合不重复请求，又不会把刚保存的配置
// 展示成陈旧快照（每次保存后调用方显式 invalidate）。

const TTL_MS = 15_000;
const cache = new Map<string, { at: number; value: ManagerResponse }>();
const inflight = new Map<string, Promise<ManagerResponse>>();

export async function fetchManagerFull(
  name: string,
  options: { force?: boolean } = {},
): Promise<ManagerResponse> {
  const hit = cache.get(name);
  if (!options.force && hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const pending = inflight.get(name);
  if (pending) return pending;

  const request = agentteamsApi
    .getManager(name)
    .then((manager) => {
      cache.set(name, { at: Date.now(), value: manager });
      return manager;
    })
    .finally(() => {
      inflight.delete(name);
    });
  inflight.set(name, request);
  return request;
}

export function invalidateManagerDetail(name: string): void {
  cache.delete(name);
}

/** 测试钩子：清缓存（TTL 会跨用例残留）。 */
export function __resetManagerDetailCacheForTests(): void {
  cache.clear();
  inflight.clear();
}

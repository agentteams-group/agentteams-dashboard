import { agentteamsApi, type WorkerResponse } from '@/lib/agentteams-api';

// 详情抽屉的写前读：列表投影不含 skills/env 等配置字段，抽屉打开时必须重新读
// 单个 Worker。15s TTL 与插件 fetchWorkerDetail 同档——抽屉反复开合不重复请求，
// 又不会把「刚刚改过的配置」展示成陈旧快照。

const TTL_MS = 15_000;
const cache = new Map<string, { at: number; value: WorkerResponse }>();
const inflight = new Map<string, Promise<WorkerResponse>>();

export async function fetchWorkerDetail(name: string, options: { force?: boolean } = {}): Promise<WorkerResponse> {
  const hit = cache.get(name);
  if (!options.force && hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const pending = inflight.get(name);
  if (pending) return pending;

  const request = agentteamsApi
    .getWorker(name)
    .then((worker) => {
      cache.set(name, { at: Date.now(), value: worker });
      return worker;
    })
    .finally(() => {
      inflight.delete(name);
    });
  inflight.set(name, request);
  return request;
}

export function invalidateWorkerDetail(name: string): void {
  cache.delete(name);
}

/** 测试钩子：清缓存（TTL 会跨用例残留）。 */
export function __resetWorkerDetailCacheForTests(): void {
  cache.clear();
  inflight.clear();
}

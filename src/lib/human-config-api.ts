import { ApiError } from '@/lib/api-error';
import {
  buildWorkspaceAccessPayload,
  extractWorkspaceAccess,
  workspaceAccessEqual,
  type WorkspaceAccess,
} from '@/lib/workspace-access';
import type {
  HumanConfigRecord,
  ModelAccessTablesResponse,
  SaveHumanConfigResult,
  SaveHumanWorkspaceAccessResult,
} from '@/lib/agentteams-api';

interface ConfigTransport {
  request: <T>(_path: string, _options?: RequestInit) => Promise<T>;
  requestResult: <T>(_path: string, _options?: RequestInit) => Promise<{ data: T; response: Response }>;
}

interface VersionedRecord {
  record: Record<string, unknown>;
  etag: string | null;
}

/**
 * Human configuration writes share the proxy transport with the main API
 * client. Injecting it keeps conditional-read scope and error handling identical
 * without introducing a runtime import cycle.
 */
export function createHumanConfigApi(transport: ConfigTransport) {
  const { request: proxyRequest, requestResult: proxyRequestResult } = transport;

  function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  function isUnsupportedWrite(err: unknown): boolean {
    return err instanceof ApiError && (err.status === 404 || err.status === 405);
  }

  function isWriteConflict(err: unknown): boolean {
    return err instanceof ApiError && (err.status === 409 || err.status === 412);
  }

  async function readVersionedRecord(path: string, cache: RequestCache = 'no-store'): Promise<VersionedRecord> {
    const result = await proxyRequestResult<unknown>(path, { cache });
    const record = asRecord(result.data);
    if (!record) throw new Error('CR 读取结果非法（期望对象）');
    return { record, etag: result.response.headers.get('etag') };
  }

  async function writeHumanConfig(
    name: string,
    buildBody: (_record: Record<string, unknown>) => Record<string, unknown>,
    buildPatch: (_record: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<SaveHumanConfigResult> {
    const path = `/humans/${encodeURIComponent(name)}`;
    let read = await readVersionedRecord(path);
    try {
      await proxyRequest<unknown>(path, {
        method: 'PATCH',
        body: JSON.stringify(buildPatch(read.record)),
      });
      return { method: 'PATCH' };
    } catch (err) {
      if (!isUnsupportedWrite(err) && !isWriteConflict(err)) throw err;
    }

    // Three total conditional attempts: initial read + at most two re-reads.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!read.etag) {
        throw new ApiError(
          'Controller 不支持原子 PATCH 且未提供 ETag，拒绝并发不安全的写入',
          409,
          path,
        );
      }
      try {
        await proxyRequest<unknown>(path, {
          method: 'PUT',
          headers: { 'If-Match': read.etag },
          body: JSON.stringify(buildBody(read.record)),
        });
        return { method: 'PUT' };
      } catch (err) {
        if (!isWriteConflict(err) || attempt === 2) throw err;
        read = await readVersionedRecord(path, 'reload');
      }
    }
    throw new ApiError('人 CR 并发写入仍冲突', 409, path);
  }

  /**
   * 保存 spec.modelAccess（读-改-写，只改该字段）。
   * payload = null（无有效作用域）→ 发送空 scopes：该 Controller 以空 spec
   * 表示全锁（fail-closed），删键在 merge-patch 下反而不会清空。
   */
  async function saveHumanModelAccess(
    name: string,
    payload: Record<string, unknown> | null,
  ): Promise<SaveHumanConfigResult> {
    const value = payload ?? { scopes: [] };
    return writeHumanConfig(
      name,
      (record) => {
        const spec = asRecord(record.spec);
        return spec
          ? { ...record, spec: { ...spec, modelAccess: value } }
          : { ...record, modelAccess: value };
      },
      (record) =>
        asRecord(record.spec)
          ? { spec: { modelAccess: value } }
          : { modelAccess: value },
    );
  }

  /**
   * 保存 spec.workspaceAccess（读-改-写，只改该字段）→ re-GET 验证。
   * 当前 Controller 的 GET /humans/{name} 不回显 workspaceAccess（write-only）
   * 时 verified = false，调用方按「未回读」告警而不是断言保存失败。
   */
  async function saveHumanWorkspaceAccess(
    name: string,
    access: WorkspaceAccess,
  ): Promise<SaveHumanWorkspaceAccessResult> {
    const payload = buildWorkspaceAccessPayload(access); // {} = 清空两列表
    const result = await writeHumanConfig(
      name,
      (record) => {
        const spec = asRecord(record.spec);
        return spec
          ? { ...record, spec: { ...spec, workspaceAccess: payload } }
          : { ...record, workspaceAccess: payload };
      },
      (record) =>
        asRecord(record.spec)
          ? { spec: { workspaceAccess: payload } }
          : { workspaceAccess: payload },
    );
    const verify = await proxyRequest<HumanConfigRecord>(
      `/humans/${encodeURIComponent(name)}`,
    );
    const current = extractWorkspaceAccess(verify);
    return { ...result, verified: workspaceAccessEqual(current, access), current };
  }

  /** 共享模型授权表清单（404 / 缺 CRD → supported=false，隐藏表选择器）。 */
  async function listModelAccessTables(): Promise<{
    supported: boolean;
    tables: string[];
  }> {
    try {
      const body = await proxyRequest<
        ModelAccessTablesResponse | string[] | unknown[]
      >('/model-access-tables');
      const record = asRecord(body);
      const list: unknown = Array.isArray(body)
        ? body
        : (record?.items ?? record?.tables ?? record?.names);
      const tables: string[] = [];
      if (Array.isArray(list)) {
        for (const item of list) {
          const entry = asRecord(item);
          const name =
            typeof item === 'string'
              ? item
              : ((asRecord(entry?.metadata)?.name ?? entry?.name) as unknown);
          if (typeof name === 'string' && name.trim() !== '' && !tables.includes(name)) {
            tables.push(name);
          }
        }
      }
      return { supported: true, tables };
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        return { supported: false, tables: [] };
      }
      if (
        err instanceof ApiError &&
        err.status === 500 &&
        /no matches for kind/i.test(err.message) &&
        /modelaccesstable/i.test(err.message)
      ) {
        return { supported: false, tables: [] };
      }
      throw err;
    }
  }

  return {
    saveHumanModelAccess,
    saveHumanWorkspaceAccess,
    listModelAccessTables,
    asRecord,
    isUnsupportedWrite,
    isWriteConflict,
    readVersionedRecord,
  };
}

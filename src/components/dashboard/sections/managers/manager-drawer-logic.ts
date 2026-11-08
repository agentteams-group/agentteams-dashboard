// Manager 详情抽屉的纯逻辑：私聊目标、草稿归一化、错误文案、保存回读判定。
// 无 React 依赖，node 环境直测。

import { ApiError, formatErrorMessage } from '@/lib/api-error';
import type {
  ManagerConfigInfo,
  ManagerMcpServer,
  ManagerResponse,
} from '@/lib/agentteams-api';

export interface ManagerDmTarget {
  mxid: string;
  /** 个人房间（Controller roomID）；缺省 = 只有 MXID，无直跳目标。 */
  roomId?: string;
}

/** 有 MXID 才可私聊（房间可选：有个人房间就直跳私聊，无则入口隐藏跳转）。 */
export function dmTargetFor(
  manager: { matrixUserID?: string; roomID?: string } | null | undefined,
): ManagerDmTarget | null {
  const mxid = (manager?.matrixUserID || '').trim();
  if (!mxid) return null;
  const roomId = (manager?.roomID || '').trim();
  return roomId ? { mxid, roomId } : { mxid };
}

/** desired-state 语义：Sleeping / Stopped 视为已休眠（显示「唤醒」）。 */
export function isManagerAsleep(state?: string | null): boolean {
  return state === 'Sleeping' || state === 'Stopped';
}

export interface ManagerConfigDraft {
  heartbeatInterval: string;
  workerIdleTimeout: string;
  notifyChannel: string;
}

export const EMPTY_MANAGER_CONFIG_DRAFT: ManagerConfigDraft = {
  heartbeatInterval: '',
  workerIdleTimeout: '',
  notifyChannel: '',
};

export function configDraftFrom(config?: ManagerConfigInfo | null): ManagerConfigDraft {
  return {
    heartbeatInterval: config?.heartbeatInterval ?? '',
    workerIdleTimeout: config?.workerIdleTimeout ?? '',
    notifyChannel: config?.notifyChannel ?? '',
  };
}

/** 与当前 spec 的 config 比较（trim 后）；true = 有未保存改动。 */
export function managerConfigDirty(
  draft: ManagerConfigDraft,
  config?: ManagerConfigInfo | null,
): boolean {
  const base = configDraftFrom(config);
  return (
    draft.heartbeatInterval.trim() !== base.heartbeatInterval.trim() ||
    draft.workerIdleTimeout.trim() !== base.workerIdleTimeout.trim() ||
    draft.notifyChannel.trim() !== base.notifyChannel.trim()
  );
}

/** 提交体：整对象替换；空串 = 回退 Controller 默认。 */
export function managerConfigPayload(draft: ManagerConfigDraft): ManagerConfigInfo {
  return {
    heartbeatInterval: draft.heartbeatInterval.trim(),
    workerIdleTimeout: draft.workerIdleTimeout.trim(),
    notifyChannel: draft.notifyChannel.trim(),
  };
}

/**
 * 文档保存拦截：Controller 只在 soul/agents 非空时写（UpdateManager：
 * `if req.Soul != ""`），空草稿无法清除既有内容——拦下，避免「已保存但没变」。
 */
export function managerDocSaveBlocked(draft: string, base: string): boolean {
  return draft.trim() === '' && base.trim() !== '';
}

export interface McpDraftNormalized {
  error?: string;
  servers?: ManagerMcpServer[];
}

/** 行草稿归一化：name/url 必须成对；两列都空 = 未填行（丢弃）。 */
export function normalizeMcpDraft(rows: ManagerMcpServer[]): McpDraftNormalized {
  const incomplete = rows.some(
    (row) => (row.name.trim() !== '') !== (row.url.trim() !== ''),
  );
  if (incomplete) return { error: '存在未完成行（name 与 url 必填）' };
  const servers: ManagerMcpServer[] = [];
  for (const row of rows) {
    const name = row.name.trim();
    const url = row.url.trim();
    if (!name || !url) continue;
    const transport = (row.transport ?? '').trim();
    servers.push(transport ? { name, url, transport } : { name, url });
  }
  return { servers };
}

export interface EnvDraftRow {
  key: string;
  value: string;
}

export interface EnvDraftNormalized {
  error?: string;
  env?: Record<string, string>;
}

/** key-value 行草稿：key 必填（value 可空）；重复 key 报错。 */
export function normalizeEnvDraft(rows: EnvDraftRow[]): EnvDraftNormalized {
  const env: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    const value = row.value;
    if (!key) {
      if (value.trim() === '') continue;
      return { error: '存在未完成行（key 必填）' };
    }
    if (Object.prototype.hasOwnProperty.call(env, key)) {
      return { error: `环境变量名重复：${key}` };
    }
    env[key] = value;
  }
  return { env };
}

/** 保存后回读：Controller 未接收 env（当前 UpdateManagerRequest 无该字段）→ false。 */
export function managerEnvApplied(
  requested: Record<string, string>,
  returned: Record<string, string> | undefined,
): boolean {
  if (!returned) return Object.keys(requested).length === 0;
  const keys = new Set([...Object.keys(requested), ...Object.keys(returned)]);
  for (const key of keys) {
    if ((requested[key] ?? '') !== (returned[key] ?? '')) return false;
  }
  return true;
}

/** 保存后回读：config 是否原样回来（后端不回显 → false ⇒ 提示「未确认」。 */
export function managerConfigApplied(
  requested: ManagerConfigInfo,
  returned: ManagerConfigInfo | undefined,
): boolean {
  if (!returned) {
    return Object.values(requested).every((value) => (value ?? '').trim() === '');
  }
  return (
    (returned.heartbeatInterval ?? '').trim() === (requested.heartbeatInterval ?? '').trim() &&
    (returned.workerIdleTimeout ?? '').trim() === (requested.workerIdleTimeout ?? '').trim() &&
    (requested.notifyChannel ?? '').trim() === (returned.notifyChannel ?? '').trim()
  );
}

/** Controller 是否回显了任何 ManagerSpec 配置字段（决定「未配置」还是「读不到」）。 */
export function managerSpecReadable(manager: ManagerResponse | null | undefined): boolean {
  if (!manager) return false;
  return Boolean(
    manager.soul !== undefined ||
      manager.agents !== undefined ||
      manager.skills !== undefined ||
      manager.mcpServers !== undefined ||
      manager.env !== undefined ||
      manager.config !== undefined,
  );
}

/** 403/404/409 落到可读文案；其余走统一 formatErrorMessage。 */
export function managerActionErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403) {
      return '无权限：Manager 配置需要 L1 管理员权限（Controller 管理员 token）';
    }
    if (err.status === 404) {
      return 'Manager 不存在，或当前 Controller 不支持该操作（404）';
    }
    if (err.status === 409) {
      return '操作冲突（409）：Manager 正在调谐或已有并发修改，请稍后重试';
    }
  }
  return formatErrorMessage(err);
}

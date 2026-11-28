import { BACKEND_NAMES, type BackendName } from '@/lib/backend-names';

// Server address-entry shape (duplicated as TYPES only — the server module is
// never imported into this client bundle). Secrets arrive as '***'.
type ServerAuth =
  | { type: 'basic'; username: string; password: string }
  | { type: 'bearer'; token: string };
export type ServerEntry = string | { url: string; auth?: ServerAuth };
type ServerAddrs = { internal?: ServerEntry; external?: ServerEntry };

const REDACTED_SECRET = '***';

interface BackendStatus {
  configured: boolean;
  candidates: string[];
}

export interface SetupStatusResponse {
  configured: boolean;
  /** F1f3: false when the installer disabled the pre-login token gate
   * (DASHBOARD_SETUP_TOKEN_ENFORCE=0) — the token field is hidden. */
  setupTokenRequired?: boolean;
  /** 地址模式（对齐工作台插件）：auto/lan/wan；老响应缺省 = auto。 */
  addressMode?: 'auto' | 'lan' | 'wan';
  /** PR-91 review: absent in the anonymous (pre-login, no token) response —
   * the saved topology is only served to a session or ?token= holder. */
  backends?: Record<BackendName, BackendStatus>;
  /** 逐地址条目（已脱敏；秘密 '***'）——回填认证方式与「已保存」占位。 */
  entries?: Record<BackendName, ServerAddrs>;
  /** 旧字符串投影（仅 session 响应返回）：{ name: { internal?, external? } }。
   * 没有 entries 的老响应/匿名响应只能靠它回填槽位。 */
  config?: Record<string, { internal?: string; external?: string }>;
  /** 工作缓存里当前生效的地址（「当前生效」徽标）。 */
  effective?: Partial<Record<BackendName, string>>;
  embedded: {
    defaults: Record<BackendName, string | undefined>;
    healthy: Record<BackendName, boolean> | null;
  };
}

/** 认证方式草稿。stored = 该地址该类型已有服务端凭据（秘密不回显，输入框
 * 留空 = 保持不变）；换类型时清零（防止把 A 类型的 stored 误带到 B 类型）。 */
export type AuthType = 'none' | 'basic' | 'bearer';

export interface SlotDraft {
  url: string;
  type: AuthType;
  username: string;
  password: string;
  token: string;
  stored: boolean;
}

export const EMPTY_SLOT: SlotDraft = {
  url: '',
  type: 'none',
  username: '',
  password: '',
  token: '',
  stored: false,
};

export interface BackendForm {
  internal: SlotDraft;
  external: SlotDraft;
}

export type BackendForms = Record<BackendName, BackendForm>;

export function emptyForm(): BackendForms {
  return Object.fromEntries(
    BACKEND_NAMES.map((name) => [
      name,
      { internal: { ...EMPTY_SLOT }, external: { ...EMPTY_SLOT } },
    ]),
  ) as BackendForms;
}

/** 服务端条目 → 编辑草稿。脱敏值 '***' 不进输入框（只置 stored 标记）。 */
function entryToDraft(entry: ServerEntry | undefined): SlotDraft {
  if (entry && typeof entry === 'object') {
    const auth = entry.auth;
    if (auth?.type === 'basic') {
      return {
        ...EMPTY_SLOT,
        url: entry.url,
        type: 'basic',
        username: auth.username ?? '',
        stored: true,
      };
    }
    if (auth?.type === 'bearer') {
      return { ...EMPTY_SLOT, url: entry.url, type: 'bearer', stored: true };
    }
    return { ...EMPTY_SLOT, url: entry.url };
  }
  return { ...EMPTY_SLOT, url: typeof entry === 'string' ? entry : '' };
}

/** 草稿 → 提交条目（插件 buildAuthEntry 语义）：
 * - 秘密已填 → 显式凭据；
 * - 秘密留空且已存 → 发 '***' 占位，服务端按槽位继承旧秘密；
 * - 凭据不完整 → 降级纯 URL 条目（诚实：不装半个凭据）。 */
export function draftToEntry(draft: SlotDraft): ServerEntry | undefined {
  const url = draft.url.trim();
  if (!url) return undefined;
  if (draft.type === 'basic' && draft.username.trim()) {
    const password = draft.password.trim();
    if (password) {
      return { url, auth: { type: 'basic', username: draft.username.trim(), password } };
    }
    if (draft.stored) {
      return {
        url,
        auth: { type: 'basic', username: draft.username.trim(), password: REDACTED_SECRET },
      };
    }
  }
  if (draft.type === 'bearer') {
    const token = draft.token.trim();
    if (token) return { url, auth: { type: 'bearer', token } };
    if (draft.stored) return { url, auth: { type: 'bearer', token: REDACTED_SECRET } };
  }
  return url;
}

/** 服务端响应 → 表单预填：只填空槽，绝不覆盖用户已输入的地址。
 *
 * 槽位身份只能来自按槽位给出的数据：`entries` 存在时**只用 entries**，
 * 空槽保持空。`candidates` 是去掉空槽后的紧凑列表（只存外网时
 * candidates[0] = 外网地址），按下标回填会把外网地址猜进内网
 * （2026-11-07 实测缺陷）。
 *
 * `entries` 缺失（老响应 / 匿名响应）时才退回 legacy：先按槽位读
 * `data.config[name][slot]`，最后才在两个槽都空时按位置用 candidates。 */
export function applyPrefill(data: SetupStatusResponse, prev: BackendForms): BackendForms {
  return Object.fromEntries(
    BACKEND_NAMES.map((name) => {
      const entries = data.entries?.[name];
      const legacy = data.config?.[name];
      const candidates = data.backends?.[name]?.candidates ?? [];
      const next: BackendForm = {
        internal: { ...prev[name].internal },
        external: { ...prev[name].external },
      };
      const slots = ['internal', 'external'] as const;
      for (const slot of slots) {
        if (next[slot].url.trim()) continue;
        if (entries) {
          const entry = entries[slot];
          if (entry) next[slot] = entryToDraft(entry);
          continue;
        }
        const legacyUrl = legacy?.[slot];
        if (legacyUrl) next[slot] = { ...EMPTY_SLOT, url: legacyUrl };
      }
      // 位置回填只作为最后的兜底，且两个槽都空时才用 —— 只要有任一槽已有
      // 地址（用户输入 / entries / legacy），位置对应关系就不再可信。
      if (!entries && !next.internal.url.trim() && !next.external.url.trim()) {
        slots.forEach((slot, idx) => {
          const url = candidates[idx] ?? '';
          if (url) next[slot] = { ...EMPTY_SLOT, url };
        });
      }
      return [name, next];
    }),
  ) as BackendForms;
}

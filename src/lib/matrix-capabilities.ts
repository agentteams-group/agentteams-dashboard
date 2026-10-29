/**
 * Matrix 侧会话能力清单（方案 v3 B-6，治「功能为什么不在」这类困惑）。
 *
 * 与 `capability-probe.ts` 不是一回事：那份探测的是 AgentTeams **Controller** 的
 * 可选契约（循环写、项目写、v2 协议块），这一份说的是 **Matrix 会话能力**在
 * 本控制台与 homeserver 两边的支持情况。两者都遵循同一条口径（§7.4 降级可见）：
 * 缺什么要写清是谁缺的，不能留一个没有解释的死按钮。
 *
 * 每一项必须回答两个问题：本控制台实现到什么程度，以及没实现/不能用时到底是谁
 * 的限制。「服务端能力」和「本控制台能力」混标成「不支持」，会让运营者去翻
 * homeserver 配置，而真正缺的是这里的代码。
 *
 * 只有全文检索有实测数据：`/search` 关掉索引时返回错误码而不是空结果，检索路径
 * 拿得到确定答案，于是记下来（`recordSearchProbe`），弹层显示「已实测」而不是猜。
 * 其余四项在本仓里是代码事实，不需要探测，也不假装探测过。
 */

import type { StatusToken } from '@/lib/status-tokens';

/** 一项能力的支持状态。`server-dependent` 只用于检索这种确实要看服务端的项。 */
export type MatrixCapabilityState = 'supported' | 'not-supported' | 'server-dependent';

export interface MatrixCapabilityRow {
  key: 'threads' | 'reactions' | 'search' | 'encryption' | 'push';
  label: string;
  state: MatrixCapabilityState;
  /** 一句话：能不能用、谁的限制。写给运营者看，不写协议代号以外的黑话。 */
  detail: string;
  /** 检索项的实测结论；其余项恒为 undefined（没有可探测的来源）。 */
  probe?: { unsupported: boolean; reason?: string; atText: string };
}

/** 状态 → 徽标 token 与文案（单轨：只走 status token，不引入新色值）。 */
export const MATRIX_CAPABILITY_PRESENTATION: Record<
  MatrixCapabilityState,
  { token: StatusToken; label: string }
> = {
  'supported': { token: 'done', label: '支持' },
  'not-supported': { token: 'blocked', label: '本控制台不支持' },
  'server-dependent': { token: 'waiting', label: '取决于服务端' },
};

/**
 * 全文检索的实测结果。
 *
 * 记在模块级而不是 store：这是一次 HTTP 调用顺带得到的事实，没有第二个写入方，
 * 也不需要触发重渲染——弹层是用户主动打开时才读它。
 */
export interface SearchProbe {
  unsupported: boolean;
  /** 服务端 `error` 原文（如 Synapse 的 "Searching is not enabled"）。 */
  reason?: string;
  /** 探测时刻（epoch ms）。 */
  at: number;
}

let searchProbe: SearchProbe | null = null;

/** 检索路径每次拿到确定结果时调用（可用与不可用两种都记）。 */
export function recordSearchProbe(unsupported: boolean, reason?: string): void {
  searchProbe = { unsupported, ...(reason ? { reason } : {}), at: Date.now() };
}

export function getSearchProbe(): SearchProbe | null {
  return searchProbe;
}

/** 测试出口：清掉实测记录，让每个用例从「未探测」开始。 */
export function resetSearchProbeForTests(): void {
  searchProbe = null;
}

/** 探测时刻的短文案；交出去而不是在清单里拼死，方便测试与本地化。 */
export function probeTimeText(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86_400)} 天前`;
}

const SEARCH_UNAVAILABLE_DETAIL =
  'Synapse 的事件索引可以被运营者关掉（search_indexing_enabled）。关掉后 /search 返回错误码而不是空结果，本控制台会明写降级原因，并退回当前会话已加载的消息：命中的范围只有已加载窗口。发起一次检索后这里会显示实测结论。';

/**
 * 能力清单。四项的依据是代码事实，改动这些实现时要同步这里：
 * - threads：`sections/chat/structures/ThreadPanel.tsx` 与发送侧 `rel_type: 'm.thread'`。
 * - reactions：全仓无 `m.reaction`（既不发也不渲染），所以是「本控制台不支持」，
 *   不能推给 homeserver。
 * - encryption：面是手写 REST 代理，无 olm/megolm，不解密（决断见方案 v3 B-5）。
 * - push：无 pusher 注册、无 push gateway，实时性来自 /sync 长连接。
 */
export function listMatrixCapabilities(now: number = Date.now()): MatrixCapabilityRow[] {
  const probe = getSearchProbe();
  const searchRow: MatrixCapabilityRow = {
    key: 'search',
    label: '内容检索（search）',
    state: probe ? (probe.unsupported ? 'not-supported' : 'supported') : 'server-dependent',
    detail: probe
      ? probe.unsupported
        ? `已实测：这个 homeserver 没有可用的全文检索${probe.reason ? `——${probe.reason}` : ''}。检索退回当前会话已加载的消息。`
        : '已实测：服务端全文检索可用，能搜到历史消息。'
      : SEARCH_UNAVAILABLE_DETAIL,
    ...(probe ? { probe: { unsupported: probe.unsupported, ...(probe.reason ? { reason: probe.reason } : {}), atText: probeTimeText(probe.at, now) } } : {}),
  };

  return [
    {
      key: 'threads',
      label: '话题回复（threads）',
      state: 'supported',
      detail:
        '回复会挂到原消息上（m.thread），右侧话题面板展开；运行时发来的 thread 子消息同样读得到。',
    },
    {
      key: 'reactions',
      label: '表情回应（reactions）',
      state: 'not-supported',
      detail:
        '本控制台没有收发 m.reaction 的入口：既不能给消息加表情，别处加的表情也不会出现在这里。这是控制台的实现缺口，不是 homeserver 的限制。',
    },
    searchRow,
    {
      key: 'encryption',
      label: '加密房间（E2EE）',
      state: 'not-supported',
      detail:
        '本控制台不提供也不承诺端到端加密：消息经服务端代理明文转发，也不解密。不要在需要长期留存的协作房间开启加密——加密消息在这里读不出来。信任边界见 docs/trust-boundary.md。',
    },
    {
      key: 'push',
      label: '离线推送（push）',
      state: 'not-supported',
      detail:
        '本控制台不注册 Matrix pusher，也没有 push gateway：页面开着时靠 /sync 长连接收到新消息，关掉页面后不会推送到手机。通知中心只汇总控制台运行期间观察到的待办。',
    },
  ];
}

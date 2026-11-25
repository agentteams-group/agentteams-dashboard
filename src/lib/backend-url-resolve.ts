// 后端地址协议解析（仅服务端使用 —— 会发起网络探测，不可进客户端 bundle）。
//
// 运维在设置页常直接填 `host:port`（省略协议）。此前的实现一律补
// `http://`，把 TLS 端口存成 http，后续请求被 nginx 以 400 拒绝
// （"plain HTTP request was sent to HTTPS port"）。业界惯例是 HTTPS 优先：
// 浏览器地址栏（Chrome/Edge HTTPS-Upgrades、Firefox HTTPS-Only）对无协议
// 输入先试 HTTPS、失败回退 HTTP；`curl --proto-default https` 同理；WHATWG
// URL 对无协议字符串直接抛错，协议必须由应用决定。
//
// 因此：无协议输入先探测 `https://<raw>`（redirect: 'manual'，任何 HTTP
// 响应都算命中 —— 能拿到响应说明 TLS 已通），失败再试 `http://<raw>`；两者
// 都不通时按 https 处理（安全默认，绝不静默降级成 http），并回报
// scheme_unresolved 让 UI 提示「若只支持 http，请显式写 http://」。显式写了
// http(s):// 的地址原样采用，不升级、不改写。
import { hasScheme, isHttpUrl, normalizeHttpUrl } from './backend-config';

export type ResolvedScheme = 'http' | 'https';

export interface ResolvedBackendUrl {
  /** 解析后的规范地址（带协议、去尾斜杠）。 */
  url: string;
  /** 采用的协议；非 http(s) 输入为 null（交由 isHttpUrl 拒绝）。 */
  scheme: ResolvedScheme | null;
  /** 协议是否已确定：显式协议 / 探测命中 = true；两路都不通 = false。 */
  resolved: boolean;
  /** 解析结果是否改写了用户输入（无协议输入恒为 true）。 */
  changed: boolean;
  /** 探测不到服务时按 https 落地的标记。 */
  warning?: 'scheme_unresolved';
}

const RESOLUTION_TTL_MS = 600_000;

interface CacheEntry {
  result: ResolvedBackendUrl;
  at: number;
}

// globalThis-scoped（与 workingMap 同一个理由）：Next 可能在一个进程里多次
// 实例化服务端模块，模块级 Map 会被切碎。
function resolutionCache(): Map<string, CacheEntry> {
  const g = globalThis as unknown as { __dashboardBackendUrlResolution?: Map<string, CacheEntry> };
  if (!g.__dashboardBackendUrlResolution) g.__dashboardBackendUrlResolution = new Map();
  return g.__dashboardBackendUrlResolution;
}

/** 测试用：清空解析缓存（跨用例的缓存会掩盖 fetch 调用次数）。 */
export function __resetBackendUrlResolutionForTests(): void {
  resolutionCache().clear();
}

/** 可提交/可探测的地址形态：显式 http(s) URL，或无协议的
 * `host[:port][/path]`。保存与测试接口都用它做第一道形状校验（协议由
 * resolveBackendUrl 决定），凭据形状另由各自解析。 */
export function isAddressLike(value: string | undefined | null): boolean {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return false;
  if (hasScheme(raw)) return isHttpUrl(normalizeHttpUrl(raw));
  if (/\s/.test(raw)) return false;
  try {
    const parsed = new URL(`http://${raw}`);
    return parsed.hostname !== '';
  } catch {
    return false;
  }
}

/** 一次协议探测：能拿到任意 HTTP 响应（含 4xx/5xx/3xx）就算该协议可用。 */
async function schemeReachable(url: string, timeoutMs: number): Promise<boolean> {
  try {
    await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return true;
  } catch {
    return false;
  }
}

/** 把用户填写的地址解析成确定的 http(s) URL（https 优先，见文件头）。
 * 同一 `host:port[/path]` 的解析结果在进程内缓存 10 分钟：设置页的「测试」
 * 与「保存」会对同一地址各解析一次，不该重复探测。只缓存命中结果 —— 探测
 * 失败说明服务此刻不可达，随后用户启动服务再测时必须重新探测，而不是被缓存
 * 的「按 https 处理」困住 10 分钟。 */
export async function resolveBackendUrl(
  raw: string | undefined | null,
  timeoutMs = 3000,
): Promise<ResolvedBackendUrl> {
  const input = typeof raw === 'string' ? raw.trim() : '';
  if (!input) return { url: '', scheme: null, resolved: false, changed: false };

  const explicit = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(input);
  if (explicit) {
    const scheme = explicit[1].toLowerCase();
    if (scheme === 'http' || scheme === 'https') {
      return {
        url: normalizeHttpUrl(input),
        scheme,
        resolved: true,
        changed: false,
      };
    }
    // 其它 scheme 原样返回，交由 isHttpUrl 拒绝。
    return { url: input, scheme: null, resolved: false, changed: false };
  }
  // 无 `//` 的已知非 http scheme（javascript: 等）——同 normalizeHttpUrl 口径。
  if (hasScheme(input)) return { url: input, scheme: null, resolved: false, changed: false };

  const key = normalizeHttpUrl(input).toLowerCase();
  const cached = resolutionCache().get(key);
  if (cached && Date.now() - cached.at < RESOLUTION_TTL_MS) return { ...cached.result };

  for (const scheme of ['https', 'http'] as const) {
    const candidate = normalizeHttpUrl(`${scheme}://${input}`);
    if (await schemeReachable(candidate, timeoutMs)) {
      const result: ResolvedBackendUrl = {
        url: candidate,
        scheme,
        resolved: true,
        changed: true,
      };
      resolutionCache().set(key, { result, at: Date.now() });
      return { ...result };
    }
  }

  return {
    url: normalizeHttpUrl(`https://${input}`),
    scheme: 'https',
    resolved: false,
    changed: true,
    warning: 'scheme_unresolved',
  };
}

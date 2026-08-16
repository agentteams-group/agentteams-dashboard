// Pure helpers for the chat composer: outbound slash-command parsing and the
// built-in emoji catalog for `:short_code:` autocomplete. Element-web style.

export interface EmojiEntry {
  char: string;
  /** matrix/element conventional short code, typed after ':' */
  name: string;
  /** extra keywords (Chinese included) matched by the autocomplete filter */
  keywords: string;
}

export const EMOJI_ENTRIES: EmojiEntry[] = [
  { char: '👍', name: '+1', keywords: 'thumbsup 赞 好 同意' },
  { char: '👎', name: '-1', keywords: 'thumbsdown 踩 反对' },
  { char: '😄', name: 'smile', keywords: '笑 开心 微笑' },
  { char: '😂', name: 'joy', keywords: '笑哭 哈哈' },
  { char: '😅', name: 'sweat_smile', keywords: '尴尬 汗' },
  { char: '🤔', name: 'thinking', keywords: '思考 想' },
  { char: '😭', name: 'sob', keywords: '哭' },
  { char: '😎', name: 'sunglasses', keywords: '酷 墨镜' },
  { char: '🥳', name: 'partying', keywords: '庆祝 派对' },
  { char: '🫡', name: 'salute', keywords: '敬礼 收到' },
  { char: '👋', name: 'wave', keywords: '你好 打招呼' },
  { char: '🙏', name: 'pray', keywords: '感谢 拜托' },
  { char: '🤝', name: 'handshake', keywords: '合作 握手' },
  { char: '💪', name: 'muscle', keywords: '加油 强' },
  { char: '❤️', name: 'heart', keywords: '心 爱 红心' },
  { char: '🔥', name: 'fire', keywords: '火 热' },
  { char: '🚀', name: 'rocket', keywords: '火箭 加速 上线' },
  { char: '⚡', name: 'zap', keywords: '闪电 快' },
  { char: '✅', name: 'white_check_mark', keywords: '完成 对 通过' },
  { char: '❌', name: 'x', keywords: '错 失败 取消' },
  { char: '⚠️', name: 'warning', keywords: '警告 注意' },
  { char: '👀', name: 'eyes', keywords: '看 关注' },
  { char: '💯', name: '100', keywords: '满分 一百' },
  { char: '🎉', name: 'tada', keywords: '庆祝 撒花 好耶' },
  { char: '🐛', name: 'bug', keywords: '缺陷 虫' },
  { char: '🔨', name: 'hammer', keywords: '修复 锤 修' },
  { char: '🧠', name: 'brain', keywords: '脑 智能' },
  { char: '🤖', name: 'robot', keywords: '机器人 agent' },
  { char: '📋', name: 'clipboard', keywords: '任务 清单 列表' },
  { char: '📌', name: 'pushpin', keywords: '置顶 钉' },
  { char: '🔒', name: 'lock', keywords: '锁 安全' },
  { char: '🎯', name: 'dart', keywords: '目标 靶' },
  { char: '⏱️', name: 'stopwatch', keywords: '时间 计时' },
  { char: '🔍', name: 'mag', keywords: '搜索 查找' },
  { char: '📦', name: 'package', keywords: '包 打包' },
  { char: '🧪', name: 'test_tube', keywords: '测试 实验' },
  { char: '🔄', name: 'arrows_counterclockwise', keywords: '刷新 重试 循环' },
  { char: '⛔', name: 'no_entry', keywords: '禁止 停' },
  { char: '🛑', name: 'octagonal_sign', keywords: '停止' },
  { char: '💤', name: 'zzz', keywords: '睡 休眠' },
];

/**
 * Filter the emoji catalog by the text typed after ':'. Matches short code
 * prefixes and Chinese/English keywords; empty query returns the head of the
 * catalog (Element behavior).
 */
export function filterEmoji(query: string, limit = 8): EmojiEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return EMOJI_ENTRIES.slice(0, limit);
  return EMOJI_ENTRIES.filter(
    (e) => e.name.includes(q) || e.keywords.toLowerCase().includes(q) || e.char === q
  ).slice(0, limit);
}

export interface ParsedOutbound {
  body: string;
  /** Matrix msgtype override (m.emote for /me); undefined keeps m.text */
  msgtype?: 'm.emote';
}

/**
 * Parse element-style outbound slash commands from the raw input text.
 * - `/me <action>`   → m.emote message without the prefix
 * - `/shrug [text]`  → `<text> ¯\_(ツ)_/¯`
 * Returns null when the text is not a recognized command (send as-is).
 */
export function parseOutboundCommand(text: string): ParsedOutbound | null {
  const trimmed = text.trim();
  if (trimmed === '/shrug' || trimmed.startsWith('/shrug ')) {
    const rest = trimmed.slice('/shrug'.length).trim();
    return { body: rest ? `${rest} ¯\\_(ツ)_/¯` : '¯\\_(ツ)_/¯' };
  }
  if (trimmed.startsWith('/me ')) {
    const action = trimmed.slice(4).trim();
    if (!action) return null;
    return { body: action, msgtype: 'm.emote' };
  }
  return null;
}

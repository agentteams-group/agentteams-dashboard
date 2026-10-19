/**
 * 干预启发式解析（F2.1 降级路径完整形态，2026-10 反馈「Agent 侧没有
 * 卡片功能」）。
 *
 * 上游 runtime 未实现 `org.agentteams.run` v2 时，Agent 对澄清问题的
 * 自然回复形态是「引导/提问句 + 文字编号选项列表」（如
 * `想确认一下你指的是哪个：\n1）选项A\n2）选项B`）。本解析器把这类
 * 消息升格为 v2 形态的干预 payload，交给 InterventionCard 渲染 ——
 * 提交后走既有的「转自然语言消息回房间」降级回写，上游零改动。
 *
 * 误伤防护（保守解析）：
 * - 代码块（``` 围栏）内的行不参与；
 * - 必须同时存在 问句/引导行（含 ？/? 或以 ：/: 收尾）+ ≥2 条连续选项；
 * - 数字 `1） 1. 1、 1)` 与字母 `A. A、 A)`（A-F，大小写均可）均认，两类不混用；
 * - 选项须从 1 / A 连续递增；数字 ≤9、字母 ≤6（序号快捷键上限）；
 * - 选项行内不以编号开头的后续正文不并入。
 */

export interface HeuristicIntervention {
  question: string;
  options: Array<{ id: string; label: string }>;
  /** 选项块之前的消息原文（引言等，随卡片一起保留渲染）。 */
  before: string;
  /** 选项块之后的消息原文（同一条消息里的其它问题，保留渲染）。 */
  after: string;
}

/**
 * 选项行形态（2026-10 装验二轮）：数字 `1） 1. 1、 1)` 与字母
 * `A. A、 A)` （大小写均可，A-F 上限 6 项）均认；两类不可混用。
 */
const DIGIT_OPTION_RE = /^\s*(\d{1,2})[）).、]\s*(.+?)\s*$/;
const ALPHA_OPTION_RE = /^\s*([A-Fa-f])[）).、]\s*(.+?)\s*$/;

const ALPHA_INDEX = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** 引导行最小疑问语义（防误伤「步骤如下：」式普通列表）。 */
const GUIDE_HINT_RE = /(哪个|哪些|哪种|是否|要不要|选|确认|偏好|倾向|还是)/;

function isQuestionish(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (/[?？]\s*$/.test(t)) return true;
  if (/[：:]\s*$/.test(t)) return t.length <= 40 && GUIDE_HINT_RE.test(t);
  return false;
}

interface OptionMatch {
  id: string;
  label: string;
  seq: number;
}

function matchOption(
  line: string,
  kind: 'digit' | 'alpha'
): OptionMatch | null {
  if (kind === 'digit') {
    const m = DIGIT_OPTION_RE.exec(line);
    if (!m) return null;
    return { id: `opt-${m[1]}`, label: m[2], seq: Number(m[1]) };
  }
  const m = ALPHA_OPTION_RE.exec(line);
  if (!m) return null;
  const upper = m[1].toUpperCase();
  return { id: `opt-${upper}`, label: m[2], seq: ALPHA_INDEX.indexOf(upper) + 1 };
}

/** 去掉代码块行与引用行，返回可解析行序号集合的副本。 */
function stripNonContent(body: string): string[] {
  const lines = body.split('\n');
  const out: string[] = [];
  let inFence = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      out.push('');
      continue;
    }
    out.push(inFence || trimmed.startsWith('>') ? '' : line);
  }
  return out;
}

export function parseInterventionHeuristic(body: string): HeuristicIntervention | null {
  if (!body || body.length > 4000) return null;
  const lines = stripNonContent(body);

  // 找最长的一段连续编号选项块（允许中间夹一个空行；数字/字母各扫一轮，
  // 取更长者——两类不混用）。
  let best: { start: number; end: number; items: Array<{ id: string; label: string }> } | null = null;
  for (const kind of ['digit', 'alpha'] as const) {
    const maxItems = kind === 'digit' ? 9 : 6;
    let i = 0;
    while (i < lines.length) {
      const first = lines[i] ? matchOption(lines[i], kind) : null;
      if (!first || first.seq !== 1) {
        i += 1;
        continue;
      }
      const items: Array<{ id: string; label: string }> = [];
      let cursor = i;
      let expected = first.seq;
      let blankGap = false;
      while (cursor < lines.length) {
        const line = lines[cursor] ?? '';
        const trimmed = line.trim();
        if (!trimmed) {
          // 允许选项块内夹一个空行（其后必须紧跟下一编号）。
          if (blankGap) break;
          blankGap = true;
          cursor += 1;
          continue;
        }
        const m = matchOption(line, kind);
        if (!m || m.seq !== expected) break;
        items.push({ id: m.id, label: m.label });
        expected += 1;
        blankGap = false;
        cursor += 1;
        if (items.length >= maxItems) break;
      }
      if (items.length >= 2 && (!best || items.length > best.items.length)) {
        best = { start: i, end: cursor, items };
      }
      i = Math.max(cursor, i + 1);
    }
  }

  if (!best) return null;

  // 问题行 = 选项块上方最近的非空行；必须是问句/引导行，否则放弃升格。
  let question: string | null = null;
  let questionLineIndex = -1;
  for (let j = best.start - 1; j >= 0; j -= 1) {
    const t = (lines[j] ?? '').trim();
    if (!t) continue;
    if (isQuestionish(t) && t.length <= 120) {
      question = t.replace(/\*\*/g, '').replace(/[：:]\s*$/, '：');
      questionLineIndex = j;
    }
    break;
  }
  if (!question) return null;

  // 三段切分：同一消息里的其它问题（选项块前/后）原样保留渲染，卡片只
  // 可视化这一组选项 —— 无信息丢失（2026-10 装验二轮：Agent 常把选项题
  // 和多个开放问题写在一条消息里）。问题行本身进卡片标题，不进 before。
  const before = lines
    .slice(0, questionLineIndex >= 0 ? questionLineIndex : best.start)
    .join('\n')
    .trim();
  const after = lines.slice(best.end).join('\n').trim();

  return { question, options: best.items, before, after };
}

/** 启发式结果 → v2 confirmation payload（供 InterventionCard 直接消费）。 */
export function heuristicToInterventionPayload(
  heuristic: HeuristicIntervention,
  confirmationId: string
): {
  tool_name: string;
  confirmation_id: string;
  question: string;
  options: Array<{ id: string; label: string; description?: string; recommended?: boolean }>;
} {
  return {
    tool_name: 'agent.question',
    confirmation_id: confirmationId,
    question: heuristic.question,
    options: heuristic.options,
  };
}

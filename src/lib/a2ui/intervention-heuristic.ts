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
 * - 必须同时存在 问句/引导行（含 ？/? 或以 ：/: 收尾）+ ≥2 条连续编号
 *   选项（`1）` `1.` `1、` `1) ` 均认）；
 * - 选项编号需从 1 连续递增，选项数 ≤9（序号快捷键上限）；
 * - 选项行内不以编号开头的后续正文不并入。
 */

export interface HeuristicIntervention {
  question: string;
  options: Array<{ id: string; label: string }>;
}

const OPTION_RE = /^\s*(\d{1})[）).、]\s*(.+?)\s*$/;

/** 冒号引导行的最小疑问语义（防误伤「步骤如下：」式普通列表）。 */
const GUIDE_HINT_RE = /(哪个|哪些|哪种|是否|要不要|选|确认|偏好|倾向|还是)/;

function isQuestionish(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (/[?？]\s*$/.test(t)) return true;
  if (/[：:]\s*$/.test(t)) return t.length <= 40 && GUIDE_HINT_RE.test(t);
  return false;
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

  // 找最长的一段连续编号选项块（允许中间夹一个空行）。
  let best: { start: number; items: Array<{ id: string; label: string }> } | null = null;
  let i = 0;
  while (i < lines.length) {
    const match = OPTION_RE.exec(lines[i] ?? '');
    if (!match) {
      i += 1;
      continue;
    }
    const items: Array<{ id: string; label: string }> = [];
    let cursor = i;
    let expected = 1;
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
      const m = OPTION_RE.exec(line);
      if (!m || Number(m[1]) !== expected) break;
      items.push({ id: `opt-${m[1]}`, label: m[2] });
      expected += 1;
      blankGap = false;
      cursor += 1;
      if (items.length >= 9) break;
    }
    if (items.length >= 2 && (!best || items.length > best.items.length)) {
      best = { start: i, items };
    }
    i = Math.max(cursor, i + 1);
  }

  if (!best) return null;

  // 问题行 = 选项块上方最近的非空行；必须是问句/引导行，否则放弃升格。
  let question: string | null = null;
  for (let j = best.start - 1; j >= 0; j -= 1) {
    const t = (lines[j] ?? '').trim();
    if (!t) continue;
    if (isQuestionish(t) && t.length <= 120) question = t.replace(/[：:]\s*$/, '：');
    break;
  }
  if (!question) return null;

  return { question, options: best.items };
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

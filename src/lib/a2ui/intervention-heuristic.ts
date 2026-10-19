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
 * - 必须同时存在 问句/引导行（含 ？/? 或以 ：/: 收尾）或题型标签
 *   （如「页面类型（单选）」「内容板块（多选）」）+ ≥2 条连续选项；
 * - 数字 `1） 1. 1、 1)` 与字母 `A. A、 A)`（A-F，大小写均可）均认，两类不混用；
 * - 选项须从 1 / A 连续递增；数字 ≤9、字母 ≤6（序号快捷键上限）；
 * - 圈号 `① ② ③`（①-⑳，用于多选）可写在同一行；
 * - 选项行内不以编号开头的后续正文不并入。
 */

export interface HeuristicQuestion {
  question: string;
  options: Array<{ id: string; label: string }>;
  multi_select?: boolean;
}

export interface HeuristicIntervention {
  /** 第一组问题的标题（单问题形态时即唯一问题）。 */
  question: string;
  options: Array<{ id: string; label: string }>;
  /** 多问题形态：一条消息里多组「标题 + 选项」按出现顺序分页。 */
  questions?: HeuristicQuestion[];
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

/** 圈号选项（多选常用）：必须从 ① 起连续。 */
const CIRCLED_INDEX = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
const CIRCLED_RE = /[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/g;

/** 引导行最小疑问语义（防误伤「步骤如下：」式普通列表）。 */
const GUIDE_HINT_RE = /(哪个|哪些|哪种|是否|要不要|选|确认|偏好|倾向|还是)/;

/** 题型标签：「页面类型（单选）」「内容板块（多选，选你要的）」。 */
const TYPE_LABEL_RE = /[（(][^）)]*(?:单选|多选|可多选)[^）)]*[）)]/;

function isQuestionish(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (/[?？]\s*$/.test(t)) return true;
  if (/[：:]\s*$/.test(t)) return t.length <= 40 && GUIDE_HINT_RE.test(t);
  return false;
}

/** 去掉标题行上的 Markdown 装饰（`**页面类型**：` → `页面类型：`）。 */
function stripInlineMarkdown(line: string): string {
  return line.replace(/\*\*/g, '').replace(/__/g, '').replace(/`/g, '').trim();
}

function normalizeQuestion(line: string): string {
  return stripInlineMarkdown(line).replace(/[：:]\s*$/, '：');
}

interface HeadingInfo {
  index: number;
  question: string;
  multiSelect: boolean;
}

/**
 * 选项块上方的标题行。除问句/引导行外，也接受题型标签（装验三轮：
 * QwenPaw 会写「**页面类型（单选）**」这种无问号的标签头）。
 */
function parseHeading(line: string): { question: string; multiSelect: boolean } | null {
  const t = stripInlineMarkdown(line);
  if (!t) return null;
  const multiSelect = /多选|可多选|多项选择/.test(t);
  if (isQuestionish(t)) {
    return t.length <= 120 ? { question: normalizeQuestion(t), multiSelect } : null;
  }
  if (t.length <= 50 && TYPE_LABEL_RE.test(t)) {
    return { question: normalizeQuestion(t), multiSelect };
  }
  return null;
}

function headingAbove(lines: string[], start: number): HeadingInfo | null {
  for (let j = start - 1; j >= 0; j -= 1) {
    const t = (lines[j] ?? '').trim();
    if (!t) continue;
    // 紧邻的上一行仍是选项行 → 说明这不是一组新问题的标题。
    if (matchOption(t, 'digit') || matchOption(t, 'alpha')) return null;
    const heading = parseHeading(t);
    return heading ? { index: j, ...heading } : null;
  }
  return null;
}

/** 单行圈号选项（① A ② B …），必须从 ① 起连续。 */
function parseCircledLine(line: string): Array<{ id: string; label: string }> | null {
  const t = line.trim();
  if (!t) return null;
  const matches = [...t.matchAll(CIRCLED_RE)];
  if (matches.length < 2) return null;
  if (t.slice(0, matches[0].index).trim()) return null;
  const items: Array<{ id: string; label: string }> = [];
  for (let i = 0; i < matches.length; i += 1) {
    const marker = matches[i][0];
    if (CIRCLED_INDEX.indexOf(marker) !== i) return null;
    const labelStart = (matches[i].index ?? 0) + marker.length;
    const labelEnd = i + 1 < matches.length ? (matches[i + 1].index ?? t.length) : t.length;
    const label = t.slice(labelStart, labelEnd).trim();
    if (!label) return null;
    items.push({ id: `opt-${marker}`, label });
  }
  return items;
}

/**
 * 单行多选项（`A. 甲 B. 乙 C. 丙` / `1）甲 2）乙`）。QwenPaw 常把整组
 * 选项压成一行，按行扫描会当成「一条选项」而漏掉整组。
 */
function parseInlineLine(
  line: string,
  kind: 'digit' | 'alpha'
): Array<{ id: string; label: string }> | null {
  const t = line.trim();
  if (!t) return null;
  const re = kind === 'digit'
    ? /(?:^|\s)(\d{1,2})\s*[）).、]\s*/g
    : /(?:^|\s)([A-Fa-f])\s*[）).、]\s*/g;
  const matches = [...t.matchAll(re)];
  if (matches.length < 2) return null;
  if (matches[0].index !== 0) return null;
  const maxItems = kind === 'digit' ? 9 : 6;
  const items: Array<{ id: string; label: string }> = [];
  for (let i = 0; i < matches.length && i < maxItems; i += 1) {
    const raw = matches[i][1];
    const seq = kind === 'digit' ? Number(raw) : ALPHA_INDEX.indexOf(raw.toUpperCase()) + 1;
    if (seq !== i + 1) return null;
    const labelStart = (matches[i].index ?? 0) + matches[i][0].length;
    const labelEnd = i + 1 < matches.length ? (matches[i + 1].index ?? t.length) : t.length;
    const label = t.slice(labelStart, labelEnd).trim();
    if (!label) return null;
    items.push({
      id: kind === 'digit' ? `opt-${seq}` : `opt-${raw.toUpperCase()}`,
      label,
    });
  }
  return items;
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

/** Matrix formatted_body 是 HTML；启发式按纯文本行匹配，先剥标签。 */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|tr|h[1-6]|li|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function looksLikeHtml(text: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(text);
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

interface OptionGroup {
  headingIndex: number;
  start: number;
  end: number;
  question: string;
  options: Array<{ id: string; label: string }>;
  multiSelect: boolean;
}

/** 扫出所有「标题 + 连续编号选项」组（数字/字母各扫一轮，圈号单行另扫）。 */
function collectOptionGroups(lines: string[]): OptionGroup[] {
  const groups: OptionGroup[] = [];
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
      if (items.length >= 2) {
        const heading = headingAbove(lines, i);
        if (heading) {
          groups.push({
            headingIndex: heading.index,
            start: i,
            end: cursor,
            question: heading.question,
            options: items,
            multiSelect: heading.multiSelect,
          });
        }
      }
      i = Math.max(cursor, i + 1);
    }
  }

  // 整组选项压成一行（`A. 甲 B. 乙 C. 丙`）：按行内标记切分。
  for (let i = 0; i < lines.length; i += 1) {
    for (const kind of ['digit', 'alpha'] as const) {
      const items = parseInlineLine(lines[i] ?? '', kind);
      if (!items) continue;
      const heading = headingAbove(lines, i);
      if (!heading) continue;
      groups.push({
        headingIndex: heading.index,
        start: i,
        end: i + 1,
        question: heading.question,
        options: items,
        multiSelect: heading.multiSelect,
      });
    }
  }

  // 圈号多选常写在同一行（① A ② B …），题型标签头必须有「多选」语义。
  for (let i = 0; i < lines.length; i += 1) {
    const items = parseCircledLine(lines[i] ?? '');
    if (!items) continue;
    const heading = headingAbove(lines, i);
    if (!heading) continue;
    groups.push({
      headingIndex: heading.index,
      start: i,
      end: i + 1,
      question: heading.question,
      options: items,
      multiSelect: heading.multiSelect || !/[（(][^）)]*单选[^）)]*[）)]/.test(heading.question),
    });
  }

  // 多组按出现顺序排列；重叠（标题落在前一组选项范围内）的丢弃，保持保守。
  groups.sort((a, b) => a.start - b.start);
  const out: OptionGroup[] = [];
  for (const group of groups) {
    const prev = out[out.length - 1];
    if (prev && group.headingIndex < prev.end) continue;
    out.push(group);
  }
  if (out.length < 2) return out;

  // 组与组之间若有无法归入任何选项组的正文，退回单组形态（其余内容仍走
  // Markdown 渲染），避免多组分页吞掉正文。
  const covered = new Set<number>();
  for (const group of out) {
    covered.add(group.headingIndex);
    for (let i = group.start; i < group.end; i += 1) covered.add(i);
  }
  for (let i = out[0].headingIndex; i < out[out.length - 1].end; i += 1) {
    if (covered.has(i)) continue;
    if ((lines[i] ?? '').trim()) return [out[0]];
  }
  return out;
}

export function parseInterventionHeuristic(body: string): HeuristicIntervention | null {
  if (!body || body.length > 12000) return null;
  const plain = looksLikeHtml(body) ? htmlToPlainText(body) : body;
  if (!plain.trim() || plain.length > 4000) return null;
  const lines = stripNonContent(plain);

  const groups = collectOptionGroups(lines);
  if (groups.length === 0) return null;

  // 三段切分：同一消息里的其它问题（选项块前/后）原样保留渲染；多组问题
  // 随卡片分页展示（2026-10 装验三轮：Agent 会把 6 组单选/多选写进同一条
  // 消息，标题常是「页面类型（单选）」这种无问号标签）。标题行本身进卡片，
  // 不进 before/after —— 无信息丢失。
  const first = groups[0];
  const last = groups[groups.length - 1];
  const before = lines.slice(0, first.headingIndex).join('\n').trim();
  const after = lines.slice(last.end).join('\n').trim();

  const questions: HeuristicQuestion[] = groups.map((group) => ({
    question: group.question,
    options: group.options,
    ...(group.multiSelect ? { multi_select: true } : {}),
  }));

  return {
    question: first.question,
    options: first.options,
    ...(questions.length > 1 ? { questions } : {}),
    before,
    after,
  };
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
  questions?: HeuristicQuestion[];
} {
  return {
    tool_name: 'agent.question',
    confirmation_id: confirmationId,
    question: heuristic.question,
    options: heuristic.options,
    ...(heuristic.questions ? { questions: heuristic.questions } : {}),
  };
}

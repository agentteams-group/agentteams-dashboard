/**
 * Agent message repr parser for Matrix chat.
 *
 * The copaw Matrix channel sometimes dumps the raw Python `repr()` of an
 * agentscope-runtime `Message` object as the plain-text body of a thread
 * message, e.g.:
 *
 *   sequence_number=88 object='message' status='completed' error=None
 *   id='msg_...' type='message' role='assistant'
 *   content=[TextContent(sequence_number=None, ..., type='text', index=0,
 *     delta=None, msg_id='msg_...', text='好的！...'), TextContent(..., text='')]
 *   code=None message=None usage=None metadata={}
 *
 * This module parses that repr back into structured data and maps it to
 * A2UI chat blocks: assistant text, thinking (reasoning) and tool calls.
 */

import type { ParsedA2uiBlock } from './parser';

// ─── Repr value model ────────────────────────────────────────────────────────

type ReprValue =
  | null
  | boolean
  | number
  | string
  | ReprValue[]
  | { [key: string]: ReprValue };

interface ReprCall {
  __class__: string;
  [key: string]: ReprValue;
}

export interface AgentReprMessage {
  /** Message type: 'message' | 'reasoning' | 'function_call' | ... */
  type?: string;
  /** Run status: 'completed' | 'in_progress' | 'failed' | ... */
  status?: string;
  role?: string;
  content: ReprCall[];
  raw: Record<string, ReprValue>;
}

// ─── Python repr tokenizer/parser ────────────────────────────────────────────

class ReprParser {
  private pos = 0;
  private readonly input: string;

  constructor(input: string) {
    this.input = input;
  }

  /** Parse a top-level sequence of `key=value` pairs until EOF. */
  parseKwargs(): Record<string, ReprValue> {
    const out: Record<string, ReprValue> = {};
    for (;;) {
      this.skipWs();
      if (this.eof()) return out;
      const key = this.parseIdent();
      this.skipWs();
      this.expect('=');
      out[key] = this.parseValue();
    }
  }

  private parseValue(): ReprValue {
    this.skipWs();
    const ch = this.peek();
    if (ch === "'" || ch === '"') return this.parseString();
    if (ch === '[') return this.parseList();
    if (ch === '{') return this.parseDict();
    if (ch === '-' || (ch >= '0' && ch <= '9')) return this.parseNumber();

    const ident = this.parseIdent();
    if (ident === 'None') return null;
    if (ident === 'True') return true;
    if (ident === 'False') return false;

    // Constructor call: Name(key=value, ...) or Name(positional, ...)
    this.skipWs();
    if (this.peek() === '(') return this.parseCall(ident);
    throw new Error(`unexpected identifier ${ident}`);
  }

  private parseCall(name: string): ReprCall {
    this.expect('(');
    const call: ReprCall = { __class__: name };
    let positionalIdx = 0;
    for (;;) {
      this.skipWs();
      if (this.tryConsume(')')) return call;
      // keyword argument?
      const save = this.pos;
      const ident = this.parseIdent();
      this.skipWs();
      if (this.tryConsume('=')) {
        call[ident] = this.parseValue();
      } else {
        // positional value — rewind and parse as value
        this.pos = save;
        call[`__arg${positionalIdx++}`] = this.parseValue();
      }
      this.skipWs();
      if (this.tryConsume(')')) return call;
      this.expect(',');
    }
  }

  private parseList(): ReprValue[] {
    this.expect('[');
    const out: ReprValue[] = [];
    for (;;) {
      this.skipWs();
      if (this.tryConsume(']')) return out;
      out.push(this.parseValue());
      this.skipWs();
      if (this.tryConsume(']')) return out;
      this.expect(',');
    }
  }

  private parseDict(): Record<string, ReprValue> {
    this.expect('{');
    const out: Record<string, ReprValue> = {};
    for (;;) {
      this.skipWs();
      if (this.tryConsume('}')) return out;
      const key = this.parseValue();
      this.skipWs();
      this.expect(':');
      out[String(key)] = this.parseValue();
      this.skipWs();
      if (this.tryConsume('}')) return out;
      this.expect(',');
    }
  }

  private parseString(): string {
    const quote = this.input[this.pos++];
    let out = '';
    for (;;) {
      if (this.eof()) throw new Error('unterminated string');
      const ch = this.input[this.pos++];
      if (ch === quote) return out;
      if (ch !== '\\') {
        out += ch;
        continue;
      }
      // escape sequence
      if (this.eof()) throw new Error('unterminated escape');
      const esc = this.input[this.pos++];
      switch (esc) {
        case 'n': out += '\n'; break;
        case 'r': out += '\r'; break;
        case 't': out += '\t'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'a': out += '\x07'; break;
        case 'v': out += '\v'; break;
        case '0': out += '\0'; break;
        case '\\': out += '\\'; break;
        case "'": out += "'"; break;
        case '"': out += '"'; break;
        case '\n': break; // line continuation
        case 'x': {
          const hex = this.input.substr(this.pos, 2);
          if (!/^[0-9a-fA-F]{2}$/.test(hex)) throw new Error('bad \\x escape');
          out += String.fromCharCode(parseInt(hex, 16));
          this.pos += 2;
          break;
        }
        case 'u': {
          const hex = this.input.substr(this.pos, 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error('bad \\u escape');
          out += String.fromCharCode(parseInt(hex, 16));
          this.pos += 4;
          break;
        }
        case 'U': {
          const hex = this.input.substr(this.pos, 8);
          if (!/^[0-9a-fA-F]{8}$/.test(hex)) throw new Error('bad \\U escape');
          out += String.fromCodePoint(parseInt(hex, 16));
          this.pos += 8;
          break;
        }
        default:
          // Unknown escape: Python keeps the backslash
          out += '\\' + esc;
      }
    }
  }

  private parseNumber(): number {
    const re = /-?\d+(\.\d+)?([eE][+-]?\d+)?/y;
    re.lastIndex = this.pos;
    const m = re.exec(this.input);
    if (!m) throw new Error('bad number');
    this.pos = re.lastIndex;
    return Number(m[0]);
  }

  private parseIdent(): string {
    const re = /[A-Za-z_][A-Za-z0-9_]*/y;
    re.lastIndex = this.pos;
    const m = re.exec(this.input);
    if (!m) throw new Error(`expected identifier at ${this.pos}`);
    this.pos = re.lastIndex;
    return m[0];
  }

  private skipWs(): void {
    while (!this.eof() && /\s/.test(this.input[this.pos])) this.pos++;
  }

  private peek(): string {
    return this.input[this.pos];
  }

  private eof(): boolean {
    return this.pos >= this.input.length;
  }

  private expect(ch: string): void {
    if (this.input[this.pos] !== ch) {
      throw new Error(`expected '${ch}' at ${this.pos}`);
    }
    this.pos++;
  }

  private tryConsume(ch: string): boolean {
    if (this.input[this.pos] === ch) {
      this.pos++;
      return true;
    }
    return false;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Cheap pre-check so normal messages never touch the repr parser. */
const AGENT_REPR_GUARD = /^(?:sequence_number=\S+\s+)?object='message'\s/;

/**
 * Parse a Matrix message body that contains a dumped agentscope-runtime
 * Message repr. Returns null when the body is not such a repr.
 */
export function parseAgentRepr(body: string): AgentReprMessage | null {
  const trimmed = body.trim();
  if (!AGENT_REPR_GUARD.test(trimmed)) return null;

  let raw: Record<string, ReprValue>;
  try {
    raw = new ReprParser(trimmed).parseKwargs();
  } catch {
    return null;
  }

  if (raw.object !== 'message' || !Array.isArray(raw.content)) return null;

  const content = raw.content.filter(
    (c): c is ReprCall => typeof c === 'object' && c !== null && !Array.isArray(c)
  );

  return {
    type: typeof raw.type === 'string' ? raw.type : undefined,
    status: typeof raw.status === 'string' ? raw.status : undefined,
    role: typeof raw.role === 'string' ? raw.role : undefined,
    content,
    raw,
  };
}

// ─── Mapping to chat blocks ──────────────────────────────────────────────────

const TOOL_CALL_TYPES = new Set([
  'function_call',
  'plugin_call',
  'mcp_call',
  'component_call',
]);

const TOOL_OUTPUT_TYPES = new Set([
  'function_call_output',
  'plugin_call_output',
  'mcp_call_output',
  'component_call_output',
]);

function toolStatus(status?: string): 'success' | 'error' | 'running' {
  switch (status) {
    case 'completed':
      return 'success';
    case 'failed':
    case 'error':
    case 'canceled':
    case 'rejected':
      return 'error';
    default:
      return 'running';
  }
}

function asDataCall(c: ReprCall): Record<string, ReprValue> | null {
  if (c.type !== 'data') return null;
  const data = c.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  return data as Record<string, ReprValue>;
}

export interface AgentReprBlocks {
  blocks: ParsedA2uiBlock[];
  hasThinking: boolean;
  hasToolCall: boolean;
}

/**
 * Map a parsed agent message repr to chat blocks:
 * - reasoning message            → thinking block
 * - function/tool call message   → tool_call block (name + arguments)
 * - tool call output message     → tool_call block (name + result)
 * - regular message              → markdown text block (non-empty parts joined)
 */
export function agentReprToBlocks(msg: AgentReprMessage): AgentReprBlocks {
  const blocks: ParsedA2uiBlock[] = [];
  let hasThinking = false;
  let hasToolCall = false;

  const text = msg.content
    .filter((c) => c.type === 'text' && typeof c.text === 'string' && c.text !== '')
    .map((c) => c.text as string)
    .join('\n');

  const isReasoning = msg.type === 'reasoning';
  const isToolCall = TOOL_CALL_TYPES.has(msg.type ?? '');
  const isToolOutput = TOOL_OUTPUT_TYPES.has(msg.type ?? '');

  if (isReasoning) {
    if (text) {
      blocks.push({ type: 'thinking', content: text });
      hasThinking = true;
    }
    return { blocks, hasThinking, hasToolCall };
  }

  if (isToolCall || isToolOutput) {
    for (const c of msg.content) {
      const data = asDataCall(c);
      if (!data) continue;
      const name = typeof data.name === 'string' && data.name ? data.name : 'tool';
      if (isToolCall) {
        blocks.push({
          type: 'tool_call',
          payload: {
            type: 'tool_call',
            tool_name: name,
            arguments: typeof data.arguments === 'string' ? data.arguments : undefined,
            status: toolStatus(msg.status),
            isStreaming: msg.status === 'in_progress',
          },
        });
      } else {
        blocks.push({
          type: 'tool_call',
          payload: {
            type: 'tool_call',
            tool_name: name,
            result: data.output != null ? String(data.output) : undefined,
            status: toolStatus(msg.status),
          },
        });
      }
      hasToolCall = true;
    }
    return { blocks, hasThinking, hasToolCall };
  }

  if (text) {
    blocks.push({ type: 'text', text });
  }
  return { blocks, hasThinking, hasToolCall };
}

/**
 * Convenience: parse a body and return chat blocks, or null when the body is
 * not an agent message repr (or carries no renderable content).
 */
export function tryParseAgentReprBlocks(body: string): AgentReprBlocks | null {
  const msg = parseAgentRepr(body);
  if (!msg) return null;
  const result = agentReprToBlocks(msg);
  if (result.blocks.length === 0) return null;
  return result;
}

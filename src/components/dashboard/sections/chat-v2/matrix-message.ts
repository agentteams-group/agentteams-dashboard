import type { DisplayMessage } from '@/hooks/use-matrix';
import { parseA2uiContent } from '@/lib/a2ui/parser';

type TDesignContent =
  | { type: 'markdown'; data: string }
  | { type: 'thinking'; data: { text: string; title: string } }
  | {
    type: 'toolcall';
    data: {
      toolCallId: string;
      toolCallName: string;
      args?: string;
      result?: string;
    };
  };

export interface TDesignMatrixMessage {
  id: string;
  role: 'user' | 'assistant';
  datetime: string;
  status: 'pending' | 'streaming' | 'complete' | 'error';
  content: TDesignContent[];
}

function stringifyPayload(payload: Record<string, unknown> | undefined): string {
  if (!payload) return '';
  return JSON.stringify(payload, null, 2);
}

/** Converts Matrix and AgentTeams payloads into TDesign Chat content blocks. */
export function toTDesignMatrixMessage(message: DisplayMessage): TDesignMatrixMessage {
  const parsed = parseA2uiContent(message.content, message.formattedContent, message.workflow);
  const content: TDesignContent[] = [];

  parsed.blocks.forEach((block, index) => {
    if (block.type === 'text') {
      content.push({ type: 'markdown', data: block.text || '' });
      return;
    }

    if (block.type === 'thinking') {
      content.push({
        type: 'thinking',
        data: { text: block.content || '', title: '思考过程' },
      });
      return;
    }

    if (block.type === 'tool_call') {
      const payload = block.payload;
      content.push({
        type: 'toolcall',
        data: {
          toolCallId: `${message.id}-tool-${index}`,
          toolCallName: String(payload?.tool_name || payload?.name || '工具调用'),
          args: stringifyPayload(payload?.arguments as Record<string, unknown> | undefined),
          result: typeof payload?.result === 'string' ? payload.result : undefined,
        },
      });
      return;
    }

    if (block.type === 'confirmation') {
      const payload = block.payload;
      content.push({
        type: 'markdown',
        data: `### 等待确认\n\n工具：${String(payload?.toolName || '未知工具')}\n\n发送 \`${String(payload?.approveReply || '/approve')}\` 以批准，或发送任意其他消息以拒绝。`,
      });
      return;
    }

    if (block.type === 'workflow') {
      const payload = block.payload;
      content.push({
        type: 'markdown',
        data: `### AgentTeams 工作流\n\n\`\`\`json\n${stringifyPayload(payload)}\n\`\`\``,
      });
      return;
    }

    if (block.type === 'a2ui') {
      content.push({
        type: 'markdown',
        data: '此消息包含 A2UI 交互内容。完整界面继续在“Matrix 聊天”入口中提供。',
      });
      return;
    }

    content.push({ type: 'markdown', data: stringifyPayload(block.payload) });
  });

  if (content.length === 0) content.push({ type: 'markdown', data: message.content });

  return {
    id: message.id,
    role: message.isMe ? 'user' : 'assistant',
    datetime: new Date(message.timestamp).toLocaleString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      month: 'short',
      day: 'numeric',
    }),
    status: message.status === 'error'
      ? 'error'
      : message.isStreaming || message.status === 'sending'
        ? 'streaming'
        : 'complete',
    content,
  };
}

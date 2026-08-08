import { describe, expect, it } from 'vitest';
import type { DisplayMessage } from '@/hooks/use-matrix';
import { toTDesignMatrixMessage } from './matrix-message';

function message(overrides: Partial<DisplayMessage> = {}): DisplayMessage {
  return {
    id: '$event',
    sender: '@agent:matrix.test',
    senderShort: 'agent',
    content: 'hello',
    timestamp: 0,
    type: 'm.text',
    isMe: false,
    ...overrides,
  };
}

describe('toTDesignMatrixMessage', () => {
  it('maps a local Matrix message to a TDesign user text message', () => {
    const adapted = toTDesignMatrixMessage(message({ isMe: true, content: 'hello **world**' }));

    expect(adapted.role).toBe('user');
    expect(adapted.status).toBe('complete');
    expect(adapted.content).toEqual([{ type: 'text', data: 'hello **world**' }]);
  });

  it('maps legacy thinking content to TDesign thinking', () => {
    const adapted = toTDesignMatrixMessage(message({
      content: '<details class="thinking">checking Matrix state</details>',
      isStreaming: true,
    }));

    expect(adapted.status).toBe('streaming');
    expect(adapted.content).toEqual([{ type: 'thinking', data: { text: 'checking Matrix state', title: '思考过程' } }]);
  });

  it('maps legacy tool cards to a visible Markdown summary', () => {
    const adapted = toTDesignMatrixMessage(message({
      content: '```card\n{"tool_name":"read_file","arguments":{"path":"README.md"},"result":"ok"}\n```',
    }));

    expect(adapted.content).toEqual([{
      type: 'markdown',
      data: '### 工具调用：read_file\n\n#### 参数\n\n```json\n{\n  "path": "README.md"\n}\n```\n\n#### 结果\n\n```\nok\n```',
    }]);
  });

  it('keeps A2UI payloads behind an explicit compatibility message', () => {
    const adapted = toTDesignMatrixMessage(message({
      content: '```a2ui\n{"version":"v0.9","createSurface":{"surfaceId":"demo","catalogId":"agentteams-chat"}}\n```',
    }));

    expect(adapted.content[0]).toEqual({
      type: 'markdown',
      data: '此消息包含 A2UI 交互内容。完整界面继续在“Matrix 聊天”入口中提供。',
    });
  });
});

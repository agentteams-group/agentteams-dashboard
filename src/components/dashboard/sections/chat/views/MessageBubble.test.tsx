import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MessageBubble } from './MessageBubble';

vi.mock('../markdown-message', () => ({
  MarkdownMessage: ({ content }: { content: string }) => <div>{content}</div>,
}));

describe('MessageBubble', () => {
  it('renders mixed text and tool blocks without repeating the raw card payload', () => {
    render(
      <MessageBubble
        message={{
          id: '$message',
          sender: '@agent:example.com',
          senderShort: 'agent',
          content: '准备执行\n```card\n{"type":"tool_call","tool_name":"read_file","status":"success"}\n```\n执行完成',
          timestamp: 0,
          type: 'm.text',
          isMe: false,
        }}
        showSender={false}
        isContinuation={false}
      />
    );

    expect(screen.getByText('准备执行')).toBeInTheDocument();
    expect(screen.getByText('执行完成')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /read_file/ })).toBeInTheDocument();
    expect(screen.queryByText(/"tool_name"/)).toBeNull();
  });

  it('renders A2UI protocol messages through the chat catalog', () => {
    const messages = [
      {
        version: 'v0.9',
        createSurface: { surfaceId: 'chat-message', catalogId: 'agentteams-chat' },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'chat-message',
          components: [{ id: 'root', component: 'MarkdownBlock', content: 'A2UI 已渲染' }],
        },
      },
    ];

    render(
      <MessageBubble
        message={{
          id: '$a2ui',
          sender: '@agent:example.com',
          senderShort: 'agent',
          content: `\`\`\`a2ui\n${JSON.stringify(messages)}\n\`\`\``,
          timestamp: 0,
          type: 'm.text',
          isMe: false,
        }}
        showSender={false}
        isContinuation={false}
      />
    );

    expect(screen.getByText('A2UI 已渲染')).toBeInTheDocument();
    expect(document.querySelector('.a2ui-message')).toBeInTheDocument();
  });

  it('renders Tool Guard approval prompts when confirmation replies are available', () => {
    render(
      <MessageBubble
        message={{
          id: '$confirmation',
          sender: '@agent:example.com',
          senderShort: 'agent',
          content: `⏳ Waiting for approval / 等待审批

Tool / 工具: execute_shell_command
Triggered by / 触发来源: Tool Guard / 工具护栏
Parameters / 参数:
{
  "command": "rm 123",
  "timeout": 10
}
💡 Triggered by tool guardrails
Type /approve to approve, or send any message to deny.`,
          timestamp: 0,
          type: 'm.text',
          isMe: false,
        }}
        showSender={false}
        isContinuation={false}
        onSendConfirmation={() => {}}
      />
    );

    expect(screen.getByRole('button', { name: /工具审批 - execute_shell_command/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '批准' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '拒绝' })).toBeInTheDocument();
  });
});

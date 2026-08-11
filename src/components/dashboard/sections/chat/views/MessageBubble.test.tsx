import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MessageBubble } from './MessageBubble';

const markdownMock = vi.fn(({ content }: { content: string }) => <div>{content}</div>);
vi.mock('../markdown-message', () => ({
  MarkdownMessage: (props: { content: string }) => markdownMock(props),
}));

afterEach(cleanup);

describe('MessageBubble', () => {
  it('passes isStreaming to the text block renderer while streaming', () => {
    markdownMock.mockClear();
    render(
      <MessageBubble
        message={{
          id: '$streaming',
          sender: '@agent:example.com',
          senderShort: 'agent',
          content: '正在生成答案',
          timestamp: 0,
          type: 'm.text',
          isMe: false,
          isStreaming: true,
        }}
        showSender={false}
        isContinuation={false}
      />
    );

    const props = markdownMock.mock.calls[0][0] as { isStreaming?: boolean };
    expect(props.isStreaming).toBe(true);
  });

  it('leaves isStreaming off the text block renderer for finished messages', () => {
    markdownMock.mockClear();
    render(
      <MessageBubble
        message={{
          id: '$done',
          sender: '@agent:example.com',
          senderShort: 'agent',
          content: '最终答案',
          timestamp: 0,
          type: 'm.text',
          isMe: false,
        }}
        showSender={false}
        isContinuation={false}
      />
    );

    const props = markdownMock.mock.calls[0][0] as { isStreaming?: boolean };
    expect(props.isStreaming).toBeFalsy();
  });
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
    expect(screen.getByRole('button', { name: /读取文件/ })).toBeInTheDocument();
    expect(screen.queryByText(/"tool_name"/)).toBeNull();
  });

  it('uses the command renderer and safely displays invalid JSON arguments', () => {
    render(
      <MessageBubble
        message={{
          id: '$command',
          sender: '@agent:example.com',
          senderShort: 'agent',
          content: '```card\n{"type":"tool_call","tool_name":"execute_command","arguments":"not json","status":"success"}\n```',
          timestamp: 0,
          type: 'm.text',
          isMe: false,
        }}
        showSender={false}
        isContinuation={false}
      />
    );

    expect(screen.getByRole('button', { name: /执行命令/ })).toBeInTheDocument();
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

  it('renders AgentTeams workflow details from a structured message payload', () => {
    render(
      <MessageBubble
        message={{
          id: '$workflow',
          sender: '@agent:example.com',
          senderShort: 'agent',
          content: '正在执行',
          timestamp: 0,
          type: 'm.text',
          isMe: false,
          rawContent: {
            'agentteams.workflow': {
              title: '发布流程',
              status: 'in_progress',
              runId: 'run-1',
              subagents: [{ name: '部署智能体', status: 'running' }],
              steps: [{ title: '规划', status: 'completed' }, { title: '发布', status: 'running' }],
            },
          },
        }}
        showSender={false}
        isContinuation={false}
      />
    );

    expect(screen.getByText('发布流程')).toBeInTheDocument();
    expect(screen.getByText('runId: run-1')).toBeInTheDocument();
    expect(screen.getByText('部署智能体')).toBeInTheDocument();
    expect(screen.getByLabelText('执行进度 1/2')).toBeInTheDocument();
  });

  it('uses expanded widths for text bubbles and workflow cards', () => {
    const textMessage = render(
      <MessageBubble
        message={{
          id: '$wide-content',
          sender: '@agent:example.com',
          senderShort: 'agent',
          content: '宽内容',
          timestamp: 0,
          type: 'm.text',
          isMe: false,
        }}
        showSender={false}
        isContinuation={false}
      />
    );

    expect(screen.getByText('宽内容').parentElement).toHaveClass('max-w-[min(92%,72ch)]');
    textMessage.unmount();

    render(
      <MessageBubble
        message={{
          id: '$wide-workflow',
          sender: '@agent:example.com',
          senderShort: 'agent',
          content: '工作流内容',
          timestamp: 0,
          type: 'm.text',
          isMe: false,
          rawContent: {
            'agentteams.workflow': {
              title: '宽工作流',
              status: 'running',
            },
          },
        }}
        showSender={false}
        isContinuation={false}
      />
    );

    expect(
      Array.from(document.querySelectorAll('div')).find((element) =>
        element.classList.contains('w-[min(100%,56rem)]')
      )
    ).toBeInTheDocument();
  });

  it.each([
    {
      runtime: 'Hermes',
      content: '```card\n{"type":"tool_call","tool_name":"execute_command","status":"running","isStreaming":true}\n```',
      isStreaming: true,
      assertRendered: () => expect(screen.getByRole('button', { name: /执行命令/ })).toBeInTheDocument(),
    },
    {
      runtime: 'OpenClaw',
      content: '<details class="thinking">正在分析请求</details>',
      isStreaming: true,
      assertRendered: () => expect(screen.getByText('正在分析请求')).toBeInTheDocument(),
    },
    {
      runtime: 'Human',
      content: '普通文本消息',
      assertRendered: () => expect(screen.getByText('普通文本消息')).toBeInTheDocument(),
    },
    {
      runtime: 'Copaw',
      content: `⏳ Waiting for approval / 等待审批

Tool / 工具: execute_shell_command
Triggered by / 触发来源: Tool Guard / 工具护栏
Parameters / 参数:
{ "command": "pwd" }

Type /approve to approve, or send any message to deny.`,
      assertRendered: () => expect(screen.getByRole('button', { name: '批准' })).toBeInTheDocument(),
    },
    {
      runtime: 'QwenPaw',
      content: "object='message' status='completed' error=None id='msg_qwen' type='reasoning' role='assistant' content=[TextContent(sequence_number=None, object='content', status=None, error=None, type='text', index=0, delta=None, msg_id='msg_qwen', text='正在推理')] code=None message=None usage=None metadata={}",
      assertRendered: () => {
        fireEvent.click(screen.getByRole('button', { name: /思考过程/ }));
        expect(screen.getByText('正在推理')).toBeInTheDocument();
      },
    },
  ])('$runtime runtime message renders its supported content', ({ runtime, content, isStreaming, assertRendered }) => {
    render(
      <MessageBubble
        message={{
          id: `$${runtime.toLowerCase()}`,
          sender: `@${runtime.toLowerCase()}:example.com`,
          senderShort: runtime,
          content,
          timestamp: 0,
          type: 'm.text',
          isMe: false,
          isStreaming,
        }}
        showSender={false}
        isContinuation={false}
        onSendConfirmation={() => {}}
      />
    );

    assertRendered();
  });

  it('renders an attachment block for long-message metadata', () => {
    render(
      <MessageBubble
        message={{
          id: '$attachment',
          sender: '@agent:example.com',
          senderShort: 'agent',
          content: '正文被截断…',
          timestamp: 0,
          type: 'm.text',
          isMe: false,
          rawContent: {
            'com.agentteams.long_message': {
              version: 1,
              url: 'mxc://example.com/abc123',
              filename: 'full-reply.txt',
              mimetype: 'text/plain',
            },
          },
        }}
        showSender={false}
        isContinuation={false}
      />
    );

    expect(screen.getByText('full-reply.txt')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /下载/ })).toBeInTheDocument();
  });

  it('renders a loading placeholder for an in-progress a2ui marker while streaming', () => {
    render(
      <MessageBubble
        message={{
          id: '$a2ui-streaming',
          sender: '@agent:example.com',
          senderShort: 'agent',
          content: '```a2ui\n{"version":"v0.9","createSurface":{"surfaceId":"s"}}',
          timestamp: 0,
          type: 'm.text',
          isMe: false,
          isStreaming: true,
        }}
        showSender={false}
        isContinuation={false}
      />
    );

    expect(screen.getByText('正在生成交互内容...')).toBeInTheDocument();
  });

  it('renders structured Agent run blocks as collapsible cards', () => {
    render(
      <MessageBubble
        message={{
          id: '$agent-run',
          sender: '@agent:example.com',
          senderShort: 'agent',
          content: '最终答案',
          timestamp: 0,
          type: 'm.text',
          isMe: false,
          rawContent: {
            'org.agentteams.run': {
              blocks: [
                { type: 'thinking', content: '正在分析请求' },
                { type: 'tool_call', payload: { tool_name: 'read_file', status: 'running' } },
                { type: 'text', text: '最终答案' },
              ],
            },
          },
        }}
        showSender={false}
        isContinuation={false}
      />
    );

    expect(screen.getByRole('button', { name: /思考过程/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /读取文件/ })).toBeInTheDocument();
    expect(screen.getByText('最终答案')).toBeInTheDocument();
  });

  it('shows a single check for my message with no read receipts', () => {
    render(
      <MessageBubble
        message={{
          id: '$mine',
          sender: '@me:example.com',
          senderShort: 'me',
          content: 'hello',
          timestamp: 1000,
          type: 'm.text',
          isMe: true,
        }}
        showSender={false}
        isContinuation={false}
        readReceipts={{}}
        currentUserId="@me:example.com"
      />
    );

    expect(screen.getByLabelText('已发送')).toBeInTheDocument();
    expect(screen.queryByLabelText('已读')).toBeNull();
  });

  it('shows a double check when another user has read my message', () => {
    render(
      <MessageBubble
        message={{
          id: '$mine-read',
          sender: '@me:example.com',
          senderShort: 'me',
          content: 'hello',
          timestamp: 1000,
          type: 'm.text',
          isMe: true,
        }}
        showSender={false}
        isContinuation={false}
        readReceipts={{
          '@peer:example.com': { ts: 1500, eventId: '$mine-read' },
        }}
        currentUserId="@me:example.com"
      />
    );

    expect(screen.getByLabelText('已读')).toBeInTheDocument();
    expect(screen.queryByLabelText('已发送')).toBeNull();
  });

  it('does not count my own receipt as read by another user', () => {
    render(
      <MessageBubble
        message={{
          id: '$mine-self',
          sender: '@me:example.com',
          senderShort: 'me',
          content: 'hello',
          timestamp: 1000,
          type: 'm.text',
          isMe: true,
        }}
        showSender={false}
        isContinuation={false}
        readReceipts={{
          '@me:example.com': { ts: 1500, eventId: '$mine-self' },
        }}
        currentUserId="@me:example.com"
      />
    );

    expect(screen.getByLabelText('已发送')).toBeInTheDocument();
    expect(screen.queryByLabelText('已读')).toBeNull();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MessageBubble } from './MessageBubble';

vi.mock('../markdown-message', () => ({
  MarkdownMessage: ({ content }: { content: string }) => <div>{content}</div>,
}));

afterEach(cleanup);

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
          workflow: {
            title: '发布流程',
            status: 'in_progress',
            runId: 'run-1',
            subagents: [{ name: '部署智能体', status: 'running' }],
            steps: [{ title: '规划', status: 'completed' }, { title: '发布', status: 'running' }],
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
          workflow: {
            title: '宽工作流',
            status: 'running',
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
          agentBlocks: [
            { type: 'thinking', content: '正在分析请求' },
            { type: 'tool_call', payload: { tool_name: 'read_file', status: 'running' } },
            { type: 'text', text: '最终答案' },
          ],
        }}
        showSender={false}
        isContinuation={false}
      />
    );

    expect(screen.getByRole('button', { name: /思考过程/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /读取文件/ })).toBeInTheDocument();
    expect(screen.getByText('最终答案')).toBeInTheDocument();
  });
});

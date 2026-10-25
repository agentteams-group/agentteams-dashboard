import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MessageBubble } from './MessageBubble';
import { useHitlInboxStore } from '@/lib/hitl-inbox';

// WorkflowCard（v11 live overlay）内含 useQuery → 渲染需 QueryClientProvider。
function renderWithProvider(ui: Parameters<typeof render>[0]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const markdownMock = vi.fn(({ content }: { content: string }) => <div>{content}</div>);
vi.mock('../markdown-message', () => ({
  MarkdownMessage: (props: { content: string }) => markdownMock(props),
}));

afterEach(cleanup);
beforeEach(() => {
  useHitlInboxStore.setState({ confirmations: {}, resolutions: {} });
});

describe('MessageBubble', () => {
  it('passes isStreaming to the text block renderer while streaming', () => {
    markdownMock.mockClear();
    renderWithProvider(
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
    renderWithProvider(
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
    renderWithProvider(
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

  it('renders the intervention card once when the message has multiple text blocks', () => {
    renderWithProvider(
      <MessageBubble
        message={{
          id: '$multi-block-choice',
          sender: '@agent:example.com',
          senderShort: 'agent',
          content:
            '请选择一种方案？\n1. 方案甲\n2. 方案乙\n```card\n{"type":"tool_call","tool_name":"read_file","status":"success"}\n```\n补充说明',
          timestamp: 0,
          type: 'm.text',
          isMe: false,
        }}
        showSender={false}
        isContinuation={false}
        onSendConfirmation={vi.fn()}
      />
    );

    expect(screen.getAllByText('请选择一种方案？')).toHaveLength(1);
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.getAllByText('补充说明')).toHaveLength(1);
  });

  it('uses the command renderer and safely displays invalid JSON arguments', () => {
    renderWithProvider(
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

    renderWithProvider(
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
    renderWithProvider(
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
    renderWithProvider(
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
    const textMessage = renderWithProvider(
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

    // The reading column itself is capped (780px) by ScrollPanel, so message
    // bodies simply fill it instead of carrying their own rem caps.
    expect(screen.getByText('宽内容').parentElement).toHaveClass('w-full');
    textMessage.unmount();

    renderWithProvider(
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
    renderWithProvider(
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
    const { container } = renderWithProvider(
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
    // The row must stretch so the attachment wrapper can resolve against the
    // whole column instead of the card header width.
    const row = container.querySelector('.flex.items-start.gap-2');
    expect(row?.className).toContain('w-full');
  });

  it('uses the full message column for inline HTML file attachments', () => {
    renderWithProvider(
      <MessageBubble
        message={{
          id: '$html-file',
          sender: '@agent:example.com',
          senderShort: 'agent',
          content: 'index.html',
          timestamp: 0,
          type: 'm.file',
          isMe: false,
          mediaUrl: 'mxc://example.com/page1',
          mediaInfo: { mimetype: 'text/html' },
        }}
        showSender={false}
        isContinuation={false}
      />
    );

    // w-fit collapsed the bubble to the card width and gave the sandboxed
    // document a narrow viewport; the file message owns the full column.
    const bubble = screen.getByText('index.html').closest('.break-words');
    expect(bubble?.className).toContain('w-full');
  });

  it('renders a loading placeholder for an in-progress a2ui marker while streaming', () => {
    renderWithProvider(
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
    renderWithProvider(
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
    renderWithProvider(
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
    renderWithProvider(
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
    renderWithProvider(
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

describe('MessageBubble — worker avatar → sessions (C / #1295)', () => {
  const base = {
    id: '$worker-msg',
    sender: '@worker1:example.com',
    senderShort: 'worker1',
    content: 'hi',
    timestamp: 0,
    type: 'm.text' as const,
    isMe: false,
  };

  it('worker 发送者头像可点 → onOpenWorkerChats(workerName)', () => {
    const onOpenWorkerChats = vi.fn();
    renderWithProvider(
      <MessageBubble
        message={{ ...base, workerName: 'worker-1' }}
        showSender
        isContinuation={false}
        onOpenWorkerChats={onOpenWorkerChats}
      />
    );
    const btn = screen.getByLabelText('查看 worker-1 的会话');
    expect(btn).not.toHaveAttribute('disabled');
    fireEvent.click(btn);
    expect(onOpenWorkerChats).toHaveBeenCalledTimes(1);
    expect(onOpenWorkerChats).toHaveBeenCalledWith('worker-1');
  });

  it('人类发送者（无 workerName）头像不可点、不回调', () => {
    const onOpenWorkerChats = vi.fn();
    renderWithProvider(
      <MessageBubble
        message={base}
        showSender
        isContinuation={false}
        onOpenWorkerChats={onOpenWorkerChats}
      />
    );
    const anyBtn = screen.queryByRole('button', { name: /的会话/ });
    if (anyBtn) expect(anyBtn).toBeDisabled();
    expect(onOpenWorkerChats).not.toHaveBeenCalled();
  });

  it('未接 onOpenWorkerChats（无回调方）时头像也不可点', () => {
    renderWithProvider(
      <MessageBubble message={{ ...base, workerName: 'worker-1' }} showSender isContinuation={false} />
    );
    const btn = screen.queryByLabelText('查看 worker-1 的会话');
    expect(btn).toBeNull();
  });
});

describe('MessageBubble — 干预启发式升格（F2.1 降级完整形态）', () => {
  const baseMessage = {
    id: '$heuristic',
    sender: '@manager:example.com',
    senderShort: 'manager',
    content: '',
    timestamp: 0,
    type: 'm.text',
    isMe: false,
  };

  it('Agent 回复「问句 + 编号选项」→ 渲染干预卡（不再渲染原文本）', () => {
    renderWithProvider(
      <MessageBubble
        message={{
          ...baseMessage,
          content: '你希望先实现哪一种交互？\n1）消息内嵌卡片\n2）底部快捷操作\n3）独立详情面板',
        }}
        showSender={false}
        isContinuation={false}
        onSendConfirmation={vi.fn()}
      />,
    );
    // 卡片标题（问题原句）
    expect(screen.getByText('你希望先实现哪一种交互？')).toBeInTheDocument();
    // 选项进入卡内（radio 形态）
    expect(screen.getByRole('radio', { name: /消息内嵌卡片/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /底部快捷操作/ })).toBeInTheDocument();
    // 提交按钮（Codex 风格文案）
    expect(screen.getByRole('button', { name: /提交选择/ })).toBeInTheDocument();
    // 原始编号列表文本不再重复渲染
    expect(screen.queryByText(/2）底部快捷操作/)).not.toBeInTheDocument();
  });

  it('提交干预卡时把消息发送者交给回写回调（Worker 房间用于 @）', () => {
    const onSend = vi.fn();
    renderWithProvider(
      <MessageBubble
        message={{
          ...baseMessage,
          eventId: '$card',
          sender: '@ceshi:matrix-local.agentteams.io:18080',
          content: '选哪个？\n1. 甲\n2. 乙',
        }}
        showSender={false}
        isContinuation={false}
        onSendConfirmation={onSend}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: /甲/ }));
    fireEvent.click(screen.getByRole('button', { name: /提交选择/ }));
    expect(onSend).toHaveBeenCalledWith(
      expect.stringContaining('甲'),
      '@ceshi:matrix-local.agentteams.io:18080',
      '$card',
    );
  });

  it('有 formatted_body HTML 时仍按纯文本 body 升格', () => {
    renderWithProvider(
      <MessageBubble
        message={{
          ...baseMessage,
          content: '页面类型：想要哪种？\nA. 落地页\nB. 3D 演示页\nC. 信息展示页',
          formattedContent:
            '<p><strong>页面类型</strong>：想要哪种？</p><p>A. 落地页</p><p>B. 3D 演示页</p><p>C. 信息展示页</p>',
        }}
        showSender={false}
        isContinuation={false}
        onSendConfirmation={vi.fn()}
      />,
    );
    expect(screen.getByText('页面类型：想要哪种？')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /落地页/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /提交选择/ })).toBeInTheDocument();
  });

  it('QwenPaw「1 = 选项」逐题追问也升格为干预卡', () => {
    renderWithProvider(
      <MessageBubble
        message={{
          ...baseMessage,
          content: [
            '收到，我换个方式——一次只问一个问题，尽量短。我们先定第一个：',
            '**问题 1/6：你想要哪种页面？**',
            '1 = 宣传落地页（滚动浏览，像特斯拉官网那种）',
            '2 = 3D 互动页（中间一个飞行汽车模型，能拖动旋转）',
            '3 = 简单图文介绍页',
            '回一个数字（比如「1」）就行，我再问下一个。',
          ].join('\n'),
        }}
        showSender={false}
        isContinuation={false}
        onSendConfirmation={vi.fn()}
      />,
    );
    expect(screen.getByText('问题 1/6：你想要哪种页面？')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /宣传落地页/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /提交选择/ })).toBeInTheDocument();
  });

  it('流式中的消息不升格（等定稿再渲染卡片）', () => {
    renderWithProvider(
      <MessageBubble
        message={{
          ...baseMessage,
          content: '选哪个？\n1）甲\n2）乙',
          isStreaming: true,
        }}
        showSender={false}
        isContinuation={false}
        onSendConfirmation={vi.fn()}
      />,
    );
    expect(screen.queryByRole('radio', { name: /甲/ })).not.toBeInTheDocument();
    expect(screen.getByText(/选哪个/)).toBeInTheDocument();
  });

  it('自己的消息与普通列表不升格', () => {
    renderWithProvider(
      <MessageBubble
        message={{
          ...baseMessage,
          content: '步骤如下：\n1. 安装\n2. 启动',
          isMe: true,
        }}
        showSender={false}
        isContinuation={false}
        onSendConfirmation={vi.fn()}
      />,
    );
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });
});

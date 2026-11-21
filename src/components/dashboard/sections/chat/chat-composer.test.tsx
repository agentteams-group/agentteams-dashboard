import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatComposer } from './chat-composer';

vi.mock('./components/FileRefPickerDialog', () => ({ FileRefPickerDialog: ({ onSendPersonalFile }: { onSendPersonalFile: (_file: File) => void }) => <button onClick={() => onSendPersonalFile(new File(['hello'], 'mine.txt'))}>发送我的文件</button> }));

vi.mock('./voice-input', () => ({ VoiceInput: () => null }));

afterEach(cleanup);

it('keeps supplementary input enabled and exposes Stop during a direct execution', () => {
  const onStop = vi.fn(), onSend = vi.fn();
  render(<ChatComposer value="只看杭州" onChange={vi.fn()} onSend={onSend}
    isSending={false} sendError={null} placeholder="消息" disabled={false}
    execution={{ runId: '$run', agentId: '@agent:test', status: 'running' }} onStop={onStop} />);
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(false);
  const stop = screen.getByRole('button', { name: '停止执行' });
  expect(stop.textContent).toBe('');
  expect(stop.querySelector('circle')).not.toBeNull();
  expect(stop.querySelector('rect')).not.toBeNull();
  expect(screen.getByRole('button', { name: '发送消息' }).textContent).toBe('发送');
  fireEvent.click(stop);
  expect(onStop).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
  expect(onSend).toHaveBeenCalledOnce();
});

it('does not show Stop for ordinary chats', () => {
  render(<ChatComposer value="" onChange={vi.fn()} onSend={vi.fn()}
    isSending={false} sendError={null} placeholder="消息" disabled={false} />);
  expect(screen.queryByRole('button', { name: '停止执行' })).toBeNull();
  expect(screen.getByRole('button', { name: '发送消息' }).textContent).toBe('发送');
});

it('offers queueing separately from immediate supplementary input', () => {
  const onQueue = vi.fn(), onSend = vi.fn();
  render(<ChatComposer value="下一步整理报表" onChange={vi.fn()} onSend={onSend} onQueue={onQueue}
    isSending={false} sendError={null} placeholder="消息" disabled={false}
    execution={{ runId: '$run', agentId: '@agent:test', status: 'running' }} />);
  fireEvent.click(screen.getByRole('button', { name: '加入消息队列' }));
  expect(onQueue).toHaveBeenCalledOnce();
  expect(onSend).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
  expect(onSend).toHaveBeenCalledOnce();
});

describe('ChatComposer keyboard submission', () => {
  it.each(['send', 'queue'] as const)('uses the %s Enter preference during a reply, while the send button always sends immediately', (replyEnterAction) => {
    const onSend = vi.fn(), onQueue = vi.fn();
    render(<ChatComposer value="检查退款异常" onChange={vi.fn()} onSend={onSend} onQueue={onQueue}
      replyEnterAction={replyEnterAction} isSending={false} sendError={null} placeholder="消息" disabled={false}
      execution={{ runId: '$run', agentId: '@agent:test', status: 'running' }} />);
    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    expect(onQueue).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledTimes(replyEnterAction === 'send' ? 1 : 0);
    expect(onQueue).toHaveBeenCalledTimes(replyEnterAction === 'queue' ? 1 : 0);
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    expect(onSend).toHaveBeenCalledTimes(replyEnterAction === 'send' ? 2 : 1);
  });

  it.each([undefined, 'completed', 'stopped', 'failed'] as const)('sends normally with the queue preference outside a reply (%s)', status => {
    const onSend = vi.fn(), onQueue = vi.fn();
    render(<ChatComposer value="继续检查" onChange={vi.fn()} onSend={onSend} onQueue={onQueue}
      replyEnterAction="queue" isSending={false} sendError={null} placeholder="消息" disabled={false}
      execution={status ? { runId: '$run', agentId: '@agent:test', status } : null} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(onSend).toHaveBeenCalledOnce();
    expect(onQueue).not.toHaveBeenCalled();
  });

  it('keeps Enter saving an edit with the queue preference', () => {
    const onSend = vi.fn(), onQueue = vi.fn(), onSubmitEdit = vi.fn();
    render(<ChatComposer value="修改内容" onChange={vi.fn()} onSend={onSend} onQueue={onQueue}
      replyEnterAction="queue" isSending={false} sendError={null} placeholder="消息" disabled={false}
      execution={{ runId: '$run', agentId: '@agent:test', status: 'running' }}
      editSession={{ eventId: '$edit', initialText: '原文' }} onSubmitEdit={onSubmitEdit} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(onSubmitEdit).toHaveBeenCalledWith('修改内容');
    expect(onSend).not.toHaveBeenCalled();
    expect(onQueue).not.toHaveBeenCalled();
  });

  it('adds an interruption hint without changing the send label', () => {
    render(<ChatComposer value="检查退款" onChange={vi.fn()} onSend={vi.fn()} interruptsOnSend
      isSending={false} sendError={null} placeholder="消息" disabled={false}
      execution={{ runId: '$run', agentId: '@agent:test', status: 'running' }} />);
    expect(screen.getByRole('status').textContent).toContain('发送会打断当前会话');
    expect(screen.getByRole('button', { name: '发送消息' }).textContent).toBe('发送');
  });

  it('does not send when composition ends before the confirming Enter', () => {
    const onSend = vi.fn();
    render(<ChatComposer value="你好啊hhh" onChange={vi.fn()} onSend={onSend}
      isSending={false} sendError={null} placeholder="消息" disabled={false} />);
    const input = screen.getByRole('textbox');
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      fireEvent.compositionStart(input);
      fireEvent.keyDown(input, { key: 'Enter', isComposing: false, keyCode: 13 });
      expect(onSend).not.toHaveBeenCalled();
      fireEvent.compositionEnd(input, { data: '哈哈哈' });
      fireEvent.keyDown(input, { key: 'Enter', isComposing: false, keyCode: 13 });
      expect(onSend).not.toHaveBeenCalled();
      now.mockReturnValue(1101);
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onSend).toHaveBeenCalledTimes(1);
    } finally {
      now.mockRestore();
    }
  });

  it.each([
    { isComposing: true },
    { keyCode: 229 },
  ])('does not send while confirming IME input: %j', (imeEvent) => {
    const onSend = vi.fn();
    render(<ChatComposer value="你好" onChange={vi.fn()} onSend={onSend}
      isSending={false} sendError={null} placeholder="消息" disabled={false} />);
    const input = screen.getByRole('textbox');

    fireEvent.keyDown(input, { key: 'Enter', ...imeEvent });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});

it('opens personal files without a Worker workspace and forwards the attachment', () => {
  const upload = vi.fn();
  render(<ChatComposer value="" onChange={vi.fn()} onSend={vi.fn()} isSending={false} sendError={null} placeholder="消息" disabled={false} onFileUpload={upload} />);
  fireEvent.click(screen.getByTitle('选择文件（我的文件或工作空间）'));
  fireEvent.click(screen.getByRole('button', { name: '发送我的文件' }));
  expect(upload).toHaveBeenCalledWith(expect.objectContaining({ name: 'mine.txt', size: 5 }));
});

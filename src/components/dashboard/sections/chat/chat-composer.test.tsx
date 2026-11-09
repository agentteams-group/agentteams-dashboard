import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatComposer } from './chat-composer';

vi.mock('./voice-input', () => ({ VoiceInput: () => null }));

afterEach(cleanup);

describe('ChatComposer keyboard submission', () => {
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

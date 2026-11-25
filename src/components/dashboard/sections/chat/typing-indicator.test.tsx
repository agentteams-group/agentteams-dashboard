import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TypingIndicator } from './typing-indicator';

afterEach(cleanup);

describe('typing status', () => {
  it('keeps an empty status slot without inventing an active sender', () => {
    const { rerender } = render(<TypingIndicator users={[]} />);
    const slot = screen.getByRole('status');
    expect(slot).toHaveTextContent(/^$/);
    rerender(<TypingIndicator users={[{ userId: '@manager:test', displayName: 'Manager' }]} />);
    expect(screen.getByRole('status')).toBe(slot);
    expect(slot).toHaveTextContent('Manager 正在输入');
  });

  it.each([
    [['Manager'], 'Manager 正在输入'],
    [['Manager', 'Leader'], 'Manager 和 Leader 正在输入'],
    [['Manager', 'Leader', 'Worker'], 'Manager 等 3 人正在输入'],
  ])('announces the actual senders: %s', (names, text) => {
    render(<TypingIndicator users={names.map((displayName) => ({ userId: `@${displayName}:test`, displayName }))} />);
    expect(screen.getByRole('status')).toHaveTextContent(text);
    expect(screen.getByTitle(text)).toHaveTextContent(text);
    expect(screen.getByText(names.length > 2 ? '等 3 人正在输入' : '正在输入')).toBeInTheDocument();
  });
});

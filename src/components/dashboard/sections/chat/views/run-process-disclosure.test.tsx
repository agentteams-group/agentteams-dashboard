import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { RunProcessDisclosure } from './run-process-disclosure';
import type { ParsedA2uiBlock } from '@/lib/a2ui/parser';

afterEach(cleanup);

const thinking = (content: string): ParsedA2uiBlock[] => [{ type: 'thinking', content }];

describe('live process preview', () => {
  it('bounds live content and collapses when the turn finishes despite a stale tool status', () => {
    const blocks: ParsedA2uiBlock[] = [{ type: 'tool_call', payload: { tool_name: 'execute_shell_command', status: 'running' } }];
    const { rerender } = render(<RunProcessDisclosure blocks={blocks} active />);
    expect(screen.getByTestId('run-process-preview')).toHaveClass('max-h-60', 'overflow-y-auto');
    rerender(<RunProcessDisclosure blocks={blocks} active={false} />);
    expect(screen.getByTestId('run-process')).toHaveAttribute('data-state', 'closed');
    expect(screen.queryByText('正在处理')).not.toBeInTheDocument();
  });

  it('resets a manual expansion on completion and lets the user reopen the history', () => {
    const { rerender } = render(<RunProcessDisclosure blocks={thinking('执行中')} active />);
    const toggle = () => fireEvent.click(screen.getByRole('button', { name: /^过程/ }));
    toggle();
    toggle();
    rerender(<RunProcessDisclosure blocks={thinking('已完成')} active={false} />);
    expect(screen.getByTestId('run-process')).toHaveAttribute('data-state', 'closed');
    toggle();
    expect(screen.getByText('已完成')).toBeVisible();
  });

  it('follows new content until the user scrolls up to inspect earlier steps', () => {
    const { rerender } = render(<RunProcessDisclosure blocks={thinking('第一步')} active />);
    const preview = screen.getByTestId('run-process-preview');
    Object.defineProperties(preview, { scrollHeight: { configurable: true, value: 600 }, clientHeight: { value: 240 } });
    rerender(<RunProcessDisclosure blocks={thinking('第二步')} active />);
    expect(preview.scrollTop).toBe(600);
    preview.scrollTop = 100;
    fireEvent.scroll(preview);
    rerender(<RunProcessDisclosure blocks={thinking('第三步')} active />);
    expect(preview.scrollTop).toBe(100);
    preview.scrollTop = 360;
    fireEvent.scroll(preview);
    Object.defineProperty(preview, 'scrollHeight', { value: 800 });
    rerender(<RunProcessDisclosure blocks={thinking('第四步')} active />);
    expect(preview.scrollTop).toBe(800);
  });
});

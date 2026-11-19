import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import { isComposing, useDesktopInputFocus, useHoverOpen } from './desktop-interactions';

function Harness() {
  useDesktopInputFocus();
  const hover = useHoverOpen({});
  return <><input aria-label="first" /><textarea aria-label="second" /><input aria-label="readonly" readOnly />
    <button {...hover.triggerProps}>选择</button>{hover.open && <div {...hover.contentProps}><button>选项</button></div>}</>;
}

function mouseOver(element: HTMLElement) {
  const event = new Event('pointerover', { bubbles: true });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  fireEvent(element, event);
}

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('desktop interactions', () => {
  it('focuses text inputs on mouse hover without changing their content', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    render(<Harness />);
    const input = screen.getByLabelText('first');
    mouseOver(input);
    expect(document.activeElement).toBe(input);
    mouseOver(screen.getByLabelText('readonly'));
    expect(document.activeElement).toBe(input);
  });

  it('keeps the composing input focused until composition ends', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    render(<Harness />);
    const input = screen.getByLabelText('first');
    input.focus();
    fireEvent.compositionStart(input);
    expect(isComposing()).toBe(true);
    mouseOver(screen.getByLabelText('second'));
    expect(document.activeElement).toBe(input);
    fireEvent.compositionEnd(input);
    mouseOver(screen.getByLabelText('second'));
    expect(document.activeElement).toBe(screen.getByLabelText('second'));
  });

  it('does not focus inputs when the device has no fine hover pointer', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    render(<Harness />);
    mouseOver(screen.getByLabelText('first'));
    expect(document.activeElement).not.toBe(screen.getByLabelText('first'));
  });

  it('opens on mouse hover and keeps trigger and popup in one region', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: '选择' });
    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
    expect(screen.getByRole('button', { name: '选项' })).toBeTruthy();
    fireEvent.pointerLeave(trigger, { pointerType: 'mouse' });
    fireEvent.pointerEnter(screen.getByRole('button', { name: '选项' }).parentElement!, { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(150));
    expect(screen.getByRole('button', { name: '选项' })).toBeTruthy();
    fireEvent.pointerLeave(screen.getByRole('button', { name: '选项' }).parentElement!, { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(150));
    expect(screen.queryByRole('button', { name: '选项' })).toBeNull();
  });
});

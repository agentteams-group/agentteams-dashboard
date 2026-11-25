import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NativeSelect } from './native-select';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('preserves the native change event and disabled choices when using the hover picker', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const change = vi.fn();
  render(<NativeSelect aria-label="状态" defaultValue="pending" onChange={event => change(event.target.value)}><option value="pending">待办</option><optgroup label="其他"><option value="done">已完成</option><option value="blocked" disabled>阻塞</option></optgroup></NativeSelect>);
  const select = screen.getByRole('combobox');
  fireEvent.pointerEnter(select, { pointerType: 'mouse' });
  const list = within(screen.getByRole('listbox'));
  expect(change).not.toHaveBeenCalled();
  expect(list.getByRole('option', { name: '阻塞' })).toBeDisabled();
  fireEvent.pointerMove(list.getByRole('option', { name: '已完成' }), { pointerType: 'mouse' });
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(list.getByRole('option', { name: '已完成' }));
  expect(change).toHaveBeenCalledExactlyOnceWith('done');
  expect(select).toHaveValue('done');
});

it('keeps native keyboard and touch selection', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const change = vi.fn();
  render(<NativeSelect aria-label="状态" defaultValue="pending" onChange={event => change(event.target.value)}><option value="pending">待办</option><option value="done">已完成</option></NativeSelect>);
  const select = screen.getByRole('combobox');
  fireEvent.pointerEnter(select, { pointerType: 'touch' });
  expect(screen.queryByRole('listbox')).toBeNull();
  fireEvent.change(select, { target: { value: 'done' } });
  expect(change).toHaveBeenCalledExactlyOnceWith('done');
});

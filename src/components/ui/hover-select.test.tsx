import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './dropdown-menu';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('opens a selector on mouse hover and changes its value only after explicit selection', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const change = vi.fn();
  render(<Select defaultValue="one" onValueChange={change}><SelectTrigger aria-label="团队"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="one">团队一</SelectItem><SelectItem value="two">团队二</SelectItem></SelectContent></Select>);
  const trigger = screen.getByRole('combobox');
  fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  fireEvent.pointerMove(screen.getByRole('option', { name: '团队二' }), { pointerType: 'mouse' });
  expect(change).not.toHaveBeenCalled();
  fireEvent.pointerUp(screen.getByRole('option', { name: '团队二' }), { pointerType: 'mouse' });
  expect(change).toHaveBeenCalledExactlyOnceWith('two');
});

it('opens an action menu without executing or stealing focus from the draft', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const save = vi.fn();
  render(<><textarea aria-label="草稿" /><DropdownMenu><DropdownMenuTrigger>操作</DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem onSelect={save}>提交</DropdownMenuItem></DropdownMenuContent></DropdownMenu></>);
  const draft = screen.getByRole('textbox');
  draft.focus();
  fireEvent.pointerEnter(screen.getByRole('button', { name: '操作' }), { pointerType: 'mouse' });
  expect(screen.getByRole('menuitem', { name: '提交' })).toBeInTheDocument();
  expect(draft).toHaveFocus();
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('menuitem', { name: '提交' }));
  expect(save).toHaveBeenCalledOnce();
});

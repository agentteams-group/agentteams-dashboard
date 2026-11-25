import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, renderHook, screen, act, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ListPagination, useListPagination } from './list-pagination';

const originalScroll = HTMLElement.prototype.scrollIntoView;
beforeEach(() => { HTMLElement.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { cleanup(); HTMLElement.prototype.scrollIntoView = originalScroll; });
const rows = Array.from({ length: 31 }, (_, index) => index + 1);

it('resets filters and keeps a removed last page clamped after new rows arrive', () => {
  const { result, rerender } = renderHook(({ items, filter }) => useListPagination(items, 12, filter), { initialProps: { items: rows, filter: 'teams' } });
  act(() => result.current.onChange(3));
  expect(result.current.items).toEqual([25, 26, 27, 28, 29, 30, 31]);
  rerender({ items: rows.slice(0, 24), filter: 'teams' });
  expect(result.current.page).toBe(2);
  rerender({ items: rows, filter: 'teams' });
  expect(result.current.page).toBe(2);
  rerender({ items: rows, filter: 'agents' });
  expect(result.current.page).toBe(1);
  rerender({ items: [], filter: 'empty' });
  expect(result.current.items).toEqual([]);
  expect(result.current.page).toBe(1);
});

it('supports previous, next and numbered pages with disabled boundaries', () => {
  function List() {
    const pagination = useListPagination(rows, 12, 'all');
    return <><p data-testid="rows">{pagination.items.join(',')}</p><ListPagination {...pagination} label="Agent" /></>;
  }
  render(<List />);
  const nav = within(screen.getByRole('navigation', { name: 'Agent分页' }));
  expect(nav.getByRole('button', { name: '上一页' })).toBeDisabled();
  fireEvent.click(nav.getByRole('button', { name: '下一页' }));
  expect(screen.getByTestId('rows')).toHaveTextContent('13,14,15,16,17,18,19,20,21,22,23,24');
  fireEvent.click(nav.getByRole('button', { name: '第 3 页' }));
  expect(nav.getByRole('button', { name: '下一页' })).toBeDisabled();
  expect(nav.getByRole('button', { name: '第 3 页' })).toHaveAttribute('aria-current', 'page');
  fireEvent.click(nav.getByRole('button', { name: '上一页' }));
  expect(nav.getByText('共 31 个Agent · 第 2 / 3 页')).toBeInTheDocument();
});

it('shows a single page explicitly and bounds the numbered controls for large lists', () => {
  const props = { page: 1, totalPages: 1, totalItems: 6, label: '团队', onChange: vi.fn() };
  const { rerender } = render(<ListPagination {...props} />);
  expect(screen.getByText('共 6 个团队 · 第 1 / 1 页')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled();
  rerender(<ListPagination {...props} page={100} totalPages={200} totalItems={2400} />);
  expect(screen.getAllByRole('button')).toHaveLength(7);
  expect(screen.getByRole('button', { name: '第 200 页' })).toBeInTheDocument();
});

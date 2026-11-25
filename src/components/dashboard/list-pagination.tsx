'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

export function useListPagination<T>(items: T[], pageSize: number, resetKey: string) {
  const [state, setState] = useState({ key: resetKey, page: 1 });
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = state.key === resetKey ? Math.min(state.page, totalPages) : 1;
  // Reset filters and clamp removed pages before rendering their rows.
  if (state.key !== resetKey || state.page !== page) setState({ key: resetKey, page });
  return {
    page, totalPages, totalItems: items.length,
    items: items.slice((page - 1) * pageSize, page * pageSize),
    onChange: (next: number) => setState({ key: resetKey, page: Math.min(totalPages, Math.max(1, next)) }),
  };
}

export function ListPagination({ page, totalPages, totalItems, label, onChange }: {
  page: number; totalPages: number; totalItems: number; label: string; onChange: (_page: number) => void;
}) {
  const nav = useRef<HTMLElement>(null);
  const changePage = (next: number) => {
    onChange(next);
    nav.current?.parentElement?.scrollIntoView({ block: 'start' });
  };
  if (totalItems === 0) return null;
  const pages: Array<number | 'ellipsis'> = [];
  for (let current = 1; current <= totalPages; current++) {
    if (current === 1 || current === totalPages || Math.abs(current - page) <= 1) pages.push(current);
    else if (pages.at(-1) !== 'ellipsis') pages.push('ellipsis');
  }
  return <nav ref={nav} aria-label={`${label}分页`} className="flex flex-wrap items-center justify-between gap-3 pt-2">
    <p className="text-xs text-muted-foreground" aria-live="polite">共 {totalItems} 个{label} · 第 {page} / {totalPages} 页</p>
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => changePage(page - 1)}>上一页</Button>
      <div className="hidden items-center gap-1 sm:flex">
        {pages.map((current, index) => current === 'ellipsis' ? <span key={`gap-${index}`} aria-hidden="true" className="px-1 text-xs text-muted-foreground">…</span> :
          <Button key={current} variant={current === page ? 'secondary' : 'outline'} size="sm" className="w-8 px-0" aria-label={`第 ${current} 页`} aria-current={current === page ? 'page' : undefined} onClick={() => changePage(current)}>{current}</Button>)}
      </div>
      <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => changePage(page + 1)}>下一页</Button>
    </div>
  </nav>;
}

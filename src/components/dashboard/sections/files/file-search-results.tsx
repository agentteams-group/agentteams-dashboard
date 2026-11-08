'use client';

import { Download, FolderOpen, Info, MoreHorizontal, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { fmtBytes, fmtTs } from '@/lib/files-model';
import type { HumanFileEntry } from '@/lib/human-files-api';
import {
  SEARCH_RESULT_CAP,
  resultParentPath,
  resultRelPath,
  searchEntryName,
  type RankedSearch,
  type SearchPageState,
} from '@/lib/files-search';
import { FileGlyph } from './file-views';

/** 搜索结果行操作：目录只给「进入 / 详情」，文件给「详情 / 下载 / 删除」
 *（与插件同口径；重命名 / 移动在搜索态不提供，避免跨目录上下文歧义）。 */
export interface SearchRowActions {
  onEnter: (_entry: HumanFileEntry) => void;
  onDetails: (_entry: HumanFileEntry) => void;
  onDownload: (_entry: HumanFileEntry) => void;
  onDelete: (_entry: HumanFileEntry) => void;
}

export interface FileSearchResultsProps {
  ranked: RankedSearch;
  page: SearchPageState;
  /** 去抖 / 首次请求在途（含「已生效但首屏未回」）。 */
  pending: boolean;
  /** 非降级错误文案（降级 = 全局搜索不可用，由页面外层提示）。 */
  error: string;
  loadingMore: boolean;
  selectedPath: string | null;
  actions: SearchRowActions;
  onActivate: (_entry: HumanFileEntry) => void;
  onLoadMore: () => void;
}

function RowActions({ entry, actions }: { entry: HumanFileEntry; actions: SearchRowActions }) {
  const isDir = entry.type === 'directory';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 sm:size-9"
          aria-label={`更多操作 ${searchEntryName(entry)}`}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        {isDir && (
          <DropdownMenuItem onSelect={() => actions.onEnter(entry)}>
            <FolderOpen className="size-4" /> 进入
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => actions.onDetails(entry)}>
          <Info className="size-4" /> 详情
        </DropdownMenuItem>
        {!isDir && (
          <DropdownMenuItem onSelect={() => actions.onDownload(entry)}>
            <Download className="size-4" /> 下载
          </DropdownMenuItem>
        )}
        {!isDir && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => actions.onDelete(entry)}
            >
              <Trash2 className="size-4" /> 删除
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SearchResultRow({
  entry,
  selected,
  actions,
  onActivate,
}: {
  entry: HumanFileEntry;
  selected: boolean;
  actions: SearchRowActions;
  onActivate: (_entry: HumanFileEntry) => void;
}) {
  const path = resultRelPath(entry);
  const name = searchEntryName(entry);
  const isDir = entry.type === 'directory';
  const parent = resultParentPath(entry);
  const meta = [isDir ? '' : fmtBytes(entry.size), fmtTs(entry.updatedAt)]
    .filter((s) => s !== '')
    .join(' · ');
  return (
    <li>
      <div
        data-hf-row
        data-path={path}
        role="button"
        tabIndex={0}
        aria-label={name}
        aria-current={selected ? 'true' : undefined}
        title={path}
        onClick={() => onActivate(entry)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onActivate(entry);
          }
        }}
        className={cn(
          'grid min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          'grid-cols-[minmax(0,1fr)_auto_auto]',
          selected ? 'bg-primary/10' : 'hover:bg-accent/40',
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <FileGlyph entry={entry} />
          <div className="min-w-0">
            <p className="truncate font-medium" title={name}>
              {name}
              {isDir && <span className="text-muted-foreground"> ›</span>}
            </p>
            <p className="truncate text-xs text-muted-foreground" title={parent || '根目录'}>
              {parent === '' ? '根目录' : parent}
            </p>
          </div>
        </div>
        <span className="hidden max-w-[200px] truncate text-xs text-muted-foreground sm:block">
          {meta}
        </span>
        <RowActions entry={entry} actions={actions} />
      </div>
    </li>
  );
}

/** 全局搜索结果区：加载 / 失败 / 空态 / 结果列表 / 200 上限 / 分页提示。 */
export function FileSearchResults({
  ranked,
  page,
  pending,
  error,
  loadingMore,
  selectedPath,
  actions,
  onActivate,
  onLoadMore,
}: FileSearchResultsProps) {
  const empty = !pending && error === '' && ranked.matched === 0;
  return (
    <div className="min-w-0" data-testid="files-search-results">
      {pending && (
        <p className="py-8 text-center text-xs text-muted-foreground" role="status">
          搜索中…
        </p>
      )}
      {!pending && error !== '' && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          搜索失败：{error}
        </div>
      )}
      {empty && (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          没有匹配的文件或文件夹
        </div>
      )}
      {ranked.results.length > 0 && (
        <ul className="divide-y divide-border/50" role="list">
          {ranked.results.map((entry) => {
            const path = resultRelPath(entry);
            return (
              <SearchResultRow
                key={path}
                entry={entry}
                selected={selectedPath === path}
                actions={actions}
                onActivate={onActivate}
              />
            );
          })}
        </ul>
      )}
      {ranked.capped && (
        <p className="px-2 pt-2 text-xs text-muted-foreground">
          仅显示前 {SEARCH_RESULT_CAP} 条，继续输入缩小范围
        </p>
      )}
      {page.hasMore && (
        <div className="flex flex-wrap items-center gap-2 px-2 pt-2">
          <Badge variant="outline" className="text-xs">
            结果基于前 {page.loaded} 项
          </Badge>
          <Button variant="outline" size="sm" className="min-h-11 sm:min-h-9" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? '加载中…' : '加载更多'}
          </Button>
        </div>
      )}
    </div>
  );
}

import { cleanup, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ListView, TreeView, type EntryActions } from './file-views';
import { columnsFor, treeGrid, type FileSort, type FilesColumns, type TreeRow } from '@/lib/files-model';
import type { HumanFileEntry } from '@/lib/human-files-api';

// 回归：treeGrid 曾多生成一条 24px 轨道，而树行把展开箭头放在名称单元格内部，
// 于是名称被压到 24px、大小/类型叠到图标上（罗总截图）。
// 口径：表头 / 树行 / 列表行的单元格数必须等于轨道数，名称落在弹性轨道上。

/** 轨道切分：`minmax(0, 1fr)` 自带空格，不能直接按空格 split。 */
function tracks(grid: string): string[] {
  return grid.match(/minmax\([^)]*\)|\S+/g) ?? [];
}

const SORT: FileSort = { key: 'name', dir: 'asc' };

const dirEntry: HumanFileEntry = { name: 'docs', type: 'directory', size: 0 };
const fileEntry: HumanFileEntry = {
  name: 'readme.md',
  type: 'file',
  size: 2048,
  updatedAt: '2026-11-02T10:00:00Z',
};

const TREE_ROWS: TreeRow[] = [
  { path: 'docs', name: 'docs', depth: 0, isDir: true, expanded: true, entry: dirEntry },
  {
    path: 'docs/readme.md',
    name: 'readme.md',
    depth: 1,
    isDir: false,
    expanded: false,
    entry: fileEntry,
  },
];

function makeActions(): EntryActions {
  return {
    onDetails: vi.fn(),
    onDownload: vi.fn(),
    onRename: vi.fn(),
    onMove: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    editable: () => true,
  };
}

function renderTree(columns: FilesColumns): HTMLElement {
  const { container } = render(
    <TreeView
      rows={TREE_ROWS}
      columns={columns}
      selected={new Set<string>()}
      focusedPath={null}
      onToggleExpand={vi.fn()}
      onRowClick={vi.fn()}
      onToggleSelect={vi.fn()}
      actions={makeActions()}
    />,
  );
  return container;
}

function cellsOf(el: Element): HTMLElement[] {
  return Array.from(el.children) as HTMLElement[];
}

/** 行内 grid-template-columns 的轨道（读渲染结果，不看模型）。 */
function inlineTracks(el: Element): string[] {
  const style = el.getAttribute('style') ?? '';
  const matched = style.match(/grid-template-columns:\s*([^;]+)/);
  return matched ? tracks(matched[1].trim()) : [];
}

afterEach(() => {
  cleanup();
});

describe('树视图轨道与单元格对齐', () => {
  it.each([
    [375, false],
    [375, true],
    [680, true],
    [900, false],
    [900, true],
    [1200, false],
    [1200, true],
  ])('%i 宽（多选=%s）：表头与树行单元格数 == 轨道数', (width, multiSelect) => {
    const columns = columnsFor(width, multiSelect);
    const container = renderTree(columns);
    const trackCount = tracks(treeGrid(columns.columns)).length;

    expect(trackCount).toBe(columns.columns.length);
    expect(cellsOf(screen.getByTestId('files-tree-header'))).toHaveLength(trackCount);

    const rows = Array.from(container.querySelectorAll('[data-hf-row]'));
    expect(rows).toHaveLength(TREE_ROWS.length);
    for (const row of rows) {
      expect(cellsOf(row)).toHaveLength(trackCount);
      expect(inlineTracks(row)).toEqual(tracks(treeGrid(columns.columns)));
    }
  });

  it.each([
    [375, false],
    [1200, true],
  ])('%i 宽（多选=%s）：名称单元格不被 24px 轨道挤压', (width, multiSelect) => {
    const columns = columnsFor(width, multiSelect);
    const container = renderTree(columns);
    const nameIndex = columns.columns.indexOf('name');
    const rowTracks = tracks(treeGrid(columns.columns));

    expect(rowTracks[nameIndex]).toBe('minmax(0, 1fr)');
    expect(rowTracks).not.toContain('24px');

    for (const row of Array.from(container.querySelectorAll('[data-hf-row]'))) {
      const nameCell = cellsOf(row)[nameIndex];
      expect(nameCell.getAttribute('style') ?? '').not.toMatch(/width/);
    }
  });

  it('展开箭头留在名称单元格内部（不单独占轨道）', () => {
    const columns = columnsFor(1200, true);
    const container = renderTree(columns);
    const nameIndex = columns.columns.indexOf('name');
    const rows = Array.from(container.querySelectorAll('[data-hf-row]'));

    const dirCell = cellsOf(rows[0])[nameIndex];
    expect(within(dirCell).getByRole('button', { name: '收起 docs' })).toBeInTheDocument();
    // 名称文本与箭头同格：名称单元格直接承载文件名。
    expect(within(cellsOf(rows[1])[nameIndex]).getByText('readme.md')).toBeInTheDocument();
  });

  it('列表视图轨道与单元格同样一一对应（不受修复影响）', () => {
    const columns = columnsFor(900, true);
    const container = render(
      <ListView
        entries={[dirEntry, fileEntry]}
        dirPath=""
        columns={columns}
        sort={SORT}
        focusedPath={null}
        selected={new Set<string>()}
        onSort={vi.fn()}
        onRowClick={vi.fn()}
        onToggleSelect={vi.fn()}
        onEnterDir={vi.fn()}
        onSelectAll={vi.fn()}
        allState="none"
        actions={makeActions()}
      />,
    ).container;
    const trackCount = tracks(columns.grid).length;

    expect(cellsOf(screen.getByTestId('files-list-header'))).toHaveLength(trackCount);
    for (const row of Array.from(container.querySelectorAll('[data-hf-row]'))) {
      expect(cellsOf(row)).toHaveLength(trackCount);
    }
  });
});

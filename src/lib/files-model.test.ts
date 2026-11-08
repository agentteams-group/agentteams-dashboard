import { describe, expect, it } from 'vitest';
import {
  columnsFor,
  columnsTotal,
  rowClickIntent,
  selectAllState,
  selectedSummary,
  clickSelection,
  pruneSelection,
  clearSelection,
  makeUploadItems,
  startableIds,
  markUploadStatus,
  retryUpload,
  uploadProgress,
  UPLOAD_CONCURRENCY,
  quotaFormToPayload,
  quotaValueToBytes,
  bytesToQuotaInput,
  formatQuotaValue,
  quotaPercent,
  validateRelPath,
  validateFileName,
  renamePath,
  movePath,
  joinRelPath,
  sortFileEntries,
  parseFileSort,
  parseFilesView,
  flattenTree,
  treeKeyNav,
  filesErrorText,
  fmtBytes,
  entryRowPath,
  withDirPaths,
  type FileSort,
} from '@/lib/files-model';
import type { HumanFileEntry } from '@/lib/human-files-api';

const file = (name: string, size = 10, updatedAt = '2026-11-01T00:00:00Z'): HumanFileEntry => ({
  name,
  type: 'file',
  size,
  updatedAt,
});

const dir = (name: string): HumanFileEntry => ({ name, type: 'directory', size: 0 });

describe('列分档（按实测列表宽）', () => {
  it('680 收类型/修改，操作收「更多」', () => {
    const c = columnsFor(680, false);
    expect(c.compactActions).toBe(true);
    expect(c.showSize).toBe(false);
    expect(c.showUpdatedAt).toBe(false);
    expect(c.columns).toEqual(['name', 'more']);
    expect(c.total).toBeLessThanOrEqual(680);
  });

  it('900 显示大小但隐藏类型/修改', () => {
    const c = columnsFor(900, false);
    expect(c.showSize).toBe(true);
    expect(c.showUpdatedAt).toBe(true);
    expect(c.columns).toEqual(['name', 'size', 'type', 'modified', 'actions']);
  });

  it('700–899 只收类型/修改，保留大小与操作', () => {
    const c = columnsFor(760, false);
    expect(c.columns).toEqual(['name', 'size', 'actions']);
    expect(c.compactActions).toBe(false);
  });

  it('多选列插入首位，任何档位总宽不超过实测宽', () => {
    for (const width of [680, 760, 900, 1200]) {
      const c = columnsFor(width, true);
      expect(c.columns[0]).toBe('select');
      expect(c.total).toBeLessThanOrEqual(width);
    }
    expect(columnsTotal(['select', 'name', 'size', 'type', 'modified', 'actions'])).toBeLessThanOrEqual(900);
  });
});

describe('行点击意图：焦点与批量选择分离', () => {
  it('无修饰且未多选 → 只设焦点', () => {
    expect(rowClickIntent({ multiSelect: false, shiftKey: false, toggleKey: false })).toEqual({
      focusOnly: true,
      enterMulti: false,
      toggle: false,
      range: false,
    });
  });

  it('Ctrl/Shift → 自动进入多选', () => {
    expect(rowClickIntent({ multiSelect: false, shiftKey: false, toggleKey: true })).toEqual({
      focusOnly: false,
      enterMulti: true,
      toggle: true,
      range: false,
    });
    expect(rowClickIntent({ multiSelect: false, shiftKey: true, toggleKey: false })).toEqual({
      focusOnly: false,
      enterMulti: true,
      toggle: false,
      range: true,
    });
  });

  it('多选模式普通点击 = 切换', () => {
    expect(rowClickIntent({ multiSelect: true, shiftKey: false, toggleKey: false })).toEqual({
      focusOnly: false,
      enterMulti: false,
      toggle: true,
      range: false,
    });
  });
});

describe('选择集合', () => {
  const paths = ['a', 'b', 'c', 'd'];

  it('Shift 区间并入现有选择', () => {
    const base = new Set(['d']);
    const out = clickSelection(base, 'b', { shiftKey: true, anchor: 'a', paths });
    expect([...out.selected].sort()).toEqual(['a', 'b', 'd']);
    expect(out.anchor).toBe('a');
  });

  it('切目录后剔除已消失的路径（无变化时同引用）', () => {
    const set = new Set(['a', 'b']);
    expect(pruneSelection(set, ['a', 'b', 'c'])).toBe(set);
    expect([...pruneSelection(set, ['b'])]).toEqual(['b']);
  });

  it('全选三态与汇总', () => {
    expect(selectAllState(new Set(), paths)).toBe('none');
    expect(selectAllState(new Set(['a', 'b']), paths)).toBe('some');
    expect(selectAllState(new Set(paths), paths)).toBe('all');
    expect(
      selectedSummary(
        [
          { path: 'a', size: 3 },
          { path: 'b', size: 5 },
        ],
        new Set(['a', 'b']),
      ),
    ).toEqual({ count: 2, bytes: 8 });
    expect([...clearSelection()]).toEqual([]);
  });
});

describe('上传队列', () => {
  it('并发上限 ≤2，完成一项后放行下一项', () => {
    let items = makeUploadItems(
      [
        { name: 'a', size: 1 },
        { name: 'b', size: 1 },
        { name: 'c', size: 1 },
      ],
      'docs',
    );
    expect(startableIds(items)).toHaveLength(UPLOAD_CONCURRENCY);
    for (const id of startableIds(items)) items = markUploadStatus(items, id, 'uploading');
    expect(startableIds(items)).toEqual([]);
    items = markUploadStatus(items, items[0].id, 'success');
    expect(startableIds(items)).toEqual([items[2].id]);
  });

  it('失败重试回到 waiting，并汇总进度', () => {
    let items = makeUploadItems([{ name: 'a', size: 1 }], '');
    const id = items[0].id;
    items = markUploadStatus(items, id, 'failed', '配额已满');
    expect(uploadProgress(items)).toMatchObject({ failed: 1, percent: 100 });
    items = retryUpload(items, id);
    expect(items[0]).toMatchObject({ status: 'waiting', error: undefined });
    items = markUploadStatus(items, id, 'success');
    expect(uploadProgress(items)).toMatchObject({ total: 1, success: 1, percent: 100 });
  });
});

describe('配额（十进制）', () => {
  it('MB/GB 换算，留空=null、0=0', () => {
    expect(quotaValueToBytes(1.5, 'GB')).toBe(1_500_000_000);
    expect(quotaValueToBytes(null, 'MB')).toBeNull();
    expect(quotaValueToBytes(0, 'MB')).toBe(0);
    expect(quotaFormToPayload({ value: 800, unit: 'MB', files: null })).toEqual({
      bytes: 800_000_000,
      files: null,
    });
  });

  it('回显与展示', () => {
    expect(bytesToQuotaInput(1_500_000_000)).toEqual({ value: 1.5, unit: 'GB' });
    expect(bytesToQuotaInput(800_000_000)).toEqual({ value: 800, unit: 'MB' });
    expect(bytesToQuotaInput(null)).toEqual({ value: null, unit: 'MB' });
    expect(formatQuotaValue(1_000_000_000)).toBe('1 GB');
    expect(quotaPercent({ usedBytes: 50, quotaBytes: 100 })).toBe(50);
    expect(quotaPercent({ usedBytes: 50, quotaBytes: null })).toBeNull();
  });
});

describe('路径校验 / 重命名 / 移动', () => {
  it('拒绝绝对路径、../ 与保留名', () => {
    expect(validateRelPath('/etc/passwd')).toEqual({ ok: false, issue: 'absolute' });
    expect(validateRelPath('a/../b')).toEqual({ ok: false, issue: 'dotdot' });
    expect(validateRelPath('a\\b')).toEqual({ ok: false, issue: 'badchar' });
    expect(validateRelPath('con.txt')).toEqual({ ok: false, issue: 'reserved' });
    expect(validateFileName('..')).toEqual({ ok: false, issue: 'empty' });
    expect(validateFileName('ok.txt')).toEqual({ ok: true, path: 'ok.txt' });
  });

  it('重命名同目录、移动禁止进入自身', () => {
    const r = renamePath('docs/a.md', 'b.md');
    expect(r.ok && r.plan).toEqual({ from: 'docs/a.md', to: 'docs/b.md', name: 'b.md' });
    const m = movePath('docs', 'docs/sub', { isDir: true });
    expect(m).toEqual({ ok: false, issue: 'into_self' });
    const ok = movePath('docs/a.md', 'archive');
    expect(ok.ok && ok.plan.to).toBe('archive/a.md');
    expect(joinRelPath('', 'x')).toBe('x');
  });
});

describe('排序 / 视图 / 树', () => {
  const sort: FileSort = { key: 'name', dir: 'asc' };

  it('目录恒在前，名称 numeric 排序', () => {
    const out = sortFileEntries([file('file10'), file('file2'), dir('docs')], sort);
    expect(out.map((e) => e.name)).toEqual(['docs', 'file2', 'file10']);
  });

  it('解析持久化设置', () => {
    expect(parseFileSort('{"key":"size","dir":"desc"}')).toEqual({ key: 'size', dir: 'desc' });
    expect(parseFileSort('bad')).toEqual({ key: 'name', dir: 'asc' });
    expect(parseFilesView('grid')).toBe('grid');
    expect(parseFilesView('x')).toBe('list');
  });

  it('树拍平只在展开时出子层，键盘 ↓/→ 生效', () => {
    const roots = withDirPaths([dir('docs'), file('a.txt')], '');
    const children = new Map<string, HumanFileEntry[]>([['docs', withDirPaths([file('b.txt')], 'docs')]]);
    const collapsed = flattenTree({ roots, children, expanded: new Set() });
    expect(collapsed.map((r) => r.path)).toEqual(['docs', 'a.txt']);
    const open = flattenTree({ roots, children, expanded: new Set(['docs']) });
    expect(open.map((r) => r.path)).toEqual(['docs', 'docs/b.txt', 'a.txt']);
    expect(treeKeyNav({ rows: open, index: 0 }, 'ArrowDown')).toBe(1);
    let toggled = '';
    treeKeyNav({ rows: open, index: 0 }, 'ArrowRight', (p) => (toggled = p));
    expect(toggled).toBe('docs');
  });

  it('行键：老形态按目录拼、新形态用自带 path', () => {
    expect(entryRowPath(file('a.txt'), 'docs')).toBe('docs/a.txt');
    expect(entryRowPath({ ...file('a.txt'), path: 'x/a.txt' }, 'docs')).toBe('x/a.txt');
  });
});

describe('错误文案统一', () => {
  const err = (status: number, code?: string) => ({ status, code });

  it('403/404/409/412/503', () => {
    expect(filesErrorText(err(403))).toBe('无权限');
    expect(filesErrorText(err(404))).toBe('无权限或不存在');
    expect(filesErrorText(err(409))).toBe('目标路径已存在');
    expect(filesErrorText(err(412))).toContain('内容冲突');
    expect(filesErrorText(err(503))).toBe('存储暂不可用，请稍后重试');
    expect(filesErrorText(err(503, 'storage_unavailable'))).toBe('存储暂不可用，请稍后重试');
  });

  it('413 区分 size / quota', () => {
    expect(filesErrorText(err(413, 'size_exceeded'))).toContain('大小超限');
    expect(filesErrorText(err(413, 'quota_exceeded'))).toBe('配额已满');
  });

  it('字节格式化', () => {
    expect(fmtBytes(0)).toBe('0 B');
    expect(fmtBytes(2048)).toBe('2.0 KB');
    expect(fmtBytes(undefined)).toBe('—');
  });
});

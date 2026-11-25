import { describe, expect, it } from 'vitest';
import {
  SEARCH_FETCH_LIMIT,
  SEARCH_RESULT_CAP,
  parseSearchQuery,
  rankSearchResults,
  resultParentPath,
  resultRelPath,
  searchEntriesFromRecursive,
  searchPageState,
} from '@/lib/files-search';
import type { HumanFileEntry } from '@/lib/human-files-api';

const file = (
  path: string,
  size = 10,
  updatedAt = '2026-11-01T00:00:00Z',
): HumanFileEntry => ({
  name: path.split('/').pop() as string,
  type: 'file',
  size,
  updatedAt,
  path,
});

const dir = (path: string): HumanFileEntry => ({
  name: path.split('/').pop() as string,
  type: 'directory',
  size: 0,
  path,
});

describe('搜索输入归一', () => {
  it('空输入 / 单字符只提示，≥2 字符才生效', () => {
    expect(parseSearchQuery('')).toMatchObject({ raw: '', active: false, tooShort: false });
    expect(parseSearchQuery('a')).toMatchObject({
      display: 'a',
      term: 'a',
      tooShort: true,
      active: false,
    });
    expect(parseSearchQuery('  ')).toMatchObject({ display: '', active: false, tooShort: false });
    expect(parseSearchQuery(undefined)).toMatchObject({ raw: '', active: false });
  });

  it('trim + 大小写 / 中文归一', () => {
    expect(parseSearchQuery('  AB  ')).toMatchObject({
      raw: '  AB  ',
      display: 'AB',
      term: 'ab',
      active: true,
      tooShort: false,
    });
    expect(parseSearchQuery(' 报告 ').term).toBe('报告');
  });
});

describe('过滤 + 排序', () => {
  it('未达最小长度不带出任何结果', () => {
    const entries = [file('report.md')];
    expect(rankSearchResults(entries, 'r')).toEqual({ results: [], matched: 0, capped: false });
    expect(rankSearchResults(entries, '')).toEqual({ results: [], matched: 0, capped: false });
  });

  it('名称前缀 > 名称包含 > 路径包含（大小写不敏感）', () => {
    const entries = [
      file('notes/report/data.csv'),
      file('docs/my-report.txt'),
      file('report.md'),
      dir('reports'),
    ];
    const out = rankSearchResults(entries, 'report').results.map(resultRelPath);
    expect(out).toEqual([
      'reports',
      'report.md',
      'docs/my-report.txt',
      'notes/report/data.csv',
    ]);
    // 大小写不敏感：大写名称同样命中名称前缀层级。
    expect(rankSearchResults([file('misc/REPORT.md')], 'report').results).toHaveLength(1);
  });

  it('仅路径命中排在最后', () => {
    const entries = [file('archive/notes/data.csv'), file('notes.txt')];
    const out = rankSearchResults(entries, 'notes').results.map(resultRelPath);
    expect(out).toEqual(['notes.txt', 'archive/notes/data.csv']);
  });

  it('同组目录优先，名称 numeric 升序', () => {
    const entries = [file('alpine.txt'), dir('alpha')];
    expect(rankSearchResults(entries, 'al').results.map(resultRelPath)).toEqual([
      'alpha',
      'alpine.txt',
    ]);
    const numeric = [file('file10.txt'), file('file2.txt')];
    expect(rankSearchResults(numeric, 'file').results.map(resultRelPath)).toEqual([
      'file2.txt',
      'file10.txt',
    ]);
  });

  it('无匹配 → 空结果', () => {
    expect(rankSearchResults([file('a.txt'), dir('docs')], 'zzz')).toEqual({
      results: [],
      matched: 0,
      capped: false,
    });
  });

  it('最多展示 200 条，matched 计全量', () => {
    const many = Array.from({ length: 250 }, (_, i) => file(`match-${i}.txt`));
    const capped = rankSearchResults(many, 'match');
    expect(capped.results).toHaveLength(SEARCH_RESULT_CAP);
    expect(capped.matched).toBe(250);
    expect(capped.capped).toBe(true);

    const exact = rankSearchResults(many.slice(0, SEARCH_RESULT_CAP), 'match');
    expect(exact.capped).toBe(false);
    expect(exact.results).toHaveLength(SEARCH_RESULT_CAP);
  });
});

describe('分页状态与结果路径', () => {
  it('首屏 1000 项 + nextKey 才显示加载更多', () => {
    const full = Array.from({ length: SEARCH_FETCH_LIMIT }, (_, i) => file(`f-${i}.txt`));
    expect(
      searchPageState({ entries: full, nextKey: 'cursor-1', limit: SEARCH_FETCH_LIMIT }),
    ).toEqual({ loaded: SEARCH_FETCH_LIMIT, limit: SEARCH_FETCH_LIMIT, hasMore: true, atLimit: true });

    expect(searchPageState({ entries: [file('a.txt')], nextKey: null })).toMatchObject({
      loaded: 1,
      hasMore: false,
      atLimit: false,
    });
    expect(searchPageState({ entries: [], nextKey: undefined }).hasMore).toBe(false);
  });

  it('相对路径 / 父目录（根层为空串）', () => {
    expect(resultRelPath(file('docs/a.txt'))).toBe('docs/a.txt');
    expect(resultParentPath(file('docs/a.txt'))).toBe('docs');
    expect(resultParentPath(file('a.txt'))).toBe('');
    expect(resultParentPath(dir('docs/sub'))).toBe('docs');
  });
});

describe('递归平铺 → 搜索条目', () => {
  it('文件原样 + 由路径派生的目录（去重、逐级补祖先）', () => {
    const out = searchEntriesFromRecursive([
      { path: 'docs/a/report.md', size: 12 },
      { path: 'docs/b/notes.txt', size: 3 },
      { path: 'top.txt', size: 1 },
    ]);
    const files = out.filter((e) => e.type === 'file').map((e) => e.path);
    expect(files).toEqual(['docs/a/report.md', 'docs/b/notes.txt', 'top.txt']);
    const dirs = out.filter((e) => e.type === 'directory').map((e) => e.path);
    expect(dirs.sort()).toEqual(['docs', 'docs/a', 'docs/b']);
    expect(out.find((e) => e.path === 'docs/a')?.name).toBe('a');
  });

  it('空路径 / 尾斜杠归一后不产生空条目', () => {
    const out = searchEntriesFromRecursive([
      { path: 'docs/keep.txt/', size: 1 },
      { path: '', size: 1 },
    ]);
    expect(out.map((e) => e.path).sort()).toEqual(['docs', 'docs/keep.txt']);
  });
});

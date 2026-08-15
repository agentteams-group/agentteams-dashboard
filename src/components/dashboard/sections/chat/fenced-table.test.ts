import { describe, expect, it } from 'vitest';
import { isGfmTableContent, unwrapFencedTables, convertFencedTablesInHtml } from './fenced-table';

describe('isGfmTableContent', () => {
  it('accepts a header + separator + rows', () => {
    expect(isGfmTableContent('| a | b |\n| --- | --- |\n| 1 | 2 |')).toBe(true);
  });

  it('accepts alignment markers and ragged pipes', () => {
    expect(isGfmTableContent('| a | b |\n|:--|--:|\n| 1 | 2 |')).toBe(true);
    expect(isGfmTableContent('a | b\n--- | ---\n1 | 2')).toBe(true);
  });

  it('accepts a header-only table', () => {
    expect(isGfmTableContent('| a | b |\n| --- | --- |')).toBe(true);
  });

  it('rejects plain code and non-table text', () => {
    expect(isGfmTableContent('const a = 1;')).toBe(false);
    expect(isGfmTableContent('说明文字\n| --- | --- |\n| 1 | 2 |')).toBe(false);
    expect(isGfmTableContent('| a | b |\nno separator\n| 1 | 2 |')).toBe(false);
  });
});

describe('unwrapFencedTables (plain body)', () => {
  it('unwraps a fenced GFM table so remark-gfm can render it', () => {
    const text = ['前文', '', '```', '| 维度 | 状态 |', '| ----- | --- |', '| 任务 | 0 |', '```', '', '后文'].join('\n');
    const out = unwrapFencedTables(text);
    expect(out).toContain('前文');
    expect(out).toContain('| 维度 | 状态 |');
    expect(out).not.toContain('```');
    expect(out).toContain('后文');
  });

  it('keeps ordinary code fences intact', () => {
    const text = '```js\nconst a = 1;\n```';
    expect(unwrapFencedTables(text)).toBe(text);
  });
});

describe('convertFencedTablesInHtml (formatted_body)', () => {
  it('converts <pre><code> GFM tables to real table markup', () => {
    const html = [
      '<p>🎯 任务与项目</p>',
      '<pre><code>| 维度    | 状态 |',
      '| ----- | --- |',
      '| 进行中任务 | 0  |',
      '</code></pre>',
    ].join('\n');
    const out = convertFencedTablesInHtml(html);
    expect(out).toContain('<table><thead><tr><th>维度</th><th>状态</th></tr></thead>');
    expect(out).toContain('<td>进行中任务</td>');
    expect(out).not.toContain('<pre><code>');
  });

  it('decodes entities in cells and re-escapes them safely', () => {
    const html = '<pre><code>| 名称 | 备注 |\n| --- | --- |\n| a&lt;b | x &amp; y |\n</code></pre>';
    const out = convertFencedTablesInHtml(html);
    expect(out).toContain('<th>名称</th>');
    expect(out).toContain('<td>a&lt;b</td>');
    expect(out).toContain('<td>x &amp; y</td>');
  });

  it('keeps real code blocks untouched', () => {
    const html = '<pre><code class="language-js">const a = 1;\n</code></pre>';
    expect(convertFencedTablesInHtml(html)).toBe(html);
  });

  it('keeps existing real tables untouched', () => {
    const html = '<table><thead><tr><th>a</th></tr></thead></table>';
    expect(convertFencedTablesInHtml(html)).toBe(html);
  });
});

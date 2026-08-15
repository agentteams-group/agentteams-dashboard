/**
 * Fenced-table extraction.
 *
 * Some runtimes (e.g. the manager status reporter) wrap GFM pipe tables in
 * code fences (```/``` or <pre><code>). Markdown intentionally renders fenced
 * content as literal code, so those tables show up as raw pipes. These helpers
 * detect fenced blocks whose content is exactly one GFM table and convert them
 * back into renderable form:
 *
 *  - unwrapFencedTables: plain-body path — strips the ``` fence so remark-gfm
 *    builds the table itself.
 *  - convertFencedTablesInHtml: formatted_body path — replaces the
 *    <pre><code> block with real <table> markup (entities re-escaped).
 */

const SEPARATOR_ROW = /^\s*\|?(?:\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?\s*$/;

/** Splits a GFM row into trimmed cells (backslash-escaped pipes honored). */
function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

/** Whether the text is exactly one GFM table (header + separator [+ rows])). */
export function isGfmTableContent(text: string): boolean {
  const lines = text.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return false;
  if (!lines[0].includes('|')) return false;
  if (!SEPARATOR_ROW.test(lines[1])) return false;
  return lines.slice(2).every((l) => l.includes('|'));
}

/** Plain-body path: unwrap ``` fences whose content is a pure GFM table. */
export function unwrapFencedTables(text: string): string {
  return text.replace(/```[^\n]*\n([\s\S]*?)```/g, (whole, inner: string) =>
    isGfmTableContent(inner) ? inner.trimEnd() : whole
  );
}

function escapeCell(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Builds real <table> markup from GFM table lines (cells HTML-escaped). */
function buildTableHtml(md: string): string {
  const lines = md.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  const header = splitRow(lines[0]);
  const thead = `<thead><tr>${header
    .map((cell) => `<th>${escapeCell(cell)}</th>`)
    .join('')}</tr></thead>`;
  const bodyRows = lines.slice(2).map((line) => {
    const cells = splitRow(line);
    // Pad/truncate to header width so a ragged row still renders.
    while (cells.length < header.length) cells.push('');
    return `<tr>${header
      .map((_, i) => `<td>${escapeCell(cells[i] ?? '')}</td>`)
      .join('')}</tr>`;
  });
  const tbody = bodyRows.length ? `<tbody>${bodyRows.join('')}</tbody>` : '';
  return `<table>${thead}${tbody}</table>`;
}

/** formatted_body path: convert <pre><code> GFM tables into real tables. */
export function convertFencedTablesInHtml(html: string): string {
  return html.replace(
    /<pre><code(?:\s[^>]*)?>([\s\S]*?)<\/code><\/pre>/g,
    (whole, inner: string) => {
      const decoded = decodeEntities(inner).replace(/\n$/, '');
      return isGfmTableContent(decoded) ? buildTableHtml(decoded) : whole;
    }
  );
}

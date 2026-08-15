import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MarkdownMessage } from './markdown-message';

vi.mock('./mermaid-renderer', () => ({
  MermaidRenderer: () => null,
}));

describe('MarkdownMessage', () => {
  it('renders plain text through markdown', () => {
    render(<MarkdownMessage content="hello **world**" />);

    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === 'hello world')).toBeInTheDocument();
  });

  it('renders a code fence as a highlighted code block', () => {
    const { container } = render(<MarkdownMessage content={'```js\nconst a = 1;\n```'} />);

    expect(container.querySelector('pre code')).not.toBeNull();
  });

  it('streaming + plain text uses the lightweight pre path with a cursor', () => {
    const { container } = render(<MarkdownMessage content="正在生成答案" isStreaming />);

    expect(container.querySelector('pre.whitespace-pre-wrap')).toBeInTheDocument();
    expect(screen.getByText('正在生成答案')).toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('streaming + block-level features keeps the full markdown renderer', () => {
    const { container } = render(
      <MarkdownMessage content={'```js\nconst a = 1;\n```'} isStreaming />
    );

    expect(container.querySelector('pre.whitespace-pre-wrap')).not.toBeInTheDocument();
    expect(container.querySelector('pre code')).not.toBeNull();
  });

  it('renders a GFM table', () => {
    const { container } = render(
      <MarkdownMessage content={"| 列1 | 列2 |\n| --- | --- |\n| A | B |"} />
    );

    const table = container.querySelector('table');
    expect(table).toBeInTheDocument();
    expect(screen.getByText('列1')).toBeInTheDocument();
    expect(screen.getByText('列2')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('adds table styling to HTML formatted content', () => {
    const { container } = render(
      <MarkdownMessage
        content="| 列1 | 列2 |\n| --- | --- |\n| A | B |"
        formattedContent="<table><thead><tr><th>列1</th><th>列2</th></tr></thead><tbody><tr><td>A</td><td>B</td></tr></tbody></table>"
      />
    );

    // HTML formatted content takes precedence and should have table styling
    const table = container.querySelector('.matrix-message-content table');
    expect(table).toBeInTheDocument();
    expect(table?.className).toContain('border-collapse');
    expect(table?.className).toContain('border');
    
    // Check that the HTML content is rendered (not parsed as markdown)
    const htmlContent = table?.innerHTML || '';
    expect(htmlContent).toContain('列1');
    expect(htmlContent).toContain('列2');
    expect(htmlContent).toContain('A');
    expect(htmlContent).toContain('B');
  });
});

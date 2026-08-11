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
});

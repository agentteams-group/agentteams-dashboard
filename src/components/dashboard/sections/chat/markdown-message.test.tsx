import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MarkdownMessage } from './markdown-message';

vi.mock('./mermaid-renderer', () => ({
  MermaidRenderer: () => null,
}));

describe('MarkdownMessage custom blocks', () => {
  it('renders a card fenced in formatted content as a card', () => {
    const content = '前缀\n```card\n{"title":"部署状态","content":"服务正常"}\n```\n后缀';

    render(<MarkdownMessage content={content} formattedContent={content} />);

    expect(screen.getByText('部署状态')).toBeInTheDocument();
    expect(screen.getByText('服务正常')).toBeInTheDocument();
  });
});

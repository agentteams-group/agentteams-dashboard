import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { DragDropOverlay } from './DragDropOverlay';

describe('DragDropOverlay', () => {
  it('renders nothing when inactive', () => {
    const { container } = render(<DragDropOverlay active={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the overlay with default label when active', () => {
    render(<DragDropOverlay active />);
    expect(screen.getByTestId('chat-drop-overlay')).toBeInTheDocument();
    expect(screen.getByText('拖入文件以上传')).toBeInTheDocument();
  });

  it('accepts a custom label', () => {
    render(<DragDropOverlay active label="Drop to upload" />);
    expect(screen.getByText('Drop to upload')).toBeInTheDocument();
  });
});
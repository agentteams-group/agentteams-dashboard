import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { FileDetailCard } from './file-detail';

vi.mock('@/components/dashboard/document-preview', () => ({
  DocumentPreview: ({ url, filename }: { url: string; filename: string }) => <div data-testid="slides" data-url={url}>分页预览 {filename}</div>,
}));

afterEach(cleanup);

describe('FileDetailCard document preview', () => {
  it.each(['pdf', 'pptx', 'ppt'])('opens a personal %s file with its scoped download URL', async (extension) => {
    const action = vi.fn();
    render(<FileDetailCard
      humanName="alice" entry={{ name: `report.${extension}`, type: 'file', size: 1024 }}
      path={`docs/report.${extension}`} dirPath="docs" canAdmin={false}
      onClose={action} onDownload={action} onRename={action} onMove={action}
      onEdit={action} onDelete={action} onOpenDir={action}
    />);
    const preview = screen.getByRole('button', { name: '预览' });
    expect(preview).toBeEnabled();
    fireEvent.click(preview);
    expect(await screen.findByTestId('slides')).toHaveAttribute('data-url', `/api/agentteams/humans/alice/files/docs/report.${extension}`);
  });
});

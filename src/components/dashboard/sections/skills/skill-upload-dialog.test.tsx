import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SkillUploadDialog } from './skill-upload-dialog';

const mockMutateAsync = vi.fn();

vi.mock('@/hooks/use-skill-center', () => ({
  useCreateSkill: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    reset: vi.fn(),
    data: null,
    variables: null,
    isIdle: true,
    status: 'idle' as const,
    failedStatement: null,
    retry: vi.fn(),
    resetFailedStatement: vi.fn(),
    mutate: vi.fn(),
    context: null,
    failureCount: 0,
    failureReason: null,
    isPaused: false,
  }),
}));

vi.mock('@/lib/skill-package', () => ({
  parseSkillPackage: vi.fn().mockReturnValue({
    skillName: 'test-skill',
    description: 'A test skill',
    files: [],
  }),
}));

describe('SkillUploadDialog', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders title when open', () => {
    render(<SkillUploadDialog open onOpenChange={() => {}} />);
    expect(screen.getByText('上传技能包')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    const { container } = render(<SkillUploadDialog open={false} onOpenChange={() => {}} />);
    expect(container.textContent).toBe('');
  });

  it('disables upload button when no file selected', () => {
    render(<SkillUploadDialog open onOpenChange={() => {}} />);
    const uploadBtn = screen.getByRole('button', { name: '上传' });
    expect(uploadBtn).toBeDisabled();
  });

  it('enables upload button after file and preview are ready', async () => {
    mockMutateAsync.mockResolvedValue({ name: 'test-skill', description: 'Test', source: 'custom' });

    render(<SkillUploadDialog open onOpenChange={() => {}} />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const mockFile = new File(['test'], 'test.zip', { type: 'application/zip' });
    fireEvent.change(fileInput, { target: { files: [mockFile] } });

    const parseBtn = screen.getByRole('button', { name: '解析预览' });
    fireEvent.click(parseBtn);

    await waitFor(() => {
      const uploadBtn = screen.getByRole('button', { name: '上传' });
      expect(uploadBtn).not.toBeDisabled();
    });
  });

  it('calls onSuccess callback when upload succeeds', async () => {
    const onSuccess = vi.fn();
    mockMutateAsync.mockResolvedValue({ name: 'test-skill', description: 'Test', source: 'custom' });

    render(<SkillUploadDialog open onOpenChange={() => {}} onSuccess={onSuccess} />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const mockFile = new File(['test'], 'test.zip', { type: 'application/zip' });
    fireEvent.change(fileInput, { target: { files: [mockFile] } });

    const parseBtn = screen.getByRole('button', { name: '解析预览' });
    fireEvent.click(parseBtn);

    await waitFor(() => {
      const uploadBtn = screen.getByRole('button', { name: '上传' });
      expect(uploadBtn).not.toBeDisabled();
    });

    const uploadBtn = screen.getByRole('button', { name: '上传' });
    fireEvent.click(uploadBtn);

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledOnce();
    });
  });
});

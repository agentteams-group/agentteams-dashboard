import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { FileRefPickerDialog } from './FileRefPickerDialog';

vi.mock('./PersonalFilePicker', () => ({ PersonalFilePicker: ({ onSend, onDone }: { onSend: (_file: File) => void; onDone: () => void }) => <button onClick={() => { onSend(new File(['hello'], 'personal.txt')); onDone(); }}>发送个人附件</button> }));
vi.mock('@/hooks/use-agentteams-storage', () => ({ useWorkerFiles: () => ({ data: [{ key: 'work.txt', size: 5, isPrefix: false }], isLoading: false }), useTeamFiles: () => ({ data: [], isLoading: false }) }));
afterEach(cleanup);
it('keeps personal attachments separate from workspace references', () => {
  const send = vi.fn();
  const refs = vi.fn();
  const close = vi.fn();
  render(<FileRefPickerDialog open onOpenChange={close} kind="worker" ownerName="worker" onConfirm={refs} onSendPersonalFile={send} />);
  expect(screen.getByRole('button', { name: '我的文件' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: '工作空间' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'work.txt' }));
  fireEvent.click(screen.getByRole('button', { name: '插入引用' }));
  expect(refs).toHaveBeenCalledWith([{ name: 'work.txt', key: 'work.txt', size: 5 }]);
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '我的文件' }));
  fireEvent.click(screen.getByRole('button', { name: '发送个人附件' }));
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ name: 'personal.txt' }));
  expect(close).toHaveBeenCalledWith(false);
});
it('offers personal files even when no worker or team space is available', () => {
  render(<FileRefPickerDialog open onOpenChange={vi.fn()} kind="worker" ownerName="" onConfirm={vi.fn()} onSendPersonalFile={vi.fn()} />);
  expect(screen.getByRole('button', { name: '我的文件' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '工作空间' })).toBeNull();
});

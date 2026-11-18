import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { agentteamsApi, type HumanResponse } from '@/lib/agentteams-api';
import { HumanPasswordResetDialog } from './human-password-reset-dialog';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('requires a matching password for the named user and closes on success', async () => {
  const reset = vi.spyOn(agentteamsApi, 'resetHumanPassword').mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(<QueryClientProvider client={new QueryClient()}>
    <HumanPasswordResetDialog human={{ name: 'alice' } as HumanResponse} onClose={onClose} />
  </QueryClientProvider>);
  expect(screen.getByText(/为 alice 设置新密码/)).toBeVisible();
  const submit = screen.getByRole('button', { name: '重置密码' });
  fireEvent.change(screen.getByLabelText('新密码'), { target: { value: '1234' } });
  fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: '1234' } });
  expect(submit).toBeEnabled();
  expect(screen.getByText('已输入 4 个字符，需要 8–128 个字符')).toBeVisible();
  fireEvent.click(submit);
  expect(reset).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'testing only' } });
  fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'mismatched' } });
  expect(screen.getByText('两次输入的密码不一致')).toBeVisible();
  fireEvent.click(submit);
  expect(reset).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'testing only' } });
  fireEvent.click(submit);
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(reset).toHaveBeenCalledExactlyOnceWith('alice', 'testing only');
});

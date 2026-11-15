import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkerEnvEditor, validateEnvRows } from './worker-env-editor';
import { TooltipProvider } from '@/components/ui/tooltip';

afterEach(cleanup);
it('preserves literal values and sends an empty object when removing the final variable', () => {
  const change = vi.fn();
  render(<TooltipProvider><WorkerEnvEditor value={{ TOKEN: ' space\n$literal ' }} onChange={change} onValidityChange={vi.fn()} /></TooltipProvider>);
  expect(screen.getByLabelText('环境变量说明')).toBeTruthy();
  expect((screen.getByLabelText('变量值 1') as HTMLTextAreaElement).value).toBe(' space\n$literal ');
  fireEvent.change(screen.getByLabelText('变量值 1'), { target: { value: '' } });
  expect(change).toHaveBeenLastCalledWith({ TOKEN: '' });
  fireEvent.click(screen.getByText('删除'));
  expect(change).toHaveBeenLastCalledWith({});
});
it('rejects duplicate and invalid names without emitting a lossy map', () => {
  expect(validateEnvRows([['A', '1'], ['A', '2']])).toBeTruthy();
  expect(validateEnvRows([['A=B', '1']])).toBeTruthy();
  const change = vi.fn(); const valid = vi.fn();
  render(<TooltipProvider><WorkerEnvEditor value={{ A: 'one', B: 'two' }} onChange={change} onValidityChange={valid} /></TooltipProvider>);
  fireEvent.change(screen.getByLabelText('变量名 2'), { target: { value: 'A' } });
  expect(valid).toHaveBeenLastCalledWith(false);
  expect(change).not.toHaveBeenCalled();
});

it('uses the Manager lifecycle description when reused by assistant settings', () => {
  render(<TooltipProvider><WorkerEnvEditor resource="Manager" value={{ API_KEY: '' }} onChange={vi.fn()} onValidityChange={vi.fn()} /></TooltipProvider>);
  expect(screen.getByText('修改环境变量会重建托管 Manager 容器，可能中断当前任务。')).toBeTruthy();
  expect(screen.queryByText(/修改环境变量会重建托管 Worker/)).toBeNull();
  expect(screen.getByPlaceholderText('变量名，如 API_KEY')).toBeTruthy();
});

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkerEnvEditor, validateEnvRows } from './worker-env-editor';

afterEach(cleanup);
it('preserves literal values and sends an empty object when removing the final variable', () => {
  const change = vi.fn();
  render(<WorkerEnvEditor value={{ TOKEN: ' space\n$literal ' }} onChange={change} onValidityChange={vi.fn()} />);
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
  render(<WorkerEnvEditor value={{ A: 'one', B: 'two' }} onChange={change} onValidityChange={valid} />);
  fireEvent.change(screen.getByLabelText('变量名 2'), { target: { value: 'A' } });
  expect(valid).toHaveBeenLastCalledWith(false);
  expect(change).not.toHaveBeenCalled();
});

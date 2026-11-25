import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { WorkerRuntimeHandoff } from './worker-runtime-handoff';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('shows the target failure and allows selecting a replacement runtime', async () => {
  const failure = 'Container ran out of memory (OOMKilled).';
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    kind: 'WorkerRuntimeState',
    schema_version: 1,
    handoff: { id: 'switch-1', phase: 'creating', source: { runtime: 'hermes' }, target_runtime: 'openclaw' },
    target_failure: failure,
  })));

  render(<WorkerRuntimeHandoff name="alice" runtime="hermes" />);

  expect(await screen.findByRole('alert')).toHaveTextContent(failure);
  expect(screen.getByRole('status')).toHaveTextContent('正在创建目标实例');
  expect(screen.getByRole('combobox')).toBeEnabled();
});

it('keeps runtime selection disabled while a healthy handoff is in progress', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    kind: 'WorkerRuntimeState', schema_version: 1,
    handoff: { id: 'switch-1', phase: 'creating', source: { runtime: 'hermes' }, target_runtime: 'openclaw' },
  })));
  render(<WorkerRuntimeHandoff name="alice" runtime="hermes" />);
  expect(await screen.findByRole('status')).toHaveTextContent('正在创建目标实例');
  expect(screen.getByRole('combobox')).toBeDisabled();
});

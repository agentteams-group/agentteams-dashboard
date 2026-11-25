import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { OverflowText } from './overflow-text';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('reveals clipped text on keyboard focus and closes with Escape', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const text = '很长的模型名称'.repeat(20);
  render(<TooltipProvider><OverflowText text={text} /></TooltipProvider>);
  const summary = screen.getByText(text);
  Object.defineProperties(summary, { scrollWidth: { value: 800 }, clientWidth: { value: 120 } });
  fireEvent.focus(summary);
  expect(await screen.findByRole('tooltip')).toHaveTextContent(text);
  fireEvent.keyDown(summary, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
});

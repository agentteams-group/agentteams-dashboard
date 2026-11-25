import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { ModelProbeAllowlistPrompt } from './model-probe-allowlist-prompt';
const policy = { allowedHosts: ['existing.local'], allowPrivateNetwork: false, revision: '7', source: 'persistent' };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('blocked model allowlist confirmation', () => {
 it('does not read or change policy until the user confirms, and cancellation does not retry', () => {
  const fetch = vi.fn(); const retry = vi.fn(); vi.stubGlobal('fetch', fetch);
  render(<ModelProbeAllowlistPrompt host="172.16.50.89" onRetry={retry} />);
  expect(screen.getByRole('alertdialog')).toHaveTextContent('172.16.50.89'); expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '取消' })); expect(fetch).not.toHaveBeenCalled(); expect(retry).not.toHaveBeenCalled();
 });
 it('appends only the confirmed host to the latest policy, preserves other settings and retries once after saving', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(policy)).mockResolvedValueOnce(Response.json({ ...policy, allowedHosts: [...policy.allowedHosts,'172.16.50.89'], revision: '8' })); const retry = vi.fn(); vi.stubGlobal('fetch', fetch);
  render(<ModelProbeAllowlistPrompt host="172.16.50.89" onRetry={retry} />);
  fireEvent.click(screen.getByRole('button', { name: '加入并重试' }));
  await waitFor(() => expect(retry).toHaveBeenCalledOnce());
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ allowedHosts: ['existing.local','172.16.50.89'], allowPrivateNetwork: false, revision: '7' });
 });
 it('retries without rewriting when another administrator has already approved the host', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ ...policy, allowedHosts: ['172.16.50.89'] })); const retry = vi.fn(); vi.stubGlobal('fetch', fetch);
  render(<ModelProbeAllowlistPrompt host="172.16.50.89" onRetry={retry} />); fireEvent.click(screen.getByRole('button', { name: '加入并重试' }));
  await waitFor(() => expect(retry).toHaveBeenCalledOnce()); expect(fetch).toHaveBeenCalledTimes(1);
 });
 it.each([403,409,503])('keeps the confirmation open and does not retry the model if saving fails: %s', async status => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(policy)).mockResolvedValueOnce(Response.json({ error: 'save denied' }, { status })); const retry = vi.fn(); vi.stubGlobal('fetch', fetch);
  render(<ModelProbeAllowlistPrompt host="172.16.50.89" onRetry={retry} />); fireEvent.click(screen.getByRole('button', { name: '加入并重试' }));
  await screen.findByRole('alert'); expect(screen.getByRole('alertdialog')).toBeInTheDocument(); expect(retry).not.toHaveBeenCalled();
 });
});

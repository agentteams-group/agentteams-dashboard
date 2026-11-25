import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { ModelProbePolicySettings } from './model-probe-policy-settings';
const initial = { allowedHosts: ['172.16.50.89'], allowPrivateNetwork: false, revision: '1', source: 'persistent' };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('ModelProbePolicySettings', () => {
 it('loads persisted hosts, saves a replacement list and uses the new revision for the next edit', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(initial)).mockResolvedValueOnce(Response.json({ ...initial, allowedHosts: ['gpu.local','172.16.50.90'], revision: '2' })).mockResolvedValueOnce(Response.json({ ...initial, allowedHosts: [], revision: '3' }));
  vi.stubGlobal('fetch', fetch); render(<ModelProbePolicySettings />);
  const hosts = await screen.findByRole('textbox', { name: '允许访问的内网主机' });
  await waitFor(() => expect(hosts).toHaveValue('172.16.50.89'));
  fireEvent.change(hosts, { target: { value: 'gpu.local\n172.16.50.90' } });
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  await screen.findByText('配置已保存，后续测试立即生效。');
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ allowedHosts: ['gpu.local','172.16.50.90'], allowPrivateNetwork: false, revision: '1' });
  fireEvent.change(hosts, { target: { value: '' } }); fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ allowedHosts: [], allowPrivateNetwork: false, revision: '2' });
 });
 it('keeps the draft on conflict and requires an explicit reload before saving again', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(initial)).mockResolvedValueOnce(Response.json({ error: 'changed' }, { status: 409 })).mockResolvedValueOnce(Response.json({ ...initial, allowedHosts: ['other.local'], revision: '2' }));
  vi.stubGlobal('fetch', fetch); render(<ModelProbePolicySettings />);
  const hosts = await screen.findByRole('textbox', { name: '允许访问的内网主机' }); await waitFor(() => expect(hosts).toHaveValue('172.16.50.89'));
  fireEvent.change(hosts, { target: { value: 'my.local' } }); fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('重新加载'); expect(hosts).toHaveValue('my.local'); expect(screen.getByRole('button', { name: '保存配置' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '重新加载' })); await waitFor(() => expect(hosts).toHaveValue('other.local'));
 });
 it('preserves the legacy broad-private default and retains the draft when a save fails', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ ...initial, allowedHosts: [], allowPrivateNetwork: true, revision: '', source: 'environment' })).mockResolvedValueOnce(Response.json({ error: 'storage unavailable' }, { status: 503 }));
  vi.stubGlobal('fetch', fetch); render(<ModelProbePolicySettings />);
  const hosts = await screen.findByRole('textbox', { name: '允许访问的内网主机' }); await waitFor(() => expect(hosts).toBeEnabled());
  const toggle = screen.getByRole('switch', { name: '允许所有内网地址' }); expect(toggle).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(toggle); fireEvent.change(hosts, { target: { value: 'gpu.local' } }); fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('storage unavailable'); expect(hosts).toHaveValue('gpu.local'); expect(screen.queryByText('配置已保存，后续测试立即生效。')).toBeNull();
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ allowedHosts: ['gpu.local'], allowPrivateNetwork: false, revision: '' });
 });
 it('refreshes when the tab is revisited and preserves a dirty draft if another operation changed the policy', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(initial)).mockResolvedValueOnce(Response.json({ ...initial, allowedHosts: ['approved.local'], revision: '2' })).mockResolvedValueOnce(Response.json({ ...initial, allowedHosts: ['another.local'], revision: '3' }));
  vi.stubGlobal('fetch', fetch); const { rerender } = render(<ModelProbePolicySettings active />);
  const hosts = await screen.findByRole('textbox', { name: '允许访问的内网主机' }); await waitFor(() => expect(hosts).toHaveValue('172.16.50.89'));
  rerender(<ModelProbePolicySettings active={false} />); rerender(<ModelProbePolicySettings active />); await waitFor(() => expect(hosts).toHaveValue('approved.local'));
  fireEvent.change(hosts, { target: { value: 'unsaved.local' } }); rerender(<ModelProbePolicySettings active={false} />); rerender(<ModelProbePolicySettings active />);
  expect(await screen.findByRole('alert')).toHaveTextContent('草稿已保留'); expect(hosts).toHaveValue('unsaved.local'); expect(screen.getByRole('button', { name: '保存配置' })).toBeDisabled();
 });
 it.each([404,503])('does not offer a local substitute when Controller configuration is unavailable: %s', async status => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'unavailable' }, { status })));
  render(<ModelProbePolicySettings />);
  expect(await screen.findByRole('alert')).toBeInTheDocument(); expect(screen.getByRole('button', { name: '保存配置' })).toBeDisabled();
 });
});

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { AssistantReminderSettings } from './assistant-reminder-settings';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const view = { owner: 'current-leader', revision: 'r1', roomId: '!assistant', context: { enabled: true, everySeconds: 86400 } };

it('loads only when opened and saves the exact revision without changing private notes', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(view)).mockResolvedValueOnce(Response.json({ ...view, revision: 'r2' }));
  vi.stubGlobal('fetch', fetch);
  render(<AssistantReminderSettings team="research" roomId="!assistant" />);
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '提醒设置' }));
  const toggle = await screen.findByRole('switch', { name: '定时提醒' });
  expect(toggle).toBeChecked();
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(fetch.mock.calls[0][0]).toContain('team=research');
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ owner: 'current-leader', revision: 'r1', enabled: false, everySeconds: 86400 });
});

it('uses the current human session for a Manager conversation', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json(view));
  vi.stubGlobal('fetch', fetch);
  render(<AssistantReminderSettings manager="default" roomId="!assistant" />);
  fireEvent.click(screen.getByRole('button', { name: '提醒设置' }));
  await screen.findByRole('switch', { name: '定时提醒' });
  expect(fetch.mock.calls[0][0]).toContain('manager=default');
  expect(fetch.mock.calls[0][0]).not.toContain('user=');
});

it('does not overwrite settings after a concurrent change', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(view)).mockResolvedValueOnce(Response.json({}, { status: 409 }));
  vi.stubGlobal('fetch', fetch);
  render(<AssistantReminderSettings team="research" roomId="!assistant" />);
  fireEvent.click(screen.getByRole('button', { name: '提醒设置' }));
  await screen.findByRole('switch', { name: '定时提醒' });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('已更新');
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('refuses to edit a room that changed during handoff', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ...view, roomId: '!another-user' })));
  render(<AssistantReminderSettings team="research" roomId="!assistant" />);
  fireEvent.click(screen.getByRole('button', { name: '提醒设置' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('会话已更新');
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
});

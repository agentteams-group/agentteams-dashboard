import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useSectionStore } from '@/lib/section-store';
import { useExtensionStore } from '@/lib/plugins/extension-store';
import { ManagementTab } from './management-tab';

beforeEach(() => {
  useAgentTeamsStore.setState({ userLevel: 3, settingsOpen: true });
  useSectionStore.setState({ activeSection: 'chat' });
  useExtensionStore.getState().clear();
});
afterEach(cleanup);

it('keeps automation collapsed in settings and opens the existing page explicitly', () => {
  render(<ManagementTab />);
  const summary = screen.getByText('自动化');
  const section = summary.closest('details')!;
  expect(section.open).toBe(false);
  fireEvent.click(summary);
  fireEvent.click(screen.getByRole('button', { name: '打开自动化', hidden: true }));
  expect(useSectionStore.getState().activeSection).toBe('loops');
  expect(useAgentTeamsStore.getState().settingsOpen).toBe(false);
});

it('points to observability from settings and dismisses the settings overlay', () => {
  render(<ManagementTab />);
  fireEvent.click(screen.getByRole('button', { name: '打开观测与治理' }));
  expect(useSectionStore.getState().activeSection).toBe('tracing');
  expect(useAgentTeamsStore.getState().settingsOpen).toBe(false);
});

it('keeps plugin pages reachable after moving them out of the sidebar', () => {
  useExtensionStore.getState().add('menuItems', 'monitor', { id: 'home', label: '监控面板', target: { type: 'plugin-route', routeId: 'home' } });
  render(<ManagementTab />);
  fireEvent.click(screen.getByRole('button', { name: '监控面板' }));
  expect(useSectionStore.getState().activeSection).toBe('plugin-route:monitor/home');
  expect(useAgentTeamsStore.getState().settingsOpen).toBe(false);
});

it('does not duplicate operations pages or their bundled plugin entries in settings', () => {
  useExtensionStore.getState().add('menuItems', 'wen-tian', { id: 'diagnose', label: '问天诊断', target: { type: 'plugin-route', routeId: 'diagnose' } });
  useExtensionStore.getState().add('menuItems', 'monitor-panel', { id: 'monitor', label: '监控面板', target: { type: 'plugin-route', routeId: 'monitor' } });
  render(<ManagementTab />);
  for (const name of ['Tracing', '监控面板']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '问天诊断' })).toBeInTheDocument();
});

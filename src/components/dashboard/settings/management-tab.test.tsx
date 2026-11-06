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

it('opens audit from settings and dismisses the settings overlay', () => {
  render(<ManagementTab />);
  fireEvent.click(screen.getByRole('button', { name: '审计' }));
  expect(useSectionStore.getState().activeSection).toBe('audit');
  expect(useAgentTeamsStore.getState().settingsOpen).toBe(false);
});

it('keeps plugin pages reachable after moving them out of the sidebar', () => {
  useExtensionStore.getState().add('menuItems', 'monitor', { id: 'home', label: '监控面板', target: { type: 'plugin-route', routeId: 'home' } });
  render(<ManagementTab />);
  fireEvent.click(screen.getByRole('button', { name: '监控面板' }));
  expect(useSectionStore.getState().activeSection).toBe('plugin-route:monitor/home');
  expect(useAgentTeamsStore.getState().settingsOpen).toBe(false);
});

it('keeps the upstream tracing page reachable from settings', () => {
  render(<ManagementTab />);
  fireEvent.click(screen.getByRole('button', { name: 'Tracing' }));
  expect(useSectionStore.getState().activeSection).toBe('tracing');
  expect(useAgentTeamsStore.getState().settingsOpen).toBe(false);
});

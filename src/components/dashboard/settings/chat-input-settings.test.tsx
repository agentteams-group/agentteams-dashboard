import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { ChatInputSettings } from './chat-input-settings';

afterEach(() => {
  cleanup();
  useAgentTeamsStore.setState({ replyEnterAction: 'send', autoReconnect: false });
});

it('defaults to immediate sending and persists the selected queue behavior across rehydration', async () => {
  expect(useAgentTeamsStore.getState().replyEnterAction).toBe('send');
  const scroll = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: () => {} });
  try {
    render(<ChatInputSettings />);
    fireEvent.keyDown(screen.getByRole('combobox', { name: '回复中按 Enter' }), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: '排队' }));
    expect(useAgentTeamsStore.getState().replyEnterAction).toBe('queue');
    const saved = localStorage.getItem('agentteams-store');
    useAgentTeamsStore.setState({ replyEnterAction: 'send' });
    localStorage.setItem('agentteams-store', saved!);
    await useAgentTeamsStore.persist.rehydrate();
    expect(useAgentTeamsStore.getState().replyEnterAction).toBe('queue');
  } finally {
    if (scroll) Object.defineProperty(Element.prototype, 'scrollIntoView', scroll);
    else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  }
});

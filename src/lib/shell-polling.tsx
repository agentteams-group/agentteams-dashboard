'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

interface ShellPollingState {
  activeSection: string | null;
  visible: boolean;
}

interface ShellPollingContextValue extends ShellPollingState {
  setActiveSection: (_section: string) => void;
}

const ShellPollingContext = createContext<ShellPollingContextValue | null>(null);

const CHAT_SECTIONS = new Set(['chat', 'my-teams']);
const NON_CHAT_QUERY_KEYS = new Set([
  'agentteams-health',
  'agentteams-version',
  'agentteams-workers',
  'agentteams-teams',
  'agentteams-managers',
  'agentteams-humans',
  'agentteams-cluster-status',
]);

function sectionAllows(key: readonly unknown[], section: string | null): boolean {
  // No shell mounted (unit tests, standalone consumers): preserve existing behaviour.
  if (section === null) return true;
  if (key[0] === 'chat-room-access') return CHAT_SECTIONS.has(section);
  if (typeof key[0] === 'string' && NON_CHAT_QUERY_KEYS.has(key[0])) {
    return !CHAT_SECTIONS.has(section);
  }
  return true;
}

export function ShellPollingProvider({ children }: { children: ReactNode }) {
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  const value = useMemo(() => ({ activeSection, visible }), [activeSection, visible]);
  return (
    <ShellPollingContext.Provider value={{ ...value, setActiveSection }}>
      {children}
    </ShellPollingContext.Provider>
  );
}

/** Called by the authenticated shell; startup/login screens never install a section. */
export function useShellPollingSection(section: string): void {
  const context = useContext(ShellPollingContext);
  const setActiveSection = context?.setActiveSection;
  useEffect(() => {
    setActiveSection?.(section);
  }, [section, setActiveSection]);
}

/** React Query already pauses intervals in hidden tabs; this adds the section gate. */
export function useShellPollingInterval(key: readonly unknown[], interval: number | false): number | false {
  const context = useContext(ShellPollingContext);
  const activeSection = context?.activeSection ?? null;
  const visible = context?.visible ?? true;
  if (!visible || !sectionAllows(key, activeSection)) return false;
  return interval;
}

'use client';

import { create } from 'zustand';

/**
 * Global active-section state.
 *
 * The dashboard historically kept this in component state; plugins need to
 * navigate programmatically (api.dashboard.navigate), so it now lives in a
 * tiny store that both the dashboard shell and the plugin API can reach.
 */

interface SectionState {
  activeSection: string;
  taskCollaboration: { taskId: string; roomId: string } | null;
  mentionRoomId: string | null;
  notificationsOpen: boolean;
  setNotificationsOpen: (_open: boolean) => void;
  setActiveSection: (_sectionId: string) => void;
}

export const useSectionStore = create<SectionState>()((set) => ({
  activeSection: 'overview',
  taskCollaboration: null,
  mentionRoomId: null,
  notificationsOpen: false,
  setNotificationsOpen: (notificationsOpen) => set({ notificationsOpen }),
  setActiveSection: (sectionId: string) => set((state) => ({
    activeSection: sectionId === 'my-workbench' ? 'tasks' : sectionId,
    notificationsOpen: sectionId === 'my-workbench' ? true : state.notificationsOpen,
    taskCollaboration: sectionId === 'chat' ? state.taskCollaboration : null,
    mentionRoomId: sectionId === 'chat' || sectionId === 'my-teams' ? state.mentionRoomId : null,
  })),
}));

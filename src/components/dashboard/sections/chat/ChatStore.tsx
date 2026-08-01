'use client';

import React, { useState, useCallback } from 'react';

interface ChatStore {
  currentRoomId: string;
  setCurrentRoomId: (_roomId: string) => void;
  autoScroll: boolean;
  setAutoScroll: (_auto: boolean) => void;
  newMessagesCount: number;
  incrementNewMessages: () => void;
  clearNewMessages: () => void;
}

const ChatContext = React.createContext<ChatStore | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [currentRoomId, setCurrentRoomId] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [newMessagesCount, setNewMessagesCount] = useState(0);

  const incrementNewMessages = useCallback(() => {
    setNewMessagesCount(c => c + 1);
  }, []);

  const clearNewMessages = useCallback(() => {
    setNewMessagesCount(0);
  }, []);

  return (
    <ChatContext.Provider value={{
      currentRoomId,
      setCurrentRoomId,
      autoScroll,
      setAutoScroll,
      newMessagesCount,
      incrementNewMessages,
      clearNewMessages,
    }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChatStore() {
  const context = React.useContext(ChatContext);
  if (!context) {
    throw new Error('useChatStore must be used within ChatProvider');
  }
  return context;
}

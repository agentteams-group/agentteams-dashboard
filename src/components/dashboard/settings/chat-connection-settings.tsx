'use client';

import { useState } from 'react';
import { useMatrixStore } from '@/lib/matrix-store';
import { ChatAuthBadge } from '../sections/chat/chat-auth-badge';
import { ServerCapabilityPopover } from '../sections/chat/server-capability-popover';

export function ChatConnectionSettings() {
  const isLoggedIn = useMatrixStore((state) => state.isLoggedIn);
  const userId = useMatrixStore((state) => state.userId);
  const logout = useMatrixStore((state) => state.logout);
  const [showLoginDialog, setShowLoginDialog] = useState(false);

  return (
    <section aria-label="聊天连接诊断" className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">聊天连接</h3>
        <ServerCapabilityPopover />
      </div>
      <ChatAuthBadge compact isLoggedIn={isLoggedIn} userId={userId} onLogout={logout}
        onLoginClick={() => setShowLoginDialog(true)} showLoginDialog={showLoginDialog}
        onLoginDialogChange={setShowLoginDialog} />
    </section>
  );
}

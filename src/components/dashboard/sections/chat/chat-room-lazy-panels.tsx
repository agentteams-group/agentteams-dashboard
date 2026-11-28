'use client';

import dynamic from 'next/dynamic';
import { forwardRef, lazy, Suspense } from 'react';
import type { MessageListHandle } from './structures/MessageList';

const LazyMessageList = lazy(
  () => import('./structures/MessageList').then((module) => ({ default: module.MessageList })),
);

// next/dynamic owns the forwarded ref for its own retry handle. MessageList's
// imperative scrolling API must reach the loaded component, so use React.lazy
// with a real forwarded ref at this boundary.
export const MessageList = forwardRef<MessageListHandle, React.ComponentProps<typeof LazyMessageList>>(
  function MessageList(props, ref) {
    return <Suspense fallback={null}><LazyMessageList {...props} ref={ref} /></Suspense>;
  },
);

export const ChatComposer = dynamic(
  () => import('./chat-composer').then((module) => ({ default: module.ChatComposer })),
  { ssr: false },
);
export const RoomContextPanel = dynamic(
  () => import('./components/RoomContextPanel').then((module) => ({ default: module.RoomContextPanel })),
  { ssr: false },
);
export const WorkerChatsPanel = dynamic(
  () => import('@/components/dashboard/sections/workers/worker-chats-panel').then((module) => ({ default: module.WorkerChatsPanel })),
  { ssr: false },
);
export const AttachmentPreviewPanel = dynamic(
  () => import('./attachment-preview').then((module) => ({ default: module.AttachmentPreviewPanel })),
  { ssr: false },
);
export const TaskTopologyPopover = dynamic(
  () => import('./components/TaskTopologyPopover').then((module) => ({ default: module.TaskTopologyPopover })),
  { ssr: false },
);
export const RoomAttachments = dynamic(
  () => import('./components/RoomAttachments').then((module) => ({ default: module.RoomAttachments })),
  { ssr: false },
);

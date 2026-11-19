'use client';

import { MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useMatrixStore } from '@/lib/matrix-store';
import { useChatRoomAccess } from '@/hooks/use-chat-room-access';
import { isTeamAdmin } from '@/lib/team-access';
import { openChatRoom } from '@/lib/open-chat-room';
import type { TeamResponse } from '@/lib/agentteams-api';

export function TeamAssistantButton({ team }: { team: TeamResponse }) {
  const { sessionUser } = useAgentTeamsStore();
  const { userId } = useMatrixStore();
  const access = useChatRoomAccess();
  if (!isTeamAdmin(team, sessionUser, userId)) return null;
  const reason = !team.leaderDMRoomID ? '团队助手尚未就绪'
    : access.state === 'checking' ? '正在核验私聊权限'
    : access.state === 'disconnected' ? '请先连接对话'
    : access.state === 'error' ? '私聊权限暂时无法核验'
    : !access.joinedRooms?.includes(team.leaderDMRoomID) ? '尚未加入团队助手私聊'
    : undefined;
  return <Button variant="outline" size="sm" disabled={Boolean(reason)} title={reason ?? '与团队助手对话'}
    onClick={() => openChatRoom(team.leaderDMRoomID)}>
    <MessageCircle className="size-3.5" aria-hidden="true" />团队助手
  </Button>;
}

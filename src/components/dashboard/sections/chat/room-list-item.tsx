'use client';

import { motion } from 'framer-motion';
import { Bot, Crown, Hash, UserCheck, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { CopyButton } from '@/components/dashboard/copy-button';
import type { RoomInfo } from './room-info';

const PHASE_COLOR: Record<string, string> = {
  Running: 'text-emerald-500',
  Active: 'text-emerald-500',
  Ready: 'text-emerald-500',
  Sleeping: 'text-amber-500',
  Pending: 'text-amber-500',
  Failed: 'text-red-500',
  Stopped: 'text-gray-500',
};

function roomTypeIcon(type: RoomInfo['type']) {
  switch (type) {
    case 'team':
      return <Users className="w-4 h-4 text-emerald-500" />;
    case 'worker':
      return <Bot className="w-4 h-4 text-primary" />;
    case 'manager':
      return <Crown className="w-4 h-4 text-violet-500" />;
    case 'human':
      return <UserCheck className="w-4 h-4 text-cyan-500" />;
    default:
      return <Hash className="w-4 h-4 text-muted-foreground" />;
  }
}

function statusDot(phase: string | undefined): string {
  if (!phase) return 'bg-gray-400';
  if (phase === 'Running' || phase === 'Active' || phase === 'Ready') return 'bg-emerald-500';
  if (phase === 'Sleeping' || phase === 'Pending') return 'bg-amber-500';
  if (phase === 'Failed') return 'bg-red-500';
  return 'bg-gray-400';
}

export function RoomListItem({
  room,
  isSelected,
  onClick,
}: {
  room: RoomInfo;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-lg transition-all duration-200 ${
        isSelected
          ? 'bg-primary/10 border border-primary/30'
          : 'hover:bg-accent border border-transparent'
      }`}
      whileHover={{ x: 2 }}
      whileTap={{ scale: 0.99 }}
    >
      <div className="flex items-center gap-2.5">
        <div className="relative">
          {roomTypeIcon(room.type)}
          {room.phase && PHASE_COLOR[room.phase] && (
            <div
              className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ${statusDot(room.phase)}`}
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="font-medium text-sm truncate">{room.name}</p>
            {room.phase && (
              <Badge
                variant="outline"
                className={`text-[8px] px-1 py-0 h-3.5 shrink-0 ${PHASE_COLOR[room.phase] || ''}`}
              >
                {room.phase}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            <p className="text-[10px] text-muted-foreground font-mono truncate max-w-[140px]">
              {room.id}
            </p>
            <CopyButton text={room.id} className="h-5 w-5" />
          </div>
        </div>
        {room.members && room.members.length > 0 && (
          <Badge variant="secondary" className="text-[10px] shrink-0">
            {room.members.length}
          </Badge>
        )}
      </div>
    </motion.button>
  );
}

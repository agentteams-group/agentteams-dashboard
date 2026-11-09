'use client';

import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { attentionCounts } from '@/lib/assistant-task-notes';
import { canOpenConversation, conversationSections, LEADER_ACCESS_LABELS } from './agent-conversations';
import type { RoomInfo } from './room-info';

export type ConversationAttention = ReturnType<typeof attentionCounts>;

export function TaskAttention({ counts, pending }: { counts?: ConversationAttention; pending?: string }) {
  if (pending) return <span className="text-xs text-muted-foreground">{pending}</span>;
  if (!counts) return null;
  return <span className="flex flex-wrap gap-x-2 gap-y-1 text-xs">
    {counts.confirmation > 0 && <span className="text-status-waiting">待确认 {counts.confirmation}</span>}
    {counts.review > 0 && <span className="text-status-waiting">待验收 {counts.review}</span>}
    {counts.failed > 0 && <span className="text-status-failed">失败 {counts.failed}</span>}
  </span>;
}

export function ConversationSwitcher({ rooms, selectedRoomId, onSelectRoom, attention, pending }: {
  rooms: RoomInfo[];
  selectedRoomId: string | null;
  onSelectRoom: (_id: string) => void;
  attention: Record<string, ConversationAttention>;
  pending?: string;
}) {
  const sections = conversationSections(rooms);
  const choices = [
    ...sections.operations.map(room => ({ id: room.id, name: room.name, target: room, room })),
    ...sections.teams.map(team => {
      const room = team.rooms.find(room => room.agentRole === 'leader') ?? team.rooms[0];
      return { id: team.id, name: team.name, room, target: team.rooms.find(canOpenConversation) };
    }),
  ];
  const selected = rooms.find(room => room.id === selectedRoomId);
  const currentTeam = sections.teams.find(team => team.id === selected?.parentTeam);
  const relatedRoom = currentTeam?.rooms.find(room => selected?.type === 'team'
    ? room.agentRole === 'leader' && canOpenConversation(room)
    : room.type === 'team');
  const relatedEntry = relatedRoom && <Button variant="outline" size="sm" className="shrink-0" onClick={() => onSelectRoom(relatedRoom.id)}>
    {relatedRoom.type === 'team' ? '团队协作' : '团队助手'}
  </Button>;
  const current = choices.find(choice => choice.id === selected?.parentTeam || choice.id === selected?.id);
  const label = current?.name ?? (selected ? '其他对话' : '选择团队');
  const otherAttention = pending ? 0 : sections.teams.filter(team => team.id !== current?.id).reduce((total, team) => {
    const room = team.rooms.find(room => room.agentRole === 'leader') ?? team.rooms[0];
    const counts = attention[room.id];
    return total + (counts ? counts.confirmation + counts.review + counts.failed : 0);
  }, 0);
  if (choices.length <= 1) {
    const only = choices[0];
    return <div className="flex min-w-0 items-center gap-2"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{selected ? label : only?.name ?? label}</p>{only && !only.target && only.room.access && only.room.access !== 'joined' && <p className="truncate text-xs text-muted-foreground">{LEADER_ACCESS_LABELS[only.room.access]}</p>}</div>{relatedEntry}</div>;
  }
  return <div className="flex min-w-0 items-center gap-2"><DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="sm" className="h-9 min-w-0 max-w-full gap-2 px-2" aria-label={`切换团队，当前：${label}`}>
        <span className="truncate text-sm">{label}</span>
        {otherAttention > 0 && <span className="shrink-0 rounded-full bg-status-waiting/10 px-1.5 text-xs text-status-waiting" aria-label={`其他团队 ${otherAttention} 项待处理`} title={`其他团队有 ${otherAttention} 项待确认、待验收或失败事项`}>{otherAttention}</span>}
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="max-h-[70dvh] w-72 max-w-[90vw] overflow-y-auto">
      <DropdownMenuLabel>选择工作范围</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={current?.id ?? ''} onValueChange={id => { const choice = choices.find(choice => choice.id === id); if (choice?.target) onSelectRoom(choice.target.id); }}>
        {choices.map(choice => <DropdownMenuRadioItem key={choice.id} value={choice.id} disabled={!choice.target} className="items-start py-3">
          <span className="min-w-0 space-y-1">
            <span className="block truncate text-sm font-medium">{choice.name}</span>
            {!choice.target && choice.room.access && choice.room.access !== 'joined'
              ? <span className="block text-xs text-muted-foreground">{LEADER_ACCESS_LABELS[choice.room.access]}</span>
              : <TaskAttention counts={attention[choice.room.id]} pending={pending} />}
          </span>
        </DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>{relatedEntry}</div>;
}

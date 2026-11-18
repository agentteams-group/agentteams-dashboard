'use client';

import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { attentionCounts } from '@/lib/assistant-task-notes';
import { TEAM_PHASE_LABELS } from '@/lib/phase-colors';
import { canOpenConversation, conversationSections, LEADER_ACCESS_LABELS } from './agent-conversations';
import type { RoomInfo } from './room-info';

export type ConversationAttention = ReturnType<typeof attentionCounts>;

export function RelatedConversationButton({ rooms, selectedRoomId, onSelectRoom }: {
  rooms: RoomInfo[];
  selectedRoomId: string | null;
  onSelectRoom: (_id: string) => void;
}) {
  const selected = rooms.find(room => room.id === selectedRoomId);
  const team = conversationSections(rooms).teams.find(team => team.id === selected?.parentTeam);
  const related = team?.rooms.find(room => selected?.type === 'team'
    ? room.agentRole === 'leader' && canOpenConversation(room)
    : room.type === 'team');
  return related ? <Button variant="outline" size="sm" onClick={() => onSelectRoom(related.id)}>
    {related.type === 'team' ? '团队协作' : '团队助手'}
  </Button> : null;
}

export function TaskAttention({ counts, pending }: { counts?: ConversationAttention; pending?: string }) {
  if (pending) return <span className="text-xs text-muted-foreground">{pending}</span>;
  if (!counts) return null;
  return <span className="flex flex-wrap gap-x-2 gap-y-1 text-xs">
    {counts.confirmation > 0 && <span className="text-status-waiting">待确认 {counts.confirmation}</span>}
    {counts.review > 0 && <span className="text-status-waiting">待验收 {counts.review}</span>}
    {counts.failed > 0 && <span className="text-status-failed">失败 {counts.failed}</span>}
  </span>;
}

export function ConversationSwitcher({ rooms, relatedRooms = rooms, selectedRoomId, onSelectRoom, attention, pending }: {
  rooms: RoomInfo[];
  relatedRooms?: RoomInfo[];
  selectedRoomId: string | null;
  onSelectRoom: (_id: string) => void;
  attention: Record<string, ConversationAttention>;
  pending?: string;
}) {
  const sections = conversationSections(rooms);
  const choices = [
    ...sections.operations.map(room => ({ id: room.id, name: room.name, title: room.name, target: room, room })),
    ...sections.teams.map(team => {
      const room = team.rooms.find(room => room.agentRole === 'leader') ?? team.rooms[0];
      return { id: team.id, name: `${team.name}${room.teamRole ? ` · ${room.teamRole === 'admin' ? '管理员' : '成员'}` : ''}`, title: team.name, room, target: team.rooms.find(canOpenConversation) };
    }),
  ];
  const selected = relatedRooms.find(room => room.id === selectedRoomId);
  const collaboration = selected?.type === 'team';
  const team = collaboration ? selected.team : undefined;
  const current = choices.find(choice => choice.id === selected?.parentTeam || choice.id === selected?.id);
  const label = selected?.type === 'project' || selected?.type === 'worker' ? selected.name : current ? `${current.name}${selected?.type === 'team' ? ' · 团队协作' : ''}` : (selected ? selected.name : '选择团队');
  const title = selected?.type === 'project' || selected?.type === 'worker' ? selected.name : current?.title ?? selected?.name ?? '选择团队';
  const role = selected?.teamRole ?? current?.room.teamRole;
  const roleLabel = role === 'admin' ? '管理员' : role === 'member' ? '成员' : '';
  const description = collaboration ? '' : [selected?.agentRole === 'operations' ? '平台管理助手' : selected?.agentRole === 'leader' ? '团队助手' : '', roleLabel].filter(Boolean).join(' · ');
  const canSwitch = choices.length > 1;
  const otherAttention = pending ? 0 : sections.teams.filter(team => team.id !== current?.id).reduce((total, team) => {
    const room = team.rooms.find(room => room.agentRole === 'leader') ?? team.rooms[0];
    const counts = attention[room.id];
    return total + (counts ? counts.confirmation + counts.review + counts.failed : 0);
  }, 0);
  if (!canSwitch && !collaboration) {
    const only = choices[0];
    return <div className="min-w-0"><p className="truncate text-sm font-semibold" title={title}>{selected ? title : only?.title ?? title}</p>{description && <p className="mt-0.5 truncate text-xs text-muted-foreground">{description}</p>}{only && !only.target && only.room.access && only.room.access !== 'joined' && <p className="truncate text-xs text-muted-foreground">{LEADER_ACCESS_LABELS[only.room.access]}</p>}</div>;
  }
  return <div className="flex min-w-0 items-center gap-2"><DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="sm" className="h-auto min-w-0 max-w-full justify-start gap-2 px-1 py-1 text-left" aria-label={`${canSwitch ? '切换团队' : '查看团队详情'}，当前：${label}`}>
        <span className="min-w-0"><span className="block truncate text-sm font-semibold" title={title}>{title}</span>{description && <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">{description}</span>}</span>
        {otherAttention > 0 && <span className="shrink-0 rounded-full bg-status-waiting/10 px-1.5 text-xs text-status-waiting" aria-label={`其他团队 ${otherAttention} 项待处理`} title={`其他团队有 ${otherAttention} 项待确认、待验收或失败事项`}>{otherAttention}</span>}
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="max-h-[70dvh] w-72 max-w-[90vw] overflow-y-auto">
      {collaboration && <>
        <DropdownMenuLabel>团队详情</DropdownMenuLabel>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 px-2 pb-2 text-xs [&_dt]:text-muted-foreground">
          {roleLabel && <><dt>角色</dt><dd>{roleLabel}</dd></>}
          {team?.phase && <><dt>状态</dt><dd>{TEAM_PHASE_LABELS[team.phase] ?? team.phase}</dd></>}
          {team && <><dt>就绪 Worker</dt><dd>{team.readyWorkers}/{team.totalWorkers}</dd></>}
          {team?.leaderName && <><dt>队长</dt><dd className="break-all">{team.leaderName}</dd></>}
        </dl>
        {canSwitch && <DropdownMenuSeparator />}
      </>}
      {canSwitch && <>
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
      </>}
    </DropdownMenuContent>
  </DropdownMenu></div>;
}

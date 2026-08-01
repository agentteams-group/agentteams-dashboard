'use client';

import { useMemo } from 'react';
import { Bot, Crown, Users, Hash } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import type { RoomInfo } from './room-info';
import type { RoomMember } from '@/hooks/use-matrix';

export function RoomTopology({
  rooms,
  selectedRoomId,
  members = [],
}: {
  rooms: RoomInfo[];
  selectedRoomId?: string | null;
  members?: RoomMember[];
}) {
  const topology = useMemo(() => {
    if (selectedRoomId) {
      const selectedRoom = rooms.find(r => r.id === selectedRoomId);
      if (selectedRoom) {
        return {
          currentRoom: selectedRoom,
          relatedRooms: rooms.filter(r => r.parentTeam === selectedRoom.parentTeam && r.id !== selectedRoomId),
          teamMembers: members,
        };
      }
    }

    const teamRooms = rooms.filter((r) => r.type === 'team');
    const workerRooms = rooms.filter((r) => r.type === 'worker');
    const managerRooms = rooms.filter((r) => r.type === 'manager');

    return {
      currentRoom: null,
      relatedRooms: [],
      teamMembers: [],
      overview: teamRooms.map((teamRoom) => ({
        team: teamRoom,
        workers: workerRooms.filter((w) => w.parentTeam === teamRoom.parentTeam),
        managers: managerRooms.filter((m) => m.parentTeam === teamRoom.parentTeam),
      })),
    };
  }, [rooms, selectedRoomId, members]);

  // Show current room context
  if (topology.currentRoom) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Hash className="w-4 h-4 text-emerald-500" />
          当前房间
        </h3>
        <Card className="glass-card">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <Hash className="w-3 h-3 text-emerald-500" />
              <span className="font-medium text-xs truncate">{topology.currentRoom.name}</span>
              <Badge variant="outline" className="text-[8px] ml-auto">
                {topology.currentRoom.type}
              </Badge>
            </div>
            <div className="flex items-center gap-1 mt-2 text-[10px] text-muted-foreground font-mono truncate">
              <span>{topology.currentRoom.id}</span>
            </div>
            {topology.currentRoom.parentTeam && (
              <div className="flex items-center gap-1 mt-1 text-[10px]">
                <Users className="w-3 h-3 text-muted-foreground" />
                <span>团队: {topology.currentRoom.parentTeam}</span>
              </div>
            )}
            {topology.teamMembers.length > 0 && (
              <div className="mt-2 pt-2 border-t">
                <p className="text-[10px] text-muted-foreground mb-1">当前成员 ({topology.teamMembers.length})</p>
                <div className="space-y-1">
                  {topology.teamMembers.map((m) => (
                    <div key={m.userId} className="flex items-center gap-1.5">
                      <Avatar className="w-4 h-4">
                        <AvatarFallback className="text-[7px] bg-muted text-muted-foreground">
                          {m.displayName.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-[10px] truncate flex-1">{m.displayName}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {topology.relatedRooms.length > 0 && (
              <div className="mt-2 pt-2 border-t">
                <p className="text-[10px] text-muted-foreground mb-1">同团队房间</p>
                <div className="space-y-1">
                  {topology.relatedRooms.slice(0, 3).map(r => (
                    <div key={r.id} className="flex items-center gap-1 text-[10px]">
                      <Hash className="w-3 h-3 text-muted-foreground" />
                      <span className="truncate">{r.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show overview
  if (!topology.overview || topology.overview.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Users className="w-4 h-4 text-emerald-500" />
        房间拓扑
      </h3>
      {topology.overview.map(({ team, workers: teamWorkers, managers: teamManagers }) => (
        <Card key={team.id} className="glass-card">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-3 h-3 text-emerald-500" />
              <span className="font-medium text-xs">{team.parentTeam}</span>
              <Badge variant="outline" className="text-[8px] ml-auto">
                {teamWorkers.length + teamManagers.length}
              </Badge>
            </div>
            <div className="space-y-1.5 ml-5">
              {teamManagers.map((mgr) => (
                <div key={mgr.id} className="flex items-center gap-1.5 text-[10px]">
                  <Crown className="w-3 h-3 text-violet-500" />
                  <span className="font-medium">{mgr.name}</span>
                  <span className="text-muted-foreground">↔</span>
                  <span className="text-muted-foreground">团队</span>
                </div>
              ))}
              {teamWorkers.map((wr) => (
                <div key={wr.id} className="flex items-center gap-1.5 text-[10px]">
                  <Bot className="w-3 h-3 text-emerald-500" />
                  <span className="font-medium">{wr.name}</span>
                  <span className="text-muted-foreground">↔</span>
                  <span className="text-muted-foreground">团队</span>
                </div>
              ))}
              {teamWorkers.length === 0 && teamManagers.length === 0 && (
                <p className="text-[10px] text-muted-foreground">暂无成员</p>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

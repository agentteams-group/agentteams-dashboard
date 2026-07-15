'use client';

import { useMemo } from 'react';
import { Bot, Crown, Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { RoomInfo } from './room-info';

export function RoomTopology({ rooms }: { rooms: RoomInfo[] }) {
  const topology = useMemo(() => {
    const teamRooms = rooms.filter((r) => r.type === 'team');
    const workerRooms = rooms.filter((r) => r.type === 'worker');
    const managerRooms = rooms.filter((r) => r.type === 'manager');
    return teamRooms.map((teamRoom) => {
      const teamWorkers = workerRooms.filter((w) => w.parentTeam === teamRoom.parentTeam);
      return { team: teamRoom, workers: teamWorkers, managers: managerRooms };
    });
  }, [rooms]);

  if (topology.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Users className="w-4 h-4 text-emerald-500" />
        房间拓扑
      </h3>
      {topology.map(({ team, workers: teamWorkers, managers: teamManagers }) => (
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
                  <Bot className="w-3 h-3 text-primary" />
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

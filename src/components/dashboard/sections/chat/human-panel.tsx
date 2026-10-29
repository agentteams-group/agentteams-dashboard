'use client';

import { Lock, UserCheck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useHumans } from '@/hooks/use-agentteams-humans';
import { CopyButton } from '@/components/dashboard/copy-button';
import { getAvatarColor } from './format';

export function HumanPanel() {
  const { data: humans, isLoading } = useHumans();

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <UserCheck className="w-4 h-4 text-cyan-500" />
        Human-in-the-Loop
      </h3>
      {isLoading ? (
        <Card className="glass-card">
          <CardContent className="p-4 space-y-3">
            <div className="h-5 w-24 bg-muted rounded animate-pulse" />
            <div className="h-4 w-32 bg-muted rounded animate-pulse" />
          </CardContent>
        </Card>
      ) : humans && humans.length > 0 ? (
        humans.map((human) => {
          const color = getAvatarColor(human.matrixUserID || human.name);
          return (
            <Card key={human.name} className="glass-card">
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  <Avatar className="w-6 h-6">
                    <AvatarFallback className={`text-xs ${color}`}>
                      {(human.displayName || human.name).slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{human.displayName}</p>
                    <p className="text-xs text-muted-foreground font-mono">@{human.name}</p>
                  </div>
                  <Badge
                    variant={human.phase === 'Active' ? 'default' : 'secondary'}
                    className="text-xs"
                  >
                    {human.phase}
                  </Badge>
                </div>
                {human.matrixUserID && (
                  <div className="flex items-center gap-1 mt-2">
                    <p className="text-xs text-muted-foreground font-mono truncate flex-1">
                      {human.matrixUserID}
                    </p>
                    <CopyButton text={human.matrixUserID} className="h-5 w-5" />
                  </div>
                )}
                {human.initialPassword && (
                  <div className="flex items-center gap-1 mt-1">
                    <Lock className="w-3 h-3 text-amber-500" />
                    <p className="text-xs text-amber-600 dark:text-amber-400">初始密码已生成</p>
                    <CopyButton text={human.initialPassword} className="h-5 w-5" />
                  </div>
                )}
                {human.rooms && human.rooms.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs text-muted-foreground mb-1">
                      所在房间 ({human.rooms.length})
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {human.rooms.slice(0, 2).map((roomId) => (
                        <Badge key={roomId} variant="outline" className="text-xs">
                          {roomId.slice(0, 15)}...
                        </Badge>
                      ))}
                      {human.rooms.length > 2 && (
                        <Badge variant="outline" className="text-xs">
                          +{human.rooms.length - 2}
                        </Badge>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })
      ) : (
        <Card className="glass-card">
          <CardContent className="p-6 text-center">
            <UserCheck className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">暂无人类用户</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

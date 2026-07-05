'use client';

import { SectionHeader } from '@/components/dashboard/section-header';
import { TopologyCanvas } from '@/components/dashboard/topology/topology-canvas';
import { useWorkers } from '@/hooks/use-hiclaw-workers';
import { useTeams } from '@/hooks/use-hiclaw-teams';
import { useManagers } from '@/hooks/use-hiclaw-managers';

export function TopologySection() {
  const { data: workers } = useWorkers();
  const { data: teams } = useTeams();
  const { data: managers } = useManagers();

  return (
    <div className="space-y-4">
      <SectionHeader
        title="通信拓扑图"
        description="可视化 Manager → Team → Worker 的层级关系和当前状态"
      />
      <TopologyCanvas
        workers={workers || []}
        teams={teams || []}
        managers={managers || []}
      />
      <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-violet-500 inline-block" /> Manager
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" /> Team
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-orange-500 inline-block" /> Worker
        </span>
        <span className="ml-4">外环颜色 = 阶段状态</span>
      </div>
    </div>
  );
}

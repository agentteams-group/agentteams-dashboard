'use client';

import { SectionHeader } from '@/components/dashboard/section-header';
import { SkillCenter } from '@/components/dashboard/sections/skills/skill-center';
import { useMcpServers } from '@/hooks/use-agentteams-mcps';

export function ResourceCenterSection() {
  const { data: mcpServers, refetch: refetchMcpServers, isRefetching } = useMcpServers();

  const handleRefresh = () => {
    refetchMcpServers();
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="技能"
        description="浏览、管理和分配团队可用的技能"
        onRefresh={handleRefresh}
        isRefreshing={isRefetching}
      />

      <SkillCenter onRefresh={handleRefresh} mcpServers={mcpServers} />
    </div>
  );
}

'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SectionHeader } from '@/components/dashboard/section-header';
import { SkillCenter } from '@/components/dashboard/sections/skills/skill-center';
import { McpServersSection } from '@/components/dashboard/sections/mcps/mcp-servers-section';
import { WorkersActivitySection } from '@/components/dashboard/sections/workers/workers-activity-section';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { useMcpServers } from '@/hooks/use-agentteams-mcps';

export function ResourceCenterSection() {
  const [activeTab, setActiveTab] = useState('skills');
  const { refetch: refetchWorkers, isRefetching: isRefetchingWorkers } = useWorkers();
  const { data: mcpServers, refetch: refetchMcpServers } = useMcpServers();

  const handleRefresh = () => {
    refetchWorkers();
    refetchMcpServers();
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="资源中心"
        description="统一管理技能、MCP 服务器和 Worker 运行状态"
        onRefresh={handleRefresh}
        isRefreshing={isRefetchingWorkers}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="skills">技能</TabsTrigger>
          <TabsTrigger value="mcps">MCP 服务器</TabsTrigger>
          <TabsTrigger value="workers">Worker 运行</TabsTrigger>
        </TabsList>

        <TabsContent value="skills">
          <SkillCenter onRefresh={handleRefresh} mcpServers={mcpServers} />
        </TabsContent>

        <TabsContent value="mcps">
          <McpServersSection />
        </TabsContent>

        <TabsContent value="workers">
          <WorkersActivitySection />
        </TabsContent>
      </Tabs>
    </div>
  );
}

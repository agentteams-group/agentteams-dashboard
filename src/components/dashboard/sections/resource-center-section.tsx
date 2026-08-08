'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SectionHeader } from '@/components/dashboard/section-header';
import { SkillCenter } from '@/components/dashboard/sections/skills/skill-center';
import { McpServersSection } from '@/components/dashboard/sections/mcps/mcp-servers-section';
import { useMcpServers } from '@/hooks/use-agentteams-mcps';

export function ResourceCenterSection() {
  const [activeTab, setActiveTab] = useState('skills');
  const { data: mcpServers, refetch: refetchMcpServers, isRefetching } = useMcpServers();

  const handleRefresh = () => {
    refetchMcpServers();
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="资源中心"
        description="统一管理市场内容与 MCP 服务器"
        onRefresh={handleRefresh}
        isRefreshing={isRefetching}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="skills">市场</TabsTrigger>
          <TabsTrigger value="mcps">MCP 服务器</TabsTrigger>
        </TabsList>

        <TabsContent value="skills">
          <SkillCenter onRefresh={handleRefresh} mcpServers={mcpServers} />
        </TabsContent>

        <TabsContent value="mcps">
          <McpServersSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SectionHeader } from '@/components/dashboard/section-header';
import { SkillCenter } from '@/components/dashboard/sections/skills/skill-center';
import { McpServersSection } from '@/components/dashboard/sections/mcps/mcp-servers-section';
import { PluginGallery } from '@/components/dashboard/sections/plugins/plugin-gallery';
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
        description="统一管理市场内容、MCP 服务器与插件"
        onRefresh={handleRefresh}
        isRefreshing={isRefetching}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full max-w-lg grid-cols-3">
          <TabsTrigger value="skills">市场</TabsTrigger>
          <TabsTrigger value="mcps">MCP 服务器</TabsTrigger>
          <TabsTrigger value="plugins">插件</TabsTrigger>
        </TabsList>

        <TabsContent value="skills">
          <SkillCenter onRefresh={handleRefresh} mcpServers={mcpServers} />
        </TabsContent>

        <TabsContent value="mcps">
          <McpServersSection />
        </TabsContent>

        <TabsContent value="plugins">
          <PluginGallery />
        </TabsContent>
      </Tabs>
    </div>
  );
}

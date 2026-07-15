'use client';

import { useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Cpu, Code, Terminal, Layers, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { SectionHeader } from '@/components/dashboard/section-header';
import { useQueryClient } from '@tanstack/react-query';

const runtimeInfo = [
  {
    name: 'OpenClaw',
    key: 'openclaw',
    desc: '标准 AI Agent 运行时，支持多模型、多技能、MCP Server 集成。适合通用 Agent 场景。',
    features: ['多模型支持', '技能插件', 'MCP Server', '容器化', '状态管理'],
    language: 'Go + Python',
    models: ['GPT-4', 'Claude-3', '通义千问', 'DeepSeek'],
    useCases: ['通用 Agent', '内容生成', '代码助手', '数据分析'],
    color: 'text-primary',
    bgColor: 'bg-primary/10 border-primary/20',
  },
  {
    name: 'CoPaw',
    key: 'copaw',
    desc: '协作优先运行时，针对团队协作场景优化。内置协调协议和消息路由。',
    features: ['协作协议', '消息路由', '任务分解', '结果合并', '冲突解决'],
    language: 'Rust',
    models: ['GPT-4', 'Claude-3', 'Gemini'],
    useCases: ['多 Agent 协作', '代码审查', '文档编写', '项目管理'],
    color: 'text-emerald-500',
    bgColor: 'bg-emerald-500/10 border-emerald-500/20',
  },
  {
    name: 'Hermes',
    key: 'hermes',
    desc: '高性能消息运行时，优化了消息处理和实时通信。适合高频交互场景。',
    features: ['消息队列', '实时通信', '流处理', '低延迟', '事件驱动'],
    language: 'Go',
    models: ['GPT-4', 'Claude-3', 'Llama-3'],
    useCases: ['实时交互', '流式处理', '事件驱动', 'IoT 网关'],
    color: 'text-cyan-500',
    bgColor: 'bg-cyan-500/10 border-cyan-500/20',
  },
  {
    name: 'OpenHuman',
    key: 'openhuman',
    desc: '人类交互运行时，为 Human-in-the-Loop 场景设计。支持审批、确认和人工介入。',
    features: ['人工审批', '确认流程', '权限控制', '通知推送', '审计日志'],
    language: 'TypeScript',
    models: ['GPT-4', 'Claude-3'],
    useCases: ['审批流程', '人工介入', '安全审核', '质量保证'],
    color: 'text-violet-500',
    bgColor: 'bg-violet-500/10 border-violet-500/20',
  },
];

export function RuntimeSection() {
  const { data: workers } = useWorkers();
  const { isConnected } = useAgentTeamsStore();
  const queryClient = useQueryClient();
  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['agentteams-workers'] });
  }, [queryClient]);

  const runtimeCounts = useMemo(() => {
    const counts: Record<string, number> = { openclaw: 0, copaw: 0, hermes: 0, openhuman: 0 };
    workers?.forEach((w) => {
      if (counts[w.runtime] !== undefined) counts[w.runtime]++;
    });
    return counts;
  }, [workers]);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="多运行时"
        description="AgentTeams 支持的 Worker 运行时类型"
        isLive={isConnected}
        onRefresh={handleRefresh}
      />

      {/* Runtime Overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {runtimeInfo.map((rt, i) => (
          <motion.div
            key={rt.name}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
          >
            <Card className="glass-card text-center">
              <CardContent className="p-4">
                <Cpu className={`w-8 h-8 ${rt.color} mx-auto mb-2`} />
                <p className="font-semibold text-sm">{rt.name}</p>
                <p className="text-2xl font-bold mt-1">{runtimeCounts[rt.key] || 0}</p>
                <p className="text-xs text-muted-foreground">Workers</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Runtime Comparison Table */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-sm">运行时对比</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-3 font-medium text-muted-foreground">运行时</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">语言</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">核心特性</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">支持模型</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">适用场景</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">实例数</th>
                </tr>
              </thead>
              <tbody>
                {runtimeInfo.map((rt, i) => (
                  <motion.tr
                    key={rt.name}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.1 + i * 0.05 }}
                    className="border-b border-border/50 hover:bg-accent/30"
                  >
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <Cpu className={`w-4 h-4 ${rt.color}`} />
                        <span className="font-medium">{rt.name}</span>
                      </div>
                    </td>
                    <td className="p-3">
                      <Badge variant="outline" className="text-xs">{rt.language}</Badge>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {rt.features.slice(0, 3).map((f) => (
                          <Badge key={f} variant="secondary" className="text-[10px]">{f}</Badge>
                        ))}
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {rt.models.map((m) => (
                          <Badge key={m} variant="outline" className="text-[10px]">{m}</Badge>
                        ))}
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {rt.useCases.map((uc) => (
                          <Badge key={uc} variant="outline" className="text-[10px]">{uc}</Badge>
                        ))}
                      </div>
                    </td>
                    <td className="p-3">
                      <span className="font-bold">{runtimeCounts[rt.key] || 0}</span>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Runtime Details */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {runtimeInfo.map((rt, i) => (
          <motion.div
            key={rt.name}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + i * 0.1 }}
          >
            <Card className="glass-card hover-lift">
              <CardContent className="p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className={`p-2 rounded-lg ${rt.bgColor} border`}>
                    <Cpu className={`w-5 h-5 ${rt.color}`} />
                  </div>
                  <div>
                    <h3 className="font-semibold">{rt.name}</h3>
                    <Badge variant="outline" className="text-xs">
                      {runtimeCounts[rt.key] || 0} 实例
                    </Badge>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mb-3">{rt.desc}</p>
                <div className="space-y-2">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">支持模型</p>
                    <div className="flex flex-wrap gap-1">
                      {rt.models.map((m) => (
                        <Badge key={m} variant="secondary" className="text-[10px]">{m}</Badge>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">核心特性</p>
                    <div className="flex flex-wrap gap-1">
                      {rt.features.map((f) => (
                        <Badge key={f} variant="outline" className="text-[10px]">{f}</Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Runtime Selection Guide */}
      <Card className="glass-card">
        <CardContent className="p-6">
          <h2 className="text-lg font-semibold mb-4">选择指南</h2>
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-primary/5 border border-primary/10">
              <Code className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">通用 Agent 任务</p>
                <p className="text-xs text-muted-foreground">选择 OpenClaw — 最灵活的运行时，支持多模型和 MCP Server 集成</p>
              </div>
              <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/10">
              <Layers className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">多 Agent 协作</p>
                <p className="text-xs text-muted-foreground">选择 CoPaw — 内置协作协议，简化多 Agent 编排</p>
              </div>
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-cyan-500/5 border border-cyan-500/10">
              <Terminal className="w-4 h-4 text-cyan-500 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">高频消息交互</p>
                <p className="text-xs text-muted-foreground">选择 Hermes — 低延迟消息处理，适合实时交互</p>
              </div>
              <CheckCircle2 className="w-5 h-5 text-cyan-500 shrink-0" />
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-violet-500/5 border border-violet-500/10">
              <Cpu className="w-4 h-4 text-violet-500 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">需要人工介入</p>
                <p className="text-xs text-muted-foreground">选择 OpenHuman — Human-in-the-Loop 设计，审批流程完善</p>
              </div>
              <CheckCircle2 className="w-5 h-5 text-violet-500 shrink-0" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

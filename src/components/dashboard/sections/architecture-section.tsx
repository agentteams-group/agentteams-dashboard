'use client';

import { motion } from 'framer-motion';
import {
  GitBranch,
  Server,
  Cpu,
  Shield,
  MessageSquare,
  Users,
  Bot,
  Crown,
  Zap,
  Database,
  ArrowDown,
  Globe,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SectionHeader } from '@/components/dashboard/section-header';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

export function ArchitectureSection() {
  const queryClient = useQueryClient();
  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['agentteams-workers'] });
    queryClient.invalidateQueries({ queryKey: ['agentteams-teams'] });
    queryClient.invalidateQueries({ queryKey: ['agentteams-managers'] });
  }, [queryClient]);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="架构"
        description="AgentTeams 系统架构概览"
        onRefresh={handleRefresh}
      />

      {/* Layered Architecture Diagram */}
      <Card className="glass-card">
        <CardContent className="p-6">
          <h2 className="text-lg font-semibold mb-6 text-center">AgentTeams 分层架构</h2>

          <div className="relative">
            {/* Main Layers Column */}
            <div className="max-w-2xl mx-auto space-y-3">
              {/* Layer 1: Human-in-the-Loop */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0 }}
              >
                <div className="p-4 rounded-xl bg-cyan-500/10 border-2 border-cyan-500/30">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Globe className="w-5 h-5 text-cyan-500" />
                      <span className="font-semibold text-cyan-600 dark:text-cyan-400">人机交互层</span>
                    </div>
                    <Badge variant="outline" className="text-[10px] border-cyan-500/30 text-cyan-600 dark:text-cyan-400">
                      Human-in-the-Loop
                    </Badge>
                  </div>
                  <div className="flex gap-3 flex-wrap">
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-background/60 text-sm">
                      <Users className="w-4 h-4 text-cyan-500" />
                      <span>用户 / 管理员</span>
                    </div>
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-background/60 text-sm">
                      <MessageSquare className="w-4 h-4 text-cyan-500" />
                      <span>Element Web</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">人类通过 Matrix 客户端与 Agent 交互，审批关键决策</p>
                </div>
              </motion.div>

              <div className="flex justify-center">
                <ArrowDown className="w-4 h-4 text-muted-foreground" />
              </div>

              {/* Layer 2: Manager Agent (Orchestration) */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
              >
                <div className="p-4 rounded-xl bg-violet-500/10 border-2 border-violet-500/30">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Crown className="w-5 h-5 text-violet-500" />
                      <span className="font-semibold text-violet-600 dark:text-violet-400">编排层</span>
                    </div>
                    <Badge variant="outline" className="text-[10px] border-violet-500/30 text-violet-600 dark:text-violet-400">
                      Manager Agent
                    </Badge>
                  </div>
                  <div className="flex gap-3 flex-wrap">
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-background/60 text-sm">
                      <GitBranch className="w-4 h-4 text-violet-500" />
                      <span>任务分配</span>
                    </div>
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-background/60 text-sm">
                      <Shield className="w-4 h-4 text-violet-500" />
                      <span>冲突解决</span>
                    </div>
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-background/60 text-sm">
                      <Zap className="w-4 h-4 text-violet-500" />
                      <span>结果聚合</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">Manager 协调多个团队，管理任务生命周期</p>
                </div>
              </motion.div>

              <div className="flex justify-center">
                <ArrowDown className="w-4 h-4 text-muted-foreground" />
              </div>

              {/* Layer 3: Team Leaders */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                <div className="p-4 rounded-xl bg-emerald-500/10 border-2 border-emerald-500/30">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Users className="w-5 h-5 text-emerald-500" />
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">团队领导层</span>
                    </div>
                    <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
                      Team Leaders
                    </Badge>
                  </div>
                  <div className="flex gap-3 flex-wrap">
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-background/60 text-sm">
                      <Users className="w-4 h-4 text-emerald-500" />
                      <span>团队协调</span>
                    </div>
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-background/60 text-sm">
                      <Bot className="w-4 h-4 text-emerald-500" />
                      <span>Worker 管理</span>
                    </div>
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-background/60 text-sm">
                      <MessageSquare className="w-4 h-4 text-emerald-500" />
                      <span>心跳检测</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">Team Leader 管理 Worker 生命周期，监控健康状态</p>
                </div>
              </motion.div>

              <div className="flex justify-center">
                <ArrowDown className="w-4 h-4 text-muted-foreground" />
              </div>

              {/* Layer 4: Workers (Execution) */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                <div className="p-4 rounded-xl bg-primary/10 border-2 border-primary/30">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Bot className="w-5 h-5 text-primary" />
                      <span className="font-semibold text-primary dark:text-primary">执行层</span>
                    </div>
                    <Badge variant="outline" className="text-[10px] border-primary/30 text-primary dark:text-primary">
                      Workers
                    </Badge>
                  </div>
                  <div className="flex gap-3 flex-wrap">
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-background/60 text-sm">
                      <Cpu className="w-4 h-4 text-primary" />
                      <span>OpenClaw</span>
                    </div>
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-background/60 text-sm">
                      <Cpu className="w-4 h-4 text-primary" />
                      <span>CoPaw</span>
                    </div>
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-background/60 text-sm">
                      <Cpu className="w-4 h-4 text-primary" />
                      <span>Hermes</span>
                    </div>
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-background/60 text-sm">
                      <Cpu className="w-4 h-4 text-primary" />
                      <span>OpenHuman</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">Worker 执行具体任务，支持多运行时和技能插件</p>
                </div>
              </motion.div>
            </div>

            {/* Side Components */}
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl mx-auto">
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 }}
              >
                <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-center">
                  <MessageSquare className="w-5 h-5 text-blue-500 mx-auto mb-1" />
                  <p className="text-xs font-semibold">Matrix 协议</p>
                  <p className="text-[10px] text-muted-foreground">通信层</p>
                  <p className="text-[10px] text-muted-foreground mt-1">端到端加密、房间模型、实时同步</p>
                </div>
              </motion.div>
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
              >
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-center">
                  <Database className="w-5 h-5 text-amber-500 mx-auto mb-1" />
                  <p className="text-xs font-semibold">MinIO</p>
                  <p className="text-[10px] text-muted-foreground">存储层</p>
                  <p className="text-[10px] text-muted-foreground mt-1">技能包存储、配置管理、对象存储</p>
                </div>
              </motion.div>
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.6 }}
              >
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-center">
                  <Shield className="w-5 h-5 text-rose-500 mx-auto mb-1" />
                  <p className="text-xs font-semibold">Higress 网关</p>
                  <p className="text-[10px] text-muted-foreground">网关层</p>
                  <p className="text-[10px] text-muted-foreground mt-1">API 认证、限流、凭证隔离</p>
                </div>
              </motion.div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Key Concepts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          {
            icon: GitBranch,
            title: '声明式管理',
            desc: '所有资源通过 K8s CRD 定义，Controller 自动调谐确保期望状态与实际状态一致。',
            color: 'text-violet-500',
          },
          {
            icon: MessageSquare,
            title: '事件驱动',
            desc: '基于 Matrix 协议的实时通信，所有 Agent 交互通过消息事件触发。',
            color: 'text-cyan-500',
          },
          {
            icon: Server,
            title: '分层架构',
            desc: '交互层 → 编排层 → 领导层 → 执行层，各层职责清晰，依赖单向。',
            color: 'text-emerald-500',
          },
          {
            icon: Bot,
            title: '弹性伸缩',
            desc: 'Worker 可按需唤醒/休眠，Team 动态组建，Manager 自动协调。',
            color: 'text-primary',
          },
        ].map((item, i) => (
          <motion.div
            key={item.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 + i * 0.1 }}
          >
            <Card className="glass-card hover-lift">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <item.icon className={`w-5 h-5 ${item.color}`} />
                  <h3 className="font-semibold">{item.title}</h3>
                </div>
                <p className="text-sm text-muted-foreground">{item.desc}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Data Flow Diagram */}
      <Card className="glass-card">
        <CardContent className="p-6">
          <h2 className="text-lg font-semibold mb-4">数据流</h2>
          <div className="flex items-center justify-center gap-2 py-4 flex-wrap text-sm">
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
              <Users className="w-4 h-4 text-cyan-500" />
              <span>用户请求</span>
            </div>
            <span className="text-muted-foreground">→</span>
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20">
              <Shield className="w-4 h-4 text-rose-500" />
              <span>Higress</span>
            </div>
            <span className="text-muted-foreground">→</span>
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
              <Crown className="w-4 h-4 text-violet-500" />
              <span>Manager</span>
            </div>
            <span className="text-muted-foreground">→</span>
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <Users className="w-4 h-4 text-emerald-500" />
              <span>Team</span>
            </div>
            <span className="text-muted-foreground">→</span>
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20">
              <Bot className="w-4 h-4 text-primary" />
              <span>Workers</span>
            </div>
            <span className="text-muted-foreground">→</span>
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <MessageSquare className="w-4 h-4 text-blue-500" />
              <span>Matrix</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground text-center mt-2">
            所有通信通过 Matrix 协议进行，Higress 网关在入口处进行认证和限流
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

'use client';

import { motion } from 'framer-motion';
import { Rocket, Terminal, Copy, Check, Server, Container, WifiOff, CheckCircle2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useState, useMemo, useCallback } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SectionHeader } from '@/components/dashboard/section-header';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useCopyToClipboard } from '@/lib/use-copy-to-clipboard';
import { useInfrastructure } from '@/hooks/use-agentteams-infrastructure';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { useTeams } from '@/hooks/use-agentteams-teams';
import { useManagers } from '@/hooks/use-agentteams-managers';
import { useHumans } from '@/hooks/use-agentteams-humans';

const STEPS_KEY = 'agentteams-quickstart-completed';

function getCompletedSteps(): Set<number> {
  if (typeof window === 'undefined') return new Set();
  try {
    const stored = localStorage.getItem(STEPS_KEY);
    if (stored) return new Set(JSON.parse(stored));
  } catch { /* ignore */ }
  return new Set();
}

function saveCompletedSteps(steps: Set<number>) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STEPS_KEY, JSON.stringify([...steps]));
  } catch { /* ignore */ }
}

function CodeBlock({ code, onCopyAll }: { code: string; onCopyAll?: () => void }) {
  const { copied, copy } = useCopyToClipboard({ onCopy: () => onCopyAll?.() });

  return (
    <div className="relative group">
      <pre className="bg-muted/50 rounded-lg p-3 text-xs font-mono overflow-x-auto custom-scrollbar border border-border/50 whitespace-pre-wrap break-all">
        <code>{code}</code>
      </pre>
      <Button
        variant="ghost"
        size="sm"
        className="absolute top-2 right-2 h-7 gap-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={() => copy(code)}
      >
        {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
        {copied ? '已复制' : '复制命令'}
      </Button>
    </div>
  );
}

export function QuickstartSection() {
  const { controllerUrl, isConnected } = useAgentTeamsStore();
  const { data: infra } = useInfrastructure();
  const { data: workers } = useWorkers();
  const { data: teams } = useTeams();
  const { data: managers } = useManagers();
  const { data: humans } = useHumans();

  const [completedSteps, setCompletedSteps] = useState<Set<number>>(() => {
    if (typeof window !== 'undefined') {
      return getCompletedSteps();
    }
    return new Set();
  });

  const toggleStep = (step: number) => {
    setCompletedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(step)) next.delete(step);
      else next.add(step);
      saveCompletedSteps(next);
      return next;
    });
  };

  const baseUrl = controllerUrl || 'http://localhost:8090';

  const steps = useMemo(() => [
    {
      step: 1,
      title: '健康检查',
      desc: '验证 Controller 是否运行正常。',
      code: `curl ${baseUrl}/healthz`,
      expected: 'ok',
    },
    {
      step: 2,
      title: '查看现有 Workers',
      desc: '获取当前所有 Worker 列表。',
      code: `curl ${baseUrl}/api/v1/workers`,
      expected: '{"workers": [...], "total": N}',
    },
    {
      step: 3,
      title: '创建 Worker',
      desc: '创建你的第一个 AI Agent Worker，并写入 AI 网关中已配置的请求模型别名。',
      code: `curl -X POST ${baseUrl}/api/v1/workers \\
  -H "Content-Type: application/json" \\
   -d '{"name":"my-worker","runtime":"openclaw","model":"team-chat"}'`,
      expected: 'Worker 创建成功',
    },
    {
      step: 4,
      title: '创建团队',
      desc: '组建团队让 Worker 协作。',
      code: `curl -X POST ${baseUrl}/api/v1/teams \\
  -H "Content-Type: application/json" \\
  -d '{"name":"my-team","workerNames":["my-worker"]}'`,
      expected: '团队创建成功',
    },
    {
      step: 5,
      title: '创建 Manager',
      desc: '部署 Manager 来领导团队，并写入 AI 网关中已配置的请求模型别名。',
      code: `curl -X POST ${baseUrl}/api/v1/managers \\
  -H "Content-Type: application/json" \\
   -d '{"name":"my-manager","model":"team-chat"}'`,
      expected: 'Manager 创建成功',
    },
    {
      step: 6,
      title: '创建人类用户',
      desc: '添加人类用户实现 Human-in-the-Loop。',
      code: `curl -X POST ${baseUrl}/api/v1/humans \\
  -H "Content-Type: application/json" \\
  -d '{"name":"alice","displayName":"Alice"}'`,
      expected: '用户创建成功',
    },
    {
      step: 7,
      title: '唤醒 Worker',
      desc: '唤醒 Worker 开始工作。',
      code: `curl -X POST ${baseUrl}/api/v1/workers/my-worker/wake`,
      expected: 'Worker 已唤醒',
    },
  ], [baseUrl]);

  // Prerequisites check
  const prerequisites = useMemo(() => {
    const checks: { label: string; met: boolean; detail: string }[] = [];

    checks.push({
      label: 'AgentTeams Controller 运行中',
      met: isConnected,
      detail: isConnected ? `已连接: ${baseUrl}` : `未连接: ${baseUrl}`,
    });

    checks.push({
      label: 'Kubernetes 集群',
      met: !!infra?.kubernetes?.healthy,
      detail: infra?.kubernetes?.healthy ? `版本: ${infra.kubernetes.version}` : 'K8s 不可用（嵌入式模式可忽略）',
    });

    checks.push({
      label: 'Matrix 服务器 (Synapse)',
      met: !!infra?.matrix?.healthy,
      detail: infra?.matrix?.healthy ? `Homeserver: ${infra.matrix.homeserver}` : 'Matrix 服务未部署',
    });

    checks.push({
      label: 'MinIO 对象存储',
      met: !!infra?.minio?.healthy,
      detail: infra?.minio?.healthy ? `端点: ${infra.minio.endpoint}` : 'MinIO 不可用（包管理功能受限）',
    });

    return checks;
  }, [isConnected, baseUrl, infra]);

  const metCount = prerequisites.filter((p) => p.met).length;

  // Auto-detect completed steps based on actual data
  const autoDetectedSteps = useMemo(() => {
    const detected = new Set<number>();
    if (isConnected) detected.add(1);
    if (workers && workers.length > 0) { detected.add(2); detected.add(3); }
    if (teams && teams.length > 0) detected.add(4);
    if (managers && managers.length > 0) detected.add(5);
    if (humans && humans.length > 0) detected.add(6);
    if (workers?.some((w) => w.phase === 'Running' || w.phase === 'Ready')) detected.add(7);
    return detected;
  }, [isConnected, workers, teams, managers, humans]);

  // Merge auto-detected with manually toggled
  const effectiveCompleted = useMemo(() => {
    const merged = new Set(completedSteps);
    autoDetectedSteps.forEach((s) => merged.add(s));
    return merged;
  }, [completedSteps, autoDetectedSteps]);

  const progressPercent = steps.length > 0 ? Math.round((effectiveCompleted.size / steps.length) * 100) : 0;

  const handleRefresh = useCallback(() => {
    // No-op, data is auto-refreshed
  }, []);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="快速开始"
        description="7 步快速上手 AgentTeams"
        onRefresh={handleRefresh}
      />

      {/* Progress Bar */}
      <Card className="glass-card">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">完成进度</span>
            <Badge variant="outline" className="text-[10px]">
              {effectiveCompleted.size}/{steps.length} 步
            </Badge>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-emerald-500 to-cyan-500 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${progressPercent}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            {progressPercent === 100
              ? '🎉 所有必要步骤已完成！'
              : progressPercent >= 50
                ? `进展顺利，还剩 ${steps.length - effectiveCompleted.size} 步`
                : '按照以下步骤开始使用 AgentTeams'}
          </p>
        </CardContent>
      </Card>

      {/* Prerequisites */}
      <Card className="glass-card border-amber-500/20">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Rocket className="w-5 h-5 text-amber-500" />
            <span className="font-medium">前提条件</span>
            <Badge variant="outline" className="text-[10px]">
              {metCount}/{prerequisites.length} 满足
            </Badge>
          </div>
          <div className="space-y-2">
            {prerequisites.map((pre) => (
              <div key={pre.label} className="flex items-start gap-2.5 p-2 rounded-md bg-background/50">
                {pre.met ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                ) : (
                  <WifiOff className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{pre.label}</span>
                    <Badge variant={pre.met ? 'outline' : 'secondary'} className={`text-[10px] ${pre.met ? 'text-emerald-600 border-emerald-500/30' : 'text-amber-600'}`}>
                      {pre.met ? '就绪' : '未就绪'}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{pre.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Deployment Methods */}
      <Card className="glass-card">
        <CardContent className="p-6">
          <h2 className="text-lg font-semibold mb-4">部署方式</h2>
          <Tabs defaultValue="embedded">
            <TabsList>
              <TabsTrigger value="embedded">
                <Server className="w-3.5 h-3.5 mr-1.5" />
                嵌入式模式
              </TabsTrigger>
              <TabsTrigger value="k8s">
                <Container className="w-3.5 h-3.5 mr-1.5" />
                K8s InCluster 模式
              </TabsTrigger>
            </TabsList>
            <TabsContent value="embedded" className="mt-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                嵌入式模式适用于开发和测试环境，Controller 直接在宿主机上运行。
              </p>
              <CodeBlock code={`# 下载并启动 Controller\nagentteams controller start --mode=embedded\n\n# 验证\ncurl ${baseUrl}/healthz`} />
              <div className="grid grid-cols-2 gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/5 border border-emerald-500/10">
                  <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">优点</p>
                  <p className="text-xs text-muted-foreground">快速启动、无需 K8s 集群</p>
                </div>
                <div className="p-2 rounded-lg bg-amber-500/5 border border-amber-500/10">
                  <p className="text-xs font-medium text-amber-600 dark:text-amber-400">注意</p>
                  <p className="text-xs text-muted-foreground">不支持自动伸缩、无 CRD 管理</p>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="k8s" className="mt-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                K8s InCluster 模式适用于生产环境，Controller 在集群内运行并管理 CRD。
              </p>
              <CodeBlock code={`# 使用 Helm 部署\nhelm install agentteams ./charts/agentteams \\\n  --namespace agentteams-system \\\n  --create-namespace\n\n# 验证\nkubectl get pods -n agentteams-system\nkubectl port-forward svc/agentteams-controller 8090:8090 -n agentteams-system`} />
              <div className="grid grid-cols-2 gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/5 border border-emerald-500/10">
                  <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">优点</p>
                  <p className="text-xs text-muted-foreground">声明式管理、自动调谐、弹性伸缩</p>
                </div>
                <div className="p-2 rounded-lg bg-amber-500/5 border border-amber-500/10">
                  <p className="text-xs font-medium text-amber-600 dark:text-amber-400">注意</p>
                  <p className="text-xs text-muted-foreground">需要 K8s 集群、配置更复杂</p>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Steps */}
      <div className="space-y-4">
        {steps.map((step, i) => {
          const isCompleted = effectiveCompleted.has(step.step);
          const isAutoDetected = autoDetectedSteps.has(step.step);
          return (
            <motion.div
              key={step.step}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1 }}
            >
              <Card className={`glass-card transition-all ${isCompleted ? 'border-emerald-500/20 bg-emerald-500/[0.02]' : ''}`}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    {/* Step number / completion indicator */}
                    <button
                      onClick={() => toggleStep(step.step)}
                      className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                      title={isCompleted ? '标记为未完成' : '标记为已完成'}
                      style={{
                        backgroundColor: isCompleted ? 'rgba(16,185,129,0.1)' : 'rgba(var(--primary),0.1)',
                      }}
                    >
                      {isCompleted ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                      ) : (
                        <span className="text-sm font-bold text-primary">{step.step}</span>
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className={`font-semibold ${isCompleted ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>
                          {step.title}
                        </h3>
                        {isAutoDetected && (
                          <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-500/30">
                            自动检测
                          </Badge>
                        )}
                        {isCompleted && !isAutoDetected && (
                          <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-500/30">
                            已完成
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mb-3">{step.desc}</p>
                      <CodeBlock code={step.code} />
                      {step.expected && (
                        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline" className="text-[10px]">期望返回</Badge>
                          <code className="font-mono">{step.expected}</code>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      {/* Next Steps */}
      <Card className="glass-card">
        <CardContent className="p-6">
          <h2 className="text-lg font-semibold mb-4">后续步骤</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { title: '配置 MCP Server', desc: '集成外部工具和服务到 Worker' },
              { title: '上传技能包', desc: '使用 MinIO 上传自定义技能包' },
              { title: '设置网关消费者', desc: '通过 Higress 网关控制 API 访问' },
              { title: '探索 Dashboard', desc: '使用此面板监控和管理所有资源' },
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-background/50">
                <Terminal className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-sm">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

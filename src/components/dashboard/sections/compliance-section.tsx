'use client';

import { useMemo } from 'react';
import {
  FileCheck,
  Shield,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Download,
  Users,
  Eye,
  Play,
  Pencil,
  Trash2,
  Sun,
  Moon,
} from 'lucide-react';
import { SectionHeader } from '@/components/dashboard/section-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { usePolicyStore } from '@/lib/policy-store';
import { evaluatePolicies } from '@/lib/policy-engine';
import { getAccessSummary } from '@/lib/rbac-engine';
import { useAuditStore } from '@/lib/audit-store';
import { useWorkers } from '@/hooks/use-hiclaw-workers';
import { useTeams } from '@/hooks/use-hiclaw-teams';
import { useManagers } from '@/hooks/use-hiclaw-managers';
import { useHumans } from '@/hooks/use-hiclaw-humans';

const PERM_ICONS: Record<string, React.ReactNode> = {
  view: <Eye className="w-3 h-3" />,
  create: <Play className="w-3 h-3" />,
  update: <Pencil className="w-3 h-3" />,
  delete: <Trash2 className="w-3 h-3" />,
  wake: <Sun className="w-3 h-3" />,
  sleep: <Moon className="w-3 h-3" />,
  'ensure-ready': <CheckCircle2 className="w-3 h-3" />,
};

export function ComplianceSection() {
  const { policies } = usePolicyStore();
  const { data: workers } = useWorkers();
  const { data: teams } = useTeams();
  const { data: managers } = useManagers();
  const { data: humans } = useHumans();
  const auditEvents = useAuditStore((s) => s.events);

  const violations = useMemo(
    () =>
      evaluatePolicies(policies, {
        workers: workers || [],
        teams: teams || [],
        managers: managers || [],
        humans: humans || [],
      }),
    [policies, workers, teams, managers, humans]
  );

  const enabledPolicies = policies.filter((p) => p.enabled).length;
  const passingPolicies = policies.filter(
    (p) => p.enabled && !violations.some((v) => v.policyId === p.id)
  ).length;
  const complianceRate = enabledPolicies > 0 ? Math.round((passingPolicies / enabledPolicies) * 100) : 100;

  const recentEvents = auditEvents.slice(0, 20);

  const handleExport = () => {
    const report = {
      generatedAt: new Date().toISOString(),
      complianceRate,
      totalPolicies: enabledPolicies,
      passingPolicies,
      violations: violations.length,
      policyDetails: policies.map((p) => ({
        name: p.name,
        enabled: p.enabled,
        violations: violations.filter((v) => v.policyId === p.id).length,
      })),
      rbacSummary: (humans || []).map((h) => ({
        name: h.name,
        ...getAccessSummary(h),
      })),
      recentAuditEvents: recentEvents.map((e) => ({
        time: new Date(e.timestamp).toISOString(),
        action: e.action,
        entity: `${e.entityType}/${e.entityName}`,
        severity: e.severity,
      })),
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `compliance-report-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <SectionHeader
          title="合规仪表盘"
          description="策略合规率、RBAC 审计、治理事件汇总"
        />
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="w-3.5 h-3.5 mr-1" />
          导出报告
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Card className="glass-card">
          <CardContent className="p-3 flex items-center gap-3">
            {complianceRate >= 90 ? (
              <CheckCircle2 className="w-8 h-8 text-emerald-500" />
            ) : (
              <AlertTriangle className="w-8 h-8 text-amber-500" />
            )}
            <div>
              <p className="text-2xl font-bold">{complianceRate}%</p>
              <p className="text-[10px] text-muted-foreground">合规率</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-3 flex items-center gap-3">
            <Shield className="w-8 h-8 text-violet-500" />
            <div>
              <p className="text-2xl font-bold">{passingPolicies}/{enabledPolicies}</p>
              <p className="text-[10px] text-muted-foreground">通过策略</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-3 flex items-center gap-3">
            <Users className="w-8 h-8 text-cyan-500" />
            <div>
              <p className="text-2xl font-bold">{humans?.length ?? 0}</p>
              <p className="text-[10px] text-muted-foreground">注册用户</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-3 flex items-center gap-3">
            <FileCheck className="w-8 h-8 text-emerald-500" />
            <div>
              <p className="text-2xl font-bold">{auditEvents.length}</p>
              <p className="text-[10px] text-muted-foreground">审计事件</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Policy compliance breakdown */}
      <Card className="glass-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">策略合规明细</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {policies.filter((p) => p.enabled).map((policy) => {
              const policyViolations = violations.filter((v) => v.policyId === policy.id);
              const passing = policyViolations.length === 0;
              return (
                <div key={policy.id} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
                  <div className="flex items-center gap-2">
                    {passing ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-500" />
                    )}
                    <span className="text-xs font-medium">{policy.name}</span>
                  </div>
                  <Badge variant={passing ? 'outline' : 'destructive'} className="text-[10px]">
                    {passing ? '通过' : `${policyViolations.length} 违规`}
                  </Badge>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* RBAC summary */}
      {humans && humans.length > 0 && (
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">RBAC 权限审计</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {humans.map((human) => {
                const summary = getAccessSummary(human);
                return (
                  <div key={human.name} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-muted-foreground" />
                      <span className="text-xs font-medium">{human.displayName || human.name}</span>
                      <Badge variant="outline" className="text-[9px]">{summary.level}</Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      {summary.permissions.slice(0, 4).map((p) => (
                        <Badge key={p} variant="secondary" className="text-[8px] p-0.5">
                          {PERM_ICONS[p]}
                        </Badge>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent audit events */}
      {recentEvents.length > 0 && (
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">最近审计事件</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {recentEvents.map((event) => (
                <div key={event.id} className="flex items-center gap-2 text-xs py-1 border-b border-border/30 last:border-0">
                  <Badge
                    variant={event.severity === 'error' ? 'destructive' : event.severity === 'warning' ? 'secondary' : 'outline'}
                    className="text-[8px] shrink-0"
                  >
                    {event.severity}
                  </Badge>
                  <span className="text-muted-foreground shrink-0">
                    {new Date(event.timestamp).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="font-medium">{event.entityName}</span>
                  <span className="text-muted-foreground">{event.action}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

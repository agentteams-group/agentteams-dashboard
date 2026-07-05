'use client';

import { useMemo } from 'react';
import {
  Shield,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ToggleLeft,
  ToggleRight,
  Zap,
  Trash2,
  Info,
} from 'lucide-react';
import { SectionHeader } from '@/components/dashboard/section-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { usePolicyStore } from '@/lib/policy-store';
import { evaluatePolicies, type PolicyViolation } from '@/lib/policy-engine';
import { determineRemediation } from '@/lib/remediation-engine';
import { useWorkers } from '@/hooks/use-hiclaw-workers';
import { useTeams } from '@/hooks/use-hiclaw-teams';
import { useManagers } from '@/hooks/use-hiclaw-managers';
import { useHumans } from '@/hooks/use-hiclaw-humans';
import { BUILTIN_POLICIES } from '@/lib/policy-engine';

export function PoliciesSection() {
  const { policies, togglePolicy, deletePolicy } = usePolicyStore();
  const { data: workers } = useWorkers();
  const { data: teams } = useTeams();
  const { data: managers } = useManagers();
  const { data: humans } = useHumans();

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

  const violationsByPolicy = useMemo(() => {
    const map = new Map<string, PolicyViolation[]>();
    for (const v of violations) {
      const list = map.get(v.policyId) || [];
      list.push(v);
      map.set(v.policyId, list);
    }
    return map;
  }, [violations]);

  const totalViolations = violations.length;
  const criticalViolations = violations.filter((v) => v.enforcement === 'auto-remediate').length;
  const enabledPolicies = policies.filter((p) => p.enabled).length;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="治理策略"
        description="定义和管理 Agent/团队治理规则，系统自动检测违规"
      />

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="glass-card">
          <CardContent className="p-3 flex items-center gap-3">
            <Shield className="w-8 h-8 text-violet-500" />
            <div>
              <p className="text-2xl font-bold">{enabledPolicies}</p>
              <p className="text-[10px] text-muted-foreground">活跃策略</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-3 flex items-center gap-3">
            {totalViolations === 0 ? (
              <CheckCircle2 className="w-8 h-8 text-emerald-500" />
            ) : (
              <AlertTriangle className="w-8 h-8 text-amber-500" />
            )}
            <div>
              <p className="text-2xl font-bold">{totalViolations}</p>
              <p className="text-[10px] text-muted-foreground">违规项</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-3 flex items-center gap-3">
            <XCircle className={`w-8 h-8 ${criticalViolations > 0 ? 'text-red-500' : 'text-gray-400'}`} />
            <div>
              <p className="text-2xl font-bold">{criticalViolations}</p>
              <p className="text-[10px] text-muted-foreground">严重违规</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Policy list */}
      <div className="space-y-3">
        {policies.map((policy) => {
          const policyViolations = violationsByPolicy.get(policy.id) || [];
          const isBuiltin = BUILTIN_POLICIES.some((bp) => bp.id === policy.id);
          const hasViolations = policyViolations.length > 0;

          return (
            <Card key={policy.id} className={`glass-card ${!policy.enabled ? 'opacity-60' : ''}`}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button onClick={() => togglePolicy(policy.id)}>
                      {policy.enabled ? (
                        <ToggleRight className="w-5 h-5 text-emerald-500" />
                      ) : (
                        <ToggleLeft className="w-5 h-5 text-gray-400" />
                      )}
                    </button>
                    <CardTitle className="text-sm">{policy.name}</CardTitle>
                    {isBuiltin && (
                      <Badge variant="secondary" className="text-[9px]">内置</Badge>
                    )}
                    <Badge
                      variant="outline"
                      className={`text-[9px] ${
                        policy.enforcement === 'auto-remediate'
                          ? 'text-red-500'
                          : policy.enforcement === 'block'
                            ? 'text-amber-500'
                            : 'text-blue-500'
                      }`}
                    >
                      {policy.enforcement === 'warn' ? '告警' : policy.enforcement === 'block' ? '阻止' : '自动修复'}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    {hasViolations && (
                      <Badge variant="destructive" className="text-[10px]">
                        {policyViolations.length} 违规
                      </Badge>
                    )}
                    {!isBuiltin && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => deletePolicy(policy.id)}
                      >
                        <Trash2 className="w-3 h-3 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-xs text-muted-foreground mb-2">{policy.description}</p>

                {/* Show violations with remediation info */}
                {hasViolations && (
                  <div className="space-y-1 mt-2">
                    {policyViolations.slice(0, 5).map((v, i) => {
                      const remediation = policy.enforcement === 'auto-remediate' ? determineRemediation(v) : null;
                      return (
                        <div key={i}>
                          <div className="flex items-center gap-2 text-[10px] text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            <span>{v.message}</span>
                          </div>
                          {remediation && (
                            <div className="flex items-center gap-1.5 ml-5 text-[9px] text-blue-500">
                              <Zap className="w-2.5 h-2.5" />
                              <span>自动: {remediation.reason}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {policyViolations.length > 5 && (
                      <p className="text-[10px] text-muted-foreground">
                        ...还有 {policyViolations.length - 5} 项违规
                      </p>
                    )}
                  </div>
                )}

                {!hasViolations && policy.enabled && (
                  <div className="flex items-center gap-1.5 text-[10px] text-emerald-500 mt-1">
                    <CheckCircle2 className="w-3 h-3" />
                    全部通过
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Info */}
      <div className="border border-border/50 rounded-lg p-4 bg-muted/30">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-medium">策略引擎</p>
            <p className="text-xs text-muted-foreground">
              内置策略自动检测常见问题。自定义策略功能将在后续版本中开放。
              违规项每 15 秒自动刷新。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

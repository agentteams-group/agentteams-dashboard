'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Sparkles,
  Search,
  Bot,
  Crown,
  Server,
  ChevronDown,
  ChevronRight,
  Link2,
  Wifi,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { useManagers } from '@/hooks/use-agentteams-managers';
import { useSearch } from '@/lib/search-context';
import { SectionHeader } from '@/components/dashboard/section-header';
import { WORKER_PHASE_BADGE_CLASSES, MANAGER_PHASE_BADGE_CLASSES } from '@/lib/phase-colors';


interface SkillInfo {
  name: string;
  workers: { name: string; phase: string; runtime: string }[];
  managers: { name: string; phase: string }[];
  totalCount: number;
}

interface MCPServerInfo {
  name: string;
  url: string;
  transport: string;
  workers: string[];
}

function SkillCard({ skill, isExpanded, onToggle }: {
  skill: SkillInfo;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const categoryColors: Record<string, string> = {
    '协调': 'bg-primary/10 text-primary dark:text-primary',
    '监控': 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
    '处理': 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    '容错': 'bg-red-500/10 text-red-600 dark:text-red-400',
    '优化': 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
    '通信': 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  };

  // Infer category from skill name heuristics
  const inferCategory = (name: string): string => {
    const lower = name.toLowerCase();
    if (lower.includes('coord') || lower.includes('assign') || lower.includes('match') || lower.includes('team') || lower.includes('conflict')) return '协调';
    if (lower.includes('monitor') || lower.includes('track') || lower.includes('health') || lower.includes('progress') || lower.includes('deadline')) return '监控';
    if (lower.includes('process') || lower.includes('aggregate') || lower.includes('report')) return '处理';
    if (lower.includes('error') || lower.includes('recover') || lower.includes('retry') || lower.includes('fallback')) return '容错';
    if (lower.includes('optim') || lower.includes('load') || lower.includes('balance') || lower.includes('priorit')) return '优化';
    if (lower.includes('comm') || lower.includes('relay') || lower.includes('message') || lower.includes('notify')) return '通信';
    return '处理';
  };

  const category = inferCategory(skill.name);
  const colorClass = categoryColors[category] || '';

  return (
    <Card className="glass-card hover-lift">
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-xs font-medium truncate">{skill.name}</span>
            <Badge className={`text-[10px] shrink-0 ${colorClass}`} variant="secondary">
              {category}
            </Badge>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Badge variant="outline" className="text-[10px]">
              {skill.totalCount} 使用者
            </Badge>
            <button
              onClick={onToggle}
              className="p-0.5 hover:bg-accent rounded"
            >
              {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Compact badges for workers/managers */}
        <div className="flex flex-wrap gap-1 mt-1.5">
          {skill.workers.slice(0, 3).map((w) => (
            <Badge key={w.name} variant="outline" className="text-[10px] gap-1">
              <Bot className="w-2.5 h-2.5 text-primary" />
              {w.name}
            </Badge>
          ))}
          {skill.workers.length > 3 && (
            <Badge variant="outline" className="text-[10px]">+{skill.workers.length - 3}</Badge>
          )}
          {skill.managers.slice(0, 2).map((m) => (
            <Badge key={m.name} variant="outline" className="text-[10px] gap-1">
              <Crown className="w-2.5 h-2.5 text-violet-500" />
              {m.name}
            </Badge>
          ))}
          {skill.managers.length > 2 && (
            <Badge variant="outline" className="text-[10px]">+{skill.managers.length - 2}</Badge>
          )}
        </div>

        {/* Expanded details */}
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            className="mt-2 space-y-2 overflow-hidden"
          >
            {skill.workers.length > 0 && (
              <div className="p-2 rounded-md bg-muted/30">
                <p className="text-[10px] text-muted-foreground font-medium mb-1 flex items-center gap-1">
                  <Bot className="w-3 h-3 text-primary" />
                  使用此技能的 Workers
                </p>
                <div className="flex flex-wrap gap-1">
                  {skill.workers.map((w) => (
                    <Badge key={w.name} variant="secondary" className={`text-[10px] ${WORKER_PHASE_BADGE_CLASSES[w.phase] || ''}`}>
                      {w.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {skill.managers.length > 0 && (
              <div className="p-2 rounded-md bg-muted/30">
                <p className="text-[10px] text-muted-foreground font-medium mb-1 flex items-center gap-1">
                  <Crown className="w-3 h-3 text-violet-500" />
                  使用此技能的 Managers
                </p>
                <div className="flex flex-wrap gap-1">
                  {skill.managers.map((m) => (
                    <Badge key={m.name} variant="secondary" className={`text-[10px] ${MANAGER_PHASE_BADGE_CLASSES[m.phase] || ''}`}>
                      {m.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}

export function SkillsSection() {
  const { data: workers, refetch, isRefetching } = useWorkers();
  const { data: managers } = useManagers();
  const { searchQuery } = useSearch();
  const [localFilter, setLocalFilter] = useState('');
  const [expandedSkills, setExpandedSkills] = useState<Set<string>>(new Set());
  const [mcpExpanded, setMcpExpanded] = useState<Set<string>>(new Set());

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const toggleSkill = (name: string) => {
    setExpandedSkills((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleMcp = (name: string) => {
    setMcpExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  // Derive skills dynamically from Workers and Managers
  const dynamicSkills = useMemo(() => {
    const skillMap = new Map<string, SkillInfo>();

    // Extract skills from workers
    workers?.forEach((w) => {
      const skills: string[] = [];
      // Workers have a 'role' field that acts as their primary skill
      if (w.role) skills.push(w.role);
      // The worker name itself often indicates a skill type
      // We could also parse from the worker's image or config

      skills.forEach((skillName) => {
        if (!skillMap.has(skillName)) {
          skillMap.set(skillName, { name: skillName, workers: [], managers: [], totalCount: 0 });
        }
        const info = skillMap.get(skillName)!;
        info.workers.push({ name: w.name, phase: w.phase, runtime: w.runtime });
        info.totalCount++;
      });
    });

    // Extract skills from managers - derive from the teams they lead
    managers?.forEach((m) => {
      const managerSkills: string[] = [];
      if (Array.isArray(m.skills)) {
        managerSkills.push(...m.skills);
      }
      // Otherwise derive from runtime/role
      if (managerSkills.length === 0) {
        const runtime = (m.runtime || '').toLowerCase();
        if (runtime.includes('openclaw')) managerSkills.push('task_assignment', 'worker_coordination');
        else if (runtime.includes('copaw')) managerSkills.push('team_formation', 'conflict_resolution');
        else if (runtime.includes('hermes')) managerSkills.push('message_routing', 'realtime_coordination');
        else if (runtime.includes('openhuman')) managerSkills.push('human_approval', 'escalation');
        else managerSkills.push('coordination');
      }
      managerSkills.forEach((skillName) => {
        if (!skillMap.has(skillName)) {
          skillMap.set(skillName, { name: skillName, workers: [], managers: [], totalCount: 0 });
        }
        const info = skillMap.get(skillName)!;
        info.managers.push({ name: m.name, phase: m.phase });
        info.totalCount++;
      });
    });

    return Array.from(skillMap.values()).sort((a, b) => b.totalCount - a.totalCount);
  }, [workers, managers]);

  // Extract MCP server configurations from workers
  const mcpServers = useMemo(() => {
    const serverMap = new Map<string, MCPServerInfo>();

    workers?.forEach((w) => {
      const mcpConfigs = w.mcpServers;
      if (mcpConfigs && Array.isArray(mcpConfigs)) {
        mcpConfigs.forEach((mcp) => {
          const key = `${mcp.name}-${mcp.url}`;
          if (!serverMap.has(key)) {
            serverMap.set(key, { name: mcp.name, url: mcp.url, transport: mcp.transport, workers: [] });
          }
          serverMap.get(key)!.workers.push(w.name);
        });
      }
    });

    return Array.from(serverMap.values());
  }, [workers]);

  // Worker skills summary (which worker has which skill)
  const workerSkillMap = useMemo(() => {
    const map = new Map<string, string[]>();
    workers?.forEach((w) => {
      const skills: string[] = [];
      if (w.role) skills.push(w.role);
      if (skills.length > 0) {
        map.set(w.name, skills);
      }
    });
    return map;
  }, [workers]);

  const q = (searchQuery || localFilter).toLowerCase();

  const filteredSkills = useMemo(() => {
    if (!q) return dynamicSkills;
    return dynamicSkills.filter(
      (s) =>
        (s.name || '').toLowerCase().includes(q) ||
        s.workers?.some((w) => (w.name || '').toLowerCase().includes(q)) ||
        s.managers?.some((m) => (m.name || '').toLowerCase().includes(q))
    );
  }, [dynamicSkills, q]);

  const filteredMcp = useMemo(() => {
    if (!q) return mcpServers;
    return mcpServers.filter(
      (s) =>
        (s.name || '').toLowerCase().includes(q) ||
        (s.url || '').toLowerCase().includes(q) ||
        s.workers?.some((w) => (w || '').toLowerCase().includes(q))
    );
  }, [mcpServers, q]);

  const totalSkillCount = dynamicSkills.length;
  const categories = useMemo(() => {
    const cats = new Set<string>();
    dynamicSkills.forEach((s) => {
      const lower = (s.name || '').toLowerCase();
      if (lower.includes('coord') || lower.includes('assign') || lower.includes('match') || lower.includes('team') || lower.includes('conflict')) cats.add('协调');
      else if (lower.includes('monitor') || lower.includes('track') || lower.includes('health') || lower.includes('progress') || lower.includes('deadline')) cats.add('监控');
      else if (lower.includes('process') || lower.includes('aggregate') || lower.includes('report')) cats.add('处理');
      else if (lower.includes('error') || lower.includes('recover') || lower.includes('retry') || lower.includes('fallback')) cats.add('容错');
      else if (lower.includes('optim') || lower.includes('load') || lower.includes('balance') || lower.includes('priorit')) cats.add('优化');
      else if (lower.includes('comm') || lower.includes('relay') || lower.includes('message') || lower.includes('notify')) cats.add('通信');
      else cats.add('其他');
    });
    return cats.size;
  }, [dynamicSkills]);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="技能生态"
        description="Worker 技能和 MCP 服务器配置一览"
        onRefresh={handleRefresh}
        isRefreshing={isRefetching}
      />

      {/* Stats Banner */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="glass-card">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">技能总数</p>
            <p className="text-2xl font-bold">{totalSkillCount}</p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">技能类别</p>
            <p className="text-2xl font-bold">{categories}</p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">活跃 Workers</p>
            <p className="text-2xl font-bold">{workers?.length ?? 0}</p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">MCP 服务器</p>
            <p className="text-2xl font-bold">{mcpServers.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="搜索技能、Worker 或 MCP 服务器..."
          value={localFilter}
          onChange={(e) => setLocalFilter(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Dynamic Skills Grid */}
      <div>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-amber-500" />
          动态技能
          <Badge variant="outline" className="text-[10px]">{filteredSkills.length}</Badge>
        </h2>
        {filteredSkills.length === 0 ? (
          <Card className="glass-card">
            <CardContent className="p-8 text-center">
              <Sparkles className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                {dynamicSkills.length === 0 ? '暂无技能数据，请先创建 Worker 并配置技能' : '没有匹配的技能'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredSkills.map((skill, i) => (
              <motion.div
                key={skill.name}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02 }}
                layout
              >
                <SkillCard
                  skill={skill}
                  isExpanded={expandedSkills.has(skill.name)}
                  onToggle={() => toggleSkill(skill.name)}
                />
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Worker Skill Map */}
      {workerSkillMap.size > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Bot className="w-5 h-5 text-primary" />
            Worker 技能映射
            <Badge variant="outline" className="text-[10px]">{workerSkillMap.size} Workers</Badge>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from(workerSkillMap.entries()).map(([workerName, skills], i) => (
              <motion.div
                key={workerName}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02 }}
                layout
              >
                <Card className="glass-card hover-lift">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Bot className="w-4 h-4 text-primary" />
                      <span className="font-medium text-sm">{workerName}</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {skills.map((skill) => (
                        <Badge key={skill} variant="outline" className="text-xs">
                          {skill}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* MCP Server Section */}
      <div>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Server className="w-5 h-5 text-emerald-500" />
          MCP 服务器配置
          <Badge variant="outline" className="text-[10px]">{filteredMcp.length}</Badge>
        </h2>
        {filteredMcp.length === 0 ? (
          <Card className="glass-card">
            <CardContent className="p-8 text-center">
              <Server className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                {mcpServers.length === 0
                  ? '暂无 MCP 服务器配置。可在创建/编辑 Worker 时添加 MCP 服务器。'
                  : '没有匹配的 MCP 服务器'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {filteredMcp.map((mcp, i) => (
              <motion.div
                key={`${mcp.name}-${mcp.url}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                layout
              >
                <Card className="glass-card hover-lift">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                          <Wifi className="w-4 h-4 text-emerald-500" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{mcp.name}</span>
                            <Badge variant="outline" className="text-[10px]">{mcp.transport}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground font-mono truncate max-w-[400px]" title={mcp.url}>
                            <Link2 className="w-3 h-3 inline mr-1" />
                            {mcp.url}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="outline" className="text-[10px]">
                          {mcp.workers.length} Worker
                        </Badge>
                        <button
                          onClick={() => toggleMcp(mcp.name)}
                          className="p-1 hover:bg-accent rounded"
                        >
                          {mcpExpanded.has(mcp.name) ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                    {mcpExpanded.has(mcp.name) && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        className="mt-2 p-2 rounded-md bg-muted/30 overflow-hidden"
                      >
                        <p className="text-[10px] text-muted-foreground font-medium mb-1">连接的 Workers:</p>
                        <div className="flex flex-wrap gap-1">
                          {mcp.workers.map((w) => (
                            <Badge key={w} variant="secondary" className="text-[10px]">
                              <Bot className="w-2.5 h-2.5 mr-1 text-primary" />
                              {w}
                            </Badge>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

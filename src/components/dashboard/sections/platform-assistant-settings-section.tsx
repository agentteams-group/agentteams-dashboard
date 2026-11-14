'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SectionHeader } from '@/components/dashboard/section-header';
import { ApiErrorState } from '@/components/dashboard/api-error-state';
import { useManagers } from '@/hooks/use-agentteams-managers';
import { useModelSelection } from '@/hooks/use-model-selection';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { currentHashParams, hashForSection, platformAssistantSettingsHash } from '@/lib/nav-hash';
import { openChatRoom } from '@/lib/open-chat-room';
import { ManagerDetailPanel } from './managers/manager-detail-panel';
import { ManagersSection } from './managers-section';

export function PlatformAssistantSettingsSection() {
  const userLevel = useAgentTeamsStore(state => state.userLevel);
  return userLevel >= 3 ? <AssistantSettings userLevel={userLevel} />
    : <p className="p-6 text-sm text-muted-foreground">仅管理员可以配置平台助手。</p>;
}

function AssistantSettings({ userLevel }: { userLevel: number }) {
  const { data: managers = [], isLoading, isError, refetch, isRefetching } = useManagers();
  const { options: modelOptions, sessionIssue } = useModelSelection();
  const [requestedName, setRequestedName] = useState(() => currentHashParams()?.get('manager') ?? null);
  useEffect(() => {
    const sync = () => setRequestedName(currentHashParams()?.get('manager') ?? null);
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  const selected = requestedName ? managers.find(manager => manager.name === requestedName)
    : managers.find(manager => manager.name === 'default') ?? managers[0];

  if (isError) return <ApiErrorState onRetry={() => void refetch()} />;
  return <div className="space-y-4">
    <SectionHeader title="平台助手设置" onRefresh={() => void refetch()} isRefreshing={isRefetching}
      actions={<Button size="sm" variant="outline" onClick={() => {
        if (selected?.roomID) openChatRoom(selected.roomID);
        else window.location.hash = hashForSection('chat');
      }}><ArrowLeft className="size-4" />返回对话</Button>} />
    <p className="text-sm text-muted-foreground">配置平台助手的模型、提示词、技能与运行参数。</p>
    {managers.length > 1 && <div className="flex items-center gap-3">
      <label id="assistant-instance-label" className="text-sm font-medium">助手实例</label>
      <Select value={selected?.name ?? ''} onValueChange={name => {
        setRequestedName(name);
        window.location.hash = platformAssistantSettingsHash(name);
      }}><SelectTrigger aria-labelledby="assistant-instance-label" className="w-64"><SelectValue placeholder="选择助手实例" /></SelectTrigger>
        <SelectContent>{managers.map(manager => <SelectItem key={manager.name} value={manager.name}>{manager.name}</SelectItem>)}</SelectContent>
      </Select>
    </div>}
    {isLoading ? <p role="status" className="p-6 text-sm text-muted-foreground">正在加载平台助手…</p> : selected ?
      <ManagerDetailPanel key={selected.name} manager={selected} modelOptions={modelOptions} sessionIssue={sessionIssue} userLevel={userLevel}
        onChanged={() => void refetch()} className="h-[calc(100dvh-19rem)] min-h-[420px] rounded-xl border bg-card" /> :
      <p role="status" className="rounded-xl border p-6 text-sm text-muted-foreground">{requestedName ? '未找到该助手实例，请在高级管理中选择或创建。' : '尚未配置平台助手，请在高级管理中创建。'}</p>}
    <details className="rounded-xl border bg-card">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">高级管理</summary>
      <div className="border-t p-4"><p className="mb-4 text-sm text-muted-foreground">管理助手实例的创建、删除、运行时与镜像升级。</p><ManagersSection /></div>
    </details>
  </div>;
}

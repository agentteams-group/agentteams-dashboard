'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, Check, Database, Globe, Workflow } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { McpServerConfig } from '@/lib/agentteams-api';
import { emptyMcpConnection, MCP_KIND_LABELS, validateMcpInput, type McpKind, type McpVerification } from '@/lib/mcp-management';
import { mcpManagementApi } from '@/lib/mcp-management-api';
import { McpConnectionFields, McpRestToolsEditor } from './mcp-connection-fields';

const choices = [
  { kind: 'proxy' as const, icon: Globe, description: '接入已有 MCP 服务，配置后端地址和认证即可。' },
  { kind: 'rest' as const, icon: Workflow, description: '把 HTTP API 变成工具，支持可视化配置或导入 OpenAPI。' },
  { kind: 'database' as const, icon: Database, description: '连接 MySQL、PostgreSQL 或 ClickHouse，由网关生成工具。' },
];

export function McpSetupDialog({ open, onOpenChange, server, onSaved }: { open: boolean; onOpenChange: (_open: boolean) => void; server?: McpServerConfig; onSaved: (_server: McpServerConfig) => void }) {
  const [step, setStep] = useState(server ? 1 : 0);
  const [name, setName] = useState(server?.name ?? '');
  const [description, setDescription] = useState(server?.description ?? '');
  const [connection, setConnection] = useState(server?.connection ?? emptyMcpConnection());
  const [busy, setBusy] = useState(false);
  const [gateway, setGateway] = useState<string>();
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<McpServerConfig>();
  const [verification, setVerification] = useState<McpVerification>();
  useEffect(() => {
    if (!open) return;
    let active = true;
    mcpManagementApi.capabilities().then((result) => { if (active) setGateway(result.gateway); }).catch((e) => { if (active) setError(e instanceof Error ? e.message : '网关管理暂不可用。'); });
    return () => { active = false; };
  }, [open]);

  async function saveAndVerify() {
    const input = { name, description, connection };
    const validation = validateMcpInput(input);
    if (validation) { setError(validation); return; }
    setError(''); setBusy(true); setVerification(undefined); setStep(2);
    try {
      const record = await mcpManagementApi.save(input);
      setSaved(record);
      let result = await mcpManagementApi.verify(record.name);
      for (const delay of [2000, 4000, 8000, 12000]) {
        if (result.success || !/HTTP (401|403|404|405|503)/.test(result.message)) break;
        setVerification({ ...result, message: '网关配置正在生效，稍候自动重试…' });
        await new Promise((resolve) => setTimeout(resolve, delay));
        result = await mcpManagementApi.verify(record.name);
      }
      setVerification(result);
    } catch (e) { setError(e instanceof Error ? e.message : '服务接入失败。'); }
    finally { setBusy(false); }
  }
  async function retry() {
    if (!saved) { setStep(1); return; }
    setBusy(true); setError('');
    try { setVerification(await mcpManagementApi.verify(saved.name)); }
    catch (e) { setError(e instanceof Error ? e.message : '验证失败。'); }
    finally { setBusy(false); }
  }
  function choose(kind: McpKind) {
    setConnection({ ...emptyMcpConnection(), kind, ...(kind === 'database' ? { database: { type: 'MYSQL', host: '', port: 3306, username: '', password: '', dbname: '' } } : {}) });
    setError('');
  }
  return <Dialog open={open} onOpenChange={(value) => { if (!busy) onOpenChange(value); }}><DialogContent className="gap-0 p-0 sm:max-w-3xl">
    <DialogHeader className="px-6 pb-5 pt-6"><DialogTitle>{server ? `编辑 ${server.name}` : '接入 MCP'}</DialogTitle><DialogDescription>让 Agent 通过网关使用外部工具，凭证由网关统一管理。</DialogDescription></DialogHeader>
    <ol aria-label="接入步骤" className="grid grid-cols-3 border-y bg-muted/25 px-6 py-3">
      {['选择类型', '配置服务', '验证并启用'].map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined} className={`flex items-center gap-2 text-xs ${step === index ? 'font-medium text-foreground' : 'text-muted-foreground'}`}><span className={`flex size-6 shrink-0 items-center justify-center rounded-full ${step >= index ? 'bg-foreground text-background' : 'border bg-background'}`}>{step > index ? <Check className="size-3.5" /> : index + 1}</span>{label}</li>)}
    </ol>
    <div className="max-h-[60dvh] overflow-y-auto px-6 py-6">
      {step === 0 && <div className="space-y-3"><p className="pb-1 text-sm text-muted-foreground">你想接入哪种服务？</p>{choices.map(({ kind, icon: Icon, description: text }) => <button key={kind} type="button" aria-pressed={connection.kind === kind} onClick={() => choose(kind)} className={`flex w-full items-center gap-4 rounded-xl border p-4 text-left transition-colors ${connection.kind === kind ? 'border-foreground bg-muted/40 ring-1 ring-foreground' : 'hover:border-muted-foreground/50 hover:bg-muted/20'}`}><span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted"><Icon className="size-5 text-muted-foreground" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{MCP_KIND_LABELS[kind]}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{text}</span></span><span className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${connection.kind === kind ? 'border-foreground bg-foreground' : ''}`}>{connection.kind === kind && <Check className="size-3 text-background" />}</span></button>)}<p className="pt-2 text-xs text-muted-foreground">已有网关地址可从列表右上角的更多菜单登记。</p></div>}
      {step === 1 && <div className="space-y-5">
        <div className="flex items-center gap-2"><span className="rounded bg-muted px-2 py-1 text-xs font-medium">{MCP_KIND_LABELS[connection.kind]}</span>{!server && <button type="button" className="text-xs text-muted-foreground underline underline-offset-4" onClick={() => setStep(0)}>更换类型</button>}</div>
        <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="managed-mcp-name">服务名称</Label><Input id="managed-mcp-name" value={name} disabled={Boolean(server || saved)} placeholder="如 project-docs" onChange={(e) => setName(e.target.value)} /><p className="text-xs text-muted-foreground">用于生成网关地址，启用后不可修改。</p></div><div className="space-y-2"><Label htmlFor="managed-mcp-description">用途说明 <span className="font-normal text-muted-foreground">选填</span></Label><Input id="managed-mcp-description" value={description} placeholder="如查询项目文档与研发知识" onChange={(e) => setDescription(e.target.value)} /></div></div>
        <McpConnectionFields value={connection} onChange={setConnection} />
        {connection.kind === 'rest' && <McpRestToolsEditor value={connection} onChange={setConnection} />}
      </div>}
      {step === 2 && <div className="space-y-5">
        <div className="flex items-start gap-3"><div className={`flex size-10 shrink-0 items-center justify-center rounded-full ${verification?.success ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground'}`}>{verification?.success ? <Check className="size-5" /> : <Workflow className="size-5" />}</div><div><p className="font-medium">{busy ? '正在创建配置并验证网关…' : verification?.success ? 'MCP 已接入，工具验证通过' : saved ? '配置已启用，等待验证' : '服务尚未启用'}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{busy ? verification?.message || '执行初始化和工具发现，不会调用业务工具。' : verification?.message || '检查连接配置后重试。'}</p></div></div>
        <div className="divide-y rounded-lg border text-sm"><div className="flex items-center justify-between gap-4 px-4 py-3"><span className="text-muted-foreground">接入方式</span><span>{MCP_KIND_LABELS[connection.kind]}</span></div><div className="px-4 py-3"><span className="text-muted-foreground">Agent 访问地址</span><p className="mt-2 break-all font-mono text-xs">{saved?.url || (gateway ? `${gateway}/mcp-servers/${name}` : '创建后生成')}</p></div><div className="flex items-center justify-between gap-4 px-4 py-3"><span className="text-muted-foreground">Agent 授权</span><span>完成后选择，默认不授权</span></div></div>
        {verification?.tools && <div className="space-y-2"><p className="text-xs font-medium text-muted-foreground">已发现 {verification.tools.length} 个工具</p><div className="flex flex-wrap gap-2">{verification.tools.slice(0, 8).map((tool) => <span key={tool.name} className="rounded-md border px-2.5 py-1.5 font-mono text-xs">{tool.name}</span>)}{verification.tools.length > 8 && <span className="py-1.5 text-xs text-muted-foreground">其余工具可在详情中查看</span>}</div></div>}
        {!busy && saved && !verification?.success && <p className="text-xs leading-5 text-muted-foreground">新配置可能需要几十秒生效。可以重新验证，或先保存，稍后到详情继续。</p>}
      </div>}
      {error && <p role="alert" className="mt-4 rounded-lg bg-destructive/5 px-3 py-2 text-sm leading-6 text-destructive">{error}</p>}
    </div>
    <DialogFooter className="flex-row items-center justify-between border-t bg-muted/10 px-6 py-4 sm:justify-between"><Button type="button" variant="ghost" disabled={busy} onClick={() => step === 0 ? onOpenChange(false) : setStep(step - 1)}>{step === 0 ? '取消' : '上一步'}</Button><div className="flex gap-2">
      {step === 0 && <Button type="button" onClick={() => { setError(''); setStep(1); }}>下一步<ArrowRight className="ml-2 size-3.5" /></Button>}
      {step === 1 && <Button type="button" disabled={busy || !gateway} onClick={() => void saveAndVerify()}>保存并验证</Button>}
      {step === 2 && <>{!verification?.success && <Button type="button" variant="outline" disabled={busy} onClick={() => void retry()}>重新验证</Button>}<Button type="button" disabled={busy || !saved} onClick={() => { if (saved) onSaved({ ...saved, verification }); onOpenChange(false); }}>{verification?.success ? '完成，查看详情' : '保存，稍后验证'}</Button></>}
    </div></DialogFooter>
  </DialogContent></Dialog>;
}

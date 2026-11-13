'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import type { McpServerConfig } from '@/lib/agentteams-api';
import { MCP_KIND_LABELS, type McpToolSchema, type McpVerification } from '@/lib/mcp-management';
import { mcpManagementApi } from '@/lib/mcp-management-api';
import { apiUrl } from '@/lib/api-base';
import { mcpSelectClass } from './mcp-connection-fields';

function formatToolResult(value: unknown): string {
  if (value && typeof value === 'object' && 'content' in value && Array.isArray(value.content)) {
    return value.content.map((part: { type?: string; text?: string }) => {
      if (part.type !== 'text' || typeof part.text !== 'string') return JSON.stringify(part, null, 2);
      try { return JSON.stringify(JSON.parse(part.text), null, 2); } catch { return part.text; }
    }).join('\n\n');
  }
  return JSON.stringify(value, null, 2);
}

function ToolRunner({ server, tools }: { server: McpServerConfig; tools: McpToolSchema[] }) {
  const [selected, setSelected] = useState(tools[0]?.name ?? '');
  const [values, setValues] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<McpVerification>();
  const [error, setError] = useState('');
  const tool = tools.find((item) => item.name === selected) ?? tools[0];
  if (!tool) return <p className="py-6 text-sm text-muted-foreground">先验证工具，获取服务实际返回的工具列表。</p>;
  async function run() {
    if (!tool) return;
    setError(''); setResult(undefined);
    const args: Record<string, unknown> = {};
    try {
      for (const [name, schema] of Object.entries(tool.inputSchema.properties ?? {})) {
        const value = values[name] ?? (schema.default !== undefined ? String(schema.default) : '');
        if (!value.trim()) { if (tool.inputSchema.required?.includes(name)) throw new Error(`请填写 ${name}。`); continue; }
        if (schema.type === 'number' || schema.type === 'integer') { const number = Number(value); if (!Number.isFinite(number) || (schema.type === 'integer' && !Number.isInteger(number))) throw new Error(`${name} 须为有效数字。`); args[name] = number; }
        else if (schema.type === 'boolean') args[name] = value === 'true';
        else if (schema.type === 'object' || schema.type === 'array') { args[name] = JSON.parse(value); if ((schema.type === 'array') !== Array.isArray(args[name]) || (schema.type === 'object' && (args[name] === null || typeof args[name] !== 'object'))) throw new Error(`${name} 的 JSON 类型不正确。`); }
        else args[name] = value;
      }
      setPending(true);
      setResult(await mcpManagementApi.call(server.name, tool.name, args));
    } catch (e) { setError(e instanceof Error ? e.message : '工具调用失败。'); }
    finally { setPending(false); }
  }
  return <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
    <div className="min-w-0 space-y-4"><div className="space-y-2"><Label htmlFor="mcp-tool-choice">选择工具</Label><select id="mcp-tool-choice" className={mcpSelectClass} value={tool.name} onChange={(e) => { setSelected(e.target.value); setValues({}); setResult(undefined); setError(''); }}>{tools.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}</select><p className="text-xs leading-5 text-muted-foreground">{tool.description}</p></div>
      {Object.entries(tool.inputSchema.properties ?? {}).map(([name, schema]) => <div key={name} className="space-y-2"><Label htmlFor={`mcp-arg-${name}`}>{name}{tool.inputSchema.required?.includes(name) && <span className="ml-1 text-muted-foreground">*</span>}<span className="ml-2 font-normal text-muted-foreground">{schema.type}</span></Label>
        {schema.type === 'object' || schema.type === 'array' ? <Textarea id={`mcp-arg-${name}`} className="font-mono text-xs" value={values[name] ?? (schema.default === undefined ? '' : JSON.stringify(schema.default))} onChange={(e) => setValues({ ...values, [name]: e.target.value })} placeholder={schema.type === 'object' ? '{}' : '[]'} /> : schema.type === 'boolean' || schema.enum ? <select id={`mcp-arg-${name}`} className={mcpSelectClass} value={values[name] ?? (schema.default === undefined ? '' : String(schema.default))} onChange={(e) => setValues({ ...values, [name]: e.target.value })}><option value="">请选择</option>{(schema.enum ?? [true, false]).map((v) => <option key={String(v)} value={String(v)}>{String(v)}</option>)}</select> : <Input id={`mcp-arg-${name}`} type={schema.type === 'number' || schema.type === 'integer' ? 'number' : 'text'} value={values[name] ?? (schema.default === undefined ? '' : String(schema.default))} onChange={(e) => setValues({ ...values, [name]: e.target.value })} />}
        {schema.description && <p className="text-xs text-muted-foreground">{schema.description}</p>}
      </div>)}
      <div className="space-y-2 pt-1"><Button type="button" disabled={pending} onClick={() => void run()}>{pending ? '正在调用…' : '运行工具'}</Button><p className="text-xs leading-5 text-muted-foreground">使用网关验证身份执行一次真实调用，可能修改后端数据。</p></div>
    </div>
    <div className="min-w-0 rounded-lg border bg-muted/15 p-4"><p className="mb-3 text-xs font-medium text-muted-foreground">调用结果</p>{pending ? <div role="status" className="space-y-3"><div className="h-3 w-3/4 animate-pulse rounded bg-muted" /><div className="h-3 w-1/2 animate-pulse rounded bg-muted" /></div> : result ? <><p className={`mb-3 text-xs ${result.success ? 'text-emerald-600' : 'text-destructive'}`}>{result.message}</p><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all font-mono text-xs leading-6">{formatToolResult(result.result)}</pre></> : <p className="text-sm leading-6 text-muted-foreground">填写左侧工具参数并运行，在这里查看后端返回结果。</p>}{error && <p role="alert" className="text-sm leading-6 text-destructive">{error}</p>}</div>
  </div>;
}

function AgentAccess({ server, onChanged }: { server: McpServerConfig; onChanged: () => void }) {
  const { data: workers = [], isLoading, error: loadError } = useWorkers();
  const [selected, setSelected] = useState(server.authorizedWorkers ?? []);
  const [saved, setSaved] = useState(server.authorizedWorkers ?? []);
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<Record<string, { success: boolean; message: string }>>({});
  const [probing, setProbing] = useState<string>();
  const dirty = [...selected].sort().join() !== [...saved].sort().join();
  async function save() {
    setPending(true); setError('');
    try { const result = await mcpManagementApi.authorize(server.name, selected); setSaved(result.authorizedWorkers); setSelected(result.authorizedWorkers); setResults(Object.fromEntries(result.results.map((r) => [r.name, r]))); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : '保存授权失败。'); }
    finally { setPending(false); }
  }
  async function probe(name: string) {
    setProbing(name);
    try {
      const send = async () => {
        const response = await fetch(apiUrl(`/api/agentteams/workers/${encodeURIComponent(name)}/gateway-probe`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'mcp', server: server.name }) });
        return { response, body: await response.json() };
      };
      let { response: res, body } = await send();
      for (const delay of [2000, 4000, 6000]) {
        if (body.success || !/HTTP (401|403|404|503)/.test(body.message ?? '')) break;
        setResults((r) => ({ ...r, [name]: { success: false, message: '网关授权正在生效，稍候自动重试…' } }));
        await new Promise((resolve) => setTimeout(resolve, delay));
        ({ response: res, body } = await send());
      }
      setResults((r) => ({ ...r, [name]: { success: res.ok && body.success === true, message: res.ok && body.success === true ? '验证通过：该 Agent 可通过网关访问此 MCP。' : res.status === 404 || res.status === 405 ? '当前 Controller 不支持 Agent 身份验证，请升级后重试。' : body.message || body.error || `HTTP ${res.status}` } }));
    } catch { setResults((r) => ({ ...r, [name]: { success: false, message: 'Agent 验证失败，请检查连接。' } })); }
    finally { setProbing(undefined); }
  }
  const filtered = workers.filter((w) => `${w.name} ${w.team ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-medium">选择可使用此服务的 Agent</p><p className="mt-1 text-xs text-muted-foreground">保存时同步 Agent 配置与网关授权；取消勾选会撤销权限。</p></div><Button size="sm" disabled={pending || !dirty || server.gatewayState !== 'ready'} onClick={() => void save()}>{pending ? '正在保存…' : `保存授权${dirty ? ` · ${selected.length} 个` : ''}`}</Button></div>
    <Input aria-label="搜索授权 Agent" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索 Agent 名称" />
    <div className="divide-y rounded-lg border">{isLoading ? <p className="p-4 text-sm text-muted-foreground">正在加载 Agent…</p> : loadError ? <p role="alert" className="p-4 text-sm text-destructive">Agent 列表加载失败，请刷新后重试。</p> : !filtered.length ? <p className="p-4 text-sm text-muted-foreground">{workers.length ? '没有匹配的 Agent' : '还没有可授权的 Agent，请先创建 Agent。'}</p> : filtered.map((w) => <div key={w.name} className="px-4 py-3"><div className="flex items-center justify-between gap-3"><label className="flex min-w-0 cursor-pointer items-center gap-3"><input type="checkbox" disabled={pending} checked={selected.includes(w.name)} onChange={(e) => setSelected(e.target.checked ? [...selected, w.name] : selected.filter((n) => n !== w.name))} /><span className="min-w-0"><span className="block truncate text-sm font-medium">{w.name}</span><span className="mt-0.5 block text-xs text-muted-foreground">{w.role === 'leader' ? 'Leader' : 'Worker'}{w.team ? ` · ${w.team}` : ''}</span></span></label><div className="flex shrink-0 items-center gap-2"><span className="text-xs text-muted-foreground">{saved.includes(w.name) ? '已授权' : '未授权'}</span>{saved.includes(w.name) && <Button variant="outline" size="sm" disabled={Boolean(probing) || dirty || server.transport === 'sse'} onClick={() => void probe(w.name)}>{probing === w.name ? '验证中…' : '验证权限'}</Button>}</div></div>{results[w.name] && <p className={`ml-7 mt-2 text-xs leading-5 ${results[w.name].success ? 'text-emerald-600' : 'text-destructive'}`}>{results[w.name].message}</p>}</div>)}</div>
    {server.transport === 'sse' && <p className="text-xs text-muted-foreground">当前 Controller 的 Agent 身份探测使用 Streamable HTTP；SSE 服务可在工具页验证连接并调试。</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}

export function McpDetailDialog({ server, onClose, onEdit, onChanged }: { server: McpServerConfig; onClose: () => void; onEdit: () => void; onChanged: () => void }) {
  const [verification, setVerification] = useState(server.verification);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  async function verify() {
    setPending(true); setError('');
    try { setVerification(await mcpManagementApi.verify(server.name)); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : '验证失败。'); }
    finally { setPending(false); }
  }
  const c = server.connection!;
  return <Dialog open onOpenChange={(value) => { if (!value) onClose(); }}><DialogContent className="gap-0 p-0 sm:max-w-4xl"><DialogHeader className="px-6 pb-5 pt-6"><div className="flex items-center gap-3"><DialogTitle>{server.name}</DialogTitle><Badge variant="secondary">{MCP_KIND_LABELS[c.kind]}</Badge></div><DialogDescription>{server.description || '通过网关管理连接、工具与 Agent 授权。'}</DialogDescription></DialogHeader>
    <Tabs defaultValue="tools" className="gap-0"><div className="flex items-center justify-between gap-3 border-y bg-muted/15 px-6 py-2"><TabsList><TabsTrigger value="tools">工具与调试{verification?.tools ? ` · ${verification.tools.length}` : ''}</TabsTrigger><TabsTrigger value="connection">连接配置</TabsTrigger><TabsTrigger value="agents">Agent 授权</TabsTrigger></TabsList></div>
      <div className="max-h-[65dvh] min-h-80 overflow-y-auto px-6 py-5">
        <TabsContent value="tools" className="m-0 space-y-5"><div className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-muted/30 p-4"><div><p className="text-sm font-medium">{verification?.success ? '网关验证通过' : verification ? '网关验证未通过' : '等待网关验证'}</p><p className={`mt-1 text-xs leading-5 ${verification && !verification.success ? 'text-destructive' : 'text-muted-foreground'}`}>{verification?.message || '初始化并读取实际工具列表，不执行业务操作。'}</p>{verification?.checkedAt && <p className="mt-1 text-xs text-muted-foreground">验证时间：{new Date(verification.checkedAt).toLocaleString()}</p>}</div><Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => void verify()}>{pending ? '正在验证…' : '重新验证工具'}</Button></div>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<ToolRunner key={verification?.checkedAt ?? 'initial'} server={server} tools={verification?.tools ?? []} /></TabsContent>
        <TabsContent value="connection" className="m-0 space-y-5"><div className="flex items-center justify-between"><p className="text-sm font-medium">连接概要</p><Button variant="outline" size="sm" onClick={onEdit}>编辑连接</Button></div><dl className="divide-y rounded-lg border text-sm">{[
          ['网关配置', server.gatewayState === 'ready' ? '已启用' : '接入失败，请编辑并重试'], ['后端地址', c.kind === 'database' ? `${c.database?.host}:${c.database?.port}/${c.database?.dbname}` : c.backendUrl], ['传输协议', server.transport === 'sse' ? 'SSE' : 'Streamable HTTP'], ['后端认证', c.auth.type === 'none' ? '无需认证' : c.auth.type === 'bearer' ? 'Bearer Token · 已配置' : c.auth.type === 'basic' ? 'Basic Auth · 已配置' : `API Key · ${c.auth.in} · ${c.auth.name}`], ['附加 Header', c.headers.map((p) => `${p.name}: ${p.secret ? '已配置敏感值' : p.value}`).join('\n') || '未设置'], ['附加 Query', c.query.map((p) => `${p.name}: ${p.secret ? '已配置敏感值' : p.value}`).join('\n') || '未设置'],
        ].map(([label, value]) => <div key={label} className="grid gap-2 px-4 py-3 sm:grid-cols-[120px_minmax(0,1fr)]"><dt className="text-muted-foreground">{label}</dt><dd className="whitespace-pre-wrap break-all text-sm">{value}</dd></div>)}</dl>
          <div className="space-y-2"><Label>Agent 访问地址</Label><div className="flex items-start gap-2 rounded-lg border bg-muted/20 p-3"><code className="min-w-0 flex-1 break-all text-xs leading-6">{server.url}</code><Button variant="ghost" size="icon" aria-label="复制网关地址" onClick={async () => { await navigator.clipboard.writeText(server.url); setCopied(true); }}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />}</Button></div><p className="text-xs leading-5 text-muted-foreground">Agent 使用自己的 Consumer 凭证访问这个地址，后端凭证由网关注入。</p></div>
        </TabsContent>
        <TabsContent value="agents" className="m-0"><AgentAccess server={server} onChanged={onChanged} /></TabsContent>
      </div>
    </Tabs>
  </DialogContent></Dialog>;
}

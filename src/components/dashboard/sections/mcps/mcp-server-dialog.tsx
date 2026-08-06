'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Play, Loader2, CheckCircle2, XCircle, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCreateMcpServer, useUpdateMcpServer, useTestMcpServer } from '@/hooks/use-agentteams-mcps';

interface McpServerFormValues {
  name: string;
  url: string;
  transport: 'sse' | 'streaminghttp';
  type?: string;
  timeout?: number;
  headers?: Record<string, string>;
  description?: string;
}

const TRANSPORT_OPTIONS: { value: 'sse' | 'streaminghttp'; label: string }[] = [
  { value: 'sse', label: 'SSE' },
  { value: 'streaminghttp', label: 'Streamable HTTP (推荐)' },
];

const TYPE_OPTIONS = [
  { value: 'streamable-http-proxy', label: 'Streamable HTTP 代理' },
  { value: 'sse-proxy', label: 'SSE 代理' },
  { value: 'rest-to-mcp', label: 'REST to MCP' },
];

export function McpServerDialog({
  open: dialogOpen,
  onOpenChange,
  server,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  server?: McpServerFormValues & { name: string };
  onSuccess?: () => void;
}) {
  const isEdit = !!server;
  const { register, handleSubmit, reset, formState: { errors } } = useForm<McpServerFormValues>({
    defaultValues: server || { name: '', url: '', transport: 'sse' },
  });
  const createMutation = useCreateMcpServer();
  const updateMutation = useUpdateMcpServer();
  const testMutation = useTestMcpServer();

  const [headerKeys, setHeaderKeys] = useState<string[]>(server?.headers ? Object.keys(server.headers) : []);
  const [headerValues, setHeaderValues] = useState<Record<string, string>>(server?.headers || {});
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; latencyMs?: number; statusCode?: number } | null>(null);

  const handleClose = () => {
    reset({ name: '', url: '', transport: 'sse' });
    setHeaderKeys([]);
    setHeaderValues({});
    setTestResult(null);
    onOpenChange(false);
  };

  const onSubmit = async (data: McpServerFormValues) => {
    const headers = headerKeys.length > 0
      ? Object.fromEntries(headerKeys.filter((k) => k.trim()).map((k) => [k.trim(), headerValues[k] || '']))
      : undefined;

    const payload = { ...data, headers };

    if (isEdit) {
      await updateMutation.mutateAsync({
        name: data.name,
        data: { url: data.url, transport: data.transport, type: data.type, timeout: data.timeout, headers, description: data.description },
      });
    } else {
      await createMutation.mutateAsync(payload);
    }
    onSuccess?.();
    handleClose();
  };

  const handleTest = async () => {
    setTestResult(null);
    const url = (document.getElementById('url') as HTMLInputElement)?.value || '';
    const transport = server?.transport || 'sse';
    if (!url.startsWith('http')) {
      setTestResult({ success: false, message: '请输入有效的 HTTP(S) URL 后再测试' });
      return;
    }
    try {
      const result = await testMutation.mutateAsync({ url, transport, timeout: 8000 });
      setTestResult(result);
    } catch (err: unknown) {
      setTestResult({ success: false, message: err instanceof Error ? err.message : '测试请求失败' });
    }
  };

  const addHeaderRow = () => {
    setHeaderKeys([...headerKeys, '']);
  };

  const removeHeaderRow = (index: number) => {
    const key = headerKeys[index];
    const nextKeys = headerKeys.filter((_, i) => i !== index);
    const nextValues = { ...headerValues };
    if (key) delete nextValues[key];
    setHeaderKeys(nextKeys);
    setHeaderValues(nextValues);
  };

  return (
    <Dialog open={dialogOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-w-[95vw] overflow-hidden">
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑 MCP 服务器' : '添加 MCP 服务器'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          {isEdit ? (
            <div className="space-y-2">
              <Label htmlFor="name">服务器名称</Label>
              <Input id="name" {...register('name', { required: '请输入服务器名称' })} disabled />
              {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="name">服务器名称 <span className="text-destructive">*</span></Label>
              <Input
                id="name"
                {...register('name', {
                  required: '请输入服务器名称',
                  pattern: {
                    value: /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
                    message: '仅允许字母、数字、点、下划线、连字符',
                  },
                })}
                placeholder="my-mcp-server"
              />
              {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="type">服务器类型</Label>
              <Select
                defaultValue={server?.type || ''}
                onValueChange={(v) => {
                  const el = document.getElementById('type') as HTMLSelectElement;
                  if (el) el.value = v;
                }}
              >
                <SelectTrigger id="type">
                  <SelectValue placeholder="选择类型" />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input type="hidden" {...register('type')} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="timeout">超时 (ms)</Label>
              <Input
                id="timeout"
                type="number"
                {...register('timeout', { valueAsNumber: true })}
                placeholder="5000"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="url">服务端点 URL <span className="text-destructive">*</span></Label>
            <div className="flex gap-2">
              <Input
                id="url"
                {...register('url', {
                  required: '请输入服务端点 URL',
                  pattern: {
                    value: /^https?:\/\/.+/,
                    message: '须为有效的 HTTP(S) 地址',
                  },
                })}
                placeholder="https://example.com/mcp"
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTest}
                disabled={testMutation.isPending}
              >
                {testMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5 mr-1" />
                )}
                测试
              </Button>
            </div>
            {errors.url && <p className="text-sm text-destructive">{errors.url.message}</p>}
            {testResult && (
              <div className={`flex items-center gap-2 text-xs p-2 rounded ${testResult.success ? 'bg-emerald-500/10 text-emerald-600' : 'bg-destructive/10 text-destructive'}`}>
                {testResult.success ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <XCircle className="w-3.5 h-3.5 shrink-0" />}
                <span>{testResult.message}</span>
                {testResult.latencyMs != null && <span className="text-muted-foreground">({testResult.latencyMs}ms)</span>}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="transport">传输方式 <span className="text-destructive">*</span></Label>
            <Select
              defaultValue={server?.transport || 'sse'}
              onValueChange={(v) => {
                const el = document.getElementById('transport') as HTMLSelectElement;
                if (el) el.value = v;
              }}
            >
              <SelectTrigger id="transport">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRANSPORT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input type="hidden" {...register('transport', { required: true })} />
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Info className="w-3 h-3" />
              Streamable HTTP 为 MCP 协议推荐传输方式，支持多客户端连接
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>自定义请求头</Label>
              <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={addHeaderRow}>
                添加
              </Button>
            </div>
            {headerKeys.length === 0 && (
              <p className="text-xs text-muted-foreground">如 Authorization 或 X-API-Key，用于认证和自定义路由</p>
            )}
            {headerKeys.map((key, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <Input
                  placeholder="Header 名称"
                  value={key}
                  onChange={(e) => {
                    const nextKeys = [...headerKeys];
                    const oldKey = nextKeys[idx];
                    nextKeys[idx] = e.target.value;
                    setHeaderKeys(nextKeys);
                    if (oldKey) {
                      const nextValues = { ...headerValues };
                      nextValues[e.target.value] = nextValues[oldKey] || '';
                      delete nextValues[oldKey];
                      setHeaderValues(nextValues);
                    }
                  }}
                  className="flex-1"
                />
                <Input
                  placeholder="值"
                  value={headerValues[key] || ''}
                  onChange={(e) => {
                    setHeaderValues({ ...headerValues, [key]: e.target.value });
                  }}
                  className="flex-1"
                />
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => removeHeaderRow(idx)}>
                  移除
                </Button>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">描述（可选）</Label>
            <Textarea
              id="description"
              {...register('description')}
              placeholder="MCP 服务器用途描述..."
              rows={2}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              取消
            </Button>
            <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
              {createMutation.isPending || updateMutation.isPending ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

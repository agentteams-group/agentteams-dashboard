'use client';

import { useForm } from 'react-hook-form';
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
import { useCreateMcpServer, useUpdateMcpServer } from '@/hooks/use-agentteams-mcps';

interface McpServerFormValues {
  name: string;
  url: string;
  transport: 'sse' | 'streaminghttp';
  description?: string;
}

const TRANSPORT_OPTIONS: { value: 'sse' | 'streaminghttp'; label: string }[] = [
  { value: 'sse', label: 'SSE' },
  { value: 'streaminghttp', label: 'Streaming HTTP' },
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

  const handleClose = () => {
    reset({ name: '', url: '', transport: 'sse' });
    onOpenChange(false);
  };

  const onSubmit = async (data: McpServerFormValues) => {
    if (isEdit) {
      await updateMutation.mutateAsync({
        name: data.name,
        data: { url: data.url, transport: data.transport, description: data.description },
      });
    } else {
      await createMutation.mutateAsync(data);
    }
    onSuccess?.();
    handleClose();
  };

  return (
    <Dialog open={dialogOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md max-w-[95vw]">
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑 MCP 服务器' : '添加 MCP 服务器'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {isEdit ? (
            <div className="space-y-2">
              <Label htmlFor="name">服务器名称</Label>
              <Input id="name" {...register('name', { required: '请输入服务器名称' })} disabled />
              {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="name">服务器名称</Label>
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
          <div className="space-y-2">
            <Label htmlFor="url">服务端点 URL</Label>
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
            />
            {errors.url && <p className="text-sm text-destructive">{errors.url.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="transport">传输方式</Label>
            <Select
              value={server?.transport || 'sse'}
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
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">描述（可选）</Label>
            <Textarea
              id="description"
              {...register('description')}
              placeholder="MCP 服务器描述..."
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

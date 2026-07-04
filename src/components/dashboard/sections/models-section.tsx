'use client';

import { useState } from 'react';
import { Trash2, Star, Loader2 } from 'lucide-react';
import { SectionHeader } from '@/components/dashboard/section-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  useModels,
  useCreateModel,
  useDeleteModel,
  useSetDefaultModel,
} from '@/hooks/use-hiclaw-models';
import type { CreateModelRequest } from '@/lib/hiclaw-api';

const PROVIDER_PRESETS = [
  { label: 'OpenAI / 兼容', value: 'openai' },
  { label: '通义千问', value: 'qwen' },
  { label: 'DeepSeek', value: 'deepseek' },
  { label: 'Ollama', value: 'ollama' },
];

export function ModelsSection() {
  const { data: models, isLoading } = useModels();
  const createModel = useCreateModel();
  const deleteModel = useDeleteModel();
  const setDefault = useSetDefaultModel();

  const [form, setForm] = useState<CreateModelRequest>({
    name: '',
    provider: 'openai',
    apiKey: '',
    baseUrl: '',
    capabilities: [],
  });

  const handleCreate = () => {
    if (!form.name.trim() || !form.apiKey.trim()) return;
    createModel.mutate(
      {
        ...form,
        capabilities: form.capabilities?.length ? form.capabilities : undefined,
      },
      {
        onSuccess: () =>
          setForm({
            name: '',
            provider: 'openai',
            apiKey: '',
            baseUrl: '',
            capabilities: [],
          }),
      }
    );
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="模型仓库"
        description="集中管理多厂商大模型配置，供 Worker / Manager 选择"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="lg:col-span-1">
          <Label>名称 *</Label>
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="例如 gpt-4"
          />
        </div>
        <div className="lg:col-span-1">
          <Label>厂商 *</Label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors"
            value={form.provider}
            onChange={(e) => setForm({ ...form, provider: e.target.value })}
          >
            {PROVIDER_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>
        <div className="lg:col-span-2">
          <Label>API Key *</Label>
          <Input
            type="password"
            value={form.apiKey}
            onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            placeholder="sk-..."
          />
        </div>
        <div className="lg:col-span-1">
          <Label>Base URL（可选）</Label>
          <Input
            value={form.baseUrl || ''}
            onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
            placeholder="https://api..."
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button
          onClick={handleCreate}
          disabled={!form.name.trim() || !form.apiKey.trim() || createModel.isPending}
        >
          {createModel.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          添加模型
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead>厂商</TableHead>
            <TableHead>Base URL</TableHead>
            <TableHead>能力</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                加载中...
              </TableCell>
            </TableRow>
          )}
          {!isLoading && models?.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                暂无模型，请添加或检查 Controller /api/v1/models 接口
              </TableCell>
            </TableRow>
          )}
          {models?.map((model) => (
            <TableRow key={model.name}>
              <TableCell className="font-medium">
                {model.name}
                {model.default && (
                  <Badge variant="secondary" className="ml-2 text-[10px]">
                    <Star className="w-3 h-3 inline mr-1" />
                    默认
                  </Badge>
                )}
              </TableCell>
              <TableCell>{model.provider}</TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {model.baseUrl || '-'}
              </TableCell>
              <TableCell>
                {(model.capabilities ?? []).map((c) => (
                  <Badge key={c} variant="outline" className="mr-1 text-[10px]">
                    {c}
                  </Badge>
                ))}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDefault.mutate(model.name)}
                  disabled={model.default || setDefault.isPending}
                >
                  设为默认
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => deleteModel.mutate(model.name)}
                  disabled={deleteModel.isPending}
                >
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

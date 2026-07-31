'use client';

import { useState, useEffect } from 'react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Trash2, Plus, Save, X } from 'lucide-react';
import type { AlertRule, AlertChannel, AlertSeverity } from '@/lib/alert-types';
import { buildDefaultRules } from '@/lib/alert-rules';

const INSIGHT_TYPES = [
  { value: 'failed-workers', label: 'Worker 失败' },
  { value: 'stuck-pending', label: 'Worker 卡住' },
  { value: 'low-worker-health', label: '低健康度' },
  { value: 'container-issues', label: '容器异常' },
  { value: 'degraded-teams', label: '团队降级' },
  { value: 'failed-teams', label: '团队失败' },
  { value: 'disconnected', label: '控制器断开' },
  { value: 'unhealthy-services', label: '服务异常' },
];

export function AlertSettingsPage() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<AlertRule>>({});

  useEffect(() => {
    loadRules();
  }, []);

  const loadRules = async () => {
    try {
      const res = await fetch('/api/settings/alerts');
      const data = await res.json();
      setRules(data.rules ?? []);
    } catch {
      setRules(buildDefaultRules());
    }
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/settings/alerts?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    setRules(rules.filter((r) => r.id !== id));
  };

  const startEdit = (rule: AlertRule) => {
    setEditingId(rule.id);
    setEditForm({ ...rule });
  };

  const handleSave = async () => {
    if (!editForm.id) return;
    await fetch('/api/settings/alerts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    });
    setEditingId(null);
    loadRules();
  };

  const handleAddRule = () => {
    const defaultRule = buildDefaultRules()[0];
    const newRule: AlertRule = {
      ...defaultRule,
      id: `rule-${Date.now()}`,
      insightType: defaultRule.insightType,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setRules([...rules, newRule]);
    startEdit(newRule);
  };

  const setEditingForm = (updates: Partial<AlertRule>) => {
    setEditForm({ ...editForm, ...updates });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">告警规则</h2>
          <p className="text-sm text-muted-foreground">配置哪些洞察触发通知及通知渠道</p>
        </div>
        <Button onClick={handleAddRule} size="sm">
          <Plus className="mr-2 h-4 w-4" />添加规则
        </Button>
      </div>

      <div className="space-y-4">
        {rules.map((rule) => (
          <AlertRuleCard
            key={rule.id}
            rule={rule}
            isEditing={editingId === rule.id}
            editForm={editingId === rule.id ? editForm : rule}
            onStartEdit={() => startEdit(rule)}
            onCancel={() => setEditingId(null)}
            onSave={handleSave}
            onDelete={() => handleDelete(rule.id)}
            onFormChange={setEditingForm}
          />
        ))}
      </div>
    </div>
  );
}

function AlertRuleCard({
  rule,
  isEditing,
  editForm,
  onStartEdit,
  onCancel,
  onSave,
  onDelete,
  onFormChange,
}: {
  rule: AlertRule;
  isEditing: boolean;
  editForm: AlertRule | Partial<AlertRule>;
  onStartEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onDelete: () => void;
  onFormChange: (updates: Partial<AlertRule>) => void;
}) {
  const severityColors: Record<string, string> = {
    critical: 'bg-red-500/20 text-red-500',
    warning: 'bg-yellow-500/20 text-yellow-500',
    info: 'bg-blue-500/20 text-blue-500',
  };

  if (isEditing) {
    return (
      <div className="rounded-lg border p-4 space-y-4 bg-muted/50">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>洞察类型</Label>
            <Select
              value={editForm.insightType as string}
              onValueChange={(v) => onFormChange({ insightType: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="选择洞察类型" />
              </SelectTrigger>
              <SelectContent>
                {INSIGHT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>严重程度</Label>
            <Select
              value={editForm.severity}
              onValueChange={(v) => onFormChange({ severity: v as AlertSeverity })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="critical">严重</SelectItem>
                <SelectItem value="warning">警告</SelectItem>
                <SelectItem value="info">信息</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label>通知渠道</Label>
          <div className="flex gap-4 mt-2">
            {(['matrix', 'slack', 'email'] as AlertChannel[]).map((channel) => (
              <label key={channel} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={(editForm.channels ?? []).includes(channel)}
                  onChange={(e) => {
                    const current = editForm.channels ?? [];
                    const next = e.target.checked
                      ? [...current, channel]
                      : current.filter((c) => c !== channel);
                    onFormChange({ channels: next });
                  }}
                />
                {channel === 'matrix' ? 'Matrix' : channel === 'slack' ? 'Slack' : 'Email'}
              </label>
            ))}
          </div>
        </div>
        <div>
          <Label>节流间隔（分钟）</Label>
          <Input
            type="number"
            min={1}
            value={editForm.throttleMinutes ?? 15}
            onChange={(e) => onFormChange({ throttleMinutes: Number(e.target.value) })}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            <X className="mr-2 h-4 w-4" />取消
          </Button>
          <Button size="sm" onClick={onSave}>
            <Save className="mr-2 h-4 w-4" />保存
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-4 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <span className={`px-2 py-1 rounded text-xs font-medium ${severityColors[rule.severity]}`}>
          {rule.severity.toUpperCase()}
        </span>
        <div>
          <p className="font-medium">{rule.insightType}</p>
          <p className="text-sm text-muted-foreground">
            渠道:{' '}
            {rule.channels.map((c) => c.charAt(0).toUpperCase() + c.slice(1)).join(', ')}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Switch
          checked={rule.enabled}
          onCheckedChange={(checked) => {}}
        />
        <Button variant="ghost" size="icon" onClick={onStartEdit}>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
        </Button>
        <Button variant="ghost" size="icon" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

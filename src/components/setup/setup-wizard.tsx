'use client';

import { useState } from 'react';
import { Check, ChevronRight, KeyRound, Loader2, Sparkles } from 'lucide-react';
import { apiUrl } from '@/lib/api-base';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Alert, AlertDescription } from '@/components/ui/alert';

interface SetupWizardProps {
  onComplete?: () => void;
}

const providers = [
  { value: 'qwen', label: '通义千问 (Qwen)', showBaseUrl: false },
  { value: 'openai', label: 'OpenAI / 兼容接口', showBaseUrl: true },
];

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState(1);
  const [provider, setProvider] = useState('qwen');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedProvider = providers.find((p) => p.value === provider) || providers[0];

  const handleSave = async () => {
    if (!apiKey.trim()) return;
    setIsSaving(true);
    setError(null);

    try {
      const payload: Record<string, string> = {
        llmProvider: provider,
        llmApiKey: apiKey.trim(),
      };
      if (selectedProvider.showBaseUrl && baseUrl.trim()) {
        payload.openaiBaseUrl = baseUrl.trim();
      }

      const res = await fetch(apiUrl('/api/hiclaw/setup/'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || `保存失败 (HTTP ${res.status})`);
      }

      setStep(3);
      onComplete?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">首次启动配置</CardTitle>
              <CardDescription>配置大模型 API 以启用 AI 能力</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 1 && (
            <>
              <div className="space-y-2">
                <Label>模型提供商</Label>
                <Select value={provider} onValueChange={setProvider}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {providers.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="setup-api-key">
                  <KeyRound className="w-3.5 h-3.5 inline mr-1" />
                  API Key
                </Label>
                <Input
                  id="setup-api-key"
                  type="password"
                  placeholder="sk-..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </div>
              {selectedProvider.showBaseUrl && (
                <div className="space-y-2">
                  <Label htmlFor="setup-base-url">Base URL（可选）</Label>
                  <Input
                    id="setup-base-url"
                    placeholder="https://api.openai.com/v1"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                  />
                </div>
              )}
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button
                onClick={handleSave}
                disabled={isSaving || !apiKey.trim()}
                className="w-full"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    保存中...
                  </>
                ) : (
                  <>
                    下一步
                    <ChevronRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </>
          )}

          {step === 3 && (
            <div className="text-center space-y-4 py-4">
              <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center mx-auto">
                <Check className="w-6 h-6 text-green-500" />
              </div>
              <div>
                <p className="font-medium">配置完成</p>
                <p className="text-sm text-muted-foreground">刷新页面后进入 Dashboard</p>
              </div>
              <Button onClick={() => window.location.reload()} className="w-full">
                进入 Dashboard
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

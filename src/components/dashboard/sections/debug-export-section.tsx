'use client';

import { useState } from 'react';
import { Download, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useInfrastructure } from '@/hooks/use-agentteams-infrastructure';

export function DebugExportSection() {
  const { data: infra, isLoading, error } = useInfrastructure();
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const response = await fetch('/api/agentteams/debug/export');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `agentteams-debug-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Export failed', err);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Download className="h-6 w-6 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold mb-1">一键采集诊断信息</h3>
              <p className="text-sm text-muted-foreground mb-4">
                下载包含系统配置、运行状态和日志的压缩包，用于问题排查
              </p>
              <Button onClick={handleExport} disabled={exporting || isLoading}>
                {exporting ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />采集中...</>
                ) : (
                  <><Download className="h-4 w-4 mr-2" />下载诊断包</>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {infra && (
        <div className="grid gap-3">
          {Object.entries(infra).map(([key, value]) => (
            <Card key={key}>
              <CardContent className="p-3 flex items-center justify-between">
                <span className="text-sm font-medium capitalize">{key}</span>
                <Badge variant={value === 'healthy' || value === true ? 'default' : 'destructive'}>
                  {String(value)}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-500">
          <AlertCircle className="h-4 w-4" />
          {error.message}
        </div>
      )}
    </div>
  );
}

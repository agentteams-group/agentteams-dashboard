'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useWorkerFiles } from '@/hooks/use-agentteams-storage';
import { agentteamsApi } from '@/lib/agentteams-api';
import {
  File as FileIcon,
  Folder,
  RefreshCw,
  AlertCircle,
  Image as ImageIcon,
  FileText,
  Code,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { MarkdownMessage } from '../markdown-message';
import { MermaidRenderer } from '../mermaid-renderer';

// Sensitive patterns to filter out
const SENSITIVE_PATTERNS = [
  /^\.hermes\/config\.yaml$/,
  /^\.ssh\//,
  /^credentials\//,
  /^openclaw\.json$/,
  /\.lock$/,
];

function isSafe(key: string): boolean {
  return !SENSITIVE_PATTERNS.some((p) => p.test(key));
}

function getFileIcon(key: string) {
  const ext = key.split('.').pop()?.toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext || '')) return <ImageIcon className="h-4 w-4 text-blue-500" />;
  if (['md', 'markdown', 'txt'].includes(ext || '')) return <FileText className="h-4 w-4 text-green-500" />;
  if (['json', 'yaml', 'yml', 'toml', 'xml'].includes(ext || '')) return <Code className="h-4 w-4 text-yellow-500" />;
  if (['mermaid', 'mmd', 'mm'].includes(ext || '')) return <Code className="h-4 w-4 text-purple-500" />;
  return <FileIcon className="h-4 w-4 text-muted-foreground" />;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface WorkerFilesPanelProps {
  workerName: string;
}

export function WorkerFilesPanel({ workerName }: WorkerFilesPanelProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);

  const { data: objects, isLoading, error, refetch } = useWorkerFiles(workerName);

  const safeObjects = objects?.filter((obj) => isSafe(obj.key)) ?? [];

  const handleRefresh = async () => {
    await refetch();
    setLastSyncTime(new Date());
  };

  if (!workerName) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="text-center text-muted-foreground">
            <Folder className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p className="text-sm">请输入 Worker 名称</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Folder className="h-5 w-5 text-emerald-500" />
          <span className="font-semibold text-sm">{workerName}</span>
          <Badge variant="secondary" className="text-xs">
            工作目录
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {lastSyncTime && (
            <span className="text-[10px] text-muted-foreground">
              同步于 {lastSyncTime.toLocaleTimeString('zh-CN')}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleRefresh}
            disabled={isLoading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col gap-3">
        {/* File list */}
        <Card className="flex flex-col min-h-0" style={{ flex: '0 0 45%' }}>
          <CardHeader className="py-2 px-3 shrink-0">
            <CardTitle className="text-sm flex items-center gap-2">
              <Folder className="h-4 w-4" />
              文件列表
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 p-0 overflow-hidden">
            <ScrollArea className="h-full">
              {isLoading ? (
                <div className="p-3 space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              ) : error ? (
                <div className="p-4 text-center text-sm text-red-500 flex items-center justify-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  加载失败
                </div>
              ) : safeObjects.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  <Folder className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>该 Worker 尚未同步文件或目录</p>
                  <p className="mt-1 text-xs">请确认 Worker 已挂载对象存储并完成初始化</p>
                </div>
              ) : (
                <div className="py-1">
                  {safeObjects.map((obj) => (
                    <button
                      key={obj.key}
                      onClick={() => setSelectedKey(obj.key)}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent transition-colors ${
                        selectedKey === obj.key ? 'bg-accent border-l-2 border-emerald-500' : ''
                      }`}
                    >
                      {obj.isPrefix ? (
                        <Folder className="h-4 w-4 text-blue-500 shrink-0" />
                      ) : (
                        getFileIcon(obj.key)
                      )}
                      <span className="flex-1 text-left truncate font-mono text-xs">
                        {obj.key.split('/').pop() || obj.key}
                      </span>
                      {!obj.isPrefix && (
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {formatSize(obj.size)}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* File preview */}
        <Card className="flex flex-col flex-1 min-h-0">
          <CardHeader className="py-2 px-3 shrink-0">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="h-4 w-4" />
              {selectedKey ? selectedKey.split('/').pop() : '预览'}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 p-0 overflow-hidden">
            {selectedKey ? (
              <FilePreview key={selectedKey} workerName={workerName} objectKey={selectedKey} />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                <div className="text-center">
                  <FileIcon className="h-12 w-12 mx-auto mb-2 opacity-30" />
                  <p>选择文件查看预览</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function FilePreview({ workerName, objectKey }: { workerName: string; objectKey: string }) {
  const [expanded, setExpanded] = useState(false);
  const ext = objectKey.split('.').pop()?.toLowerCase();
  const isTextFile = ['md', 'markdown', 'txt', 'json', 'yaml', 'yml', 'toml', 'xml', 'js', 'ts', 'jsx', 'tsx', 'py', 'sh', 'bash', 'log', 'csv', 'mermaid', 'mmd', 'mm'].includes(ext || '');
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext || '');

  if (isImage) {
    const imageUrl = agentteamsApi.downloadWorkerFileUrl(workerName, objectKey);
    return (
      <div className="p-4">
        <img
          src={imageUrl}
          alt={objectKey}
          className={`max-w-full rounded border ${expanded ? 'max-h-none' : 'max-h-[400px] object-contain'}`}
        />
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 text-xs"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <Minimize2 className="h-3 w-3 mr-1" /> : <Maximize2 className="h-3 w-3 mr-1" />}
          {expanded ? '缩小' : '放大'}
        </Button>
      </div>
    );
  }

  if (ext === 'svg') {
    const url = agentteamsApi.downloadWorkerFileUrl(workerName, objectKey);
    return (
      <iframe
        src={url}
        className="w-full h-[400px] border rounded"
        title={objectKey}
      />
    );
  }

  if (!isTextFile) {
    const url = agentteamsApi.downloadWorkerFileUrl(workerName, objectKey);
    return (
      <div className="p-4">
        <a
          href={url}
          download
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90"
        >
          <FileIcon className="h-4 w-4" />
          下载文件
        </a>
      </div>
    );
  }

  return <TextViewer workerName={workerName} objectKey={objectKey} ext={ext} />;
}

function TextViewer({ workerName, objectKey, ext }: { workerName: string; objectKey: string; ext?: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const url = agentteamsApi.downloadWorkerFileUrl(workerName, objectKey);
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (!cancelled) {
          setContent(text);
          setError(null);
        }
      })
      .catch((e: any) => {
        if (!cancelled) {
          setError(e.message);
          setContent(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [workerName, objectKey]);

  if (error) {
    return (
      <div className="p-4 text-sm text-red-500 flex items-center gap-2">
        <AlertCircle className="h-4 w-4" />
        加载失败: {error}
      </div>
    );
  }

  if (!content) {
    return <div className="p-4 text-sm text-muted-foreground">加载中...</div>;
  }

  // Render based on extension
  if (ext === 'md' || ext === 'markdown') {
    return (
      <div className="p-4 overflow-auto max-h-[500px]">
        <MarkdownMessage content={content} formattedContent={undefined} />
      </div>
    );
  }

  if (ext === 'mermaid' || ext === 'mmd' || ext === 'mm') {
    return (
      <div className="p-4 overflow-auto max-h-[500px]">
        <MermaidRenderer content={content} />
      </div>
    );
  }

  // JSON with syntax highlighting
  if (ext === 'json') {
    let jsonContent: string;
    try {
      const parsed = JSON.parse(content);
      jsonContent = JSON.stringify(parsed, null, 2);
    } catch {
      jsonContent = content;
    }
    return <pre className="p-4 text-xs font-mono overflow-auto max-h-[500px] bg-muted rounded">{jsonContent}</pre>;
  }

  // Plain text
  return (
    <pre className="p-4 text-xs font-mono overflow-auto max-h-[500px] bg-muted rounded whitespace-pre-wrap">
      {content}
    </pre>
  );
}

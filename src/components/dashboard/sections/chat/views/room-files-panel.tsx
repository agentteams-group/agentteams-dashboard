'use client';

import { useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiUrl } from '@/lib/api-base';
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
  Upload,
  Download,
} from 'lucide-react';
import { mxcToDownloadUrl } from '@/lib/matrix-media';
import { useMatrixStore } from '@/lib/matrix-store';

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

interface RoomFile {
  eventId: string;
  filename: string;
  mimetype: string;
  size: number;
  timestamp: number;
  contentUri: string;
  downloadUrl?: string;
}

function extractFilesFromMessages(
  homeserver: string,
  messages: Array<{
    event_id: string;
    content: { msgtype?: string; body?: string; url?: string; info?: { mimetype?: string; size?: number } };
    origin_server_ts: number;
    type: string;
  }>
): RoomFile[] {
  return messages
    .filter((m) => {
      const msgtype = m.content?.msgtype;
      return msgtype === 'm.file' || msgtype === 'm.image' || msgtype === 'm.audio' || msgtype === 'm.video';
    })
    .map((m) => ({
      eventId: m.event_id,
      filename: (m.content?.body as string) || m.content?.url?.split('/').pop() || '文件',
      mimetype: m.content?.info?.mimetype || 'application/octet-stream',
      size: m.content?.info?.size || 0,
      timestamp: m.origin_server_ts,
      contentUri: m.content?.url || '',
      downloadUrl: m.content?.url ? mxcToDownloadUrl(m.content.url, homeserver) : undefined,
    }));
}

interface RoomFilesResult {
  files: RoomFile[];
  totalSize: number;
}

interface RoomFilesQueryResult {
  chunk: Array<{
    event_id: string;
    content: { msgtype?: string; body?: string; url?: string; info?: { mimetype?: string; size?: number } };
    origin_server_ts: number;
    type: string;
  }>;
}

async function fetchRoomFiles(homeserver: string, accessToken: string, roomId: string): Promise<RoomFilesResult> {
  const url = apiUrl(`/api/matrix/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=200`);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`获取房间消息失败: ${res.status}`);
  const data = await res.json() as RoomFilesQueryResult;
  const files = extractFilesFromMessages(homeserver, data.chunk);
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  return { files, totalSize };
}

export function RoomFilesPanel({ roomId }: { roomId: string }) {
  const homeserver = useMatrixStore((s) => s.homeserver);
  const accessToken = useMatrixStore((s) => s.accessToken);
  const [selectedFile, setSelectedFile] = useState<RoomFile | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, error, refetch } = useQuery<RoomFilesResult>({
    queryKey: ['room-files', roomId],
    queryFn: () => {
      if (!homeserver || !accessToken) return Promise.resolve({ files: [], totalSize: 0 });
      return fetchRoomFiles(homeserver, accessToken, roomId);
    },
    enabled: !!roomId && !!homeserver && !!accessToken,
    retry: 1,
    placeholderData: (previousData) => previousData,
    throwOnError: false,
  });

  const queryClient = useQueryClient();
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      const url = apiUrl(`/api/matrix/rooms/${encodeURIComponent(roomId)}/upload`);
      const res = await fetch(url, { method: 'POST', body: form });
      if (!res.ok) throw new Error(`上传失败: ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['room-files', roomId] });
      setLastSyncTime(new Date());
    },
  });

  const safeFiles = data?.files.filter((f) => isSafe(f.filename)) ?? [];

  const handleRefresh = async () => {
    await refetch();
    setLastSyncTime(new Date());
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await uploadMutation.mutateAsync(file);
    } catch {
      // error handled by mutation state
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  if (!roomId) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="text-center text-muted-foreground">
            <Folder className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p className="text-sm">请输入房间 ID</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Folder className="h-4 w-4 text-emerald-500 shrink-0" />
          <span className="font-semibold text-xs truncate">房间文件</span>
          <Badge variant="secondary" className="text-[10px] shrink-0">
            {safeFiles.length} 个文件
          </Badge>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {lastSyncTime && (
            <span className="text-[10px] text-muted-foreground hidden sm:inline">
              同步于 {lastSyncTime.toLocaleTimeString('zh-CN')}
            </span>
          )}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileUpload}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
            title="上传文件"
          >
            <Upload className="h-3.5 w-3.5" />
          </Button>
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
              ) : safeFiles.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  <Folder className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>该房间暂无文件</p>
                  <p className="mt-1 text-xs">点击上传按钮添加文件</p>
                </div>
              ) : (
                <div className="py-1">
                  {safeFiles.map((file) => (
                    <div
                      key={file.eventId}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors group ${
                        selectedFile?.eventId === file.eventId ? 'bg-accent border-l-2 border-emerald-500' : ''
                      }`}
                    >
                      <button
                        onClick={() => setSelectedFile(file)}
                        className="flex items-center gap-3 flex-1 min-w-0"
                      >
                        {getFileIcon(file.filename)}
                        <span className="flex-1 text-left truncate font-mono text-xs">
                          {file.filename}
                        </span>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {formatSize(file.size)}
                        </span>
                      </button>
                      {file.downloadUrl && (
                        <a
                          href={file.downloadUrl}
                          download
                          className="shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-background text-muted-foreground hover:text-foreground transition-all"
                          title="下载文件"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Download className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
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
              {selectedFile ? selectedFile.filename : '预览'}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 p-0 overflow-hidden">
            {selectedFile ? (
              <FilePreview key={selectedFile.eventId} file={selectedFile} expanded={expanded} onExpandChange={setExpanded} />
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

function FilePreview({ file, expanded, onExpandChange }: { file: RoomFile; expanded: boolean; onExpandChange: (_v: boolean) => void }) {
  const ext = file.filename.split('.').pop()?.toLowerCase();
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext || '');

  if (isImage && file.downloadUrl) {
    return (
      <div className="p-4">
        <img
          src={file.downloadUrl}
          alt={file.filename}
          className={`max-w-full rounded border ${expanded ? 'max-h-none' : 'max-h-[400px] object-contain'}`}
        />
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 text-xs"
          onClick={() => onExpandChange(!expanded)}
        >
          {expanded ? <Minimize2 className="h-3 w-3 mr-1" /> : <Maximize2 className="h-3 w-3 mr-1" />}
          {expanded ? '缩小' : '放大'}
        </Button>
      </div>
    );
  }

  if (file.downloadUrl) {
    return (
      <div className="p-4">
        <a
          href={file.downloadUrl}
          download
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90"
        >
          <FileText className="h-4 w-4" />
          下载文件
        </a>
      </div>
    );
  }

  return (
    <div className="p-4 text-sm text-muted-foreground text-center">
      <FileIcon className="h-12 w-12 mx-auto mb-2 opacity-30" />
      <p>无法预览此文件类型</p>
    </div>
  );
}

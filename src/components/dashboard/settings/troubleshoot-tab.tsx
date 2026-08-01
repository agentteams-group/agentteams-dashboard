'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Stethoscope, Loader2, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { useTroubleshoot } from '@/hooks/use-agentteams-troubleshoot';
import { useInfrastructure } from '@/hooks/use-agentteams-infrastructure';
import { useLogs } from '@/hooks/use-agentteams-logs';

const COMPONENTS = [
  { value: 'controller', label: 'Controller' },
  { value: 'worker', label: 'Worker / Manager' },
  { value: 'matrix', label: 'Matrix' },
  { value: 'higress', label: 'Higress' },
  { value: 'minio', label: 'MinIO' },
  { value: 'dashboard', label: 'Dashboard' },
];

function CodeBlock({ language, children }: { language?: string; children: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group my-2 rounded-lg overflow-hidden border bg-muted/50">
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted text-xs text-muted-foreground">
        <span>{language || 'code'}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={handleCopy}
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </Button>
      </div>
      <pre className="p-3 overflow-x-auto m-0">
        <code className={`text-xs ${language ? `language-${language}` : ''}`}>{children}</code>
      </pre>
    </div>
  );
}

export function TroubleshootTab() {
  const { data: infra } = useInfrastructure();
  const [component, setComponent] = useState('controller');
  const [symptom, setSymptom] = useState('');
  const [copied, setCopied] = useState(false);
  const { answer, loading, error, diagnose, reset } = useTroubleshoot();

  const { data: logs } = useLogs(component, { tail: 50 });

  const handleDiagnose = () => {
    if (!symptom.trim()) return;
    const recentLogs = (logs || [])
      .slice(-20)
      .map((l) => `${l.timestamp} [${l.level.toUpperCase()}] ${l.message}`)
      .join('\n');
    diagnose({
      component,
      symptom: symptom.trim(),
      logs: recentLogs,
      infraSnapshot: infra || undefined,
    });
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(answer);
    setCopied(true);
    toast.success('已复制诊断结果');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>选择组件</Label>
        <Select value={component} onValueChange={setComponent}>
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COMPONENTS.map((c) => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>症状描述</Label>
        <Textarea
          value={symptom}
          onChange={(e) => setSymptom(e.target.value)}
          placeholder="例如：MinIO 健康检查失败，Worker 无法启动，Matrix 房间未生成..."
          rows={4}
        />
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={handleDiagnose} disabled={loading || !symptom.trim()}>
          {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          <Stethoscope className="w-4 h-4 mr-2" />
          AI 诊断
        </Button>
        {answer && (
          <>
            <Button variant="outline" size="sm" onClick={handleCopy}>
              {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
              复制
            </Button>
            <Button variant="ghost" size="sm" onClick={reset}>
              清除
            </Button>
          </>
        )}
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {answer && (
        <Card>
          <CardContent className="p-4">
            <ScrollArea className="h-80">
              <div className="text-sm">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                  components={{
                    code({ className, children, ...props }) {
                      const language = className?.replace('language-', '');
                      const code = String(children).replace(/\n$/, '');
                      if (className?.includes('language-')) {
                        return <CodeBlock language={language}>{code}</CodeBlock>;
                      }
                      return (
                        <code className="bg-muted px-1 py-0.5 rounded text-xs" {...props}>
                          {children}
                        </code>
                      );
                    },
                    pre({ children }) {
                      return <div className="my-1">{children}</div>;
                    },
                    p({ children }) {
                      return <p className="mb-2 last:mb-0">{children}</p>;
                    },
                    ul({ children }) {
                      return <ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>;
                    },
                    ol({ children }) {
                      return <ol className="list-decimal pl-4 mb-2 space-y-1">{children}</ol>;
                    },
                    li({ children }) {
                      return <li className="mb-0.5">{children}</li>;
                    },
                    a({ href, children }) {
                      return (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-emerald-600 hover:underline"
                        >
                          {children}
                        </a>
                      );
                    },
                    h1({ children }) {
                      return <h1 className="text-xl font-semibold mb-2">{children}</h1>;
                    },
                    h2({ children }) {
                      return <h2 className="text-lg font-semibold mb-2">{children}</h2>;
                    },
                    h3({ children }) {
                      return <h3 className="text-base font-semibold mb-2">{children}</h3>;
                    },
                    table({ children }) {
                      return (
                        <div className="overflow-x-auto my-2">
                          <table className="text-xs border-collapse border border-border">
                            {children}
                          </table>
                        </div>
                      );
                    },
                    th({ children }) {
                      return <th className="border border-border px-2 py-1 bg-muted">{children}</th>;
                    },
                    td({ children }) {
                      return <td className="border border-border px-2 py-1">{children}</td>;
                    },
                    blockquote({ children }) {
                      return (
                        <blockquote className="border-l-4 border-emerald-500/50 pl-4 italic my-2">
                          {children}
                        </blockquote>
                      );
                    },
                    hr() {
                      return <hr className="border-border my-2" />;
                    },
                  }}
                >
                  {answer}
                </ReactMarkdown>
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

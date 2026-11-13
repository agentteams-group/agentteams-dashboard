'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Info } from 'lucide-react';

/**
 * Collapsible onboarding guide for the MCP pipeline (#132). The dashboard
 * only registers addresses; the gateway service and the Consumer
 * authorization live in Manager / Higress, so the four states are spelled out
 * to stop users from reading "registration saved" as "ready to use".
 */
export function McpOnboardingPanel() {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Info className="size-3.5 shrink-0" />
        <span>接入服务 → 验证工具 → 授权 Agent</span>
        {open ? <ChevronDown className="size-3.5 ml-auto" /> : <ChevronRight className="size-3.5 ml-auto" />}
      </button>
      {open && (
        <div className="px-4 pb-3 text-xs text-muted-foreground space-y-2">
          <ol className="space-y-1 list-decimal list-inside">
            <li>
              <span className="font-medium text-foreground">网关接入</span>
              ：点击「接入 MCP」，选择已有 MCP、HTTP API 或数据库。配置保存后会创建网关服务，数据面端点为
              <code className="font-mono mx-1">POST /mcp-servers/{'{name}'}/mcp</code>
              （实际地址以详情页为准）。
            </li>
            <li>
              <span className="font-medium text-foreground">验证工具</span>
              ：以网关验证身份完成 MCP 初始化并读取工具列表，不执行业务工具。新配置可能需要几十秒生效，失败后可重试。
            </li>
            <li>
              <span className="font-medium text-foreground">Agent 授权</span>
              ：在详情中选择 Agent 并保存，同时写入 Agent 配置和网关授权。后端凭证、Header 与 Query 由网关管理。
            </li>
            <li>
              <span className="font-medium text-foreground">调用验证</span>
              ：点击「验证权限」，使用该 Agent 的真实 Consumer 身份验证已保存配置。工具调试页的「运行工具」会执行真实业务调用。
            </li>
          </ol>
          <p>
            「登记已有网关地址」只记录外部服务地址，保留原有接入和授权方式；它与本页创建的受管服务分别展示。
          </p>
        </div>
      )}
    </div>
  );
}

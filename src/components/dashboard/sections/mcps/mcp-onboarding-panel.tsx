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
        <span>接入与授权流程（登记 ≠ 可用）</span>
        {open ? <ChevronDown className="size-3.5 ml-auto" /> : <ChevronRight className="size-3.5 ml-auto" />}
      </button>
      {open && (
        <div className="px-4 pb-3 text-[11px] text-muted-foreground space-y-2">
          <ol className="space-y-1 list-decimal list-inside">
            <li>
              <span className="font-medium text-foreground">网关接入</span>
              ：在 Manager / Higress 创建 MCP 服务与路由，数据面端点为
              <code className="font-mono mx-1">POST /mcp-servers/{'{name}'}/mcp</code>
              （Streamable HTTP）。本页的登记不会创建网关服务。
            </li>
            <li>
              <span className="font-medium text-foreground">Consumer 授权</span>
              ：在「模型管理 → Consumers」确认目标 Worker 的 Consumer 已进入该服务的
              <code className="font-mono mx-1">allowedConsumers</code>
              。授权由管理员执行，范围明确。
            </li>
            <li>
              <span className="font-medium text-foreground">登记地址</span>
              ：回到本页登记网关地址，并在 Worker 的新建 / 编辑页把服务分配给该 Worker。自定义 Headers 保存在登记中，不下发给 Worker。
            </li>
            <li>
              <span className="font-medium text-foreground">调用验证</span>
              ：在 Worker 编辑页底部运行「已保存配置的网关验证」，以该 Worker 的 Consumer 身份完成 MCP 初始化，这才是可用性结论。
            </li>
          </ol>
          <p>
            四态相互独立：已登记、已分配到 Worker、Consumer 已授权、验证通过。本页的「测试连接」以 Dashboard 身份直连登记地址，只验证地址可达，不能替代第 4 步。
          </p>
        </div>
      )}
    </div>
  );
}

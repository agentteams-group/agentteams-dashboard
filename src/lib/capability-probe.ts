'use client';

/**
 * Controller 能力探测（PRD F5.6）：启动/使用时探测上游可选契约的可用性，
 * 缺失时 UI 降级（画布→编排视图、派单→指令消息）并以能力徽标注明原因
 * —— 旧 Controller 下无死按钮、无报错弹窗。
 *
 * 探测口径（对应 PRD §8.2 缺口表）：
 * - loopsWrite（G3）：GET /api/v1/loops/status 是否存在（404/405=未接通）；
 * - projectWrite（G2）：任务/项目创建 BFF 是否可用（本仓尚未提供，恒否，
 *   待上游契约接通后改为真实探测）；
 * - reviewProtocol（G4）：org.agentteams.run v2 干预/报告块是否出现
 *   （运行时才知道 → 由首条结构化块命中时置位，会话级缓存）。
 */

import { create } from 'zustand';
import { apiUrl } from '@/lib/api-base';

export interface ControllerCapabilities {
  /** 循环写 API（G3）：false 时画布产物只能导出 JSON + 手动派单引导。 */
  loopsWrite: boolean;
  /** 项目/任务写 BFF（G2）：false 时派单只生成结构化指令消息。 */
  projectWrite: boolean;
  /** v2 协议块（G4）：出现过 review.report / 干预选项块即置位。 */
  reviewProtocol: boolean;
  /** 最近一次探测时间戳（0=未探测）。 */
  probedAt: number;
}

interface CapabilityState extends ControllerCapabilities {
  probeLoops: () => Promise<void>;
  markReviewProtocolSeen: () => void;
}

/** 探测结果会话级缓存（zustand，不持久化——每次冷启动重探）。 */
export const useCapabilityStore = create<CapabilityState>()((set) => ({
  loopsWrite: false,
  projectWrite: false,
  reviewProtocol: false,
  probedAt: 0,

  probeLoops: async () => {
    try {
      const res = await fetch(apiUrl('/api/agentteams/loops/status'), {
        credentials: 'same-origin',
      });
      // 200/4xx-业务错（如 401 之外的语义错误）= 端点存在；404/405 = 上游未接。
      const exists = res.status !== 404 && res.status !== 405;
      set({ loopsWrite: exists, probedAt: Date.now() });
    } catch {
      set({ loopsWrite: false, probedAt: Date.now() });
    }
  },

  markReviewProtocolSeen: () => {
    const state = useCapabilityStore.getState();
    if (!state.reviewProtocol) set({ reviewProtocol: true });
  },
}));

/** 降级原因文案（能力徽标 tooltip / 降级说明共用，§7.4 降级可见）。 */
export function capabilityNote(key: keyof Pick<ControllerCapabilities, 'loopsWrite' | 'projectWrite' | 'reviewProtocol'>): string {
  switch (key) {
    case 'loopsWrite':
      return '当前 Controller 未提供循环写接口（上游 #1253 未接通）：画布产物可导出 JSON 供 Manager 引用，无法一键下发执行';
    case 'projectWrite':
      return '当前未提供任务创建接口：修复派单以结构化指令消息发回房间，由 Manager 消费';
    case 'reviewProtocol':
      return '尚未观测到上游 v2 结构化块：审查报告按 Markdown 约定渲染，干预为工具确认二态';
  }
}

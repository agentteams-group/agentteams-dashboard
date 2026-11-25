import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { LoopDryRunDialog } from './loop-dry-run-dialog';
import { LOOP_TEMPLATES, templateToDraft } from '@/lib/loop-definition';

// 预演对话框的可见行为（方案 v3 F-3）：步骤序列来自 simulateLoopDryRun，
// 面板必须把拓扑可达性与每一步的节点名摆出来，作者发布前才看得出断点。
afterEach(() => {
  cleanup();
});

describe('LoopDryRunDialog（F-3 预演）', () => {
  const draft = templateToDraft(LOOP_TEMPLATES[0], '@me:example.org');

  it('打开时展示循环名、可达徽标与首尾步骤', () => {
    render(<LoopDryRunDialog definition={draft} open onOpenChange={vi.fn()} />);

    expect(screen.getByText('循环预演仿真 (Dry Run)')).toBeInTheDocument();
    expect(screen.getByText('拓扑可达 (Reachable)')).toBeInTheDocument();
    expect(screen.getByText(/推演执行序列/)).toBeInTheDocument();
    // start 与 end 节点都应出现在推演序列里
    expect(screen.getAllByText('开始').length).toBeGreaterThan(0);
    expect(screen.getAllByText('结束').length).toBeGreaterThan(0);
  });

  it('definition 为空时不渲染对话框内容', () => {
    const { container } = render(
      <LoopDryRunDialog definition={null} open onOpenChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

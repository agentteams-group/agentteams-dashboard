import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { WelcomeSteps } from './welcome-steps';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('WelcomeSteps: 三步引导与示例闭环 (C-7)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('visible 为 true 时渲染三步引导与离线体验按钮', () => {
    renderWithClient(<WelcomeSteps visible={true} />);

    expect(screen.getByText('三步跑通第一个闭环')).toBeInTheDocument();
    expect(screen.getByText('① 打开协作空间')).toBeInTheDocument();
    expect(screen.getByText('② 挑一个模板循环')).toBeInTheDocument();
    expect(screen.getByText('③ 发第一条任务消息')).toBeInTheDocument();
    expect(screen.getByText('离线体验示例闭环 (免后端)')).toBeInTheDocument();
  });

  it('允许独立勾选步骤完成态，并持久化到本地存储', () => {
    renderWithClient(<WelcomeSteps visible={true} />);

    const step1CheckBtn = screen.getByLabelText('标记第 1 步为已完成');
    fireEvent.click(step1CheckBtn);

    // 步骤 1 应显示已完成标识
    expect(screen.getByText('已完成')).toBeInTheDocument();
    expect(screen.getByText('再次前往')).toBeInTheDocument();

    // 再次点击取消勾选
    const step1UncheckBtn = screen.getByLabelText('标记第 1 步为未完成');
    fireEvent.click(step1UncheckBtn);
    expect(screen.queryByText('已完成')).not.toBeInTheDocument();
  });

  it('点击跳过按钮后持久化 dismissed 状态', () => {
    const { unmount } = renderWithClient(<WelcomeSteps visible={true} />);

    const skipBtn = screen.getByText('跳过（不再显示）');
    fireEvent.click(skipBtn);

    unmount();
    cleanup();
    const { container } = renderWithClient(<WelcomeSteps visible={true} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('打开离线示例空间全闭环对话框，完成演练可一键打勾全部步骤', () => {
    renderWithClient(<WelcomeSteps visible={true} />);

    const demoBtn = screen.getByText('离线体验示例闭环 (免后端)');
    fireEvent.click(demoBtn);

    // 对话框应弹出并展示三张核心卡片标题
    expect(screen.getByText('示例空间 · 离线全闭环演练')).toBeInTheDocument();
    expect(screen.getByText(/① 任务流转（接力卡 Workflow Card）/)).toBeInTheDocument();
    expect(screen.getByText(/② 质量与安全门禁（审查报告卡 Review Report）/)).toBeInTheDocument();
    expect(screen.getByText(/③ 人机回路（人工介入确认卡 HITL Intervention）/)).toBeInTheDocument();

    // 点击完成演练
    const finishBtn = screen.getByText('完成演练并打勾所有步骤');
    fireEvent.click(finishBtn);

    // 退出对话框后所有 3 步均应标记为已完成
    expect(screen.getByText('（已全部完成，棒！）')).toBeInTheDocument();
    expect(screen.getAllByText('已完成')).toHaveLength(3);
  });
});

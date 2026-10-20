/**
 * 审查报告卡（F3.1/F3.2/F3.4）单测：折叠摘要、问题勾选、派单文本生成、
 * 放行动作与权限、自动放行开关门控。
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

import { ReviewReportCard } from './review-report-card';
import type { RuntimeReviewReportBlock } from '@/lib/a2ui/protocol';
import { useHitlInboxStore } from '@/lib/hitl-inbox';

vi.mock('@/lib/agentteams-store', () => ({
  useAgentTeamsStore: (selector: (_s: { userLevel: number }) => unknown) =>
    selector({ userLevel: 3 }),
}));

vi.mock('@/lib/matrix-store', () => ({
  useMatrixStore: (selector: (_s: { userId: string | null }) => unknown) =>
    selector({ userId: '@me:example.org' }),
}));

vi.mock('@/hooks/use-matrix', () => ({
  useRoomMetaStore: (selector: (_s: { activeRoomId: string | null }) => unknown) =>
    selector({ activeRoomId: '!room:example.org' }),
}));

const mockFetchRoomState = vi.fn();
const mockSendReleaseRecord = vi.fn();
const mockSendSpaceConfig = vi.fn();

vi.mock('@/lib/release-record', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/release-record')>()),
  fetchRoomState: (...args: unknown[]) => mockFetchRoomState(...args),
  sendReleaseRecord: (...args: unknown[]) => mockSendReleaseRecord(...args),
  sendSpaceConfig: (...args: unknown[]) => mockSendSpaceConfig(...args),
}));

const reportPayload: RuntimeReviewReportBlock['payload'] = {
  round: 2,
  verdict: 'revision_needed',
  title: '产品介绍页审查',
  summary: '首轮验收未过',
  project_id: 'proj-1',
  issues: [
    { id: 'i1', severity: 'blocker', anchor: 'index.html:12', repro: '打开页面即白屏', owner_node: 't3' },
    { id: 'i2', severity: 'suggestion', anchor: 'styles.css', repro: '对比度不足' },
  ],
};

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('ReviewReportCard（F3 渲染契约）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchRoomState.mockResolvedValue([]);
    useHitlInboxStore.setState({ confirmations: {} });
  });

  it('① 报告渲染：verdict + 轮次 + 分级问题列表（位置/复现/责任节点）', async () => {
    renderWithQuery(<ReviewReportCard payload={reportPayload} onSend={vi.fn()} />);
    expect(screen.getByText('产品介绍页审查')).toBeInTheDocument();
    expect(screen.getByText('第 2 轮')).toBeInTheDocument();
    expect(screen.getByText('需修订')).toBeInTheDocument();
    expect(await screen.findByText('index.html:12')).toBeInTheDocument();
    expect(screen.getByText(/复现：打开页面即白屏/)).toBeInTheDocument();
    expect(screen.getByText('t3')).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent?.includes('1 阻断 · 1 建议') === true)).toBeInTheDocument();
  });

  it('② 一键折叠为摘要（问题列表隐藏）', async () => {
    renderWithQuery(<ReviewReportCard payload={reportPayload} onSend={vi.fn()} />);
    await screen.findByText('index.html:12');
    fireEvent.click(screen.getByRole('button', { name: /折叠为摘要/ }));
    expect(screen.queryByText('index.html:12')).not.toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent?.includes('1 阻断 · 1 建议') === true)).toBeInTheDocument(); // 摘要保留
  });

  it('③ 勾选问题项 → 派发修复生成带轮次的结构化指令消息', async () => {
    const onSend = vi.fn();
    renderWithQuery(<ReviewReportCard payload={reportPayload} onSend={onSend} />);
    const dispatch = screen.getByRole('button', { name: /派发修复/ });
    expect(dispatch).toBeDisabled();
    fireEvent.click(screen.getByLabelText('勾选问题 index.html:12'));
    fireEvent.click(dispatch);
    expect(onSend).toHaveBeenCalledTimes(1);
    const text = onSend.mock.calls[0][0] as string;
    expect(text).toContain('【修复派单 · 第 2 轮】');
    expect(text).toContain('[阻断] index.html:12');
    expect(text).toContain('复现：打开页面即白屏');
    expect(text).toContain('责任节点：t3');
  });

  it('④ 阻塞报告不渲染放行按钮；pass 报告（协作者/管理员）渲染', async () => {
    const onSend = vi.fn();
    const { rerender } = renderWithQuery(
      <ReviewReportCard payload={reportPayload} onSend={onSend} />,
    );
    await waitFor(() => expect(mockFetchRoomState).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: '放行' })).not.toBeInTheDocument();

    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
        <ReviewReportCard
          payload={{ ...reportPayload, verdict: 'pass' }}
          onSend={onSend}
        />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('button', { name: '放行' })).toBeInTheDocument();
  });

  it('⑤ 放行动作写入房间状态事件（round/project/actor 齐全）并刷新', async () => {
    mockSendReleaseRecord.mockResolvedValue(undefined);
    renderWithQuery(
      <ReviewReportCard payload={{ ...reportPayload, verdict: 'pass' }} onSend={vi.fn()} />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '放行' }));
    await waitFor(() => expect(mockSendReleaseRecord).toHaveBeenCalledTimes(1));
    const [roomId, record] = mockSendReleaseRecord.mock.calls[0];
    expect(roomId).toBe('!room:example.org');
    expect(record).toMatchObject({
      action: 'release',
      project_id: 'proj-1',
      round: 2,
      actor: '@me:example.org',
    });
  });

  it('⑥ 本轮已放行 → 幂等徽标（放行按钮消失）', async () => {
    mockFetchRoomState.mockResolvedValue([
      {
        type: 'com.agentteams.release',
        state_key: 'release-1',
        content: { action: 'release', actor: '@me:example.org', ts: 1, round: 2, project_id: 'proj-1' },
      },
    ]);
    renderWithQuery(
      <ReviewReportCard payload={{ ...reportPayload, verdict: 'pass' }} onSend={vi.fn()} />,
    );
    expect(await screen.findByText('本轮已放行')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '放行' })).not.toBeInTheDocument();
  });

  it('⑦ 自动放行开关（管理员）读写空间配置', async () => {
    mockSendSpaceConfig.mockResolvedValue(undefined);
    renderWithQuery(<ReviewReportCard payload={reportPayload} onSend={vi.fn()} />);
    const toggle = await screen.findByRole('switch', { name: '自动放行（按空间，管理员）' });
    expect(toggle).not.toBeChecked(); // 默认关
    fireEvent.click(toggle);
    await waitFor(() => expect(mockSendSpaceConfig).toHaveBeenCalledTimes(1));
    const [roomId, config] = mockSendSpaceConfig.mock.calls[0];
    expect(roomId).toBe('!room:example.org');
    expect(config.auto_release).toBe(true);
  });

  it('⑧ pass + 自动放行开启 → 提示放行入口（半自动确认）', async () => {
    mockFetchRoomState.mockResolvedValue([
      {
        type: 'com.agentteams.space',
        state_key: 'auto_release',
        content: { auto_release: true, updated_by: '@me:example.org', ts: 1 },
      },
    ]);
    renderWithQuery(
      <ReviewReportCard payload={{ ...reportPayload, verdict: 'pass' }} onSend={vi.fn()} />,
    );
    expect(
      await screen.findByText(/自动放行已开启且本轮审查通过/),
    ).toBeInTheDocument();
  });
});

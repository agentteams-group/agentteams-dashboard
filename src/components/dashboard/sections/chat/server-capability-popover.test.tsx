/**
 * 能力弹层的两条底线：一是「实测」只能来自真实探测结果（未检索过时不许写得像
 * 探测过），二是受限项要写清是谁的限制。both 都是运营者会照着做决定的话。
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ServerCapabilityPopover } from './server-capability-popover';
import { resetSearchProbeForTests, recordSearchProbe } from '@/lib/matrix-capabilities';

afterEach(cleanup);

function openPopover() {
  render(<ServerCapabilityPopover />);
  fireEvent.click(screen.getByRole('button', { name: /服务端能力/ }));
  return within(screen.getByRole('dialog'));
}

describe('ServerCapabilityPopover（方案 v3 B-6）', () => {
  beforeEach(() => resetSearchProbeForTests());

  it('五项都在，且没有实测记录时检索标「取决于服务端」', () => {
    const dialog = openPopover();
    for (const label of ['话题回复', '表情回应', '内容检索', '加密房间', '离线推送']) {
      expect(dialog.getByText(new RegExp(label))).toBeInTheDocument();
    }
    expect(dialog.getByText('取决于服务端')).toBeInTheDocument();
    expect(dialog.getByText(/发起一次检索后/)).toBeInTheDocument();
    // 没探测过就不能出现「已实测」这种像结论的字样。
    expect(dialog.queryByText(/已实测/)).not.toBeInTheDocument();
  });

  it('检索探测到不可用：写服务端原因，并给出降级后的实际范围', () => {
    recordSearchProbe(true, 'Searching is not enabled');
    const dialog = openPopover();
    const searchRow = dialog.getByText('内容检索（search）').closest('li');
    expect(searchRow).not.toBeNull();
    const row = within(searchRow as HTMLElement);
    expect(row.getByText(/已实测：这个 homeserver 没有可用的全文检索——Searching is not enabled/)).toBeInTheDocument();
    // 「本控制台不支持」在受限项里是重复文案，只能按行取，不能按整张表取。
    expect(row.getByText('本控制台不支持')).toBeInTheDocument();
    expect(row.getByText(/最近一次实测：刚刚/)).toBeInTheDocument();
  });

  it('检索探测到可用：这一项转成「支持」，不再显示降级说明', () => {
    recordSearchProbe(false);
    const dialog = openPopover();
    expect(dialog.getByText('已实测：服务端全文检索可用，能搜到历史消息。')).toBeInTheDocument();
    expect(dialog.queryByText(/search_indexing_enabled/)).not.toBeInTheDocument();
  });

  it('表情回应归到控制台自己的缺口，不推给 homeserver', () => {
    const dialog = openPopover();
    const row = dialog.getByText('表情回应（reactions）').closest('li');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText(/这是控制台的实现缺口，不是 homeserver 的限制/)).toBeInTheDocument();
  });

  it('折叠时在触发器上给出受限项数，让运营者知道该点开看', () => {
    render(<ServerCapabilityPopover />);
    // threads 支持、其余三项固定受限、检索未探测 = 4 项。
    expect(screen.getByRole('button', { name: /4 项受限/ })).toBeInTheDocument();
  });
});

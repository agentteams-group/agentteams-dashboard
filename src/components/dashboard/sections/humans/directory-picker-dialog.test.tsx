import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { humanFilesApi } from '@/lib/human-files-api';
import { DirectoryPickerDialog, dirRulePath, pickerRows } from './directory-picker-dialog';

function renderPicker(overrides: {
  onPick?: (_path: string) => void;
  onOpenChange?: (_open: boolean) => void;
} = {}) {
  const onPick = overrides.onPick ?? vi.fn();
  const onOpenChange = overrides.onOpenChange ?? vi.fn();
  render(
    <DirectoryPickerDialog
      open
      humanName="alice"
      onOpenChange={onOpenChange}
      onPick={onPick}
    />,
  );
  return { onPick, onOpenChange };
}

beforeEach(() => {
  vi.spyOn(humanFilesApi, 'listDirectory').mockImplementation(async (_name, dir = '') => {
    if (dir === '') {
      return {
        path: '',
        entries: [
          { name: 'images', type: 'directory', size: 0 },
          { name: 'docs', type: 'directory', size: 0 },
          { name: 'readme.md', type: 'file', size: 12 },
        ],
      };
    }
    if (dir === 'docs') {
      return { path: dir, entries: [{ name: 'specs', type: 'directory', size: 0 }] };
    }
    return { path: dir, entries: [] };
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('dirRulePath / pickerRows', () => {
  it('根目录生成 files/**，其余生成 files/<rel>', () => {
    expect(dirRulePath('')).toBe('files/**');
    expect(dirRulePath('docs')).toBe('files/docs');
    expect(dirRulePath('docs/specs')).toBe('files/docs/specs');
  });

  it('只展开已加载的目录，收起时不列子项', () => {
    const dirs = {
      '': { status: 'loaded' as const, dirs: ['docs', 'images'] },
      docs: { status: 'loaded' as const, dirs: ['docs/specs'] },
    };
    expect(pickerRows(dirs, ['']).map((row) => row.path)).toEqual(['', 'docs', 'images']);
    expect(pickerRows(dirs, ['', 'docs']).map((row) => row.path)).toEqual([
      '',
      'docs',
      'docs/specs',
      'images',
    ]);
  });
});

describe('DirectoryPickerDialog', () => {
  it('从 files/ 根懒加载，只列目录；展开才拉子目录', async () => {
    renderPicker();
    expect(await screen.findByRole('treeitem', { name: 'docs' })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: 'images' })).toBeInTheDocument();
    // 文件不展示；子目录未展开不请求。
    expect(screen.queryByText('readme.md')).not.toBeInTheDocument();
    expect(humanFilesApi.listDirectory).toHaveBeenCalledTimes(1);
    expect(humanFilesApi.listDirectory).toHaveBeenCalledWith('alice', '');

    fireEvent.click(screen.getByRole('button', { name: '展开 docs' }));
    expect(await screen.findByRole('treeitem', { name: 'specs' })).toBeInTheDocument();
    expect(humanFilesApi.listDirectory).toHaveBeenCalledWith('alice', 'docs');

    fireEvent.click(screen.getByRole('button', { name: '收起 docs' }));
    await waitFor(() =>
      expect(screen.queryByRole('treeitem', { name: 'specs' })).not.toBeInTheDocument(),
    );
  });

  it('点目录 → 输出 files/<path> 并关闭', async () => {
    const { onPick, onOpenChange } = renderPicker();
    fireEvent.click(await screen.findByRole('treeitem', { name: 'docs' }));
    expect(onPick).toHaveBeenCalledWith('files/docs');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('点根目录 → 输出 files/**', async () => {
    const { onPick } = renderPicker();
    fireEvent.click(await screen.findByRole('treeitem', { name: '根目录' }));
    expect(onPick).toHaveBeenCalledWith('files/**');
  });

  it('键盘：↑/↓ 移行、→ 展开、Enter 选择', async () => {
    const { onPick } = renderPicker();
    const root = await screen.findByRole('treeitem', { name: '根目录' });
    root.focus();

    fireEvent.keyDown(root, { key: 'ArrowDown' });
    const docs = screen.getByRole('treeitem', { name: 'docs' });
    await waitFor(() => expect(docs).toHaveFocus());

    fireEvent.keyDown(docs, { key: 'ArrowRight' });
    expect(await screen.findByRole('treeitem', { name: 'specs' })).toBeInTheDocument();

    fireEvent.keyDown(docs, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith('files/docs');
  });

  it('403/404 → 目录列表不可用（不抛错）', async () => {
    vi.spyOn(humanFilesApi, 'listDirectory').mockRejectedValue(new Error('forbidden'));
    renderPicker();
    expect(await screen.findByText('目录列表不可用')).toBeInTheDocument();
    expect(screen.queryByRole('tree')).not.toBeInTheDocument();
    expect(screen.getByText(/请手动输入路径/)).toBeInTheDocument();
  });
});

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useFileDropZone } from './useFileDropZone';

function makeDragEvent(types: string[], files: File[] = []): React.DragEvent<HTMLElement> {
  return {
    dataTransfer: { types, files } as unknown as DataTransfer,
    preventDefault: vi.fn(),
  } as unknown as React.DragEvent<HTMLElement>;
}

describe('useFileDropZone', () => {
  it('does not activate the overlay for non-file drags', () => {
    const onFiles = vi.fn();
    const { result } = renderHook(() => useFileDropZone({ onFiles }));

    act(() => result.current.dropZoneProps.onDragEnter(makeDragEvent(['text/plain'])));
    expect(result.current.dragActive).toBe(false);
  });

  it('activates on the first file drag and clears on the final leave', () => {
    const onFiles = vi.fn();
    const { result } = renderHook(() => useFileDropZone({ onFiles }));

    act(() => result.current.dropZoneProps.onDragEnter(makeDragEvent(['Files'])));
    expect(result.current.dragActive).toBe(true);

    // Bubbling through children should NOT toggle.
    act(() => result.current.dropZoneProps.onDragEnter(makeDragEvent(['Files'])));
    act(() => result.current.dropZoneProps.onDragLeave(makeDragEvent(['Files'])));
    expect(result.current.dragActive).toBe(true);

    // Final leave flips it off.
    act(() => result.current.dropZoneProps.onDragLeave(makeDragEvent(['Files'])));
    expect(result.current.dragActive).toBe(false);
  });

  it('hands off dropped files and resets state', () => {
    const onFiles = vi.fn();
    const { result } = renderHook(() => useFileDropZone({ onFiles }));
    const file = new File(['x'], 'a.png', { type: 'image/png' });

    act(() => result.current.dropZoneProps.onDragEnter(makeDragEvent(['Files'])));
    act(() => result.current.dropZoneProps.onDrop(makeDragEvent(['Files'], [file])));

    expect(onFiles).toHaveBeenCalledWith([file]);
    expect(result.current.dragActive).toBe(false);
  });

  it('ignores drop events whose payload is empty', () => {
    const onFiles = vi.fn();
    const { result } = renderHook(() => useFileDropZone({ onFiles }));
    act(() => result.current.dropZoneProps.onDrop(makeDragEvent(['Files'], [])));
    expect(onFiles).not.toHaveBeenCalled();
  });
});
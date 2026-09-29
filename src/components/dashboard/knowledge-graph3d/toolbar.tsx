'use client';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

const ENGINE_CREDIT = '3d-force-graph (MIT) + three.js (MIT)';

/** 工具条（插件同款：缩放/适配/自动旋转/引擎标注/回到 2D）。 */
export function Graph3DToolbar({
  ready,
  autoRotate,
  onAutoRotateChange,
  onZoomIn,
  onZoomOut,
  onFit,
  onExit3D,
}: {
  ready: boolean;
  autoRotate: boolean;
  onAutoRotateChange: (_checked: boolean) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onExit3D: () => void;
}) {
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
      <Button
        variant="outline"
        size="sm"
        className="h-7 w-7 p-0 text-xs"
        onClick={onZoomIn}
        disabled={!ready}
        aria-label="放大"
      >
        ＋
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-7 w-7 p-0 text-xs"
        onClick={onZoomOut}
        disabled={!ready}
        aria-label="缩小"
      >
        －
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={onFit}
        disabled={!ready}
      >
        适配视图
      </Button>
      <Switch
        id="graph3d-rotate"
        checked={autoRotate}
        onCheckedChange={onAutoRotateChange}
        disabled={!ready}
      />
      <label
        htmlFor="graph3d-rotate"
        className="cursor-pointer select-none text-[11.5px] text-muted-foreground"
      >
        自动旋转
      </label>
      <span className="flex-1" />
      <span title={ENGINE_CREDIT} className="text-[11px] text-muted-foreground">
        引擎：{ENGINE_CREDIT}
      </span>
      <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={onExit3D}>
        回到 2D
      </Button>
    </div>
  );
}

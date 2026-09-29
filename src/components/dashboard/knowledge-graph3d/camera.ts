import * as THREE from 'three';
import type { ForceGraph3DInstance } from '3d-force-graph';
import type { G3DNodeInput } from './types';

// ── 相机适配（v0.5.0-beta.12：QwenPaw 2.2 MemoryGraphView 逐行移植，开源，
// 出处已在文件头注明）。官方三处调用时机：
// ① 建图后 rAF 立即 fit（0ms）——初始视角不再卡默认远位（「无限远」
// 根因：此前版本只有 onEngineStop fit，引擎收敛前相机停在默认位，
// fog 把远处节点全吞掉）
// ② 引擎收敛 onEngineStop → 平滑 480ms 重 fit
// ③ resize → 220ms 重 fit（仅无选中态）
// 算法：包围盒中心 target + 视角半径 viewRadius（距 target 最远节点，
// 下限 30）→ distance = viewRadius / tan(fov/2) × 0.92 → 沿当前视线
// 方向把相机平移到 distance 处并 lookAt target；同步收紧 zoom 上下限
// 与 far 平面（官方 applyGraphZoomLimits 同式）。
// ──
export const GRAPH_ZOOM_MIN_DISTANCE_FLOOR = 78;
const GRAPH_ZOOM_MIN_DISTANCE_RATIO = 0.72;
const GRAPH_ZOOM_MAX_DISTANCE_FLOOR = 420;
export const GRAPH_ZOOM_MAX_DISTANCE_CEILING = 3600;
const GRAPH_ZOOM_MAX_DISTANCE_MULTIPLIER = 1.8;
const GRAPH_ZOOM_MIN_DISTANCE_CAP = 240; // 近景锁定上限（见 applyGraphZoomLimits 注释）
// 拾取球半径（世界单位）= clamp(相机到 fit 中心距离 × 系数, MIN, MAX)。
// 系数 0.055：fit 距离处 ≈ 0.033×画面高（15–30px 直径级命中区）。
export const PICK_RADIUS_COEF = 0.055;
export const PICK_RADIUS_MIN = 12;
export const PICK_RADIUS_MAX = 34;

export function applyGraphZoomLimits(graph: ForceGraph3DInstance, fitDistance: number): void {
  const controls = graph.controls() as {
    minDistance: number;
    maxDistance: number;
  };
  // 官方式 minDistance = max(78, fit×0.72) 对大图会把近景锁死
  // （fit 1000+ → min 720+，放大极限不够）；官方记忆图小无感。
  // 修正：近景锁定封顶 GRAPH_ZOOM_MIN_DISTANCE_CAP（官方下限 78 起，
  // 大图最多锁到 240——仍可贴近读节点标签/环）。
  controls.minDistance = Math.max(
    GRAPH_ZOOM_MIN_DISTANCE_FLOOR,
    Math.min(
      fitDistance * GRAPH_ZOOM_MIN_DISTANCE_RATIO,
      GRAPH_ZOOM_MIN_DISTANCE_CAP,
    ),
  );
  controls.maxDistance = Math.max(
    fitDistance,
    Math.min(
      GRAPH_ZOOM_MAX_DISTANCE_CEILING,
      Math.max(
        GRAPH_ZOOM_MAX_DISTANCE_FLOOR,
        fitDistance * GRAPH_ZOOM_MAX_DISTANCE_MULTIPLIER,
      ),
    ),
  );
  const camera = graph.camera() as unknown as THREE.PerspectiveCamera;
  const requiredFarPlane = controls.maxDistance * 1.6;
  if (camera.far < requiredFarPlane) {
    camera.far = requiredFarPlane;
    camera.updateProjectionMatrix();
  }
}

export function fitGraphModel(
  graph: ForceGraph3DInstance,
  nodes: G3DNodeInput[],
  duration: number,
  targetRef?: { current: { x: number; y: number; z: number } | null },
): void {
  const positioned = nodes.filter(
    (n) =>
      Number.isFinite(n.x) &&
      Number.isFinite(n.y) &&
      Number.isFinite(n.z),
  );
  if (positioned.length < 2) {
    if (targetRef) targetRef.current = null;
    if (nodes.length < 2) {
      applyGraphZoomLimits(
        graph,
        GRAPH_ZOOM_MIN_DISTANCE_FLOOR / GRAPH_ZOOM_MIN_DISTANCE_RATIO,
      );
    }
    graph.zoomToFit(duration, 64);
    return;
  }
  const bounds = positioned.reduce(
    (cur, n) => ({
      maxX: Math.max(cur.maxX, Number(n.x)),
      maxY: Math.max(cur.maxY, Number(n.y)),
      maxZ: Math.max(cur.maxZ, Number(n.z)),
      minX: Math.min(cur.minX, Number(n.x)),
      minY: Math.min(cur.minY, Number(n.y)),
      minZ: Math.min(cur.minZ, Number(n.z)),
    }),
    {
      maxX: -Infinity,
      maxY: -Infinity,
      maxZ: -Infinity,
      minX: Infinity,
      minY: Infinity,
      minZ: Infinity,
    },
  );
  const target = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2,
  };
  if (targetRef) targetRef.current = { ...target };
  const camera = graph.camera() as unknown as THREE.PerspectiveCamera;
  const viewRadius = Math.max(
    ...positioned.map(
      (n) =>
        Math.hypot(
          Number(n.x) - target.x,
          Number(n.y) - target.y,
          Number(n.z) - target.z,
        ),
    ),
    30,
  );
  const distance =
    (viewRadius / Math.tan((camera.fov * Math.PI) / 360)) * 0.92;
  applyGraphZoomLimits(graph, distance);
  const currentCamera = graph.cameraPosition();
  const offset = {
    x: currentCamera.x - target.x,
    y: currentCamera.y - target.y,
    z: currentCamera.z - target.z,
  };
  const offsetLength =
    Math.hypot(offset.x, offset.y, offset.z) || 1;
  graph.cameraPosition(
    {
      x: target.x + (offset.x / offsetLength) * distance,
      y: target.y + (offset.y / offsetLength) * distance,
      z: target.z + (offset.z / offsetLength) * distance,
    },
    target,
    duration,
  );
}

/** 节点半径——QwenPaw graphNodeRadius 同值。 */
export function nodeRadius(n: G3DNodeInput, isRoot: boolean, isDirect: boolean, degree: number): number {
  if (isRoot) return 4.8;
  if (isDirect) return 3.55;
  if (n.virtual) return 2.55;
  return Math.min(3.35, 2.7 + Math.sqrt(degree) * 0.24);
}

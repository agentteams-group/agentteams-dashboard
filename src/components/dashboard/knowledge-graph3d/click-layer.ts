import * as THREE from 'three';
import type { G3DNodeInput, NodeVisual } from './types';

// 自持点击层阈值——3D「点不动」根因修复。库（three-graph-renderer
// Scene）鼠标拖拽判定无距离阈值：pointerdown 后任意 pointermove（1px 手抖
// 即触发）置 isPointerDragging，pointerup 时 clickAfterDrag(false) 静默
// 吞掉点击 → onNodeClick 不触发。容器自行判定「真点击」并手动 raycast
// 节点拾取球反查命中（与库 hover 同一几何，手感一致）。
const CLICK_TAP_MAX_MOVE_PX = 5;
const CLICK_TAP_MAX_MS = 500;
const CLICK_DEDUP_MS = 200;

/** 容器级自持点击层（根因修复「3D 点不动」——库鼠标拖拽判定无距离
 * 阈值，1px 手抖即吞点击；见上方 CLICK_TAP_* 常量注释）。
 * 记录 pointerdown/up：位移 <5px 且 <500ms = 真点击 → raycast 节点
 * 拾取球（PICK 球，与库 hover 同一几何）反查命中 → onActivate。
 * 库监听同元素更早注册先派发：静止点击库已回调 → CLICK_DEDUP_MS
 * 窗口内跳过，双路不重复。返回清理函数（移除两个监听）。 */
export function attachSelfClickLayer(
  el: HTMLElement,
  refs: {
    graphRef: { current: { camera?: () => unknown } | null };
    nodeVisualsRef: { current: Map<string, NodeVisual> };
    graphDataRef: { current: { nodes: G3DNodeInput[] } };
    libClickRef: { current: { id: string; t: number } };
  },
  onActivate: (_n: G3DNodeInput) => void,
): () => void {
  let pressInfo:
    | { x: number; y: number; t: number; pid: number }
    | null = null;
  const onSelfPointerDown = (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    pressInfo = {
      x: ev.clientX,
      y: ev.clientY,
      t: performance.now(),
      pid: ev.pointerId,
    };
  };
  const onSelfPointerUp = (ev: PointerEvent) => {
    if (!pressInfo || ev.pointerId !== pressInfo.pid) return;
    const moved = Math.hypot(
      ev.clientX - pressInfo.x,
      ev.clientY - pressInfo.y,
    );
    const held = performance.now() - pressInfo.t;
    pressInfo = null;
    if (
      moved > CLICK_TAP_MAX_MOVE_PX ||
      held > CLICK_TAP_MAX_MS
    )
      return; // 真拖拽（旋转视角）/长按——不是点击
    if (
      performance.now() - refs.libClickRef.current.t <
      CLICK_DEDUP_MS
    )
      return; // 库已派发（静止点击）
    const g = refs.graphRef.current;
    const cam = g?.camera?.() as
      | THREE.PerspectiveCamera
      | undefined;
    if (!g || !cam) return;
    const rect = el.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((ev.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, cam);
    const pickMeshes: THREE.Object3D[] = [];
    refs.nodeVisualsRef.current.forEach((v) => pickMeshes.push(v.pick));
    const hits = raycaster.intersectObjects(pickMeshes, false);
    const hitId = hits.length
      ? ((hits[0].object.userData.nodeId as string) || '')
      : '';
    if (!hitId) return;
    const node = refs.graphDataRef.current.nodes.find(
      (nd) => nd.id === hitId,
    );
    if (node) onActivate(node);
  };
  el.addEventListener('pointerdown', onSelfPointerDown);
  el.addEventListener('pointerup', onSelfPointerUp);
  return () => {
    el.removeEventListener('pointerdown', onSelfPointerDown);
    el.removeEventListener('pointerup', onSelfPointerUp);
  };
}

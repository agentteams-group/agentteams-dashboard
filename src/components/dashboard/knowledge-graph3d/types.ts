import * as THREE from 'three';
import type { ForceGraph3DInstance } from '3d-force-graph';

export interface G3DNodeInput {
  id: string;
  name: string;
  /** 图谱数据携带的额外字段（dashboard：工作区文件相对路径，点击开预览用）。 */
  path?: string;
  virtual?: boolean;
  category?: string;
  /** v4：未解析引用灰点（hover 提示标注，点击不可开预览）。 */
  resolved?: boolean;
  /** 聚合模式：节点所属 Worker 名（图例着色用）。 */
  agent?: string;
  /** d3-force 运行时写入的布局坐标（引擎跑过即有值）。 */
  x?: number;
  y?: number;
  z?: number;
}
export interface G3DLinkInput {
  source: string;
  target: string;
}

/** 选中/静音态直接操作 material 所需的引用与基准值
 * （QwenPaw GraphNodeVisual 同结构）。 */
export interface NodeVisual {
  coreMat: THREE.MeshStandardMaterial;
  orbit: THREE.Mesh;
  orbitMat: THREE.MeshBasicMaterial;
  glow: THREE.Mesh;
  glowMat: THREE.MeshBasicMaterial;
  /** 拾取放大球（单位球几何，scale=当前拾取半径，随相机距离自适应）。 */
  pick: THREE.Mesh;
  baseColor: string;
  isRoot: boolean;
  isDirect: boolean;
  isVirtual: boolean;
}

export interface G3DGraph {
  nodes: G3DNodeInput[];
  links: G3DLinkInput[];
  colorFor: (_n: G3DNodeInput) => string;
  isRoot: (_n: G3DNodeInput) => boolean;
  isDirect: (_n: G3DNodeInput) => boolean;
  onOpenNode: (_n: G3DNodeInput) => void;
  /** 选中状态外抛（图谱与预览面板双视图共享）。 */
  onSelect?: (_id: string) => void;
  onExit3D: () => void;
  height?: number;
}

/** 运行时实例句柄：库类型面 + d.ts 未暴露的 centerAt（来自
 * three-render-objects 运行时 API）。 */
export type Graph3DHandle = ForceGraph3DInstance & {
  centerAt?: (_x?: number, _y?: number, _z?: number, _transitionMs?: number) => unknown;
};

/** controls() 的 d.ts 返回 object（不可用）——按用到的字段结构化声明
 * （OrbitControls 同款表面）。 */
export interface Graph3DControls {
  minDistance: number;
  maxDistance: number;
  autoRotate: boolean;
  target: { x: number; y: number; z: number };
  addEventListener: (_type: string, _listener: () => void) => void;
  removeEventListener?: (_type: string, _listener: () => void) => void;
}

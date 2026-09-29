import * as THREE from 'three';
import SpriteText from 'three-spritetext';
import type { G3DPalette } from './palette';
import { PICK_RADIUS_MIN, nodeRadius } from './camera';
import type { G3DNodeInput, NodeVisual } from './types';

/** buildNodeVisual 读取的共享状态（主组件 stateRef.current 的结构子集，
 * 结构化传参而非整 ref——纯函数化，零行为差异）。 */
export interface NodeBuildState {
  palette: G3DPalette;
  colorFor: (_n: G3DNodeInput) => string;
  isRoot: (_n: G3DNodeInput) => boolean;
  isDirect: (_n: G3DNodeInput) => boolean;
  degree: Map<string, number>;
  nodeCount: number;
  labelSet: Set<string>;
}

// 自绘节点对象——QwenPaw createGraphNodeVisual 同构。
export function buildNodeVisual(
  n: G3DNodeInput,
  s: NodeBuildState,
): { obj: THREE.Group; visual: NodeVisual } {
  const p = s.palette;
  const root = s.isRoot(n);
  const direct = s.isDirect(n);
  const deg = s.degree.get(n.id) || 0;
  const radius = nodeRadius(n, root, direct, deg);
  const segments = s.nodeCount > 220 ? 14 : 24;
  const obj = new THREE.Group();
  const baseColor = s.colorFor(n);

  // 核心球（MeshStandardMaterial + 自发光同色——QwenPaw 原值）。
  const coreMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    emissive: new THREE.Color(baseColor),
    emissiveIntensity: root ? 0.14 : direct ? 0.07 : 0.03,
    metalness: root || direct ? 0.08 : 0.035,
    opacity: n.virtual ? 0.74 : 1,
    roughness: root ? 0.38 : direct ? 0.46 : 0.58,
    transparent: Boolean(n.virtual),
    wireframe: Boolean(n.virtual) && !root,
  });
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(
      radius,
      segments,
      Math.max(10, segments - 6),
    ),
    coreMat,
  );
  obj.add(core);

  // 拾取放大球（引入，v0.5.0-beta.12 改自适应——用户反馈「命中区还是太小」）。
  // 可见球半径只有 2.55–4.8 世界单位（link distance 72），而团队合并
  // 图谱（100+ 节点）fit 后 viewRadius 大，节点屏幕占比远小于官方
  // 单 agent 记忆图谱（10–40 节点）——同半径不同图规模=屏幕尺寸不同。
  // 官方在它的图规模下"点得中"，靠不了照抄半径，靠的是目标在屏幕上
  // 恒有足够像素。这里：单位球几何 + scale 随相机距离联动
  // （updatePickScales），保证屏幕命中区恒定 ≈15–30px，缩放/换图
  // 都自适应。material.visible=false = 不渲染，但 mesh 对
  // THREE.Raycaster 仍可见；force-graph hover/click 走
  // intersectingObjects(recursive) + getGraphObj 父级回溯到节点组。
  // 半径 clamp[12,34]：34 < 典型邻节点间距（link 72）→ 不互抢。
  const pickMat = new THREE.MeshBasicMaterial({ visible: false });
  const pick = new THREE.Mesh(
    new THREE.SphereGeometry(1, 10, 7),
    pickMat,
  );
  pick.scale.setScalar(PICK_RADIUS_MIN);
  // 自持点击层 raycast 命中后由此反查节点 id。
  pick.userData.nodeId = n.id;
  obj.add(pick);

  // root 轨道环（QwenPaw 同款 Torus）。
  const orbitMat = new THREE.MeshBasicMaterial({
    color: p.root,
    depthWrite: false,
    opacity: root ? 0.42 : 0,
    transparent: true,
  });
  const orbit = new THREE.Mesh(
    new THREE.TorusGeometry(
      radius * 1.43,
      radius * 0.035,
      8,
      44,
    ),
    orbitMat,
  );
  orbit.rotation.set(
    Math.PI * 0.38,
    Math.PI * 0.12,
    Math.PI * 0.08,
  );
  orbit.visible = root;
  obj.add(orbit);

  // 光晕（选中时点亮——QwenPaw glow 同机制）。
  const glowMat = new THREE.MeshBasicMaterial({
    color: p.active,
    depthWrite: false,
    opacity: 0,
    side: THREE.BackSide,
    transparent: true,
  });
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.28, 18, 12),
    glowMat,
  );
  glow.visible = false;
  obj.add(glow);

  // 标签——集合由 graphData memo 预计算（9/17 验收第六轮起=全节点；
  // 全名走 hover 提示，标签超 22 字截断带省略号）。
  // SpriteText(text, textHeight世界单位, color)；fontSize=76 是
  // 画布分辨率（清晰度），不是字号（混淆了两者）。
  if (s.labelSet.has(n.id)) {
    const raw = String(n.name);
    const text =
      raw.length > 22 ? `${raw.slice(0, 21)}…` : raw;
    const label = new SpriteText(
      text,
      root ? 4.3 : 3.7,
      p.label,
    );
    label.backgroundColor = root
      ? p.labelBackground
      : 'transparent';
    label.borderColor = p.labelBorder;
    label.borderRadius = 1.1;
    label.borderWidth = root ? 0.14 : 0;
    label.fontFace =
      'Geist, Inter, ui-sans-serif, system-ui, sans-serif';
    label.fontSize = 76;
    label.fontWeight = root ? '650' : '560';
    label.padding = root ? [1.05, 0.68] : [0.32, 0.1];
    label.position.set(0, -(radius + 3.6), 0);
    label.renderOrder = 4;
    obj.add(label);
  }

  return {
    obj,
    visual: {
      coreMat,
      orbit,
      orbitMat,
      glow,
      glowMat,
      pick,
      baseColor,
      isRoot: root,
      isDirect: direct,
      isVirtual: Boolean(n.virtual),
    },
  };
}

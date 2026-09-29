import * as THREE from 'three';
import type { ForceGraph3DInstance } from '3d-force-graph';
import {
  GRAPH_ZOOM_MAX_DISTANCE_CEILING,
  GRAPH_ZOOM_MIN_DISTANCE_FLOOR,
} from './camera';
import type { G3DPalette } from './palette';

/** 场景定格配置——相机（官方原值 fov 44 / near 0.1 / far CEILING×1.6）、
 * zoom 初始上下限、雾、四灯组（官方 createGraphLights 原值）、色调映射
 * 与物理力。主题相关参数在初始化时定格（见文件头注释③）。 */
export function configureGraphScene(
  graph: ForceGraph3DInstance,
  p: G3DPalette,
  updatePickScales: () => void,
): void {
  // 相机——官方原值（fov 44 / near 0.1 / far CEILING*1.6；
  // zoom 上下限由 fitGraphModel 的 applyGraphZoomLimits 动态收紧）。
  const camera: any = graph.camera();
  camera.fov = 44;
  camera.near = 0.1;
  camera.far = GRAPH_ZOOM_MAX_DISTANCE_CEILING * 1.6;
  camera.updateProjectionMatrix();
  const controls: any = graph.controls();
  controls.minDistance = GRAPH_ZOOM_MIN_DISTANCE_FLOOR;
  controls.maxDistance = GRAPH_ZOOM_MAX_DISTANCE_CEILING;
  // 相机移动（缩放/平移/旋转 tween/fit tween）→ 拾取球
  // 半径自适应（屏幕命中区恒定）。
  controls.addEventListener('change', updatePickScales);

  // 雾——官方原值。
  graph.scene().fog = new THREE.FogExp2(
    new THREE.Color(p.surface).getHex(),
    p.isDark ? 0.00085 : 0.0016,
  );
  // 四灯组——官方 createGraphLights 原值。
  const lights: THREE.Light[] = [];
  const ambient = new THREE.AmbientLight(
    '#ffffff',
    p.isDark ? 1.45 : 1.25,
  );
  const hemi = new THREE.HemisphereLight(
    '#ffffff',
    '#8899bb',
    p.isDark ? 1.22 : 1.05,
  );
  const key = new THREE.DirectionalLight(
    '#ffffff',
    p.isDark ? 2.7 : 2.3,
  );
  key.position.set(110, 150, 190);
  const fill = new THREE.DirectionalLight(
    '#ffffff',
    p.isDark ? 1.08 : 0.82,
  );
  fill.position.set(-120, -55, -90);
  lights.push(ambient, hemi, key, fill);
  lights.forEach((l) => graph.scene().add(l));
  graph.renderer().toneMappingExposure = p.isDark
    ? 1.1
    : 0.98;
  // 物理力——官方原值 -108/72 是为 v3（wikilink 稀疏图）标定；v4 结构边
  // hub-and-spoke 节点更多更密，同值下整图发散，验收轮反馈「点隔太远」
  // → 两轮收紧：-60/44/0.5 → -50/38/0.52（散点再聚合一档；参数语义与
  // 官方一致只改数值；不设 collide 同官方）。插件 Graph3D 同值。
  graph.d3Force('charge')?.strength?.(-50);
  const linkForce: any = graph.d3Force('link');
  linkForce?.distance?.(38);
  linkForce?.strength?.(0.52);
}

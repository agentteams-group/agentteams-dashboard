'use client';

// 3D 知识图谱——**移植自 workbench 插件 Graph3D.tsx（v0.5.0-beta.12，
// 其本身逐行对齐 QwenPaw 2.2 MemoryGraphView）**：同引擎、同参数、
// 同交互（自绘节点/自持点击层/相机三时机 fit/拾取球自适应）。
// 9/17 装验定案「3D 参考插件」——8/17 旧定案「dashboard 2D 简化、
// 3D 留插件宿主版」自此作废。
//
// 与插件源文件的三处适配（其余逐段同构，改动处均留注释）：
//  ① 宿主无关：React 直接 import（非 QwenPaw host 注入）；
//  ② 无 antd/i18n：shadcn Button/Switch + 中文直写（dashboard 惯例）；
//  ③ 主题：插件 useThemeColors → useGraph3DPalette（运行时读计算后
//     CSS 变量 + .dark 类，跟随 dashboard ThemeProvider 任意主题）。
//     与插件相同：场景底色/灯光/雾在初始化时定格（主题中途切换不重铺
//     场景，重进图谱即新主题——插件同款行为）。
//
// 开源引用：three.js (MIT) / 3d-force-graph (MIT, Vasturiano) /
// three-spritetext (MIT, Jay Weisskopf)——版本钉死插件同版
// （three 0.185.1 / 3d-force-graph 1.80.0 / three-spritetext 1.10.0）。
//
// A5.5 拆分（2026-09-29）：本文件保留主组件与挂载/数据/选中 effect；
// 相机适配与节点半径在 knowledge-graph3d/camera.ts，主题在 palette.ts，
// 自绘节点在 node-visual.ts，场景定格（相机/灯/雾/物理力）在 scene.ts，
// 自持点击层在 click-layer.ts，工具条在 toolbar.tsx，类型在 types.ts。

import * as React from 'react';
import * as THREE from 'three';
import ForceGraph3DImpl from '3d-force-graph';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useGraph3DPalette } from './knowledge-graph3d/palette';
import {
  fitGraphModel,
  nodeRadius,
  PICK_RADIUS_COEF,
  PICK_RADIUS_MAX,
  PICK_RADIUS_MIN,
} from './knowledge-graph3d/camera';
import { buildNodeVisual } from './knowledge-graph3d/node-visual';
import { configureGraphScene } from './knowledge-graph3d/scene';
import { attachSelfClickLayer } from './knowledge-graph3d/click-layer';
import { Graph3DToolbar } from './knowledge-graph3d/toolbar';
import type { G3DGraph, G3DNodeInput, NodeVisual } from './knowledge-graph3d/types';

export type { G3DNodeInput, G3DLinkInput } from './knowledge-graph3d/types';
export { useGraph3DPalette } from './knowledge-graph3d/palette';
export type { G3DPalette } from './knowledge-graph3d/palette';

// ── 主组件 ──────────────────────────────────────────────────────────────
export function KnowledgeGraph3D(props: G3DGraph) {
  const {
    nodes,
    links,
    colorFor,
    isRoot,
    isDirect,
    onOpenNode,
    onSelect,
    onExit3D,
    height = 480,
  } = props;
  const t = useGraph3DPalette();
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const graphRef = React.useRef<any>(null);
  const [ready, setReady] = React.useState(false);
  // WebGL 能力探测放惰性初始化（渲染期一次，客户端组件挂载即有 DOM）
  // ——不在 effect 里 setState（react-hooks/set-state-in-effect 规则）。
  const [webglFail] = React.useState<boolean>(() => {
    try {
      const cv = document.createElement('canvas');
      const gl = cv.getContext('webgl2') || cv.getContext('webgl');
      return !gl;
    } catch {
      return true;
    }
  });
  const [initError, setInitError] = React.useState('');
  const [autoRotate, setAutoRotate] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState('');
  // 选中 ref（onNodeClick 只在 init effect
  // 注册一次，闭包读不到最新 selectedId，走 ref 同步）。
  const selIdRef = React.useRef('');
  React.useEffect(() => {
    selIdRef.current = selectedId;
  }, [selectedId]);
  // fit 中心（拾取球自适应距离基准）+ hover 节点（ref 直改
  // material，零 re-render——hover 是高频事件）。
  const fitTargetRef = React.useRef<{
    x: number;
    y: number;
    z: number;
  } | null>(null);
  const hoverIdRef = React.useRef('');
  // 库自身 onNodeClick 触发时间戳（自持点击层去重——静止点击库已
  // 派发回调则跳过；被「拖拽」吞掉的点击库不派发 → 自持层补位）。
  const libClickRef = React.useRef<{ id: string; t: number }>({
    id: '',
    t: 0,
  });

  // 拾取球自适应缩放：所有节点拾取球 scale = clamp(距离×系数, MIN, MAX)。
  // 相机在 fit 距离处时命中区 ≈ 画面高的 3.3%（15–30px 直径）；放大/
  // 缩小/换图（viewRadius 变）都保持恒定屏幕尺寸。O(节点数)×1 赋值，
  // 'change' 事件频率下成本可忽略。
  const updatePickScales = React.useCallback(() => {
    const g = graphRef.current;
    if (!g) return;
    const cam = g.camera?.() as
      | THREE.PerspectiveCamera
      | undefined;
    if (!cam) return;
    const tgt = fitTargetRef.current;
    const dist = tgt
      ? cam.position.distanceTo(
          new THREE.Vector3(tgt.x, tgt.y, tgt.z),
        )
      : cam.position.length();
    const r = Math.min(
      PICK_RADIUS_MAX,
      Math.max(PICK_RADIUS_MIN, dist * PICK_RADIUS_COEF),
    );
    nodeVisualsRef.current.forEach((v) => {
      v.pick.scale.setScalar(r);
    });
  }, []);

  // hover 视觉（QwenPaw setHoveredGraphNodeColor 同机制）：悬停节点
  // 提亮 emissive + 点亮 glow——给用户可见的"对准了"反馈（瞄准辅助，
  // 比光标变化强一个量级）。选中态由选中 effect 独占，这里不碰选中节点。
  const applyHoverVisual = React.useCallback(
    (id: string, on: boolean) => {
      const v = nodeVisualsRef.current.get(id);
      if (!v || selIdRef.current === id) return;
      if (on) {
        v.coreMat.emissiveIntensity = v.isRoot
          ? 0.3
          : v.isDirect
            ? 0.28
            : 0.5;
        v.glow.visible = true;
        v.glowMat.opacity = 0.3;
      } else {
        v.coreMat.emissiveIntensity = v.isRoot
          ? 0.13
          : v.isDirect
            ? 0.07
            : 0.03;
        v.glow.visible = false;
        v.glowMat.opacity = 0;
      }
    },
    [],
  );

  // QwenPaw 同款 palette——官方从宿主 CSS 变量读，这里用其
  // 回退值映射（active #d9650b / muted #c7bfb8 / root #ff7f16 /
  // label 浅底桃边——原值照抄，深色按同色温推导）。
  const palette = React.useMemo(
    () => ({
      surface: t.surface,
      label: t.label,
      labelBackground: t.labelBackground,
      labelBorder: t.labelBorder,
      root: t.root,
      active: t.active,
      muted: t.muted,
      isDark: t.isDark,
    }),
    [t],
  );

  // 闭包读最新值（accessor 不随 React 重渲染重建）。
  const stateRef = React.useRef({
    palette,
    colorFor,
    isRoot,
    isDirect,
    onOpenNode,
    neighborSets: new Map<string, Set<string>>() as Map<string, Set<string>>,
    degree: new Map<string, number>(),
    nodeCount: 0,
    labelSet: new Set<string>(),
  });
  stateRef.current.palette = palette;
  stateRef.current.colorFor = colorFor;
  stateRef.current.isRoot = isRoot;
  stateRef.current.isDirect = isDirect;
  stateRef.current.onOpenNode = onOpenNode;
  stateRef.current.nodeCount = nodes.length;

  // 度数表（半径 + 标签阈值）。
  const degree = React.useMemo(() => {
    const d = new Map<string, number>();
    links.forEach((e) => {
      d.set(e.source, (d.get(e.source) || 0) + 1);
      d.set(e.target, (d.get(e.target) || 0) + 1);
    });
    return d;
  }, [links]);
  stateRef.current.degree = degree;

  const neighborSets = React.useMemo(() => {
    const m = new Map<string, Set<string>>();
    links.forEach((e) => {
      if (!m.has(e.source)) m.set(e.source, new Set());
      m.get(e.source)!.add(e.target);
      if (!m.has(e.target)) m.set(e.target, new Set());
      m.get(e.target)!.add(e.source);
    });
    return m;
  }, [links]);
  stateRef.current.neighborSets = neighborSets;

  // 自绘节点视觉表——nodeThreeObject accessor 写入（buildNodeVisual）。
  const nodeVisualsRef = React.useRef(
    new Map<string, NodeVisual>(),
  );

  const graphData = React.useMemo(() => {
    const s = stateRef.current;
    const nd = nodes.map((n) => {
      const deg = s.degree.get(n.id) || 0;
      const r = nodeRadius(
        n,
        s.isRoot(n),
        s.isDirect(n),
        deg,
      );
      return { ...n, val: r ** 3, _deg: deg };
    });
    const idset = new Set(nodes.map((n) => n.id));
    const lk = links
      .filter((l) => idset.has(l.source) && idset.has(l.target))
      .map((l) => ({
        source: l.source,
        target: l.target,
        _bi:
          l.source < l.target &&
          links.some(
            (o) =>
              o.source === l.target &&
              o.target === l.source,
          ),
      }));
    // 标签集合——9/17 验收第六轮：全节点挂标签（与插件/QwenPaw 同标准，
    // 旧 auto≤42 / top14 策略被「不是每个点都有标题」否决）。
    // nodeThreeObject 建球时读 stateRef.labelSet，渲染期同步写入——
    // engine 建球在 effect 之后，读到的必是当帧值。
    const labelSet = new Set<string>(nd.map((n) => n.id));
    stateRef.current.labelSet = labelSet;
    return { nodes: nd, links: lk };
  }, [nodes, links]); // degree 由 links 派生，随 links 同变

  // latest-ref：init 效果的 ResizeObserver 闭包只捕获首帧 graphData，
  // 数据更新后 resize 重 fit 必须用当前节点（官方 resizeAndFit 同理
  // 取当前 graphModel；此处用 ref 避免闭包陈旧）。
  const graphDataRef = React.useRef(graphData);
  React.useEffect(() => {
    graphDataRef.current = graphData;
  }, [graphData]);

  // 挂载 3D 图（一次）；数据变化时换 graphData。
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el || nodes.length === 0) return;
    if (webglFail) return; // 惰性初始化已探测过（不重复建 canvas）
    let cancelled = false;
    const p = stateRef.current.palette;
    // 容器 = 3d 独占 DOM（零 React 子节点）。
    try {
      el.replaceChildren();
    } catch {
      /* noop */
    }

    try {
      // 节点点击激活（root=相机聚焦不选中；其余=切换选中+开预览）。
      // 库 onNodeClick 与自持点击层共用此出口。
      const handleNodeActivate = (n: G3DNodeInput) => {
        if (stateRef.current.isRoot(n)) {
          // root 大球不再是"点了没反应"的最大目标——
          // 官方 onNodeClick=focusGraphNode 同款：相机聚焦到 root
          // （centerAt 600ms 平滑），不选中。
          try {
            graphRef.current?.centerAt(n.x, n.y, n.z, 600);
          } catch {
            /* noop */
          }
          return;
        }
        const next = selIdRef.current === n.id ? '' : n.id;
        setSelectedId(next);
        onSelect?.(next);
        // 点文件节点直接开预览（2D 同款）。
        if (next) stateRef.current.onOpenNode(n);
      };

      // 实例类型化（tsc 对照 d.ts 验证链式调用）。
      const graph = new ForceGraph3DImpl(el, {
        controlType: 'orbit',
      })
        .width(Math.max(1, el.clientWidth || 960))
        .height(height)
        .backgroundColor(p.surface)
        .numDimensions(3)
        .nodeId('id')
        // 自绘节点（官方 extend=false 替换默认）+ nodeOpacity
        // **必须数字**（L1168 直接乘，函数=NaN 全隐形）。
        .nodeRelSize(1)
        .nodeVal((n: any) => n.val)
        .nodeOpacity(1)
        .nodeResolution(24)
        .nodeColor(() => '#ffffff')
        .nodeThreeObject((n: any) => {
          nodeVisualsRef.current.delete(n.id);
          const { obj, visual } = buildNodeVisual(n, stateRef.current);
          nodeVisualsRef.current.set(n.id, visual);
          return obj;
        })
        .nodeThreeObjectExtend(false)
        // 官方同款：禁内置 HTML tooltip（自绘标签已覆盖）。
        .nodeLabel(() => '')
        .linkOpacity(0.64)
        .linkResolution(4)
        .linkColor(() =>
          p.isDark
            ? 'rgba(255,255,255,0.55)'
            : 'rgba(0,0,0,0.42)',
        )
        .linkDirectionalArrowRelPos(0.94)
        .linkDirectionalArrowLength(4.2)
        .linkDirectionalArrowResolution(10)
        .linkDirectionalArrowColor(() =>
          p.isDark
            ? 'rgba(255,255,255,0.6)'
            : 'rgba(0,0,0,0.5)',
        )
        // 官方双向边曲率 ±0.12（单向 0）。
        .linkCurvature((l: any) => (l._bi ? 0.12 : 0))
        .enableNodeDrag(false)
        .enableNavigationControls(true)
        // 物理参数官方原值（布局尺度 link distance 72！）。
        .d3AlphaDecay(0.038)
        .d3VelocityDecay(0.3)
        .warmupTicks(52)
        .cooldownTicks(160)
        .graphData({ nodes: [], links: [] })
        // 点击激活逻辑抽成共享函数——库 onNodeClick（静止点击）与
        // 自持点击层（被吞点击补位）走同一出口，行为完全一致。
        .onNodeClick((n: any) => {
          libClickRef.current = {
            id: n.id,
            t: performance.now(),
          };
          handleNodeActivate(n);
        })
        .onNodeHover((n: any) => {
          // hover 视觉反馈（提亮+glow）——可见的"对准了"提示。
          const prev = hoverIdRef.current;
          const next = n && !stateRef.current.isRoot(n) ? n.id : '';
          if (prev !== next) {
            if (prev) applyHoverVisual(prev, false);
            if (next) applyHoverVisual(next, true);
            hoverIdRef.current = next;
          }
          el.style.cursor = next ? 'pointer' : 'default';
          // 全名提示：root 已有常驻标签不提示（插件同款），其余节点
          // 显示 名称 + 完整路径 + Worker（聚合）+ 未解析标注。
          if (n && next) {
            const lines = [String(n.name)];
            const full =
              n.path && n.path !== n.id ? String(n.path) : String(n.id);
            if (full !== String(n.name)) lines.push(full);
            if (n.agent) lines.push(`Worker：${n.agent}`);
            if (n.resolved === false) lines.push('未解析引用（文件不存在，不可点开）');
            tip.textContent = lines.join('\n');
            tip.style.display = 'block';
            positionTip(lastPtr.x, lastPtr.y);
          } else {
            tip.style.display = 'none';
          }
        })
        .onBackgroundClick(() => {
          setSelectedId('');
          onSelect?.('');
        });

      // hover 全名提示（自绘 HTML，跟手移动——库内置 nodeLabel 按官方
      // 同款禁用；静态 SpriteText 截 22 字，完整路径/未解析标注只能
      // 放这里。9/17 装验反馈 G1「鼠标放上去有全名」）。
      const tip = document.createElement('div');
      tip.style.cssText =
        `position:absolute;left:0;top:0;z-index:30;display:none;` +
        `pointer-events:none;max-width:280px;padding:4px 8px;` +
        `border-radius:6px;font-size:11px;line-height:1.55;` +
        `background:${p.labelBackground};color:${p.label};` +
        `border:1px solid ${p.labelBorder};` +
        `box-shadow:0 4px 14px rgba(0,0,0,0.18);` +
        `white-space:pre-wrap;word-break:break-all;`;
      el.appendChild(tip);
      const lastPtr = { x: 0, y: 0 };
      const positionTip = (x: number, y: number) => {
        const r = el.getBoundingClientRect();
        let tx = x + 14;
        let ty = y + 12;
        const tw = tip.offsetWidth || 0;
        const th = tip.offsetHeight || 0;
        if (tx + tw > r.width - 4) tx = Math.max(4, x - tw - 10);
        if (ty + th > r.height - 4) ty = Math.max(4, y - th - 8);
        tip.style.left = `${tx}px`;
        tip.style.top = `${ty}px`;
      };
      const onTipMove = (e: PointerEvent) => {
        const r = el.getBoundingClientRect();
        lastPtr.x = e.clientX - r.left;
        lastPtr.y = e.clientY - r.top;
        if (tip.style.display !== 'none') {
          positionTip(lastPtr.x, lastPtr.y);
        }
      };
      el.addEventListener('pointermove', onTipMove);

      // 相机/灯/雾/物理力 + 拾取球自适应联动（scene.ts，主题定格）。
      configureGraphScene(graph, p, updatePickScales);

      // 数据灌入 + 官方双 fit：rAF 立即 fit（初始视角根治「无限远」）
      // + 引擎收敛 onEngineStop 平滑 480ms 重 fit。
      graph.graphData(graphData);
      let fitTimer = 0;
      window.requestAnimationFrame(() => {
        if (!cancelled && graphRef.current === graph) {
          fitGraphModel(
            graph,
            graphData.nodes,
            0,
            fitTargetRef,
          );
          updatePickScales();
        }
      });
      graph.onEngineStop(() => {
        if (cancelled) return;
        window.clearTimeout(fitTimer);
        fitTimer = window.setTimeout(
          () => {
            if (!cancelled) {
              fitGraphModel(
                graph,
                graphData.nodes,
                480,
                fitTargetRef,
              );
              updatePickScales();
            }
          },
          60,
        );
      });
      graphRef.current = graph;
      // ready 置位走宏任务（effect 内不同步 setState；加载遮罩晚一帧消失=无感）
      const readyTimer = window.setTimeout(() => setReady(true), 0);

      // resize → 官方 resizeAndFit：改尺寸 + 220ms 重 fit
      // （有选中态不重 fit——官方同款保护选中视角）。
      let resizeFrame = 0;
      const ro = new ResizeObserver(() => {
        const b = el.getBoundingClientRect();
        graph.width(Math.max(1, Math.round(b.width || 960)));
        graph.height(height);
        window.cancelAnimationFrame(resizeFrame);
        resizeFrame = window.requestAnimationFrame(() => {
          if (!selIdRef.current) {
            fitGraphModel(
              graph,
              graphDataRef.current.nodes,
              220,
              fitTargetRef,
            );
            updatePickScales();
          }
        });
      });
      ro.observe(el);

      // 自持点击层（click-layer.ts——「3D 点不动」根因修复，与库
      // 点击双路去重，详见该模块注释）。
      const detachClickLayer = attachSelfClickLayer(
        el,
        { graphRef, nodeVisualsRef, graphDataRef, libClickRef },
        handleNodeActivate,
      );

      return () => {
        cancelled = true;
        window.clearTimeout(readyTimer);
        window.clearTimeout(fitTimer);
        window.cancelAnimationFrame(resizeFrame);
        ro.disconnect();
        detachClickLayer();
        el.removeEventListener('pointermove', onTipMove);
        try {
          (graph.controls?.() as any)?.removeEventListener?.(
            'change',
            updatePickScales,
          );
        } catch {
          /* noop */
        }
        try {
          graph._destructor?.();
        } catch {
          /* noop */
        }
        // _destructor 不清 DOM——canvas/navInfo 残留会撞 React
        // 协调（历史修复的根因）。官方 container.replaceChildren() 同款。
        try {
          el.replaceChildren();
        } catch {
          /* noop */
        }
        graphRef.current = null;
        setReady(false);
      };
    } catch (e) {
      // 引擎异常 → 降级 2D 不炸 tab（历史修复）。
      try {
        el.replaceChildren();
      } catch {
        /* noop */
      }
      // 宏任务置位（effect 内不同步 setState；cancelled 防卸载后置位）
      window.setTimeout(() => {
        if (!cancelled) {
          setInitError(e instanceof Error ? e.message : String(e));
        }
      }, 0);
      return undefined;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 数据变化 → 换图 + 重新 fit（选中态清空、visual 表由
  // nodeThreeObject accessor 重建）。
  React.useEffect(() => {
    const g = graphRef.current;
    if (!g || !ready) return;
    // 清选中走宏任务（effect 内不同步 setState；陈旧选中由选中 effect
    // 的 has() 守卫兜底——新图节点空间里查不到=直接忽略）。
    const t = setTimeout(() => setSelectedId(''), 0);
    hoverIdRef.current = '';
    nodeVisualsRef.current.clear();
    g.graphData(graphData);
    // 官方同款：换数据立即 fit（0ms）+ 引擎收敛后平滑 480ms 重 fit。
    window.requestAnimationFrame(() => {
      if (graphRef.current === g) {
        fitGraphModel(g, graphData.nodes, 0, fitTargetRef);
        updatePickScales();
      }
    });
    let ft = 0;
    g.onEngineStop(() => {
      window.clearTimeout(ft);
      ft = window.setTimeout(
        () => {
          fitGraphModel(g, graphData.nodes, 480, fitTargetRef);
          updatePickScales();
        },
        60,
      );
    });
    return () => window.clearTimeout(t);
  }, [graphData, ready, updatePickScales]);

  // 选中态 → **直接操作 material**——QwenPaw applyGraphVisualState
  // 逐行同构（nodeOpacity 不支持 accessor，隐形根因；
  // 不透明材质调 opacity 无效，必须切 transparent + needsUpdate）。
  React.useEffect(() => {
    // 陈旧选中守卫：换图瞬间 selectedId 还是旧图节点 id（清选中走
    // 宏任务），新图视觉表里查不到 → 跳过本轮（不做全局变暗）。
    if (selectedId && !nodeVisualsRef.current.has(selectedId)) return;
    const p = stateRef.current.palette;
    const nb = selectedId
      ? neighborSets.get(selectedId)
      : undefined;
    nodeVisualsRef.current.forEach((v, id) => {
      const isSelected = id === selectedId;
      const isNeighbor = Boolean(nb && nb.has(id));
      const isMuted =
        Boolean(selectedId) && !isSelected && !isNeighbor;
      const nodeColor = isSelected
        ? p.active
        : isMuted
          ? p.muted
          : v.baseColor;
      v.coreMat.color.set(nodeColor);
      v.coreMat.emissive.set(
        isSelected ? p.active : v.baseColor,
      );
      v.coreMat.emissiveIntensity = isSelected
        ? 0.32
        : v.isRoot
          ? 0.13
          : v.isDirect
            ? 0.07
            : 0.03;
      v.coreMat.opacity = isMuted
        ? 0.24
        : v.isVirtual
          ? 0.74
          : 1;
      v.coreMat.transparent = isMuted || v.isVirtual;
      v.coreMat.needsUpdate = true;
      v.orbit.visible = isSelected || v.isRoot;
      v.orbitMat.color.set(
        isSelected ? p.active : p.root,
      );
      v.orbitMat.opacity = isSelected
        ? 0.78
        : isMuted
          ? 0.12
          : 0.42;
      v.glow.visible = isSelected;
      v.glowMat.color.set(p.active);
      v.glowMat.opacity = isSelected ? 0.13 : 0;
    });
  }, [selectedId, neighborSets]);

  // 自动旋转 = OrbitControls.autoRotate（tick 每帧
  // controls.update 生效，three-render-objects tick 实锤）。
  React.useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    try {
      const controls = g.controls?.();
      if (controls) controls.autoRotate = Boolean(autoRotate);
    } catch {
      /* noop */
    }
  }, [autoRotate, ready]);

  // 缩放 = cameraPosition 相对 controls.target 位移（zoom() 未代理，
  // 历史缺陷修复）。factor<1 放大，>1 缩小。
  const zoomBy = (factor: number) => {
    const g = graphRef.current;
    if (!g) return;
    try {
      const cam = g.camera?.();
      const controls = g.controls?.();
      const target = controls?.target || { x: 0, y: 0, z: 0 };
      g.cameraPosition(
        {
          x: target.x + (cam.position.x - target.x) * factor,
          y: target.y + (cam.position.y - target.y) * factor,
          z: target.z + (cam.position.z - target.z) * factor,
        },
        240,
      );
    } catch {
      /* noop */
    }
  };

  if (webglFail) {
    return (
      <div className="my-10 rounded-md border border-amber-300 bg-amber-50 p-4 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
        <p className="font-medium">当前浏览器/设备不支持 WebGL，3D 图谱不可用</p>
        <p className="mt-1 opacity-80">已自动保留 2D 图谱视图</p>
        <Button variant="outline" size="sm" className="mt-2 h-6 px-2 text-xs" onClick={onExit3D}>
          回到 2D
        </Button>
      </div>
    );
  }

  if (initError) {
    return (
      <div className="my-10 rounded-md border border-amber-300 bg-amber-50 p-4 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
        <p className="font-medium">3D 图谱初始化失败，已回退 2D</p>
        <p className="mt-1 font-mono opacity-80">{initError}</p>
        <Button variant="outline" size="sm" className="mt-2 h-6 px-2 text-xs" onClick={onExit3D}>
          回到 2D
        </Button>
      </div>
    );
  }

  return (
    <div>
      <Graph3DToolbar
        ready={ready}
        autoRotate={autoRotate}
        onAutoRotateChange={setAutoRotate}
        onZoomIn={() => zoomBy(1 / 1.25)}
        onZoomOut={() => zoomBy(1.25)}
        onFit={() => {
          const g = graphRef.current;
          if (g) fitGraphModel(g, graphData.nodes, 650);
        }}
        onExit3D={onExit3D}
      />
      {/* 3D 容器零 React 子节点 + 兄弟位遮罩。 */}
      <div
        style={{
          width: '100%',
          height,
          borderRadius: 8,
          overflow: 'hidden',
        }}
        className="relative border border-border/60"
      >
        <div ref={containerRef} className="absolute inset-0" />
        {!ready ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2.5">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
            <span className="text-xs text-muted-foreground">3D 布局计算中…</span>
          </div>
        ) : null}
      </div>
      <div className="mt-1 text-[11.5px] text-muted-foreground">
        拖拽旋转 · 滚轮缩放 · 右键平移 · 点节点选中（邻接高亮）并打开预览 · 点空白取消
      </div>
    </div>
  );
}

export default KnowledgeGraph3D;

// three-render-objects imports this module unconditionally even though
// KnowledgeGraph3D always uses Three's WebGL renderer. Keep the unused WebGPU
// implementation out of the on-demand 3D bundle; fail loudly if a future caller
// accidentally tries to enable it instead of silently changing renderers.
export class WebGPURenderer {
  constructor() {
    throw new Error('KnowledgeGraph3D uses WebGL only; WebGPU is disabled');
  }
}

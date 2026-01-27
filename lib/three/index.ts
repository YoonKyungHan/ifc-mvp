/**
 * Three.js 최적화 유틸리티 모음
 */

export {
  analyzeForInstancing,
  optimizeWithInstancing,
  getInstancingStats,
} from "./instancedMeshOptimizer";

export {
  createLODMesh,
  applyLODToGroup,
  DynamicLODManager,
  enableFrustumCulling,
  createBoundingBoxHelpers,
} from "./lodManager";

export {
  mergeByMaterial,
  getVerticesForExpressID,
} from "./geometryMerger";

// BVH 레이캐스팅
export {
  initBVH,
  applyBVHToGroup,
  disposeBVHFromGroup,
  SpatialPartition,
} from "./bvhRaycaster";

// Stencil 하이라이팅
export {
  StencilHighlighter,
  MaterialHighlighter,
} from "./stencilHighlighter";

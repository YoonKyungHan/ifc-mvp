/**
 * BVH (Bounding Volume Hierarchy) 기반 레이캐스팅 최적화
 * three-mesh-bvh 라이브러리를 사용하여 대규모 모델에서 빠른 선택 구현
 */

import * as THREE from "three";
import { 
  MeshBVH, 
  acceleratedRaycast, 
  computeBoundsTree, 
  disposeBoundsTree 
} from "three-mesh-bvh";

// Three.js 프로토타입에 BVH 메서드 추가
let isInitialized = false;

export function initBVH(): void {
  if (isInitialized) return;
  
  // BufferGeometry에 BVH 메서드 추가
  THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
  THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
  
  // Mesh의 raycast를 가속화된 버전으로 교체
  THREE.Mesh.prototype.raycast = acceleratedRaycast;
  
  isInitialized = true;
  console.log("✅ BVH 레이캐스팅 초기화 완료");
}

/**
 * 그룹 내 모든 메시에 BVH 적용
 */
export function applyBVHToGroup(group: THREE.Group, options?: {
  maxLeafTris?: number;
  verbose?: boolean;
}): void {
  const { maxLeafTris = 10, verbose = false } = options || {};
  let count = 0;
  let skipped = 0;
  
  group.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry) {
      const geometry = child.geometry as THREE.BufferGeometry;
      
      // 이미 BVH가 있으면 스킵
      if (geometry.boundsTree) {
        skipped++;
        return;
      }
      
      // 인덱스가 없는 geometry는 인덱스 추가
      if (!geometry.index) {
        const positionAttr = geometry.getAttribute("position");
        if (positionAttr) {
          const indices = [];
          for (let i = 0; i < positionAttr.count; i++) {
            indices.push(i);
          }
          geometry.setIndex(indices);
        }
      }
      
      try {
        // BVH 생성
        geometry.boundsTree = new MeshBVH(geometry, { maxLeafTris });
        count++;
      } catch (e) {
        // 일부 geometry는 BVH 생성 실패할 수 있음
        if (verbose) {
          console.warn("BVH 생성 실패:", e);
        }
      }
    }
  });
  
  if (verbose || count > 100) {
    console.log(`🔍 BVH 적용: ${count}개 메시 (스킵: ${skipped}개)`);
  }
}

/**
 * 그룹 내 모든 메시의 BVH 해제
 */
export function disposeBVHFromGroup(group: THREE.Group): void {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry) {
      const geometry = child.geometry as THREE.BufferGeometry;
      if (geometry.boundsTree) {
        geometry.disposeBoundsTree();
      }
    }
  });
}

/**
 * 특정 영역의 메시만 레이캐스트 (공간 분할)
 */
export class SpatialPartition {
  private cells: Map<string, THREE.Mesh[]> = new Map();
  private cellSize: number;
  
  constructor(cellSize: number = 10) {
    this.cellSize = cellSize;
  }
  
  private getCellKey(position: THREE.Vector3): string {
    const x = Math.floor(position.x / this.cellSize);
    const y = Math.floor(position.y / this.cellSize);
    const z = Math.floor(position.z / this.cellSize);
    return `${x},${y},${z}`;
  }
  
  /**
   * 그룹 내 메시들을 공간 분할 구조에 추가
   */
  build(group: THREE.Group): void {
    this.cells.clear();
    
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        // 메시의 중심점 계산
        const center = new THREE.Vector3();
        if (child.geometry.boundingBox) {
          child.geometry.boundingBox.getCenter(center);
        } else {
          child.geometry.computeBoundingBox();
          child.geometry.boundingBox?.getCenter(center);
        }
        child.localToWorld(center);
        
        const key = this.getCellKey(center);
        
        if (!this.cells.has(key)) {
          this.cells.set(key, []);
        }
        this.cells.get(key)!.push(child);
      }
    });
    
    console.log(`🗺️ 공간 분할: ${this.cells.size}개 셀 생성`);
  }
  
  /**
   * 특정 위치 주변의 메시들만 반환
   */
  getMeshesNear(position: THREE.Vector3, radius: number = 1): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    const cellRadius = Math.ceil(radius / this.cellSize);
    
    const centerCell = {
      x: Math.floor(position.x / this.cellSize),
      y: Math.floor(position.y / this.cellSize),
      z: Math.floor(position.z / this.cellSize),
    };
    
    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      for (let dy = -cellRadius; dy <= cellRadius; dy++) {
        for (let dz = -cellRadius; dz <= cellRadius; dz++) {
          const key = `${centerCell.x + dx},${centerCell.y + dy},${centerCell.z + dz}`;
          const cellMeshes = this.cells.get(key);
          if (cellMeshes) {
            meshes.push(...cellMeshes);
          }
        }
      }
    }
    
    return meshes;
  }
  
  clear(): void {
    this.cells.clear();
  }
}

// 타입 확장
declare module "three" {
  interface BufferGeometry {
    boundsTree?: MeshBVH;
    computeBoundsTree: typeof computeBoundsTree;
    disposeBoundsTree: typeof disposeBoundsTree;
  }
}

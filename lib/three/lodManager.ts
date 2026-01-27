/**
 * LOD Manager
 * 카메라 거리에 따라 메시의 디테일 수준을 조절
 */

import * as THREE from "three";

interface LODLevel {
  distance: number;
  simplifyRatio: number; // 0.1 = 10%, 1.0 = 100%
}

// 기본 LOD 레벨 설정
const DEFAULT_LOD_LEVELS: LODLevel[] = [
  { distance: 0, simplifyRatio: 1.0 },     // 가까이: 전체 디테일
  { distance: 50, simplifyRatio: 0.5 },    // 중간: 50% 디테일
  { distance: 100, simplifyRatio: 0.25 },  // 멀리: 25% 디테일
  { distance: 200, simplifyRatio: 0.1 },   // 아주 멀리: 10% 디테일
];

/**
 * 지오메트리 단순화 (버텍스 인덱스 스킵 방식)
 * 실제 프로덕션에서는 simplify-js나 meshoptimizer 사용 권장
 */
function simplifyGeometry(
  geometry: THREE.BufferGeometry, 
  ratio: number
): THREE.BufferGeometry {
  if (ratio >= 1.0) return geometry.clone();
  
  const positions = geometry.getAttribute("position");
  const normals = geometry.getAttribute("normal");
  const indices = geometry.getIndex();
  
  if (!positions || !indices) return geometry.clone();
  
  const simplified = new THREE.BufferGeometry();
  
  // 단순화: 일부 삼각형만 사용
  const step = Math.max(1, Math.floor(1 / ratio));
  const newIndices: number[] = [];
  
  for (let i = 0; i < indices.count; i += step * 3) {
    if (i + 2 < indices.count) {
      newIndices.push(
        indices.getX(i),
        indices.getX(i + 1),
        indices.getX(i + 2)
      );
    }
  }
  
  simplified.setAttribute("position", positions.clone());
  if (normals) simplified.setAttribute("normal", normals.clone());
  simplified.setIndex(newIndices);
  
  return simplified;
}

/**
 * 메시에 LOD 적용
 */
export function createLODMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  levels: LODLevel[] = DEFAULT_LOD_LEVELS
): THREE.LOD {
  const lod = new THREE.LOD();
  
  for (const level of levels) {
    const simplifiedGeometry = simplifyGeometry(geometry, level.simplifyRatio);
    const mesh = new THREE.Mesh(simplifiedGeometry, material.clone());
    lod.addLevel(mesh, level.distance);
  }
  
  return lod;
}

/**
 * 그룹의 모든 메시에 LOD 적용
 */
export function applyLODToGroup(
  group: THREE.Group,
  levels: LODLevel[] = DEFAULT_LOD_LEVELS,
  minVertices: number = 100 // 이 이상의 버텍스를 가진 메시만 LOD 적용
): THREE.Group {
  const lodGroup = new THREE.Group();
  lodGroup.name = group.name + "_lod";
  
  let lodApplied = 0;
  let skipped = 0;
  
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    
    const positions = child.geometry.getAttribute("position");
    const vertexCount = positions?.count || 0;
    
    if (vertexCount >= minVertices) {
      // LOD 적용
      const lod = createLODMesh(
        child.geometry, 
        child.material as THREE.Material, 
        levels
      );
      
      // 원본 메시의 변환 복사
      lod.position.copy(child.position);
      lod.rotation.copy(child.rotation);
      lod.scale.copy(child.scale);
      lod.userData = { ...child.userData };
      
      lodGroup.add(lod);
      lodApplied++;
    } else {
      // 작은 메시는 그대로 복사
      const clonedMesh = child.clone();
      lodGroup.add(clonedMesh);
      skipped++;
    }
  });
  
  console.log(`🎯 LOD 적용: ${lodApplied}개 메시, ${skipped}개 스킵`);
  
  return lodGroup;
}

/**
 * 동적 LOD 업데이트 (카메라 위치 기반)
 */
export class DynamicLODManager {
  private lods: THREE.LOD[] = [];
  private camera: THREE.Camera;
  
  constructor(camera: THREE.Camera) {
    this.camera = camera;
  }
  
  /**
   * LOD 객체 등록
   */
  register(lod: THREE.LOD): void {
    this.lods.push(lod);
  }
  
  /**
   * 그룹 내 모든 LOD 등록
   */
  registerGroup(group: THREE.Group): void {
    group.traverse((child) => {
      if (child instanceof THREE.LOD) {
        this.lods.push(child);
      }
    });
  }
  
  /**
   * 카메라 위치에 따라 LOD 업데이트
   * 렌더 루프에서 호출
   */
  update(): void {
    for (const lod of this.lods) {
      lod.update(this.camera);
    }
  }
  
  /**
   * 모든 LOD 제거
   */
  clear(): void {
    this.lods = [];
  }
  
  /**
   * 현재 활성 LOD 레벨 통계
   */
  getStats(): { total: number; levels: Map<number, number> } {
    const levels = new Map<number, number>();
    
    for (const lod of this.lods) {
      // 현재 활성 레벨 확인 (근사치)
      const distance = lod.position.distanceTo(this.camera.position);
      const level = Math.floor(distance / 50); // 50 단위로 레벨 구분
      levels.set(level, (levels.get(level) || 0) + 1);
    }
    
    return { total: this.lods.length, levels };
  }
}

/**
 * 프러스텀 컬링 최적화 설정
 */
export function enableFrustumCulling(group: THREE.Group): void {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.LOD) {
      child.frustumCulled = true;
    }
  });
}

/**
 * 오클루전 컬링을 위한 바운딩박스 헬퍼 (디버그용)
 */
export function createBoundingBoxHelpers(group: THREE.Group): THREE.Group {
  const helpers = new THREE.Group();
  helpers.name = "boundingBoxHelpers";
  
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const box = new THREE.Box3().setFromObject(child);
      const helper = new THREE.Box3Helper(box, new THREE.Color(0x00ff00));
      helpers.add(helper);
    }
  });
  
  return helpers;
}

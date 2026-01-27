/**
 * Instanced Mesh Optimizer
 * 동일한 지오메트리를 가진 메시들을 InstancedMesh로 변환하여 드로우콜 최적화
 */

import * as THREE from "three";

interface GeometryHash {
  hash: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  instances: {
    matrix: THREE.Matrix4;
    expressID: number;
    typeCode: number;
  }[];
}

/**
 * 지오메트리 해시 생성 (버텍스 수 + 인덱스 수 + 바운딩박스 기반)
 */
function computeGeometryHash(geometry: THREE.BufferGeometry): string {
  const positions = geometry.getAttribute("position");
  const indices = geometry.getIndex();
  
  const vertexCount = positions?.count || 0;
  const indexCount = indices?.count || 0;
  
  // 바운딩 박스 계산
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  
  if (!box) {
    return `v${vertexCount}_i${indexCount}_unknown`;
  }
  
  const size = box.getSize(new THREE.Vector3());
  const sizeHash = `${size.x.toFixed(3)}_${size.y.toFixed(3)}_${size.z.toFixed(3)}`;
  
  return `v${vertexCount}_i${indexCount}_${sizeHash}`;
}

/**
 * 그룹 내 메시들을 분석하여 인스턴싱 가능한 것들을 찾음
 */
export function analyzeForInstancing(group: THREE.Group): Map<string, GeometryHash> {
  const geometryMap = new Map<string, GeometryHash>();
  
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    if (child.userData.expressID === undefined) return;
    
    const hash = computeGeometryHash(child.geometry);
    
    // 월드 매트릭스 계산
    child.updateMatrixWorld(true);
    const worldMatrix = child.matrixWorld.clone();
    
    if (geometryMap.has(hash)) {
      const entry = geometryMap.get(hash)!;
      entry.instances.push({
        matrix: worldMatrix,
        expressID: child.userData.expressID,
        typeCode: child.userData.typeCode,
      });
    } else {
      geometryMap.set(hash, {
        hash,
        geometry: child.geometry.clone(),
        material: (child.material as THREE.Material).clone(),
        instances: [{
          matrix: worldMatrix,
          expressID: child.userData.expressID,
          typeCode: child.userData.typeCode,
        }],
      });
    }
  });
  
  return geometryMap;
}

/**
 * 그룹을 Instanced Mesh로 최적화
 * @param group - 원본 Three.js 그룹
 * @param minInstances - 최소 인스턴스 수 (이 이상일 때만 인스턴싱)
 * @returns 최적화된 새 그룹
 */
export function optimizeWithInstancing(
  group: THREE.Group, 
  minInstances: number = 3
): THREE.Group {
  const geometryMap = analyzeForInstancing(group);
  
  const optimizedGroup = new THREE.Group();
  optimizedGroup.name = group.name + "_optimized";
  
  let instancedCount = 0;
  let regularCount = 0;
  
  geometryMap.forEach((entry) => {
    if (entry.instances.length >= minInstances) {
      // Instanced Mesh 생성
      const instancedMesh = new THREE.InstancedMesh(
        entry.geometry,
        entry.material,
        entry.instances.length
      );
      
      // 각 인스턴스의 매트릭스 설정
      entry.instances.forEach((inst, index) => {
        instancedMesh.setMatrixAt(index, inst.matrix);
      });
      
      instancedMesh.instanceMatrix.needsUpdate = true;
      
      // userData에 인스턴스 정보 저장 (선택용)
      instancedMesh.userData.instances = entry.instances.map(i => ({
        expressID: i.expressID,
        typeCode: i.typeCode,
      }));
      instancedMesh.userData.isInstanced = true;
      
      optimizedGroup.add(instancedMesh);
      instancedCount += entry.instances.length;
    } else {
      // 일반 메시로 유지
      entry.instances.forEach((inst) => {
        const mesh = new THREE.Mesh(entry.geometry.clone(), entry.material.clone());
        mesh.applyMatrix4(inst.matrix);
        mesh.userData.expressID = inst.expressID;
        mesh.userData.typeCode = inst.typeCode;
        optimizedGroup.add(mesh);
        regularCount++;
      });
    }
  });
  
  console.log(`🚀 인스턴싱 최적화: ${instancedCount}개 인스턴스화, ${regularCount}개 일반 메시`);
  console.log(`📉 드로우콜 감소: ${instancedCount + regularCount} → ${optimizedGroup.children.length}`);
  
  return optimizedGroup;
}

/**
 * 인스턴싱 통계 반환
 */
export function getInstancingStats(group: THREE.Group): {
  totalMeshes: number;
  uniqueGeometries: number;
  potentialSavings: number;
} {
  const geometryMap = analyzeForInstancing(group);
  
  let totalMeshes = 0;
  let instanceable = 0;
  
  geometryMap.forEach((entry) => {
    totalMeshes += entry.instances.length;
    if (entry.instances.length >= 3) {
      instanceable += entry.instances.length - 1; // 1개는 원본으로 필요
    }
  });
  
  return {
    totalMeshes,
    uniqueGeometries: geometryMap.size,
    potentialSavings: instanceable,
  };
}

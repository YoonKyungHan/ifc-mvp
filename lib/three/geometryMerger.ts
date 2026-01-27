/**
 * Geometry Merger
 * 동일한 재질의 지오메트리를 병합하여 드로우콜 감소
 * 선택 기능과 호환됨 (userData 유지)
 */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

interface MergeGroup {
  material: THREE.Material;
  geometries: THREE.BufferGeometry[];
  expressIDs: number[];
  typeCodes: number[];
}

/**
 * 그룹 내 메시들을 재질별로 병합
 * @param group - 원본 Three.js 그룹
 * @param maxMeshesPerGroup - 병합할 최대 메시 수 (너무 크면 GPU 메모리 문제)
 * @returns 병합된 새 그룹
 */
export function mergeByMaterial(
  group: THREE.Group,
  maxMeshesPerGroup: number = 500
): THREE.Group {
  const mergedGroup = new THREE.Group();
  mergedGroup.name = group.name + "_merged";
  
  // 재질별로 메시 그룹화
  const materialGroups = new Map<string, MergeGroup>();
  
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    if (!child.geometry || !child.material) return;
    
    const material = child.material as THREE.MeshLambertMaterial;
    
    // 색상 기반 키 생성 (uuid 대신 - 더 나은 그룹핑)
    const color = material.color;
    const opacity = material.opacity || 1;
    const key = `${color.r.toFixed(2)}_${color.g.toFixed(2)}_${color.b.toFixed(2)}_${opacity.toFixed(2)}`;
    
    // 월드 매트릭스 적용된 지오메트리 복제
    child.updateMatrixWorld(true);
    const geo = child.geometry.clone();
    geo.applyMatrix4(child.matrixWorld);
    
    // expressID를 vertex attribute로 저장 (나중에 선택용)
    const vertexCount = geo.getAttribute("position").count;
    const expressIDAttr = new Float32Array(vertexCount);
    expressIDAttr.fill(child.userData.expressID || 0);
    geo.setAttribute("expressID", new THREE.BufferAttribute(expressIDAttr, 1));
    
    if (materialGroups.has(key)) {
      const group = materialGroups.get(key)!;
      group.geometries.push(geo);
      group.expressIDs.push(child.userData.expressID);
      group.typeCodes.push(child.userData.typeCode);
    } else {
      materialGroups.set(key, {
        material: material.clone(),
        geometries: [geo],
        expressIDs: [child.userData.expressID],
        typeCodes: [child.userData.typeCode],
      });
    }
  });
  
  // 각 그룹 병합
  let mergedCount = 0;
  let totalOriginal = 0;
  
  materialGroups.forEach((group) => {
    totalOriginal += group.geometries.length;
    
    // 청크로 나누어 병합 (너무 큰 지오메트리 방지)
    for (let i = 0; i < group.geometries.length; i += maxMeshesPerGroup) {
      const chunk = group.geometries.slice(i, i + maxMeshesPerGroup);
      const chunkExpressIDs = group.expressIDs.slice(i, i + maxMeshesPerGroup);
      
      try {
        const merged = mergeGeometries(chunk, false);
        if (merged) {
          const mesh = new THREE.Mesh(merged, group.material);
          mesh.userData.isMerged = true;
          mesh.userData.expressIDs = chunkExpressIDs;
          mesh.frustumCulled = true;
          mergedGroup.add(mesh);
          mergedCount++;
        }
      } catch (e) {
        // 병합 실패 시 개별 메시로 추가
        chunk.forEach((geo, idx) => {
          const mesh = new THREE.Mesh(geo, group.material.clone());
          mesh.userData.expressID = chunkExpressIDs[idx];
          mergedGroup.add(mesh);
          mergedCount++;
        });
      }
    }
  });
  
  console.log(`🔀 지오메트리 병합: ${totalOriginal} → ${mergedCount} 메시 (${Math.round((1 - mergedCount/totalOriginal) * 100)}% 감소)`);
  
  return mergedGroup;
}

/**
 * 병합된 메시에서 선택된 expressID의 버텍스 찾기
 */
export function getVerticesForExpressID(
  mesh: THREE.Mesh,
  expressID: number
): number[] {
  const expressIDAttr = mesh.geometry.getAttribute("expressID");
  if (!expressIDAttr) return [];
  
  const indices: number[] = [];
  for (let i = 0; i < expressIDAttr.count; i++) {
    if (expressIDAttr.getX(i) === expressID) {
      indices.push(i);
    }
  }
  return indices;
}

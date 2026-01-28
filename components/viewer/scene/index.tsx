"use client";

import { useRef, useEffect, useCallback } from "react";
import { useThree, invalidate } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import { highlightMaterial, normalHighlightMaterial } from "./materials";
import { initBVH, applyBVHToGroup } from "@/lib/three";

export interface IFCSceneProps {
  model: THREE.Group | null;
  onElementSelect: (expressID: number | null, typeCode?: number) => void;
  selectedExpressIDs: number[];
  tableHighlightedIDs?: number[];  // 테이블에서 강조된 요소 (초록색)
  isDarkMode: boolean;
  hiddenExpressIDs: Set<number> | null;  // 숨길 expressID들
  xrayMode: boolean;
  visibleExpressIDs: Set<number> | null; // 보여줄 expressID들 (층 필터)
  showEdges: boolean; // 윤곽선 표시 여부
}

// 클릭 판정 기준
const CLICK_TIME_THRESHOLD = 200;
const CLICK_DISTANCE_THRESHOLD = 5;

// 윤곽선 재질 - CAD/3D뷰어 스타일 (부드러운 다크 블루-그레이)
const edgeMaterialDark = new THREE.LineBasicMaterial({ 
  color: 0x4a5568, // 다크모드: 부드러운 슬레이트 그레이
});
const edgeMaterialLight = new THREE.LineBasicMaterial({ 
  color: 0x64748b, // 라이트모드: 블루-그레이
});

// 테이블 강조용 초록색 재질
const greenHighlightMaterial = new THREE.MeshBasicMaterial({
  color: 0x22c55e, // 초록색
  transparent: true,
  opacity: 0.9,
  depthTest: true,
  side: THREE.DoubleSide,
});
const greenXrayMaterial = new THREE.MeshBasicMaterial({
  color: 0x22c55e,
  transparent: true,
  opacity: 0.85,
  depthTest: false,
  side: THREE.DoubleSide,
});

export function IFCScene({ 
  model, 
  onElementSelect, 
  selectedExpressIDs,
  tableHighlightedIDs = [],
  isDarkMode, 
  hiddenExpressIDs, 
  xrayMode, 
  visibleExpressIDs,
  showEdges
}: IFCSceneProps) {
  const { camera, scene } = useThree();
  const controlsRef = useRef<any>(null);
  
  const meshMapRef = useRef<Map<number, THREE.Mesh[]>>(new Map());
  const originalMaterialsRef = useRef<Map<THREE.Mesh, THREE.Material>>(new Map());
  const edgeLinesRef = useRef<Map<THREE.Mesh, THREE.LineSegments>>(new Map()); // 윤곽선 저장
  const prevSelectedRef = useRef<Set<number>>(new Set());
  const pointerDownRef = useRef<{ time: number; x: number; y: number } | null>(null);

  // 배경색
  useEffect(() => {
    scene.background = new THREE.Color(isDarkMode ? 0x1e293b : 0xf8fafc);
    invalidate();
  }, [isDarkMode, scene]);

  // 모델 로드 시 - BVH 레이캐스팅 적용
  useEffect(() => {
    if (!model) {
      meshMapRef.current.clear();
      originalMaterialsRef.current.clear();
      return;
    }

    // BVH 초기화 (한 번만)
    initBVH();

    const meshMap = new Map<number, THREE.Mesh[]>();
    const originalMaterials = new Map<THREE.Mesh, THREE.Material>();

    model.traverse((child) => {
      if (child instanceof THREE.Mesh && child.userData.expressID !== undefined) {
        const id = child.userData.expressID;
        const arr = meshMap.get(id) || [];
        arr.push(child);
        meshMap.set(id, arr);
        originalMaterials.set(child, child.material as THREE.Material);
        child.frustumCulled = true;
      }
    });

    meshMapRef.current = meshMap;
    originalMaterialsRef.current = originalMaterials;

    // 🚀 BVH 적용 (레이캐스팅 속도 향상)
    console.log("🔍 BVH 레이캐스팅 적용 중...");
    applyBVHToGroup(model, { verbose: true });

    if (controlsRef.current) {
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const distance = Math.max(size.x, size.y, size.z) * 2;
      
      camera.position.set(center.x + distance, center.y + distance * 0.5, center.z + distance);
      controlsRef.current.target.copy(center);
      controlsRef.current.update();
    }

    invalidate();
  }, [model, camera]);

  // 숨김 처리
  useEffect(() => {
    if (!model) return;

    model.traverse((child) => {
      if (child instanceof THREE.Mesh && child.userData.expressID !== undefined) {
        const expressID = child.userData.expressID;
        
        // 1. 명시적으로 숨긴 자재 (hiddenExpressIDs)
        if (hiddenExpressIDs !== null && hiddenExpressIDs.has(expressID)) {
          child.visible = false;
          return;
        }
        
        // 2. 층 필터 (visibleExpressIDs)
        if (visibleExpressIDs !== null && !visibleExpressIDs.has(expressID)) {
          child.visible = false;
          return;
        }
        
        child.visible = true;
      }
    });
    invalidate();
  }, [model, hiddenExpressIDs, visibleExpressIDs]);

  // 윤곽선 처리 (비동기 청크 방식으로 UI 블로킹 방지)
  useEffect(() => {
    if (!model) return;

    const edgeLines = edgeLinesRef.current;
    const edgeMaterial = isDarkMode ? edgeMaterialDark : edgeMaterialLight;
    let cancelled = false;

    if (showEdges) {
      // 메시 목록 수집 (일반 메시 + 병합된 메시 모두 포함)
      const meshesToProcess: THREE.Mesh[] = [];
      model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          // 일반 메시 또는 병합된 메시 모두 처리
          const isNormalMesh = child.userData.expressID !== undefined;
          const isMergedMesh = child.userData.isMerged === true;
          
          if ((isNormalMesh || isMergedMesh) && !edgeLines.has(child)) {
            meshesToProcess.push(child);
          }
        }
      });

      // 청크 단위로 비동기 처리 (UI 블로킹 방지)
      // 대용량 파일(100MB+)의 경우 청크를 크게 해서 처리 속도 향상
      const CHUNK_SIZE = 100;
      let index = 0;

      const processChunk = () => {
        if (cancelled) return;
        
        const end = Math.min(index + CHUNK_SIZE, meshesToProcess.length);
        
        for (let i = index; i < end; i++) {
          const mesh = meshesToProcess[i];
          try {
            const edges = new THREE.EdgesGeometry(mesh.geometry, 0.1); // 0.1도 = 모든 엣지 표시
            const line = new THREE.LineSegments(edges, edgeMaterial.clone());
            line.userData.isEdgeLine = true;
            mesh.add(line);
            edgeLines.set(mesh, line);
          } catch (e) {
            // 일부 지오메트리는 엣지 생성 실패할 수 있음
          }
        }

        index = end;
        invalidate();

        if (index < meshesToProcess.length) {
          // 다음 청크를 다음 프레임에 처리
          requestAnimationFrame(processChunk);
        } else {
          console.log(`✅ 윤곽선 생성 완료: ${edgeLines.size}개`);
        }
      };

      if (meshesToProcess.length > 0) {
        console.log(`🔲 윤곽선 생성 시작: ${meshesToProcess.length}개 메시`);
        requestAnimationFrame(processChunk);
      }
    } else {
      // 윤곽선 제거
      edgeLines.forEach((line, mesh) => {
        mesh.remove(line);
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      });
      edgeLines.clear();
      invalidate();
    }

    return () => {
      cancelled = true;
    };
  }, [model, showEdges, isDarkMode]);

  // 선택 하이라이트 (파란색: 3D 선택, 초록색: 테이블 강조)
  useEffect(() => {
    const meshMap = meshMapRef.current;
    const originalMaterials = originalMaterialsRef.current;
    const prevSelected = prevSelectedRef.current;
    const currentSelected = new Set(selectedExpressIDs);
    const tableHighlightedSet = new Set(tableHighlightedIDs);

    // 이전에 선택되었던 요소들 원래 재질로 복원
    prevSelected.forEach(id => {
      if (!currentSelected.has(id)) {
        const meshes = meshMap.get(id);
        if (meshes) {
          meshes.forEach(mesh => {
            const original = originalMaterials.get(mesh);
            if (original) {
              mesh.material = original;
              mesh.renderOrder = 0;
            }
          });
        }
      }
    });

    // 현재 선택된 요소들 하이라이트
    currentSelected.forEach(id => {
      const meshes = meshMap.get(id);
      if (meshes) {
        meshes.forEach(mesh => {
          // 테이블에서 강조된 요소는 초록색, 나머지는 파란색
          if (tableHighlightedSet.has(id)) {
            mesh.material = xrayMode ? greenXrayMaterial : greenHighlightMaterial;
            mesh.renderOrder = xrayMode ? 1000 : 1; // 초록색이 더 위에
          } else {
            mesh.material = xrayMode ? highlightMaterial : normalHighlightMaterial;
            mesh.renderOrder = xrayMode ? 999 : 0;
          }
        });
      }
    });

    prevSelectedRef.current = currentSelected;
    invalidate();
  }, [selectedExpressIDs, tableHighlightedIDs, xrayMode]);

  const handlePointerDown = useCallback((event: any) => {
    pointerDownRef.current = {
      time: Date.now(),
      x: event.clientX ?? event.nativeEvent?.clientX ?? 0,
      y: event.clientY ?? event.nativeEvent?.clientY ?? 0,
    };
  }, []);

  const handlePointerUp = useCallback((event: any) => {
    const down = pointerDownRef.current;
    if (!down) return;

    const timeDiff = Date.now() - down.time;
    const x = event.clientX ?? event.nativeEvent?.clientX ?? 0;
    const y = event.clientY ?? event.nativeEvent?.clientY ?? 0;
    const distance = Math.sqrt(Math.pow(x - down.x, 2) + Math.pow(y - down.y, 2));

    if (timeDiff < CLICK_TIME_THRESHOLD && distance < CLICK_DISTANCE_THRESHOLD) {
      const obj = event.object;
      
      // 디버그: 클릭된 객체 정보
      if (obj instanceof THREE.Mesh) {
        console.log("🖱️ 클릭된 객체:", {
          expressID: obj.userData.expressID,
          typeCode: obj.userData.typeCode,
          name: obj.name,
          hasGeometry: !!obj.geometry,
        });
      }
      
      // 일반 메시: expressID 직접 사용
      if (obj instanceof THREE.Mesh && obj.userData.expressID !== undefined) {
        const expressID = obj.userData.expressID;
        const typeCode = obj.userData.typeCode;
        
        // typeCode가 0이거나 undefined면 단일 선택으로 처리
        if (typeCode === undefined || typeCode === 0) {
          console.log("⚠️ typeCode 누락 - 단일 선택:", expressID);
          onElementSelect(expressID, -1); // -1: 단일 선택 모드
        } else {
          onElementSelect(expressID, typeCode);
        }
      }
    }

    pointerDownRef.current = null;
  }, [onElementSelect]);

  const handleMissed = useCallback(() => {
    const down = pointerDownRef.current;
    if (down) {
      const timeDiff = Date.now() - down.time;
      if (timeDiff >= CLICK_TIME_THRESHOLD) {
        pointerDownRef.current = null;
        return;
      }
    }
    onElementSelect(null);
    pointerDownRef.current = null;
  }, [onElementSelect]);

  return (
    <>
      <PerspectiveCamera makeDefault position={[50, 50, 50]} fov={45} near={0.1} far={10000} />

      <OrbitControls
        ref={controlsRef}
        enableDamping={false}
        minDistance={0.5}
        maxDistance={5000}
        onChange={() => invalidate()}
      />

      <ambientLight intensity={0.9} />
      <directionalLight position={[50, 100, 50]} intensity={0.5} />

      {model && (
        <primitive
          object={model}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerMissed={handleMissed}
        />
      )}
    </>
  );
}

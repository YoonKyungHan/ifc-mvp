// 선택 및 하이라이트 Hook - ThatOpen Components Highlighter API 전용

import { useCallback, useRef, useEffect, useState } from "react";
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBCF from "@thatopen/components-front";
import { SelectedObjectInfo, SelectionState } from "../types";
import { getCategoryKoreanName } from "../utils/categoryMap";

interface UseSelectionProps {
  componentsRef: React.RefObject<OBC.Components | null>;
  worldRef: React.RefObject<OBC.SimpleWorld<OBC.SimpleScene, OBC.SimpleCamera, OBC.SimpleRenderer> | null>;
  typeToExpressIDsRef: React.RefObject<Map<number, number[]>>;
  onSelect?: (info: SelectedObjectInfo | null, relatedIDs: number[]) => void;
}

export function useSelection({ componentsRef, worldRef, typeToExpressIDsRef, onSelect }: UseSelectionProps) {
  const [selectionState, setSelectionState] = useState<SelectionState>({
    selectedCount: 0,
    selectedExpressIDs: [],
    selectedMaterialId: null,
    tableHighlightedIDs: [],
  });
  
  const highlighterRef = useRef<OBCF.Highlighter | null>(null);
  const selectedMeshesRef = useRef<THREE.Mesh[]>([]);
  const originalMaterialsRef = useRef<Map<THREE.Mesh, THREE.Material | THREE.Material[]>>(new Map());
  
  // 하이라이트 재질 (Three.js 직접 하이라이트용)
  const highlightMaterial = useRef<THREE.MeshStandardMaterial | null>(null);
  const secondaryHighlightMaterial = useRef<THREE.MeshStandardMaterial | null>(null);
  
  // 클라이언트에서 재질 초기화
  useEffect(() => {
    if (typeof window !== 'undefined') {
      highlightMaterial.current = new THREE.MeshStandardMaterial({
        color: 0x2196f3,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
      });
      secondaryHighlightMaterial.current = new THREE.MeshStandardMaterial({
        color: 0x4caf50,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
      });
    }
  }, []);
  
  // ThatOpen Highlighter 초기화 및 이벤트 리스너
  useEffect(() => {
    const components = componentsRef.current;
    const world = worldRef.current;
    
    if (!components || !world) return;
    
    try {
      const highlighter = components.get(OBCF.Highlighter);
      highlighter.setup({ world });
      highlighterRef.current = highlighter;
      
      // 선택 이벤트 - 디바운스 적용
      let debounceTimer: NodeJS.Timeout | null = null;
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      highlighter.events.select.onHighlight.add((fragmentIdMap: any) => {
        // 디바운스 - 연속 클릭 방지
        if (debounceTimer) clearTimeout(debounceTimer);
        
        debounceTimer = setTimeout(() => {
          const clickedIds: number[] = [];
          
          if (fragmentIdMap) {
            Object.values(fragmentIdMap).forEach((idSet) => {
              if (idSet instanceof Set) {
                idSet.forEach((id) => {
                  if (typeof id === 'number') clickedIds.push(id);
                });
              }
            });
          }
          
          if (clickedIds.length === 0) return;
          
          const clickedId = clickedIds[0];
          
          // 클릭된 ID가 속한 타입 찾기
          let relatedIds: number[] = [clickedId];
          let foundTypeCode = 0;
          
          if (typeToExpressIDsRef.current && typeToExpressIDsRef.current.size > 0) {
            for (const [typeCode, expressIDs] of typeToExpressIDsRef.current.entries()) {
              if (expressIDs.includes(clickedId)) {
                relatedIds = [...expressIDs];
                foundTypeCode = typeCode;
                break;
              }
            }
          }
          
          console.log(`✅ 선택: ${relatedIds.length}개 (TypeCode: ${foundTypeCode})`);
          
          // FragmentsModel로 하이라이트
          try {
            const fragments = components.get(OBC.FragmentsManager);
            const models = [...fragments.list.values()];
            
            if (models.length > 0) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const model = models[0] as any;
              
              if (typeof model.highlight === 'function') {
                model.highlight(relatedIds, new THREE.Color(0x2196f3));
              } else if (typeof model.setColor === 'function') {
                model.setColor(relatedIds, new THREE.Color(0x2196f3));
              }
            }
          } catch {}
          
          setSelectionState(prev => ({
            ...prev,
            selectedCount: relatedIds.length,
            selectedExpressIDs: relatedIds,
          }));
          
          const info: SelectedObjectInfo = {
            expressID: clickedId,
            typeCode: foundTypeCode,
            typeName: getCategoryKoreanName(`IFC${foundTypeCode}`),
            category: '기타',
          };
          onSelect?.(info, relatedIds);
        }, 50); // 50ms 디바운스
      });
      
      highlighter.events.select.onClear.add(() => {
        setSelectionState({
          selectedCount: 0,
          selectedExpressIDs: [],
          selectedMaterialId: null,
          tableHighlightedIDs: [],
        });
        onSelect?.(null, []);
      });
      
      console.log("✅ ThatOpen Highlighter 초기화 완료");
    } catch (err) {
      console.warn("⚠️ Highlighter 초기화 실패:", err);
    }
  }, [componentsRef, worldRef, typeToExpressIDsRef, onSelect]);
  
  // 선택 초기화
  const clearSelection = useCallback(() => {
    // Three.js 직접 하이라이트 복원
    originalMaterialsRef.current.forEach((material, mesh) => {
      mesh.material = material;
    });
    originalMaterialsRef.current.clear();
    selectedMeshesRef.current = [];
    
    // ThatOpen Highlighter 초기화
    if (highlighterRef.current) {
      try {
        highlighterRef.current.clear();
      } catch {}
    }
    
    setSelectionState({
      selectedCount: 0,
      selectedExpressIDs: [],
      selectedMaterialId: null,
      tableHighlightedIDs: [],
    });
  }, []);
  
  // ExpressID로 메시 찾기 (Three.js Scene 순회)
  const findMeshesByExpressIDs = useCallback((expressIDs: number[]): THREE.Mesh[] => {
    const world = worldRef.current;
    if (!world) return [];
    
    const meshes: THREE.Mesh[] = [];
    const idSet = new Set(expressIDs);
    
    world.scene.three.traverse((child) => {
      if (child instanceof THREE.Mesh && child.userData?.expressID) {
        if (idSet.has(child.userData.expressID)) {
          meshes.push(child);
        }
      }
    });
    
    return meshes;
  }, [worldRef]);
  
  // 메시 하이라이트 (Three.js 직접 - 테이블 선택용)
  const highlightMeshes = useCallback((meshes: THREE.Mesh[], isSecondary = false) => {
    const material = isSecondary ? secondaryHighlightMaterial.current : highlightMaterial.current;
    if (!material) return;
    
    meshes.forEach((mesh) => {
      if (!originalMaterialsRef.current.has(mesh)) {
        originalMaterialsRef.current.set(mesh, mesh.material);
      }
      mesh.material = material;
      
      if (!selectedMeshesRef.current.includes(mesh)) {
        selectedMeshesRef.current.push(mesh);
      }
    });
  }, []);
  
  // 테이블에서 선택 (2차 하이라이트)
  const selectFromTable = useCallback((expressIDs: number[]) => {
    const meshes = findMeshesByExpressIDs(expressIDs);
    highlightMeshes(meshes, true);
    
    setSelectionState((prev) => ({
      ...prev,
      tableHighlightedIDs: expressIDs,
    }));
  }, [findMeshesByExpressIDs, highlightMeshes]);
  
  // ExpressID 배열로 직접 선택
  const selectByExpressIDs = useCallback((expressIDs: number[]) => {
    clearSelection();
    
    const meshes = findMeshesByExpressIDs(expressIDs);
    highlightMeshes(meshes);
    
    setSelectionState({
      selectedCount: expressIDs.length,
      selectedExpressIDs: expressIDs,
      selectedMaterialId: null,
      tableHighlightedIDs: [],
    });
  }, [clearSelection, findMeshesByExpressIDs, highlightMeshes]);
  
  return {
    selectionState,
    clearSelection,
    selectFromTable,
    selectByExpressIDs,
    findMeshesByExpressIDs,
    highlightMeshes,
  };
}

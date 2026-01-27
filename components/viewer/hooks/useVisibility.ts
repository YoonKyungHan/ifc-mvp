"use client";

import { useState, useCallback, useMemo } from "react";
import { MaterialItem, StoreyInfo } from "@/types/ifc";

/**
 * 요소 표시/숨김 상태 관리 훅
 */
export function useVisibility(materials: MaterialItem[], storeys: StoreyInfo[]) {
  const [hiddenMaterialIds, setHiddenMaterialIds] = useState<Set<string>>(new Set());
  const [selectedStorey, setSelectedStorey] = useState<string | null>(null);

  // 지오메트리 표시/숨김 토글 (material ID 기준)
  const handleToggleVisibility = useCallback((materialId: string) => {
    setHiddenMaterialIds(prev => {
      const next = new Set(prev);
      if (next.has(materialId)) {
        next.delete(materialId);
      } else {
        next.add(materialId);
      }
      return next;
    });
  }, []);

  // 전체 표시
  const handleShowAll = useCallback(() => {
    setHiddenMaterialIds(new Set());
  }, []);

  // 전체 숨김
  const handleHideAll = useCallback(() => {
    const allIds = new Set(materials.map(m => m.id));
    setHiddenMaterialIds(allIds);
  }, [materials]);

  // 리셋 (모델 로드 시)
  const resetVisibility = useCallback(() => {
    setHiddenMaterialIds(new Set());
    setSelectedStorey(null);
  }, []);

  // 숨겨진 material들의 expressIDs를 모아서 hiddenExpressIDs로 변환
  const hiddenExpressIDs = useMemo(() => {
    if (hiddenMaterialIds.size === 0) return null;
    
    const hidden = new Set<number>();
    for (const material of materials) {
      if (hiddenMaterialIds.has(material.id)) {
        for (const id of material.expressIDs) {
          hidden.add(id);
        }
      }
    }
    return hidden.size > 0 ? hidden : null;
  }, [hiddenMaterialIds, materials]);

  // 층 선택 시 해당 층의 요소들만 보이게
  const visibleExpressIDs = useMemo(() => {
    if (!selectedStorey) return null;
    const storey = storeys.find(s => s.id === selectedStorey);
    return storey ? new Set(storey.expressIDs) : null;
  }, [selectedStorey, storeys]);

  return {
    hiddenMaterialIds,
    hiddenExpressIDs,
    selectedStorey,
    visibleExpressIDs,
    setSelectedStorey,
    handleToggleVisibility,
    handleShowAll,
    handleHideAll,
    resetVisibility,
  };
}

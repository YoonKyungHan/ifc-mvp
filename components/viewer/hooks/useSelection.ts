"use client";

import { useState, useCallback } from "react";

/**
 * 요소 선택 상태 관리 훅
 */
export function useSelection(getElementsByType: (typeCode: number) => number[]) {
  const [selectedExpressIDs, setSelectedExpressIDs] = useState<number[]>([]);
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);

  // 3D 뷰에서 요소 선택 → 같은 타입 전체 선택
  const handleElementSelect = useCallback((expressID: number | null, typeCode?: number) => {
    if (expressID === null || typeCode === undefined) {
      setSelectedExpressIDs([]);
      setSelectedMaterialId(null);
      return;
    }
    const ids = getElementsByType(typeCode);
    setSelectedExpressIDs(ids);
    setSelectedMaterialId(null); // 3D 선택 시에는 정확한 규격을 알 수 없으므로 null
  }, [getElementsByType]);

  // 테이블에서 자재 선택 (타입+규격 조합)
  const handleMaterialSelect = useCallback((id: string, expressIDs: number[]) => {
    setSelectedMaterialId(id);
    setSelectedExpressIDs(expressIDs);
  }, []);

  // 모델트리에서 요소 선택 (다중)
  const handleSelectElements = useCallback((expressIDs: number[]) => {
    setSelectedMaterialId(null);
    setSelectedExpressIDs(expressIDs);
  }, []);

  // 선택 해제
  const handleClearSelection = useCallback(() => {
    setSelectedExpressIDs([]);
    setSelectedMaterialId(null);
  }, []);

  return {
    selectedExpressIDs,
    selectedMaterialId,
    handleElementSelect,
    handleMaterialSelect,
    handleSelectElements,
    handleClearSelection,
  };
}

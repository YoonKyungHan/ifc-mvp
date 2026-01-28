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
    // 선택 해제
    if (expressID === null) {
      setSelectedExpressIDs([]);
      setSelectedMaterialId(null);
      return;
    }
    
    // typeCode가 없거나 0이거나 -1(단일 선택 모드)인 경우 → 해당 요소만 선택
    if (typeCode === undefined || typeCode === 0 || typeCode === -1) {
      console.log("📌 단일 요소 선택:", expressID);
      setSelectedExpressIDs([expressID]);
      setSelectedMaterialId(null);
      return;
    }
    
    // 같은 타입의 모든 요소 선택
    const ids = getElementsByType(typeCode);
    if (ids.length === 0) {
      // getElementsByType이 빈 배열을 반환하면 단일 선택
      console.log("📌 타입 매칭 실패 - 단일 선택:", expressID);
      setSelectedExpressIDs([expressID]);
    } else {
      setSelectedExpressIDs(ids);
    }
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

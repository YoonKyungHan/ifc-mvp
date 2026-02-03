// 자재 데이터 추출 Hook (web-ifc 사용)

import { useCallback, useRef, useState } from "react";
import * as WebIFC from "web-ifc";
import { MaterialItem, StoreyInfo, IFCSpatialNode } from "../types";
import { extractMaterials, extractStoreys, initWebIFC, disposeWebIFC } from "../utils/ifcParser";

interface UseMaterialsReturn {
  materials: MaterialItem[];
  storeys: StoreyInfo[];
  spatialTree: IFCSpatialNode | null;
  typeToExpressIDsRef: React.RefObject<Map<number, number[]>>;
  isLoading: boolean;
  error: string | null;
  loadMaterials: (ifcBuffer: ArrayBuffer, onProgress?: (msg: string, pct: number) => void) => Promise<void>;
  clearMaterials: () => void;
}

export function useMaterials(): UseMaterialsReturn {
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [storeys, setStoreys] = useState<StoreyInfo[]>([]);
  const [spatialTree, setSpatialTree] = useState<IFCSpatialNode | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const typeToExpressIDsRef = useRef<Map<number, number[]>>(new Map());
  const ifcApiRef = useRef<WebIFC.IfcAPI | null>(null);
  const modelIdRef = useRef<number | null>(null);
  
  // 자재 데이터 로드
  const loadMaterials = useCallback(async (
    ifcBuffer: ArrayBuffer,
    onProgress?: (msg: string, pct: number) => void
  ) => {
    setIsLoading(true);
    setError(null);
    
    try {
      onProgress?.("web-ifc 초기화 중...", 10);
      
      // 이전 모델 정리
      if (ifcApiRef.current && modelIdRef.current !== null) {
        disposeWebIFC(ifcApiRef.current, modelIdRef.current);
      }
      
      // web-ifc 초기화
      const ifcApi = await initWebIFC();
      ifcApiRef.current = ifcApi;
      
      onProgress?.("IFC 파일 파싱 중...", 20);
      
      // IFC 파일 열기
      const modelID = ifcApi.OpenModel(new Uint8Array(ifcBuffer));
      modelIdRef.current = modelID;
      
      onProgress?.("자재 정보 추출 중...", 30);
      
      // 자재 추출
      const { materials: newMaterials, typeMap } = await extractMaterials(
        ifcApi,
        modelID,
        (msg, pct) => onProgress?.(msg, 30 + pct * 0.4)
      );
      
      typeToExpressIDsRef.current = typeMap;
      setMaterials(newMaterials);
      
      console.log(`✅ web-ifc 자재 추출 완료: ${newMaterials.length}개 항목`);
      
      onProgress?.("층 정보 추출 중...", 75);
      
      // 층 정보 추출
      const newStoreys = await extractStoreys(ifcApi, modelID);
      setStoreys(newStoreys);
      
      console.log(`✅ 층 정보 추출 완료: ${newStoreys.length}개 층`);
      
      onProgress?.("완료!", 100);
      
    } catch (err) {
      console.error("❌ 자재 추출 실패:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);
  
  // 정리
  const clearMaterials = useCallback(() => {
    if (ifcApiRef.current && modelIdRef.current !== null) {
      disposeWebIFC(ifcApiRef.current, modelIdRef.current);
      modelIdRef.current = null;
    }
    
    setMaterials([]);
    setStoreys([]);
    setSpatialTree(null);
    typeToExpressIDsRef.current = new Map();
  }, []);
  
  return {
    materials,
    storeys,
    spatialTree,
    typeToExpressIDsRef,
    isLoading,
    error,
    loadMaterials,
    clearMaterials,
  };
}

"use client";

import { useCallback, useRef, useState } from "react";
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import { MaterialItem, StoreyInfo, IFCSpatialNode, IFC_TYPE_NAMES } from "@/types/ifc";

// IFC 타입 카테고리 매핑
const TYPE_CATEGORIES: Record<number, string> = {
  3512223829: "구조", // IfcWall
  1281925730: "구조", // IfcWallStandardCase
  2979338954: "구조", // IfcBeam
  3649129432: "구조", // IfcColumn
  3124254112: "구조", // IfcSlab
  4278956645: "설비", // IfcFlowTerminal
  3304561284: "개구부", // IfcWindow
  395920057: "개구부",  // IfcDoor
  1529196076: "마감", // IfcCovering
  1509553395: "가구", // IfcFurnishingElement
};

export interface UseFragmentsLoaderReturn {
  isLoading: boolean;
  loadingMessage: string;
  error: string | null;
  progress: number;
  loadIFC: (file: File) => Promise<THREE.Object3D | null>;
  getElementsByType: (typeCode: number) => number[];
  getMaterialList: () => MaterialItem[];
  getStoreyList: () => StoreyInfo[];
  getSpatialTree: () => IFCSpatialNode | null;
  highlightByExpressID: (expressIDs: number[]) => void;
  clearHighlight: () => void;
  setVisibility: (expressIDs: number[], visible: boolean) => void;
  cleanup: () => void;
  meshCount: number;
}

export function useFragmentsLoader(): UseFragmentsLoaderReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [meshCount, setMeshCount] = useState(0);

  // Core refs
  const componentsRef = useRef<OBC.Components | null>(null);
  const fragmentsRef = useRef<OBC.FragmentsManager | null>(null);
  const ifcLoaderRef = useRef<OBC.IfcLoader | null>(null);
  const initPromiseRef = useRef<Promise<OBC.Components> | null>(null);
  
  // Model data refs
  const modelGroupRef = useRef<THREE.Group | null>(null);
  const typeMapRef = useRef<Map<number, number[]>>(new Map());
  const materialsRef = useRef<MaterialItem[]>([]);
  const storeysRef = useRef<StoreyInfo[]>([]);
  const spatialTreeRef = useRef<IFCSpatialNode | null>(null);

  // Components 초기화 - 싱글톤 패턴
  const initComponents = useCallback(async (): Promise<OBC.Components> => {
    // 이미 초기화 중이면 대기
    if (initPromiseRef.current) {
      return initPromiseRef.current;
    }

    // 이미 초기화 완료됐으면 반환
    if (componentsRef.current && ifcLoaderRef.current && fragmentsRef.current?.initialized) {
      return componentsRef.current;
    }

    // 초기화 Promise 생성
    initPromiseRef.current = (async () => {
      console.log("🚀 That Open Components 초기화 시작...");
      
      try {
        const components = new OBC.Components();
        componentsRef.current = components;

        // IFC Loader 먼저 가져오기 (FragmentsManager보다 먼저)
        const ifcLoader = components.get(OBC.IfcLoader);
        ifcLoaderRef.current = ifcLoader;

        // WASM 경로 설정 - 로컬 WASM 사용 (절대 경로)
        const wasmPath = typeof window !== 'undefined' 
          ? `${window.location.origin}/wasm/`
          : "/wasm/";
        
        console.log("📂 WASM 경로:", wasmPath);
        
        ifcLoader.settings.wasm = {
          path: wasmPath,
          absolute: true,
        };
        
        // 좌표 원점으로 이동
        ifcLoader.settings.webIfc.COORDINATE_TO_ORIGIN = true;
        
        // setup 호출 - WASM 로드 (이게 FragmentsManager도 초기화함)
        console.log("⏳ WASM 로딩 및 Fragments 초기화 중 (CDN)...");
        await ifcLoader.setup();
        
        // FragmentsManager는 IfcLoader.setup() 후에 가져오기
        const fragments = components.get(OBC.FragmentsManager);
        fragmentsRef.current = fragments;
        console.log("📦 FragmentsManager initialized:", fragments.initialized);
        
        // 만약 아직도 초기화 안됐으면 명시적으로 init 호출
        if (!fragments.initialized) {
          console.log("🔄 FragmentsManager 수동 초기화 시도...");
          // @ts-expect-error - init may need worker URL
          await fragments.init?.();
        }
        
        console.log("✅ That Open Components 초기화 완료!");
        console.log("  - FragmentsManager initialized:", fragments.initialized);
        
        return components;
      } catch (err) {
        console.error("❌ Components 초기화 실패:", err);
        initPromiseRef.current = null;
        throw err;
      }
    })();

    return initPromiseRef.current;
  }, []);

  // IFC 파일 로드
  const loadIFC = useCallback(async (file: File): Promise<THREE.Object3D | null> => {
    setIsLoading(true);
    setError(null);
    setProgress(0);
    setLoadingMessage("초기화 중...");

    try {
      // Components 초기화
      await initComponents();
      const ifcLoader = ifcLoaderRef.current!;
      const fragments = fragmentsRef.current!;

      // FragmentsManager initialized 체크 제거 - 실제 로드 시도
      console.log("📦 FragmentsManager state:", fragments?.initialized);

      setLoadingMessage("IFC 파일 읽는 중...");
      setProgress(10);

      const buffer = await file.arrayBuffer();
      const data = new Uint8Array(buffer);

      setLoadingMessage("Fragments로 변환 중... (자동 최적화)");
      setProgress(30);

      // 🚀 핵심: IFC → Fragments 변환
      console.log("📂 IFC 로드 시작:", file.name, `(${(buffer.byteLength / 1024 / 1024).toFixed(2)}MB)`);
      const model = await ifcLoader.load(data, true, file.name);
      console.log("✅ IFC 로드 완료, model:", model);
      
      setLoadingMessage("모델 분석 중...");
      setProgress(60);

      // Three.js Group으로 변환
      const group = new THREE.Group();
      group.name = file.name;
      
      // FragmentsModel에서 메시 추출
      let count = 0;
      
      // model이 FragmentsGroup인 경우 직접 사용
      const modelAny = model as any;
      const modelItems = modelAny?.items || modelAny?.children || [];
      for (const fragment of modelItems) {
        const mesh = fragment.mesh || fragment;
        if (mesh instanceof THREE.Object3D) {
          group.add(mesh);
          count++;
        }
      }
      
      // 또는 fragments.list에서 가져오기
      if (count === 0 && fragments.list) {
        for (const [, fragmentGroup] of fragments.list) {
          const fgAny = fragmentGroup as any;
          const items = fgAny?.items || fgAny?.children || [];
          for (const fragment of items) {
            const mesh = fragment.mesh || fragment;
            if (mesh instanceof THREE.Object3D) {
              group.add(mesh.clone());
              count++;
            }
          }
        }
      }
      
      modelGroupRef.current = group;
      setMeshCount(count);
      console.log(`📊 Fragments 메시 수: ${count}개 (최적화됨)`);

      // 간단한 자재 목록 생성
      setLoadingMessage("자재 목록 생성 중...");
      setProgress(90);

      // 임시: 빈 자재 목록
      materialsRef.current = [];
      storeysRef.current = [];

      setLoadingMessage("완료!");
      setProgress(100);
      setIsLoading(false);

      console.log("🎉 Fragments 로드 완료!");
      return group;

    } catch (err) {
      console.error("IFC 로드 실패:", err);
      setError(err instanceof Error ? err.message : "알 수 없는 오류");
      setIsLoading(false);
      return null;
    }
  }, [initComponents]);

  // 타입별 요소 조회
  const getElementsByType = useCallback((typeCode: number): number[] => {
    return typeMapRef.current.get(typeCode) || [];
  }, []);

  // 자재 목록
  const getMaterialList = useCallback((): MaterialItem[] => {
    return materialsRef.current;
  }, []);

  // 층 목록
  const getStoreyList = useCallback((): StoreyInfo[] => {
    return storeysRef.current;
  }, []);

  // 공간 구조
  const getSpatialTree = useCallback((): IFCSpatialNode | null => {
    return spatialTreeRef.current;
  }, []);

  // 하이라이트
  const highlightByExpressID = useCallback((expressIDs: number[]) => {
    // TODO: Fragments 방식 하이라이트 구현
    console.log("하이라이트:", expressIDs.length, "개");
  }, []);

  // 하이라이트 해제
  const clearHighlight = useCallback(() => {
    // TODO: 하이라이트 해제
  }, []);

  // 표시/숨김
  const setVisibility = useCallback((expressIDs: number[], visible: boolean) => {
    // TODO: 표시/숨김 구현
  }, []);

  // 정리
  const cleanup = useCallback(() => {
    if (fragmentsRef.current) {
      fragmentsRef.current.dispose();
    }
    
    if (componentsRef.current) {
      componentsRef.current.dispose();
    }

    componentsRef.current = null;
    fragmentsRef.current = null;
    ifcLoaderRef.current = null;
    initPromiseRef.current = null;
    modelGroupRef.current = null;
    
    typeMapRef.current.clear();
    materialsRef.current = [];
    storeysRef.current = [];
    spatialTreeRef.current = null;

    setMeshCount(0);
    console.log("🧹 Fragments 정리 완료");
  }, []);

  return {
    isLoading,
    loadingMessage,
    error,
    progress,
    loadIFC,
    getElementsByType,
    getMaterialList,
    getStoreyList,
    getSpatialTree,
    highlightByExpressID,
    clearHighlight,
    setVisibility,
    cleanup,
    meshCount,
  };
}

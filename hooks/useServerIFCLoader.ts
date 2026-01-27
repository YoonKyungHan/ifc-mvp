"use client";

import { useCallback, useRef, useState } from "react";
import * as THREE from "three";
import { MaterialItem, StoreyInfo, IFCSpatialNode, IFC_TYPE_NAMES } from "@/types/ifc";

interface ProcessedMesh {
  expressID: number;
  typeCode: number;
  positions: number[];
  normals: number[];
  indices: number[];
  color: [number, number, number, number];
  transform: number[];
}

interface ProcessedModel {
  id: string;
  fileName: string;
  meshCount: number;
  meshes: ProcessedMesh[];
  materials: MaterialInfo[];
  storeys: StoreyInfo[];
  spatialTree: IFCSpatialNode | null;
}

interface MaterialInfo {
  id: string;
  typeCode: number;
  typeName: string;
  category: string;
  count: number;
  expressIDs: number[];
  dimensions: string;
}

export function useServerIFCLoader() {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  // 데이터 캐시
  const typeMapRef = useRef<Map<number, number[]>>(new Map());
  const materialsRef = useRef<MaterialItem[]>([]);
  const storeysRef = useRef<StoreyInfo[]>([]);
  const spatialTreeRef = useRef<IFCSpatialNode | null>(null);

  const loadIFC = useCallback(async (file: File): Promise<THREE.Group | null> => {
    setIsLoading(true);
    setError(null);
    setProgress(0);
    setLoadingMessage("서버에 파일 업로드 중...");

    try {
      // 1. 서버에 파일 업로드
      const formData = new FormData();
      formData.append("file", file);

      setProgress(10);
      setLoadingMessage("서버에서 IFC 처리 중...");

      const response = await fetch("/api/convert", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        // 파일이 너무 큰 경우 클라이언트 처리 권장
        if (errorData.suggestion === "client") {
          throw new Error(`${errorData.error}\n\n💡 클라이언트 처리 모드를 사용하세요.`);
        }
        throw new Error(errorData.error || "서버 처리 실패");
      }

      setProgress(50);
      setLoadingMessage("처리된 모델 수신 중...");

      const result = await response.json();
      
      if (!result.success || !result.model) {
        throw new Error("서버에서 유효한 응답을 받지 못했습니다");
      }

      const processedModel: ProcessedModel = result.model;
      console.log(`📦 서버 처리 완료 (캐시: ${result.cached}): ${processedModel.meshCount}개 메시`);

      setProgress(60);
      setLoadingMessage("3D 모델 생성 중...");

      // 2. Three.js Group 생성
      const group = new THREE.Group();
      group.name = processedModel.fileName;

      const typeMap = new Map<number, number[]>();

      // 메시 생성 (청크 단위로)
      const CHUNK_SIZE = 500;
      const meshes = processedModel.meshes;
      
      for (let i = 0; i < meshes.length; i += CHUNK_SIZE) {
        const chunk = meshes.slice(i, i + CHUNK_SIZE);
        
        for (const meshData of chunk) {
          const geometry = new THREE.BufferGeometry();
          
          geometry.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(meshData.positions, 3)
          );
          geometry.setAttribute(
            "normal",
            new THREE.Float32BufferAttribute(meshData.normals, 3)
          );
          geometry.setIndex(meshData.indices);
          
          const [r, g, b, a] = meshData.color;
          const material = new THREE.MeshLambertMaterial({
            color: new THREE.Color(r, g, b),
            transparent: a < 1,
            opacity: a,
            side: THREE.DoubleSide,
          });

          const mesh = new THREE.Mesh(geometry, material);
          
          // 변환 행렬 적용
          const matrix = new THREE.Matrix4();
          matrix.fromArray(meshData.transform);
          mesh.applyMatrix4(matrix);
          
          // userData 설정
          mesh.userData.expressID = meshData.expressID;
          mesh.userData.typeCode = meshData.typeCode;
          
          group.add(mesh);

          // 타입별 매핑
          if (meshData.typeCode) {
            const arr = typeMap.get(meshData.typeCode) || [];
            if (!arr.includes(meshData.expressID)) {
              arr.push(meshData.expressID);
            }
            typeMap.set(meshData.typeCode, arr);
          }
        }

        // 진행률 업데이트
        const meshProgress = Math.round(60 + (i / meshes.length) * 30);
        setProgress(meshProgress);
        
        // UI 블로킹 방지
        await new Promise(r => setTimeout(r, 0));
      }

      setProgress(90);
      setLoadingMessage("자재 정보 처리 중...");

      // 타입 맵 저장
      typeMapRef.current = typeMap;

      // 자재 목록 변환
      materialsRef.current = processedModel.materials.map((m): MaterialItem => ({
        id: m.id,
        typeCode: m.typeCode,
        typeName: m.typeName,
        category: m.category,
        count: m.count,
        expressIDs: m.expressIDs,
        dimensions: undefined,
        unit: "EA",
        spec: "-",
      }));

      // 층 정보 변환
      storeysRef.current = processedModel.storeys;

      // 공간 구조
      spatialTreeRef.current = processedModel.spatialTree;

      setProgress(100);
      setLoadingMessage("완료!");
      
      console.log(`✅ 모델 생성 완료: ${group.children.length}개 메시`);
      
      return group;

    } catch (err) {
      console.error("서버 IFC 로드 실패:", err);
      setError(err instanceof Error ? err.message : "알 수 없는 오류");
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getElementsByType = useCallback((typeCode: number): number[] => {
    return typeMapRef.current.get(typeCode) || [];
  }, []);

  const getMaterialList = useCallback((): MaterialItem[] => {
    return materialsRef.current;
  }, []);

  const getStoreyList = useCallback((): StoreyInfo[] => {
    return storeysRef.current;
  }, []);

  const getSpatialTree = useCallback((): IFCSpatialNode | null => {
    return spatialTreeRef.current;
  }, []);

  const cleanup = useCallback(() => {
    typeMapRef.current.clear();
    materialsRef.current = [];
    storeysRef.current = [];
    spatialTreeRef.current = null;
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
    cleanup,
  };
}

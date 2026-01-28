"use client";

import { useState, useCallback, useRef } from "react";
import * as THREE from "three";
import { MaterialItem, StoreyInfo, IFCSpatialNode, ElementDimensions, IFC_TYPE_NAMES, IFC_SPATIAL_TYPES, IFCPropertyInfo } from "@/types/ifc";

const TYPE_CATEGORIES: Record<number, string> = {
  45: "구조", 46: "구조", 1529196076: "구조", 843113511: "구조",
  753842376: "구조", 900683007: "구조",
  395920057: "건축", 3304561284: "건축", 331165859: "건축",
  2016517767: "건축", 2262370178: "건축", 1973544240: "건축",
  263784265: "가구", 3171933400: "기타", 1073191201: "기타",
};

type IfcAPI = {
  Init(): Promise<void>;
  SetWasmPath(path: string): void;
  OpenModel(data: Uint8Array): number;
  CloseModel(modelID: number): void;
  GetLine(modelID: number, expressID: number, flatten?: boolean): unknown;
  GetLineIDsWithType(modelID: number, type: number): { size(): number; get(index: number): number };
  StreamAllMeshes(modelID: number, callback: (mesh: FlatMesh) => void): void;
  GetGeometry(modelID: number, geometryExpressID: number): IfcGeometry;
  GetVertexArray(ptr: number, size: number): Float32Array;
  GetIndexArray(ptr: number, size: number): Uint32Array;
};

interface FlatMesh {
  expressID: number;
  geometries: { size(): number; get(index: number): PlacedGeometry };
}

interface PlacedGeometry {
  geometryExpressID: number;
  color: { x: number; y: number; z: number; w: number };
  flatTransformation: number[];
}

interface IfcGeometry {
  GetVertexData(): number;
  GetVertexDataSize(): number;
  GetIndexData(): number;
  GetIndexDataSize(): number;
}

interface UseIFCLoaderReturn {
  isLoading: boolean;
  loadingMessage: string;
  error: string | null;
  progress: number;
  loadIFC: (file: File) => Promise<THREE.Group | null>;
  getElementsByType: (typeCode: number) => number[];
  getMaterialList: () => MaterialItem[];
  getStoreyList: () => StoreyInfo[];
  getSpatialTree: () => IFCSpatialNode | null;
  cleanup: () => void;
}

const typeToExpressIDs = new Map<number, number[]>();
const elementDimensions = new Map<number, ElementDimensions>(); // expressID -> 규격
const elementProperties = new Map<number, IFCPropertyInfo>(); // expressID -> IFC 속성 정보
let cachedMaterials: MaterialItem[] = [];
let cachedStoreys: StoreyInfo[] = [];
let cachedSpatialTree: IFCSpatialNode | null = null;

// IFC 속성에서 이름 추출
const getIfcName = (props: any): string => {
  if (props.Name?.value) return props.Name.value;
  if (props.LongName?.value) return props.LongName.value;
  return `#${props.expressID}`;
};

// IFC 타입 코드를 문자열로 변환
const getTypeName = (typeCode: number): string => {
  switch (typeCode) {
    case IFC_SPATIAL_TYPES.IFCPROJECT: return "IfcProject";
    case IFC_SPATIAL_TYPES.IFCSITE: return "IfcSite";
    case IFC_SPATIAL_TYPES.IFCBUILDING: return "IfcBuilding";
    case IFC_SPATIAL_TYPES.IFCBUILDINGSTOREY: return "IfcBuildingStorey";
    case IFC_SPATIAL_TYPES.IFCSPACE: return "IfcSpace";
    default: return IFC_TYPE_NAMES[typeCode] || `Type_${typeCode}`;
  }
};

// IFC 속성 정보를 규격 문자열로 변환
const buildSpecFromProperties = (props: IFCPropertyInfo, typeCode: number): string => {
  const parts: string[] = [];
  
  // 외벽/내벽 구분
  if (props.isExternal !== undefined) {
    // 타입에 따라 적절한 접두사 사용
    const typeName = IFC_TYPE_NAMES[typeCode] || "";
    if (typeName === "벽" || typeName.includes("벽")) {
      parts.push(props.isExternal ? "외벽" : "내벽");
    } else if (typeName === "슬라브" || typeName === "바닥") {
      parts.push(props.isExternal ? "외부바닥" : "내부바닥");
    } else if (typeName === "지붕") {
      parts.push(props.isExternal ? "외부지붕" : "내부천장");
    } else {
      parts.push(props.isExternal ? "외부" : "내부");
    }
  }
  
  // 참조 정보 (마감재 등)
  if (props.reference) {
    parts.push(props.reference);
  }
  
  // 마감 타입
  if (props.finishType) {
    parts.push(props.finishType);
  }
  
  // 객체 타입 (참조, 마감이 없을 때)
  if (parts.length === 0 && props.objectType) {
    parts.push(props.objectType);
  }
  
  // 내화등급
  if (props.fireRating) {
    parts.push(`내화${props.fireRating}`);
  }
  
  // 내력벽
  if (props.loadBearing) {
    parts.push("내력");
  }
  
  return parts.join(",");
};

export function useIFCLoader(): UseIFCLoaderReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const ifcApiRef = useRef<IfcAPI | null>(null);
  const modelIDRef = useRef<number | null>(null);

  // IFC 공간 구조 파싱
  const parseSpatialStructure = useCallback((ifcApi: IfcAPI, modelID: number): IFCSpatialNode | null => {
    try {
      // IfcRelAggregates 관계 수집 (공간 구조 계층)
      const aggregatesMap = new Map<number, number[]>(); // parent -> children
      const aggregatesIds = ifcApi.GetLineIDsWithType(modelID, IFC_SPATIAL_TYPES.IFCRELAGGREGATES);
      
      for (let i = 0; i < aggregatesIds.size(); i++) {
        const relId = aggregatesIds.get(i);
        try {
          const rel = ifcApi.GetLine(modelID, relId, false) as any;
          const parentId = rel.RelatingObject?.value;
          const relatedObjects = rel.RelatedObjects;
          
          if (parentId && relatedObjects) {
            const children: number[] = [];
            for (let j = 0; j < relatedObjects.length; j++) {
              if (relatedObjects[j]?.value) {
                children.push(relatedObjects[j].value);
              }
            }
            const existing = aggregatesMap.get(parentId) || [];
            aggregatesMap.set(parentId, [...existing, ...children]);
          }
        } catch {}
      }

      // IfcRelContainedInSpatialStructure 관계 수집 (공간에 포함된 요소)
      const containsMap = new Map<number, number[]>(); // spatial -> elements
      const containsIds = ifcApi.GetLineIDsWithType(modelID, IFC_SPATIAL_TYPES.IFCRELCONTAINEDINSPATIALSTRUCTURE);
      
      for (let i = 0; i < containsIds.size(); i++) {
        const relId = containsIds.get(i);
        try {
          const rel = ifcApi.GetLine(modelID, relId, false) as any;
          const spatialId = rel.RelatingStructure?.value;
          const relatedElements = rel.RelatedElements;
          
          if (spatialId && relatedElements) {
            const elements: number[] = [];
            for (let j = 0; j < relatedElements.length; j++) {
              if (relatedElements[j]?.value) {
                elements.push(relatedElements[j].value);
              }
            }
            const existing = containsMap.get(spatialId) || [];
            containsMap.set(spatialId, [...existing, ...elements]);
          }
        } catch {}
      }

      // IfcProject 찾기
      const projectIds = ifcApi.GetLineIDsWithType(modelID, IFC_SPATIAL_TYPES.IFCPROJECT);
      if (projectIds.size() === 0) {
        console.warn("⚠️ IfcProject를 찾을 수 없습니다");
        return null;
      }

      // 재귀적으로 트리 구축
      const buildNode = (expressID: number): IFCSpatialNode => {
        let name = `#${expressID}`;
        let typeCode = 0;
        
        try {
          const props = ifcApi.GetLine(modelID, expressID, false) as any;
          name = getIfcName(props);
          typeCode = props.type || 0;
        } catch {}

        const childIds = aggregatesMap.get(expressID) || [];
        const elementIds = containsMap.get(expressID) || [];

        return {
          expressID,
          name,
          type: getTypeName(typeCode),
          typeCode,
          children: childIds.map(id => buildNode(id)),
          elements: elementIds,
        };
      };

      const projectId = projectIds.get(0);
      const tree = buildNode(projectId);
      
      console.log("🌳 IFC 공간 구조 파싱 완료:", tree);
      return tree;
    } catch (err) {
      console.error("공간 구조 파싱 실패:", err);
      return null;
    }
  }, []);

  const loadIFC = useCallback(async (file: File): Promise<THREE.Group | null> => {
    setIsLoading(true);
    setError(null);
    setProgress(5);
    setLoadingMessage("라이브러리 로딩...");
    typeToExpressIDs.clear();
    elementDimensions.clear();
    cachedMaterials = [];
    cachedStoreys = [];
    cachedSpatialTree = null;

    try {
      const WebIFC = await import("web-ifc");

      setProgress(10);
      setLoadingMessage("WASM 초기화...");
      
      let ifcApi = ifcApiRef.current;
      
      if (!ifcApi) {
        ifcApi = new WebIFC.IfcAPI() as unknown as IfcAPI;
        // WASM 경로 설정 (web-ifc 0.0.57)
        ifcApi.SetWasmPath("/wasm/");
        await ifcApi.Init();
        ifcApiRef.current = ifcApi;
      }

      setProgress(15);
      setLoadingMessage("파일 읽는 중...");
      
      if (modelIDRef.current !== null) {
        try { ifcApi.CloseModel(modelIDRef.current); } catch {}
      }

      const data = await file.arrayBuffer();
      
      setProgress(20);
      setLoadingMessage("모델 파싱 중...");
      
      const modelID = ifcApi.OpenModel(new Uint8Array(data));
      modelIDRef.current = modelID;

      // Material 캐싱
      const materialCache = new Map<string, THREE.MeshLambertMaterial>();
      const getMaterial = (r: number, g: number, b: number, a: number) => {
        const key = `${r.toFixed(2)}_${g.toFixed(2)}_${b.toFixed(2)}_${a.toFixed(2)}`;
        if (!materialCache.has(key)) {
          materialCache.set(key, new THREE.MeshLambertMaterial({
            color: new THREE.Color(r, g, b),
            transparent: a < 1,
            opacity: a,
            side: THREE.DoubleSide,
          }));
        }
        return materialCache.get(key)!;
      };

      const group = new THREE.Group();
      group.name = file.name;
      
      const tempTypeData: { expressID: number; typeCode: number }[] = [];
      let meshCount = 0;

      setProgress(25);
      setLoadingMessage("지오메트리 생성 중...");

      ifcApi.StreamAllMeshes(modelID, (flatMesh) => {
        const expressID = flatMesh.expressID;
        let typeCode = 0;
        
        try {
          const props = ifcApi!.GetLine(modelID, expressID, false) as any;
          typeCode = props.type || 0;
        } catch {}

        tempTypeData.push({ expressID, typeCode });

        const geometries = flatMesh.geometries;
        const geoCount = geometries.size();
        
        for (let i = 0; i < geoCount; i++) {
          const pg = geometries.get(i);
          
          const geo = ifcApi!.GetGeometry(modelID, pg.geometryExpressID);
          const vertPtr = geo.GetVertexData();
          const vertSize = geo.GetVertexDataSize();
          const indexPtr = geo.GetIndexData();
          const indexSize = geo.GetIndexDataSize();
          
          if (vertSize === 0 || indexSize === 0) continue;
          
          const verts = ifcApi!.GetVertexArray(vertPtr, vertSize);
          const indices = ifcApi!.GetIndexArray(indexPtr, indexSize);

          if (verts.length === 0 || indices.length === 0) continue;

          const vertexCount = verts.length / 6;
          const positions = new Float32Array(vertexCount * 3);
          const normals = new Float32Array(vertexCount * 3);

          for (let v = 0; v < vertexCount; v++) {
            const srcIdx = v * 6;
            const dstIdx = v * 3;
            positions[dstIdx] = verts[srcIdx];
            positions[dstIdx + 1] = verts[srcIdx + 1];
            positions[dstIdx + 2] = verts[srcIdx + 2];
            normals[dstIdx] = verts[srcIdx + 3];
            normals[dstIdx + 1] = verts[srcIdx + 4];
            normals[dstIdx + 2] = verts[srcIdx + 5];
          }

          const bufferGeo = new THREE.BufferGeometry();
          bufferGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
          bufferGeo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
          bufferGeo.setIndex(new THREE.BufferAttribute(indices, 1));

          const material = getMaterial(pg.color.x, pg.color.y, pg.color.z, pg.color.w);
          const mesh = new THREE.Mesh(bufferGeo, material);
          
          const matrix = new THREE.Matrix4();
          matrix.fromArray(pg.flatTransformation);
          mesh.applyMatrix4(matrix);
          
          mesh.userData.expressID = expressID;
          mesh.userData.typeCode = typeCode;

          // 바운딩 박스에서 규격 계산 (mm 단위)
          bufferGeo.computeBoundingBox();
          if (bufferGeo.boundingBox) {
            const box = bufferGeo.boundingBox.clone();
            box.applyMatrix4(matrix);
            const size = box.getSize(new THREE.Vector3());
            
            // 면적 계산: 가장 큰 두 면의 곱 (m² 단위)
            const dims = [size.x, size.y, size.z].sort((a, b) => b - a);
            const area = dims[0] * dims[1]; // 가장 큰 두 치수의 곱
            
            // 기존 규격이 있으면 병합 (같은 expressID의 여러 지오메트리)
            const existing = elementDimensions.get(expressID);
            if (existing) {
              elementDimensions.set(expressID, {
                width: Math.max(existing.width, Math.round(size.x * 1000)),
                height: Math.max(existing.height, Math.round(size.y * 1000)),
                depth: Math.max(existing.depth, Math.round(size.z * 1000)),
                area: (existing.area || 0) + area, // 면적 누적
              });
            } else {
              elementDimensions.set(expressID, {
                width: Math.round(size.x * 1000),
                height: Math.round(size.y * 1000),
                depth: Math.round(size.z * 1000),
                area: area,
              });
            }
          }

          group.add(mesh);
          meshCount++;
        }
      });

      console.log(`✅ 메시 생성 완료: ${meshCount}개, 규격정보: ${elementDimensions.size}개`);

      setProgress(70);
      setLoadingMessage("IFC 속성 분석 중...");

      // Property Sets 파싱 (IsExternal, Reference 등)
      try {
        const relDefinesIds = ifcApi.GetLineIDsWithType(modelID, IFC_SPATIAL_TYPES.IFCRELDEFINESBYPROPERTIES);
        console.log(`🔍 IFCRELDEFINESBYPROPERTIES: ${relDefinesIds.size()}개 관계 발견`);
        
        for (let i = 0; i < relDefinesIds.size(); i++) {
          try {
            const relDefines = ifcApi.GetLine(modelID, relDefinesIds.get(i), true) as any;
            if (!relDefines) continue;
            
            // 관련된 객체들 (RelatedObjects)
            const relatedObjects = relDefines.RelatedObjects || [];
            const propertyDef = relDefines.RelatingPropertyDefinition;
            
            if (!propertyDef || relatedObjects.length === 0) continue;
            
            // PropertySet 처리
            if (propertyDef.type === IFC_SPATIAL_TYPES.IFCPROPERTYSET) {
              const hasProperties = propertyDef.HasProperties || [];
              
              // 속성 추출
              const propInfo: IFCPropertyInfo = {};
              
              for (const prop of hasProperties) {
                if (!prop || !prop.Name?.value) continue;
                
                const propName = prop.Name.value.toLowerCase();
                const propValue = prop.NominalValue?.value;
                
                if (propName === "isexternal" || propName === "is external") {
                  propInfo.isExternal = propValue === true || propValue === ".T." || propValue === "TRUE";
                } else if (propName === "loadbearing" || propName === "load bearing") {
                  propInfo.loadBearing = propValue === true || propValue === ".T." || propValue === "TRUE";
                } else if (propName === "firerating" || propName === "fire rating") {
                  propInfo.fireRating = String(propValue || "");
                } else if (propName === "reference") {
                  propInfo.reference = String(propValue || "");
                } else if (propName === "finish" || propName === "finishtype") {
                  propInfo.finishType = String(propValue || "");
                } else if (propName === "acousticrating") {
                  propInfo.acousticRating = String(propValue || "");
                }
              }
              
              // 각 관련 객체에 속성 저장
              for (const relObj of relatedObjects) {
                const expressID = typeof relObj === 'number' ? relObj : relObj?.expressID;
                if (!expressID) continue;
                
                // 기존 속성과 병합
                const existing = elementProperties.get(expressID) || {};
                elementProperties.set(expressID, { ...existing, ...propInfo });
              }
            }
          } catch (e) {
            // 개별 관계 파싱 실패 무시
          }
        }
        
        // 각 요소의 기본 속성도 추출 (ObjectType, Description)
        for (const { expressID, typeCode } of tempTypeData) {
          try {
            const props = ifcApi.GetLine(modelID, expressID, false) as any;
            if (!props) continue;
            
            const existing = elementProperties.get(expressID) || {};
            
            if (props.ObjectType?.value && !existing.objectType) {
              existing.objectType = props.ObjectType.value;
            }
            if (props.Description?.value && !existing.description) {
              existing.description = props.Description.value;
            }
            
            if (Object.keys(existing).length > 0) {
              elementProperties.set(expressID, existing);
            }
          } catch {}
        }
        
        console.log(`📋 속성 정보 추출 완료: ${elementProperties.size}개 요소`);
      } catch (e) {
        console.warn("Property Set 파싱 실패:", e);
      }

      setProgress(75);
      setLoadingMessage("IFC 공간 구조 분석 중...");

      // IFC 공간 구조 파싱
      cachedSpatialTree = parseSpatialStructure(ifcApi, modelID);

      // 공간 구조에서 층(BuildingStorey) 정보 추출
      if (cachedSpatialTree) {
        const extractStoreys = (node: IFCSpatialNode): StoreyInfo[] => {
          const storeys: StoreyInfo[] = [];
          
          if (node.typeCode === IFC_SPATIAL_TYPES.IFCBUILDINGSTOREY) {
            storeys.push({
              id: `storey_${node.expressID}`,
              name: node.name,
              elevation: 0, // IFC에서 실제 높이 정보는 별도로 가져와야 함
              expressIDs: node.elements,
            });
          }
          
          for (const child of node.children) {
            storeys.push(...extractStoreys(child));
          }
          
          return storeys;
        };
        
        cachedStoreys = extractStoreys(cachedSpatialTree);
        console.log(`🏢 IFC 층 정보: ${cachedStoreys.length}개 층 발견`);
      }

      setProgress(85);
      setLoadingMessage("자재 목록 생성 중...");

      // 타입별 맵 구성 (기존 방식 유지 - getElementsByType용)
      for (const { expressID, typeCode } of tempTypeData) {
        const existing = typeToExpressIDs.get(typeCode) || [];
        existing.push(expressID);
        typeToExpressIDs.set(typeCode, existing);
      }

      // IFC 속성에서 규격 문자열 생성
      const getSpecFromElement = (expressID: number, typeCode: number): string => {
        const props = elementProperties.get(expressID);
        if (props) {
          const specFromProps = buildSpecFromProperties(props, typeCode);
          if (specFromProps) return specFromProps;
        }
        
        // 속성이 없으면 치수 기반 규격 (기존 방식)
        const dim = elementDimensions.get(expressID);
        if (dim) {
          const sizes = [dim.width, dim.height, dim.depth].sort((a, b) => b - a);
          return `${sizes[0]}×${sizes[1]}×${sizes[2]}`;
        }
        
        return "일반";
      };

      // 타입 + 규격별 그룹화
      const materialMap = new Map<string, { 
        typeCode: number; 
        spec: string; 
        dimensions: ElementDimensions;
        totalArea: number;
        expressIDs: number[] 
      }>();

      for (const { expressID, typeCode } of tempTypeData) {
        const dim = elementDimensions.get(expressID);
        if (!dim) continue;
        
        const spec = getSpecFromElement(expressID, typeCode);
        const key = `${typeCode}_${spec}`;
        
        const existing = materialMap.get(key);
        if (existing) {
          existing.expressIDs.push(expressID);
          existing.totalArea += dim.area || 0;
        } else {
          materialMap.set(key, {
            typeCode,
            spec,
            dimensions: dim,
            totalArea: dim.area || 0,
            expressIDs: [expressID],
          });
        }
      }

      // 자재 목록 캐싱 (타입 + 규격별)
      materialMap.forEach((data, key) => {
        cachedMaterials.push({
          id: key,
          typeCode: data.typeCode,
          typeName: IFC_TYPE_NAMES[data.typeCode] || `타입 ${data.typeCode}`,
          category: TYPE_CATEGORIES[data.typeCode] || "기타",
          spec: data.spec,
          count: data.expressIDs.length,
          unit: "개",
          totalArea: data.totalArea,
          expressIDs: data.expressIDs,
          dimensions: data.dimensions,
        });
      });
      
      // 카테고리 → 품명 → 규격 순으로 정렬
      cachedMaterials.sort((a, b) => 
        a.category.localeCompare(b.category) || 
        a.typeName.localeCompare(b.typeName) ||
        a.spec.localeCompare(b.spec)
      );
      
      console.log(`📦 자재 종류: ${cachedMaterials.length}개 (타입+규격 조합)`);


      setProgress(90);
      setLoadingMessage("모델 정렬 중...");

      if (group.children.length > 0) {
        const box = new THREE.Box3().setFromObject(group);
        const center = box.getCenter(new THREE.Vector3());
        group.position.set(-center.x, -center.y, -center.z);
      }

      setProgress(100);
      setLoadingMessage("완료!");
      
      console.log(`🎉 로드 완료: ${group.children.length} 메시, ${cachedStoreys.length} 층`);
      
      setIsLoading(false);
      return group;
    } catch (err) {
      console.error("IFC 로드 에러:", err);
      setError(err instanceof Error ? err.message : "IFC 로드 실패");
      setIsLoading(false);
      return null;
    }
  }, [parseSpatialStructure]);

  const getElementsByType = useCallback((typeCode: number): number[] => {
    return typeToExpressIDs.get(typeCode) || [];
  }, []);

  const getMaterialList = useCallback((): MaterialItem[] => cachedMaterials, []);
  
  const getStoreyList = useCallback((): StoreyInfo[] => cachedStoreys, []);
  
  const getSpatialTree = useCallback((): IFCSpatialNode | null => cachedSpatialTree, []);

  const cleanup = useCallback(() => {
    if (ifcApiRef.current && modelIDRef.current !== null) {
      try { ifcApiRef.current.CloseModel(modelIDRef.current); } catch {}
    }
    modelIDRef.current = null;
    typeToExpressIDs.clear();
    elementDimensions.clear();
    elementProperties.clear();
    cachedMaterials = [];
    cachedStoreys = [];
    cachedSpatialTree = null;
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

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

interface MeshBuildData {
  expressID: number;
  typeCode: number;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  color: { x: number; y: number; z: number; w: number };
  transformation: number[];
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
const elementDimensions = new Map<number, ElementDimensions>();
const elementProperties = new Map<number, IFCPropertyInfo>();
let cachedMaterials: MaterialItem[] = [];
let cachedStoreys: StoreyInfo[] = [];
let cachedSpatialTree: IFCSpatialNode | null = null;

// 대용량 파일 기준 (MB)
const LARGE_FILE_THRESHOLD = 30;
// 속성 분석 스킵 기준 (관계 개수)
const PROPERTY_ANALYSIS_LIMIT = 10000;

const getIfcName = (props: any): string => {
  if (props.Name?.value) return props.Name.value;
  if (props.LongName?.value) return props.LongName.value;
  return `#${props.expressID}`;
};

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

const buildSpecFromProperties = (props: IFCPropertyInfo, typeCode: number): string => {
  const parts: string[] = [];
  
  if (props.isExternal !== undefined) {
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
  
  if (props.reference) parts.push(props.reference);
  if (props.finishType) parts.push(props.finishType);
  if (parts.length === 0 && props.objectType) parts.push(props.objectType);
  if (props.fireRating) parts.push(`내화${props.fireRating}`);
  if (props.loadBearing) parts.push("내력");
  
  return parts.join(",");
};

export function useIFCLoader(): UseIFCLoaderReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const ifcApiRef = useRef<IfcAPI | null>(null);
  const modelIDRef = useRef<number | null>(null);

  const parseSpatialStructure = useCallback((ifcApi: IfcAPI, modelID: number): IFCSpatialNode | null => {
    try {
      const aggregatesMap = new Map<number, number[]>();
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
              if (relatedObjects[j]?.value) children.push(relatedObjects[j].value);
            }
            const existing = aggregatesMap.get(parentId) || [];
            aggregatesMap.set(parentId, [...existing, ...children]);
          }
        } catch {}
      }

      const containsMap = new Map<number, number[]>();
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
              if (relatedElements[j]?.value) elements.push(relatedElements[j].value);
            }
            const existing = containsMap.get(spatialId) || [];
            containsMap.set(spatialId, [...existing, ...elements]);
          }
        } catch {}
      }

      const projectIds = ifcApi.GetLineIDsWithType(modelID, IFC_SPATIAL_TYPES.IFCPROJECT);
      if (projectIds.size() === 0) return null;

      const buildNode = (expressID: number): IFCSpatialNode => {
        let name = `#${expressID}`;
        let typeCode = 0;
        
        try {
          const props = ifcApi.GetLine(modelID, expressID, false) as any;
          name = getIfcName(props);
          typeCode = props.type || 0;
        } catch {}

        return {
          expressID,
          name,
          type: getTypeName(typeCode),
          typeCode,
          children: (aggregatesMap.get(expressID) || []).map(id => buildNode(id)),
          elements: containsMap.get(expressID) || [],
        };
      };

      return buildNode(projectIds.get(0));
    } catch {
      return null;
    }
  }, []);

  const loadIFC = useCallback(async (file: File): Promise<THREE.Group | null> => {
    setIsLoading(true);
    setError(null);
    setProgress(5);
    setLoadingMessage("라이브러리 로딩...");
    
    // 캐시 초기화
    typeToExpressIDs.clear();
    elementDimensions.clear();
    elementProperties.clear();
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
      const fileSizeMB = data.byteLength / 1024 / 1024;
      const isLargeFile = fileSizeMB > LARGE_FILE_THRESHOLD;
      
      console.log(`📁 파일: ${file.name}, 크기: ${fileSizeMB.toFixed(2)}MB, 대용량: ${isLargeFile}`);
      
      setProgress(20);
      setLoadingMessage("모델 파싱 중...");
      
      const modelID = ifcApi.OpenModel(new Uint8Array(data));
      modelIDRef.current = modelID;

      // ========== 1단계: 지오메트리 데이터 수집 ==========
      setProgress(25);
      setLoadingMessage("지오메트리 수집 중...");
      
      const meshBuildDataList: MeshBuildData[] = [];
      const tempTypeData: { expressID: number; typeCode: number }[] = [];

      ifcApi.StreamAllMeshes(modelID, (flatMesh) => {
        const expressID = flatMesh.expressID;
        let typeCode = 0;
        
        try {
          const props = ifcApi!.GetLine(modelID, expressID, false) as any;
          typeCode = props.type || 0;
        } catch {}

        tempTypeData.push({ expressID, typeCode });

        const geometries = flatMesh.geometries;
        for (let i = 0; i < geometries.size(); i++) {
          const pg = geometries.get(i);
          const geo = ifcApi!.GetGeometry(modelID, pg.geometryExpressID);
          
          const vertSize = geo.GetVertexDataSize();
          const indexSize = geo.GetIndexDataSize();
          if (vertSize === 0 || indexSize === 0) continue;
          
          const verts = ifcApi!.GetVertexArray(geo.GetVertexData(), vertSize);
          const indices = ifcApi!.GetIndexArray(geo.GetIndexData(), indexSize);
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

          meshBuildDataList.push({
            expressID, typeCode, positions, normals,
            indices: new Uint32Array(indices),
            color: pg.color,
            transformation: pg.flatTransformation,
          });
        }
      });

      console.log(`📊 수집: ${meshBuildDataList.length}개 지오메트리, ${tempTypeData.length}개 요소`);

      // ========== 2단계: Three.js 메시 생성 (청크 처리) ==========
      setProgress(35);
      
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
      
      const totalMeshes = meshBuildDataList.length;
      const chunkSize = isLargeFile ? 30 : 100; // 대용량일 때 더 작은 청크
      
      for (let i = 0; i < totalMeshes; i += chunkSize) {
        const end = Math.min(i + chunkSize, totalMeshes);
        
        for (let j = i; j < end; j++) {
          const data = meshBuildDataList[j];
          
          const bufferGeo = new THREE.BufferGeometry();
          bufferGeo.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
          bufferGeo.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
          bufferGeo.setIndex(new THREE.BufferAttribute(data.indices, 1));

          const material = getMaterial(data.color.x, data.color.y, data.color.z, data.color.w);
          const mesh = new THREE.Mesh(bufferGeo, material);
          
          const matrix = new THREE.Matrix4();
          matrix.fromArray(data.transformation);
          mesh.applyMatrix4(matrix);
          
          mesh.userData.expressID = data.expressID;
          mesh.userData.typeCode = data.typeCode;

          bufferGeo.computeBoundingBox();
          if (bufferGeo.boundingBox) {
            const box = bufferGeo.boundingBox.clone();
            box.applyMatrix4(matrix);
            const size = box.getSize(new THREE.Vector3());
            const dims = [size.x, size.y, size.z].sort((a, b) => b - a);
            const area = dims[0] * dims[1];
            
            const existing = elementDimensions.get(data.expressID);
            if (existing) {
              elementDimensions.set(data.expressID, {
                width: Math.max(existing.width, Math.round(size.x * 1000)),
                height: Math.max(existing.height, Math.round(size.y * 1000)),
                depth: Math.max(existing.depth, Math.round(size.z * 1000)),
                area: (existing.area || 0) + area,
              });
            } else {
              elementDimensions.set(data.expressID, {
                width: Math.round(size.x * 1000),
                height: Math.round(size.y * 1000),
                depth: Math.round(size.z * 1000),
                area,
              });
            }
          }

          group.add(mesh);
        }

        // UI 업데이트 + 브라우저 제어권 양보
        const meshProgress = 35 + Math.floor((end / totalMeshes) * 35);
        setProgress(meshProgress);
        setLoadingMessage(`3D 메시 생성 중... (${end}/${totalMeshes})`);
        
        // 브라우저에 제어권 양보 (대용량일 때 더 자주)
        await new Promise(resolve => setTimeout(resolve, isLargeFile ? 10 : 0));
      }

      console.log(`✅ 메시 생성 완료: ${group.children.length}개`);

      // ========== 3단계: 속성 분석 (대용량은 스킵 또는 제한) ==========
      setProgress(75);
      
      const relDefinesIds = ifcApi.GetLineIDsWithType(modelID, IFC_SPATIAL_TYPES.IFCRELDEFINESBYPROPERTIES);
      const totalRelations = relDefinesIds.size();
      
      console.log(`🔍 속성 관계: ${totalRelations}개`);
      
      // 대용량 파일이거나 관계가 너무 많으면 속성 분석 스킵
      if (isLargeFile && totalRelations > PROPERTY_ANALYSIS_LIMIT) {
        console.log(`⚠️ 대용량 파일 - 상세 속성 분석 스킵 (${totalRelations}개 > ${PROPERTY_ANALYSIS_LIMIT}개)`);
        setLoadingMessage("대용량 파일 - 기본 정보만 로드...");
      } else {
        setLoadingMessage("IFC 속성 분석 중...");
        
        // 제한된 수만 분석
        const limit = Math.min(totalRelations, PROPERTY_ANALYSIS_LIMIT);
        
        for (let i = 0; i < limit; i++) {
          try {
            const relDefines = ifcApi.GetLine(modelID, relDefinesIds.get(i), true) as any;
            if (!relDefines) continue;
            
            const relatedObjects = relDefines.RelatedObjects || [];
            const propertyDef = relDefines.RelatingPropertyDefinition;
            if (!propertyDef || relatedObjects.length === 0) continue;
            
            if (propertyDef.type === IFC_SPATIAL_TYPES.IFCPROPERTYSET) {
              const hasProperties = propertyDef.HasProperties || [];
              const propInfo: IFCPropertyInfo = {};
              
              for (const prop of hasProperties) {
                if (!prop?.Name?.value) continue;
                const propName = prop.Name.value.toLowerCase();
                const propValue = prop.NominalValue?.value;
                
                if (propName === "isexternal" || propName === "is external") {
                  propInfo.isExternal = propValue === true || propValue === ".T." || propValue === "TRUE";
                } else if (propName === "loadbearing") {
                  propInfo.loadBearing = propValue === true || propValue === ".T." || propValue === "TRUE";
                } else if (propName === "firerating") {
                  propInfo.fireRating = String(propValue || "");
                } else if (propName === "reference") {
                  propInfo.reference = String(propValue || "");
                } else if (propName === "finish" || propName === "finishtype") {
                  propInfo.finishType = String(propValue || "");
                }
              }
              
              for (const relObj of relatedObjects) {
                const expressID = typeof relObj === 'number' ? relObj : relObj?.expressID;
                if (!expressID) continue;
                const existing = elementProperties.get(expressID) || {};
                elementProperties.set(expressID, { ...existing, ...propInfo });
              }
            }
          } catch {}
          
          // 1000개마다 UI 업데이트
          if (i % 1000 === 0) {
            setLoadingMessage(`IFC 속성 분석 중... (${i}/${limit})`);
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        }
        
        console.log(`📋 속성 추출 완료: ${elementProperties.size}개`);
      }

      // ========== 4단계: 공간 구조 분석 ==========
      setProgress(85);
      setLoadingMessage("공간 구조 분석 중...");

      cachedSpatialTree = parseSpatialStructure(ifcApi, modelID);

      if (cachedSpatialTree) {
        const extractStoreys = (node: IFCSpatialNode): StoreyInfo[] => {
          const storeys: StoreyInfo[] = [];
          if (node.typeCode === IFC_SPATIAL_TYPES.IFCBUILDINGSTOREY) {
            storeys.push({
              id: `storey_${node.expressID}`,
              name: node.name,
              elevation: 0,
              expressIDs: node.elements,
            });
          }
          for (const child of node.children) {
            storeys.push(...extractStoreys(child));
          }
          return storeys;
        };
        cachedStoreys = extractStoreys(cachedSpatialTree);
        console.log(`🏢 층 정보: ${cachedStoreys.length}개`);
      }

      // ========== 5단계: 자재 목록 생성 ==========
      setProgress(92);
      setLoadingMessage("자재 목록 생성 중...");

      for (const { expressID, typeCode } of tempTypeData) {
        const existing = typeToExpressIDs.get(typeCode) || [];
        existing.push(expressID);
        typeToExpressIDs.set(typeCode, existing);
      }

      const getSpecFromElement = (expressID: number, typeCode: number): string => {
        const props = elementProperties.get(expressID);
        if (props) {
          const specFromProps = buildSpecFromProperties(props, typeCode);
          if (specFromProps) return specFromProps;
        }
        const dim = elementDimensions.get(expressID);
        if (dim) {
          const sizes = [dim.width, dim.height, dim.depth].sort((a, b) => b - a);
          return `${sizes[0]}×${sizes[1]}×${sizes[2]}`;
        }
        return "일반";
      };

      const materialMap = new Map<string, { 
        typeCode: number; spec: string; dimensions: ElementDimensions;
        totalArea: number; expressIDs: number[] 
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
            typeCode, spec, dimensions: dim,
            totalArea: dim.area || 0, expressIDs: [expressID],
          });
        }
      }

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
      
      cachedMaterials.sort((a, b) => 
        a.category.localeCompare(b.category) || 
        a.typeName.localeCompare(b.typeName) ||
        a.spec.localeCompare(b.spec)
      );

      // ========== 6단계: 모델 정렬 ==========
      setProgress(97);
      setLoadingMessage("모델 정렬 중...");

      if (group.children.length > 0) {
        const box = new THREE.Box3().setFromObject(group);
        const center = box.getCenter(new THREE.Vector3());
        group.position.set(-center.x, -center.y, -center.z);
      }

      setProgress(100);
      setLoadingMessage("완료!");
      
      console.log(`🎉 로드 완료: ${group.children.length} 메시, ${cachedMaterials.length} 자재, ${cachedStoreys.length} 층`);
      
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
    isLoading, loadingMessage, error, progress,
    loadIFC, getElementsByType, getMaterialList, getStoreyList, getSpatialTree, cleanup,
  };
}

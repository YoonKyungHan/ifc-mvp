"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import * as THREE from "three";
import { MaterialItem, StoreyInfo, IFCSpatialNode } from "@/types/ifc";

interface ParsedMesh {
  expressID: number;
  typeCode: number;
  geometries: {
    positions: Float32Array;
    normals: Float32Array;
    indices: Uint32Array;
    color: { x: number; y: number; z: number; w: number };
    transformation: number[];
  }[];
  boundingBox: { width: number; height: number; depth: number };
}

interface UseIFCWorkerLoaderReturn {
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

// 모듈 레벨 캐시
const typeToExpressIDs = new Map<number, number[]>();
let cachedMaterials: MaterialItem[] = [];
let cachedStoreys: StoreyInfo[] = [];
let cachedSpatialTree: IFCSpatialNode | null = null;

export function useIFCWorkerLoader(): UseIFCWorkerLoaderReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  
  const workerRef = useRef<Worker | null>(null);

  // Worker 초기화
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  const loadIFC = useCallback(async (file: File): Promise<THREE.Group | null> => {
    setIsLoading(true);
    setError(null);
    setProgress(0);
    setLoadingMessage("Worker 초기화...");
    
    // 캐시 초기화
    typeToExpressIDs.clear();
    cachedMaterials = [];
    cachedStoreys = [];
    cachedSpatialTree = null;

    return new Promise(async (resolve) => {
      try {
        // Worker 생성
        if (workerRef.current) {
          workerRef.current.terminate();
        }
        
        // 동적 Worker 생성 (Next.js 호환)
        const workerCode = `
          importScripts('https://unpkg.com/web-ifc@0.0.57/web-ifc-api-iife.js');
          ${getWorkerCode()}
        `;
        
        // Blob URL로 Worker 생성
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(blob);
        const worker = new Worker(workerUrl);
        workerRef.current = worker;

        // 파일 읽기
        setProgress(2);
        setLoadingMessage("파일 읽는 중...");
        const arrayBuffer = await file.arrayBuffer();

        worker.onmessage = (event) => {
          const { type, data, progress: workerProgress, message, error: workerError } = event.data;
          
          if (type === 'progress') {
            setProgress(workerProgress);
            setLoadingMessage(message);
          } else if (type === 'complete') {
            // 메인 스레드에서 Three.js 객체 생성
            setProgress(96);
            setLoadingMessage("3D 메시 생성 중...");
            
            const group = createThreeGroup(data.meshes, file.name);
            
            // 캐시 저장
            cachedMaterials = data.materials;
            cachedStoreys = data.storeys;
            cachedSpatialTree = data.spatialTree;
            
            // 타입별 맵 구성
            for (const mesh of data.meshes) {
              const existing = typeToExpressIDs.get(mesh.typeCode) || [];
              existing.push(mesh.expressID);
              typeToExpressIDs.set(mesh.typeCode, existing);
            }
            
            setProgress(100);
            setLoadingMessage("완료!");
            setIsLoading(false);
            
            console.log(`🎉 Worker 로드 완료: ${group.children.length} 메시`);
            resolve(group);
            
            // Worker URL 정리
            URL.revokeObjectURL(workerUrl);
          } else if (type === 'error') {
            console.error("Worker 에러:", workerError);
            setError(workerError);
            setIsLoading(false);
            resolve(null);
          }
        };

        worker.onerror = (e) => {
          console.error("Worker 오류:", e);
          setError(e.message);
          setIsLoading(false);
          resolve(null);
        };

        // Worker에 파싱 요청
        worker.postMessage({ type: 'parse', data: arrayBuffer }, [arrayBuffer]);
        
      } catch (err) {
        console.error("IFC 로드 에러:", err);
        setError(err instanceof Error ? err.message : "IFC 로드 실패");
        setIsLoading(false);
        resolve(null);
      }
    });
  }, []);

  const getElementsByType = useCallback((typeCode: number): number[] => {
    return typeToExpressIDs.get(typeCode) || [];
  }, []);

  const getMaterialList = useCallback((): MaterialItem[] => cachedMaterials, []);
  const getStoreyList = useCallback((): StoreyInfo[] => cachedStoreys, []);
  const getSpatialTree = useCallback((): IFCSpatialNode | null => cachedSpatialTree, []);

  const cleanup = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    typeToExpressIDs.clear();
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

// Three.js 그룹 생성 (메인 스레드에서 실행)
function createThreeGroup(meshes: ParsedMesh[], fileName: string): THREE.Group {
  const group = new THREE.Group();
  group.name = fileName;
  
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
  
  for (const meshData of meshes) {
    for (const geo of meshData.geometries) {
      const bufferGeo = new THREE.BufferGeometry();
      bufferGeo.setAttribute("position", new THREE.BufferAttribute(geo.positions, 3));
      bufferGeo.setAttribute("normal", new THREE.BufferAttribute(geo.normals, 3));
      bufferGeo.setIndex(new THREE.BufferAttribute(geo.indices, 1));
      
      const material = getMaterial(geo.color.x, geo.color.y, geo.color.z, geo.color.w);
      const mesh = new THREE.Mesh(bufferGeo, material);
      
      const matrix = new THREE.Matrix4();
      matrix.fromArray(geo.transformation);
      mesh.applyMatrix4(matrix);
      
      mesh.userData.expressID = meshData.expressID;
      mesh.userData.typeCode = meshData.typeCode;
      mesh.frustumCulled = true;
      
      group.add(mesh);
    }
  }
  
  // 중심 정렬
  if (group.children.length > 0) {
    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    group.position.set(-center.x, -center.y, -center.z);
  }
  
  return group;
}

// Worker 코드 (인라인)
function getWorkerCode(): string {
  return `
    const IFC_TYPE_NAMES = {
      45: "벽", 46: "벽", 1529196076: "슬라브", 843113511: "기둥",
      753842376: "보", 395920057: "문", 3304561284: "창문", 331165859: "계단",
      2016517767: "지붕", 2262370178: "난간", 263784265: "가구",
      3171933400: "판", 1073191201: "부재", 1973544240: "피복", 900683007: "기초",
    };

    const TYPE_CATEGORIES = {
      45: "구조", 46: "구조", 1529196076: "구조", 843113511: "구조",
      753842376: "구조", 900683007: "구조",
      395920057: "건축", 3304561284: "건축", 331165859: "건축",
      2016517767: "건축", 2262370178: "건축", 1973544240: "건축",
      263784265: "가구", 3171933400: "기타", 1073191201: "기타",
    };

    const IFC_SPATIAL_TYPES = {
      IFCPROJECT: 103090709,
      IFCSITE: 4097777520,
      IFCBUILDING: 4031249490,
      IFCBUILDINGSTOREY: 3124254112,
      IFCSPACE: 3856911033,
      IFCRELAGGREGATES: 160246688,
      IFCRELCONTAINEDINSPATIALSTRUCTURE: 3242617779,
    };

    let ifcApi = null;

    function sendProgress(progress, message) {
      self.postMessage({ type: 'progress', progress, message });
    }

    async function initIfcApi() {
      if (ifcApi) return ifcApi;
      sendProgress(5, '라이브러리 로딩...');
      ifcApi = new WebIFC.IfcAPI();
      ifcApi.SetWasmPath('https://unpkg.com/web-ifc@0.0.57/');
      sendProgress(10, 'WASM 초기화...');
      await ifcApi.Init();
      return ifcApi;
    }

    function parseSpatialStructure(api, modelID) {
      try {
        const aggregatesMap = new Map();
        const containsMap = new Map();

        const aggregatesIds = api.GetLineIDsWithType(modelID, IFC_SPATIAL_TYPES.IFCRELAGGREGATES);
        for (let i = 0; i < aggregatesIds.size(); i++) {
          try {
            const rel = api.GetLine(modelID, aggregatesIds.get(i), false);
            const parentId = rel.RelatingObject?.value;
            if (parentId && rel.RelatedObjects) {
              const children = [];
              for (let j = 0; j < rel.RelatedObjects.length; j++) {
                if (rel.RelatedObjects[j]?.value) children.push(rel.RelatedObjects[j].value);
              }
              aggregatesMap.set(parentId, [...(aggregatesMap.get(parentId) || []), ...children]);
            }
          } catch {}
        }

        const containsIds = api.GetLineIDsWithType(modelID, IFC_SPATIAL_TYPES.IFCRELCONTAINEDINSPATIALSTRUCTURE);
        for (let i = 0; i < containsIds.size(); i++) {
          try {
            const rel = api.GetLine(modelID, containsIds.get(i), false);
            const spatialId = rel.RelatingStructure?.value;
            if (spatialId && rel.RelatedElements) {
              const elements = [];
              for (let j = 0; j < rel.RelatedElements.length; j++) {
                if (rel.RelatedElements[j]?.value) elements.push(rel.RelatedElements[j].value);
              }
              containsMap.set(spatialId, [...(containsMap.get(spatialId) || []), ...elements]);
            }
          } catch {}
        }

        const projectIds = api.GetLineIDsWithType(modelID, IFC_SPATIAL_TYPES.IFCPROJECT);
        if (projectIds.size() === 0) return null;

        function getTypeName(typeCode) {
          const names = {
            [IFC_SPATIAL_TYPES.IFCPROJECT]: "IfcProject",
            [IFC_SPATIAL_TYPES.IFCSITE]: "IfcSite",
            [IFC_SPATIAL_TYPES.IFCBUILDING]: "IfcBuilding",
            [IFC_SPATIAL_TYPES.IFCBUILDINGSTOREY]: "IfcBuildingStorey",
            [IFC_SPATIAL_TYPES.IFCSPACE]: "IfcSpace",
          };
          return names[typeCode] || IFC_TYPE_NAMES[typeCode] || 'Type_' + typeCode;
        }

        function buildNode(expressID) {
          let name = '#' + expressID, typeCode = 0;
          try {
            const props = api.GetLine(modelID, expressID, false);
            name = props.Name?.value || props.LongName?.value || name;
            typeCode = props.type || 0;
          } catch {}
          return {
            expressID,
            name,
            type: getTypeName(typeCode),
            typeCode,
            children: (aggregatesMap.get(expressID) || []).map(buildNode),
            elements: containsMap.get(expressID) || [],
          };
        }

        return buildNode(projectIds.get(0));
      } catch (e) {
        return null;
      }
    }

    function extractStoreys(spatialTree) {
      const storeys = [];
      function traverse(node) {
        if (node.typeCode === IFC_SPATIAL_TYPES.IFCBUILDINGSTOREY) {
          storeys.push({
            id: 'storey_' + node.expressID,
            name: node.name,
            elevation: 0,
            expressIDs: node.elements,
          });
        }
        if (node.children) node.children.forEach(traverse);
      }
      if (spatialTree) traverse(spatialTree);
      return storeys;
    }

    async function parseIFC(fileData) {
      const api = await initIfcApi();
      sendProgress(15, '파일 읽는 중...');
      const modelID = api.OpenModel(new Uint8Array(fileData));
      sendProgress(20, '모델 파싱 중...');

      const meshes = [];
      const typeToExpressIDs = new Map();
      const elementDimensions = new Map();
      let processedCount = 0;
      let totalMeshes = 0;

      api.StreamAllMeshes(modelID, function() { totalMeshes++; });
      sendProgress(25, '지오메트리 생성 중... (0/' + totalMeshes + ')');

      api.StreamAllMeshes(modelID, function(flatMesh) {
        const expressID = flatMesh.expressID;
        let typeCode = 0;
        try {
          const props = api.GetLine(modelID, expressID, false);
          typeCode = props.type || 0;
        } catch {}

        const existing = typeToExpressIDs.get(typeCode) || [];
        existing.push(expressID);
        typeToExpressIDs.set(typeCode, existing);

        const geometries = flatMesh.geometries;
        const geoCount = geometries.size();
        const meshGeometries = [];

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;

        for (let i = 0; i < geoCount; i++) {
          const pg = geometries.get(i);
          const geo = api.GetGeometry(modelID, pg.geometryExpressID);
          const vertPtr = geo.GetVertexData();
          const vertSize = geo.GetVertexDataSize();
          const indexPtr = geo.GetIndexData();
          const indexSize = geo.GetIndexDataSize();

          if (vertSize === 0 || indexSize === 0) continue;

          const verts = api.GetVertexArray(vertPtr, vertSize);
          const indices = api.GetIndexArray(indexPtr, indexSize);

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

            const x = verts[srcIdx], y = verts[srcIdx + 1], z = verts[srcIdx + 2];
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
            if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
          }

          meshGeometries.push({
            positions: positions,
            normals: normals,
            indices: new Uint32Array(indices),
            color: { x: pg.color.x, y: pg.color.y, z: pg.color.z, w: pg.color.w },
            transformation: Array.from(pg.flatTransformation),
          });
        }

        if (meshGeometries.length > 0) {
          meshes.push({
            expressID: expressID,
            typeCode: typeCode,
            geometries: meshGeometries,
            boundingBox: {
              width: minX !== Infinity ? Math.round((maxX - minX) * 1000) : 0,
              height: minY !== Infinity ? Math.round((maxY - minY) * 1000) : 0,
              depth: minZ !== Infinity ? Math.round((maxZ - minZ) * 1000) : 0,
            },
          });

          if (minX !== Infinity) {
            elementDimensions.set(expressID, {
              width: Math.round((maxX - minX) * 1000),
              height: Math.round((maxY - minY) * 1000),
              depth: Math.round((maxZ - minZ) * 1000),
            });
          }
        }

        processedCount++;
        if (processedCount % 500 === 0) {
          const progress = 25 + Math.floor((processedCount / totalMeshes) * 50);
          sendProgress(progress, '지오메트리 생성 중... (' + processedCount + '/' + totalMeshes + ')');
        }
      });

      sendProgress(75, 'IFC 공간 구조 분석 중...');
      const spatialTree = parseSpatialStructure(api, modelID);
      const storeys = extractStoreys(spatialTree);

      sendProgress(85, '자재 목록 생성 중...');

      function getDimensionSpec(dim) {
        const sizes = [dim.width, dim.height, dim.depth].sort(function(a, b) { return b - a; });
        return sizes[0] + '×' + sizes[1] + '×' + sizes[2];
      }

      const materialMap = new Map();
      typeToExpressIDs.forEach(function(expressIDs, typeCode) {
        const specGroups = new Map();
        for (const id of expressIDs) {
          const dim = elementDimensions.get(id);
          const spec = dim ? getDimensionSpec(dim) : 'unknown';
          const group = specGroups.get(spec) || [];
          group.push(id);
          specGroups.set(spec, group);
        }
        specGroups.forEach(function(ids, spec) {
          const key = typeCode + '_' + spec;
          const dim = elementDimensions.get(ids[0]);
          materialMap.set(key, {
            id: key,
            typeCode: typeCode,
            typeName: IFC_TYPE_NAMES[typeCode] || '타입 ' + typeCode,
            category: TYPE_CATEGORIES[typeCode] || '기타',
            spec: spec,
            count: ids.length,
            unit: '개',
            expressIDs: ids,
            dimensions: dim,
          });
        });
      });

      const materials = Array.from(materialMap.values()).sort(function(a, b) {
        return a.category.localeCompare(b.category) || a.typeName.localeCompare(b.typeName) || a.spec.localeCompare(b.spec);
      });

      sendProgress(95, '정리 중...');
      api.CloseModel(modelID);
      sendProgress(100, '완료!');

      return { meshes: meshes, spatialTree: spatialTree, storeys: storeys, materials: materials };
    }

    self.onmessage = async function(event) {
      const type = event.data.type;
      const data = event.data.data;
      if (type === 'parse') {
        try {
          const result = await parseIFC(data);
          self.postMessage({ type: 'complete', data: result });
        } catch (error) {
          self.postMessage({ type: 'error', error: String(error) });
        }
      }
    };
  `;
}

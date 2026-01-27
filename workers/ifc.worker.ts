/**
 * IFC 파싱 Web Worker
 * 메인 스레드 블로킹 없이 IFC 파일을 파싱합니다.
 */

// Worker 컨텍스트 타입
declare const self: DedicatedWorkerGlobalScope;

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

interface ParseResult {
  meshes: ParsedMesh[];
  spatialTree: any;
  storeys: any[];
  materials: any[];
  progress: number;
  message: string;
}

// IFC 타입 이름 매핑
const IFC_TYPE_NAMES: Record<number, string> = {
  45: "벽", 46: "벽", 1529196076: "슬라브", 843113511: "기둥",
  753842376: "보", 395920057: "문", 3304561284: "창문", 331165859: "계단",
  2016517767: "지붕", 2262370178: "난간", 263784265: "가구",
  3171933400: "판", 1073191201: "부재", 1973544240: "피복", 900683007: "기초",
};

const TYPE_CATEGORIES: Record<number, string> = {
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
} as const;

let ifcApi: any = null;

// 진행 상황 전송
function sendProgress(progress: number, message: string) {
  self.postMessage({ type: 'progress', progress, message });
}

// IFC API 초기화
async function initIfcApi() {
  if (ifcApi) return ifcApi;
  
  sendProgress(5, '라이브러리 로딩...');
  const WebIFC = await import('web-ifc');
  
  sendProgress(10, 'WASM 초기화...');
  ifcApi = new WebIFC.IfcAPI();
  ifcApi.SetWasmPath('/wasm/');
  await ifcApi.Init();
  
  return ifcApi;
}

// 공간 구조 파싱
function parseSpatialStructure(api: any, modelID: number) {
  try {
    const aggregatesMap = new Map<number, number[]>();
    const containsMap = new Map<number, number[]>();

    // IfcRelAggregates 수집
    const aggregatesIds = api.GetLineIDsWithType(modelID, IFC_SPATIAL_TYPES.IFCRELAGGREGATES);
    for (let i = 0; i < aggregatesIds.size(); i++) {
      try {
        const rel = api.GetLine(modelID, aggregatesIds.get(i), false);
        const parentId = rel.RelatingObject?.value;
        if (parentId && rel.RelatedObjects) {
          const children = rel.RelatedObjects.map((o: any) => o.value).filter(Boolean);
          aggregatesMap.set(parentId, [...(aggregatesMap.get(parentId) || []), ...children]);
        }
      } catch {}
    }

    // IfcRelContainedInSpatialStructure 수집
    const containsIds = api.GetLineIDsWithType(modelID, IFC_SPATIAL_TYPES.IFCRELCONTAINEDINSPATIALSTRUCTURE);
    for (let i = 0; i < containsIds.size(); i++) {
      try {
        const rel = api.GetLine(modelID, containsIds.get(i), false);
        const spatialId = rel.RelatingStructure?.value;
        if (spatialId && rel.RelatedElements) {
          const elements = rel.RelatedElements.map((o: any) => o.value).filter(Boolean);
          containsMap.set(spatialId, [...(containsMap.get(spatialId) || []), ...elements]);
        }
      } catch {}
    }

    // 트리 구축
    const projectIds = api.GetLineIDsWithType(modelID, IFC_SPATIAL_TYPES.IFCPROJECT);
    if (projectIds.size() === 0) return null;

    const buildNode = (expressID: number): any => {
      let name = `#${expressID}`, typeCode = 0;
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
    };

    return buildNode(projectIds.get(0));
  } catch (e) {
    console.error('공간 구조 파싱 실패:', e);
    return null;
  }
}

function getTypeName(typeCode: number): string {
  const names: Record<number, string> = {
    [IFC_SPATIAL_TYPES.IFCPROJECT]: "IfcProject",
    [IFC_SPATIAL_TYPES.IFCSITE]: "IfcSite",
    [IFC_SPATIAL_TYPES.IFCBUILDING]: "IfcBuilding",
    [IFC_SPATIAL_TYPES.IFCBUILDINGSTOREY]: "IfcBuildingStorey",
    [IFC_SPATIAL_TYPES.IFCSPACE]: "IfcSpace",
  };
  return names[typeCode] || IFC_TYPE_NAMES[typeCode] || `Type_${typeCode}`;
}

// 층 정보 추출
function extractStoreys(spatialTree: any): any[] {
  const storeys: any[] = [];
  
  const traverse = (node: any) => {
    if (node.typeCode === IFC_SPATIAL_TYPES.IFCBUILDINGSTOREY) {
      storeys.push({
        id: `storey_${node.expressID}`,
        name: node.name,
        elevation: 0,
        expressIDs: node.elements,
      });
    }
    node.children?.forEach(traverse);
  };
  
  if (spatialTree) traverse(spatialTree);
  return storeys;
}

// 메인 파싱 함수
async function parseIFC(fileData: ArrayBuffer) {
  const api = await initIfcApi();
  
  sendProgress(15, '파일 읽는 중...');
  const modelID = api.OpenModel(new Uint8Array(fileData));
  
  sendProgress(20, '모델 파싱 중...');
  
  const meshes: ParsedMesh[] = [];
  const typeToExpressIDs = new Map<number, number[]>();
  const elementDimensions = new Map<number, { width: number; height: number; depth: number }>();
  
  let processedCount = 0;
  let totalMeshes = 0;
  
  // 먼저 메시 개수 파악
  api.StreamAllMeshes(modelID, () => { totalMeshes++; });
  
  sendProgress(25, `지오메트리 생성 중... (0/${totalMeshes})`);
  
  // 메시 처리
  api.StreamAllMeshes(modelID, (flatMesh: any) => {
    const expressID = flatMesh.expressID;
    let typeCode = 0;
    
    try {
      const props = api.GetLine(modelID, expressID, false);
      typeCode = props.type || 0;
    } catch {}
    
    // 타입별 맵 구성
    const existing = typeToExpressIDs.get(typeCode) || [];
    existing.push(expressID);
    typeToExpressIDs.set(typeCode, existing);
    
    const geometries = flatMesh.geometries;
    const geoCount = geometries.size();
    const meshGeometries: ParsedMesh['geometries'] = [];
    
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
        
        // 바운딩 박스
        const x = verts[srcIdx], y = verts[srcIdx + 1], z = verts[srcIdx + 2];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
      
      meshGeometries.push({
        positions,
        normals,
        indices: new Uint32Array(indices),
        color: { x: pg.color.x, y: pg.color.y, z: pg.color.z, w: pg.color.w },
        transformation: Array.from(pg.flatTransformation),
      });
    }
    
    if (meshGeometries.length > 0) {
      meshes.push({
        expressID,
        typeCode,
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
      sendProgress(progress, `지오메트리 생성 중... (${processedCount}/${totalMeshes})`);
    }
  });
  
  sendProgress(75, 'IFC 공간 구조 분석 중...');
  const spatialTree = parseSpatialStructure(api, modelID);
  const storeys = extractStoreys(spatialTree);
  
  sendProgress(85, '자재 목록 생성 중...');
  
  // 자재 목록 생성 (타입 + 규격별)
  const getDimensionSpec = (dim: { width: number; height: number; depth: number }) => {
    const sizes = [dim.width, dim.height, dim.depth].sort((a, b) => b - a);
    return `${sizes[0]}×${sizes[1]}×${sizes[2]}`;
  };
  
  const materialMap = new Map<string, any>();
  
  typeToExpressIDs.forEach((expressIDs, typeCode) => {
    // 규격별로 그룹화
    const specGroups = new Map<string, number[]>();
    
    for (const id of expressIDs) {
      const dim = elementDimensions.get(id);
      const spec = dim ? getDimensionSpec(dim) : 'unknown';
      const group = specGroups.get(spec) || [];
      group.push(id);
      specGroups.set(spec, group);
    }
    
    specGroups.forEach((ids, spec) => {
      const key = `${typeCode}_${spec}`;
      const dim = elementDimensions.get(ids[0]);
      
      materialMap.set(key, {
        id: key,
        typeCode,
        typeName: IFC_TYPE_NAMES[typeCode] || `타입 ${typeCode}`,
        category: TYPE_CATEGORIES[typeCode] || "기타",
        spec,
        count: ids.length,
        unit: "개",
        expressIDs: ids,
        dimensions: dim,
      });
    });
  });
  
  const materials = Array.from(materialMap.values()).sort((a, b) => 
    a.category.localeCompare(b.category) || a.typeName.localeCompare(b.typeName) || a.spec.localeCompare(b.spec)
  );
  
  sendProgress(95, '정리 중...');
  
  // 모델 닫기
  api.CloseModel(modelID);
  
  sendProgress(100, '완료!');
  
  return { meshes, spatialTree, storeys, materials };
}

// 메시지 핸들러
addEventListener('message', async (event: MessageEvent) => {
  const { type, data } = event.data;
  
  if (type === 'parse') {
    try {
      const result = await parseIFC(data);
      postMessage({ type: 'complete', data: result });
    } catch (error) {
      postMessage({ type: 'error', error: String(error) });
    }
  }
});

export {};

/**
 * IFC 파일 처리 API
 * 
 * POST /api/convert - IFC 파일을 받아서 처리된 JSON으로 변환
 * GET /api/convert?id=xxx - 캐시된 모델 데이터 조회
 */

import { NextRequest, NextResponse } from "next/server";
import * as crypto from "crypto";

// 메모리 캐시 (프로덕션에서는 Redis 등 사용 권장)
const modelCache = new Map<string, ProcessedModel>();

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
  spatialTree: SpatialNode | null;
  createdAt: number;
  expiresAt: number;
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

interface StoreyInfo {
  id: string;
  name: string;
  elevation: number;
  expressIDs: number[];
}

interface SpatialNode {
  expressID: number;
  name: string;
  type: string;
  typeCode: number;
  children: SpatialNode[];
  elementIDs: number[];
}

// IFC 타입 이름 매핑
const IFC_TYPE_NAMES: Record<number, string> = {
  3512223829: "벽체",
  1281925730: "벽체(표준)",
  2979338954: "보",
  3649129432: "기둥",
  3124254112: "슬래브",
  4278956645: "설비단말",
  3304561284: "창문",
  395920057: "문",
  1529196076: "마감재",
  1509553395: "가구",
  2320036040: "지붕",
  3495092785: "난간",
  1095909175: "계단(부재)",
  4086658281: "계단",
};

const TYPE_CATEGORIES: Record<number, string> = {
  3512223829: "구조",
  1281925730: "구조",
  2979338954: "구조",
  3649129432: "구조",
  3124254112: "구조",
  4278956645: "설비",
  3304561284: "개구부",
  395920057: "개구부",
  1529196076: "마감",
  1509553395: "가구",
};

// 캐시 TTL: 1시간
const CACHE_TTL = 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    
    if (!file) {
      return NextResponse.json({ error: "파일이 필요합니다" }, { status: 400 });
    }
    
    if (!file.name.toLowerCase().endsWith(".ifc")) {
      return NextResponse.json({ error: "IFC 파일만 지원합니다" }, { status: 400 });
    }
    
    // 파일 크기 제한 (서버 처리는 20MB까지, 그 이상은 클라이언트 처리 권장)
    const MAX_SIZE = 20 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { 
          error: `파일 크기가 ${Math.round(file.size / 1024 / 1024)}MB입니다. 서버 처리는 20MB까지만 지원합니다. 클라이언트 처리 모드를 사용하세요.`,
          suggestion: "client"
        },
        { status: 413 }
      );
    }
    
    const arrayBuffer = await file.arrayBuffer();
    
    // 파일 해시로 캐시 키 생성
    const hash = crypto.createHash("md5").update(new Uint8Array(arrayBuffer)).digest("hex");
    const cacheKey = `${hash}_${file.name}`;
    
    // 캐시 확인
    const cached = modelCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      console.log(`📦 캐시 히트: ${cacheKey}`);
      return NextResponse.json({
        success: true,
        cached: true,
        model: cached,
      });
    }
    
    console.log(`🔄 IFC 처리 시작: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
    
    try {
      // web-ifc 로드
      const WebIFC = await import("web-ifc");
      const ifcApi = new WebIFC.IfcAPI();
      
      // WASM 경로 설정 - Node.js 환경에서는 설정하지 않으면 자동으로 찾음
      // SetWasmPath를 호출하지 않음
      
      await ifcApi.Init();
      
      const modelID = ifcApi.OpenModel(new Uint8Array(arrayBuffer));
      
      // 메시 데이터 수집
      const meshes: ProcessedMesh[] = [];
      const typeMap = new Map<number, number[]>();
      
      ifcApi.StreamAllMeshes(modelID, (flatMesh: any) => {
        const expressID = flatMesh.expressID;
        const geometries = flatMesh.geometries;
        const geoCount = geometries.size();
        
        // 타입 정보 가져오기
        let typeCode = 0;
        try {
          const props = ifcApi.GetLine(modelID, expressID);
          typeCode = props?.type || 0;
        } catch {}
        
        for (let i = 0; i < geoCount; i++) {
          const pg = geometries.get(i);
          const geo = ifcApi.GetGeometry(modelID, pg.geometryExpressID);
          
          const vertPtr = geo.GetVertexData();
          const vertSize = geo.GetVertexDataSize();
          const indexPtr = geo.GetIndexData();
          const indexSize = geo.GetIndexDataSize();
          
          if (vertSize === 0 || indexSize === 0) continue;
          
          const verts = ifcApi.GetVertexArray(vertPtr, vertSize);
          const indices = ifcApi.GetIndexArray(indexPtr, indexSize);
          
          const vertexCount = verts.length / 6;
          const positions: number[] = [];
          const normals: number[] = [];
          
          for (let v = 0; v < vertexCount; v++) {
            const srcIdx = v * 6;
            positions.push(verts[srcIdx], verts[srcIdx + 1], verts[srcIdx + 2]);
            normals.push(verts[srcIdx + 3], verts[srcIdx + 4], verts[srcIdx + 5]);
          }
          
          meshes.push({
            expressID,
            typeCode,
            positions,
            normals,
            indices: Array.from(indices),
            color: [pg.color.x, pg.color.y, pg.color.z, pg.color.w],
            transform: Array.from(pg.flatTransformation),
          });
          
          // 타입별 매핑
          if (typeCode) {
            const arr = typeMap.get(typeCode) || [];
            if (!arr.includes(expressID)) arr.push(expressID);
            typeMap.set(typeCode, arr);
          }
        }
      });
      
      // 층 정보 추출
      const storeys: StoreyInfo[] = [];
      try {
        const storeyIDs = ifcApi.GetLineIDsWithType(modelID, 3124254112); // IfcBuildingStorey type code
        // Actually use the correct type code for IfcBuildingStorey
        const IFCBUILDINGSTOREY = 3124254112;
        const actualStoreyIDs = ifcApi.GetLineIDsWithType(modelID, IFCBUILDINGSTOREY);
        
        for (let i = 0; i < actualStoreyIDs.size(); i++) {
          const storeyID = actualStoreyIDs.get(i);
          try {
            const storey = ifcApi.GetLine(modelID, storeyID);
            storeys.push({
              id: String(storeyID),
              name: storey.Name?.value || `층 ${i + 1}`,
              elevation: storey.Elevation?.value || 0,
              expressIDs: [],
            });
          } catch {}
        }
      } catch {}
      
      // 자재 목록 생성
      const materials: MaterialInfo[] = [];
      typeMap.forEach((expressIDs, typeCode) => {
        const typeName = IFC_TYPE_NAMES[typeCode] || `타입_${typeCode}`;
        const category = TYPE_CATEGORIES[typeCode] || "기타";
        
        materials.push({
          id: `${typeCode}`,
          typeCode,
          typeName,
          category,
          count: expressIDs.length,
          expressIDs,
          dimensions: "",
        });
      });
      
      ifcApi.CloseModel(modelID);
      
      // 모델 데이터 생성
      const processedModel: ProcessedModel = {
        id: cacheKey,
        fileName: file.name,
        meshCount: meshes.length,
        meshes,
        materials,
        storeys,
        spatialTree: null,
        createdAt: Date.now(),
        expiresAt: Date.now() + CACHE_TTL,
      };
      
      // 캐시 저장
      modelCache.set(cacheKey, processedModel);
      
      console.log(`✅ IFC 처리 완료: ${meshes.length}개 메시, ${materials.length}개 자재 타입`);
      
      return NextResponse.json({
        success: true,
        cached: false,
        model: processedModel,
      });
      
    } catch (wasmError) {
      console.error("WASM 처리 실패:", wasmError);
      return NextResponse.json(
        { error: "서버에서 IFC 처리 실패", details: String(wasmError) },
        { status: 500 }
      );
    }
    
  } catch (error) {
    console.error("API 에러:", error);
    return NextResponse.json(
      { error: "처리 중 오류가 발생했습니다" },
      { status: 500 }
    );
  }
}

// GET: 캐시된 모델 조회 또는 상태 확인
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const modelId = searchParams.get("id");
  
  if (modelId) {
    const cached = modelCache.get(modelId);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json({
        success: true,
        model: cached,
      });
    }
    return NextResponse.json(
      { error: "캐시된 모델을 찾을 수 없습니다" },
      { status: 404 }
    );
  }
  
  // 상태 확인
  return NextResponse.json({
    status: "ready",
    description: "IFC 서버 처리 API",
    cachedModels: modelCache.size,
    usage: {
      upload: "POST /api/convert (FormData with 'file')",
      retrieve: "GET /api/convert?id=xxx",
    },
    limits: {
      maxFileSize: "150MB",
      cacheTTL: "1시간",
    },
  });
}

// DELETE: 캐시 삭제
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const modelId = searchParams.get("id");
  
  if (modelId) {
    const deleted = modelCache.delete(modelId);
    return NextResponse.json({ success: deleted });
  }
  
  // 전체 캐시 삭제
  modelCache.clear();
  return NextResponse.json({ success: true, message: "전체 캐시 삭제됨" });
}

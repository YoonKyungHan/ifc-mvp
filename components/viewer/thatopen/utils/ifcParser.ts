// web-ifc를 사용한 IFC 데이터 파싱 유틸리티

import * as WebIFC from "web-ifc";
import { MaterialItem, StoreyInfo, IFCSpatialNode } from "../types";
import { getCategoryKoreanName, getUnitForCategory } from "./categoryMap";

// IFC 타입 코드 상수
const IFC_TYPES = {
  IFCWALL: 3512223829,
  IFCWALLSTANDARDCASE: 2058353004,
  IFCSLAB: 1529196076,
  IFCCOLUMN: 843113511,
  IFCBEAM: 753842376,
  IFCDOOR: 395920057,
  IFCWINDOW: 3304561284,
  IFCSTAIR: 4252922144,
  IFCSTAIRFLIGHT: 4124788165,
  IFCROOF: 2016517767,
  IFCRAILING: 2262370178,
  IFCCOVERING: 1973544240,
  IFCCURTAINWALL: 3495092785,
  IFCFURNISHINGELEMENT: 1091909220,
  IFCBUILDINGELEMENTPROXY: 1095909175,
  IFCMEMBER: 1073191201,
  IFCPLATE: 3171933400,
  IFCFOOTING: 900683007,
  IFCPILE: 1687234759,
  IFCSPACE: 3856911033,
  IFCBUILDINGSTOREY: 3124254112,
  IFCBUILDING: 4031249490,
  IFCSITE: 4097777520,
  IFCPROJECT: 103090709,
};

// 지오메트리가 있는 IFC 타입들
const GEOMETRY_TYPES = [
  IFC_TYPES.IFCWALL,
  IFC_TYPES.IFCWALLSTANDARDCASE,
  IFC_TYPES.IFCSLAB,
  IFC_TYPES.IFCCOLUMN,
  IFC_TYPES.IFCBEAM,
  IFC_TYPES.IFCDOOR,
  IFC_TYPES.IFCWINDOW,
  IFC_TYPES.IFCSTAIR,
  IFC_TYPES.IFCSTAIRFLIGHT,
  IFC_TYPES.IFCROOF,
  IFC_TYPES.IFCRAILING,
  IFC_TYPES.IFCCOVERING,
  IFC_TYPES.IFCCURTAINWALL,
  IFC_TYPES.IFCFURNISHINGELEMENT,
  IFC_TYPES.IFCBUILDINGELEMENTPROXY,
  IFC_TYPES.IFCMEMBER,
  IFC_TYPES.IFCPLATE,
  IFC_TYPES.IFCFOOTING,
  IFC_TYPES.IFCPILE,
];

/**
 * web-ifc API 초기화
 */
export async function initWebIFC(): Promise<WebIFC.IfcAPI> {
  console.log("🔧 web-ifc 초기화 시작...");
  const ifcApi = new WebIFC.IfcAPI();
  
  console.log("🔧 WASM 경로 설정: /wasm/");
  await ifcApi.SetWasmPath("/wasm/");
  
  console.log("🔧 web-ifc Init 호출...");
  await ifcApi.Init();
  
  console.log("✅ web-ifc 초기화 완료!");
  return ifcApi;
}

/**
 * IFC 파일에서 자재 정보 추출
 */
export async function extractMaterials(
  ifcApi: WebIFC.IfcAPI,
  modelID: number,
  onProgress?: (message: string, percent: number) => void
): Promise<{ materials: MaterialItem[], typeMap: Map<number, number[]> }> {
  console.log("📦 자재 추출 시작, modelID:", modelID);
  
  const materials: MaterialItem[] = [];
  const typeMap = new Map<number, number[]>();
  const materialMap = new Map<string, { count: number; expressIDs: number[]; typeCode: number }>();
  
  let processedTypes = 0;
  const totalTypes = GEOMETRY_TYPES.length;
  let totalElements = 0;
  
  for (const typeCode of GEOMETRY_TYPES) {
    try {
      const ids = ifcApi.GetLineIDsWithType(modelID, typeCode);
      if (ids.size() === 0) continue;
      
      totalElements += ids.size();
      console.log(`  📋 타입코드 ${typeCode}: ${ids.size()}개`);
      
      const typeName = getTypeNameFromCode(typeCode);
      const koreanName = getCategoryKoreanName(typeName);
      const expressIDs: number[] = [];
      
      for (let i = 0; i < ids.size(); i++) {
        const expressID = ids.get(i);
        expressIDs.push(expressID);
        
        // 타입 맵에 추가
        if (!typeMap.has(typeCode)) {
          typeMap.set(typeCode, []);
        }
        typeMap.get(typeCode)!.push(expressID);
      }
      
      // 속성에서 규격 정보 추출 (선택적)
      let spec = "-";
      if (expressIDs.length > 0) {
        try {
          const props = ifcApi.GetLine(modelID, expressIDs[0]);
          if (props?.ObjectType?.value) {
            spec = String(props.ObjectType.value);
          } else if (props?.Description?.value) {
            spec = String(props.Description.value);
          }
        } catch {}
      }
      
      // 동일 타입+규격으로 그룹화
      const key = `${koreanName}_${spec}`;
      if (!materialMap.has(key)) {
        materialMap.set(key, { count: 0, expressIDs: [], typeCode });
      }
      const info = materialMap.get(key)!;
      info.count += expressIDs.length;
      info.expressIDs.push(...expressIDs);
      
      processedTypes++;
      onProgress?.(`${koreanName} 처리 중...`, Math.round((processedTypes / totalTypes) * 100));
      
    } catch (err) {
      console.warn(`⚠️ 타입 ${typeCode} 처리 실패:`, err);
    }
  }
  
  // MaterialItem 배열 생성
  let idx = 0;
  for (const [key, info] of materialMap.entries()) {
    const [category, spec] = key.split('_');
    materials.push({
      id: `mat_${idx++}`,
      typeCode: info.typeCode,
      typeName: category,
      category: category,
      spec: spec || '-',
      count: info.count,
      unit: getUnitForCategory(category),
      totalArea: 0,
      expressIDs: info.expressIDs,
    });
  }
  
  // 카테고리별 정렬
  materials.sort((a, b) => a.category.localeCompare(b.category));
  
  console.log(`📦 자재 추출 완료: ${materials.length}개 자재, ${totalElements}개 요소`);
  console.log(`📦 typeMap 크기: ${typeMap.size}개 타입`);
  
  // typeMap 내용 확인
  typeMap.forEach((ids, typeCode) => {
    console.log(`  🔗 타입 ${typeCode}: ${ids.length}개 요소`);
  });
  
  return { materials, typeMap };
}

/**
 * IFC 파일에서 층 정보 추출
 */
export async function extractStoreys(
  ifcApi: WebIFC.IfcAPI,
  modelID: number
): Promise<StoreyInfo[]> {
  const storeys: StoreyInfo[] = [];
  
  try {
    const ids = ifcApi.GetLineIDsWithType(modelID, IFC_TYPES.IFCBUILDINGSTOREY);
    
    for (let i = 0; i < ids.size(); i++) {
      const expressID = ids.get(i);
      const props = ifcApi.GetLine(modelID, expressID);
      
      storeys.push({
        id: `storey_${i}`,
        expressID,
        name: props?.Name?.value || `층 ${i + 1}`,
        elevation: props?.Elevation?.value || 0,
        expressIDs: [], // 해당 층 요소들 (나중에 채움)
      });
    }
    
    // 높이순 정렬
    storeys.sort((a, b) => a.elevation - b.elevation);
    
  } catch (err) {
    console.warn("⚠️ 층 정보 추출 실패:", err);
  }
  
  return storeys;
}

/**
 * IFC 파일에서 공간 트리 추출
 */
export async function extractSpatialTree(
  ifcApi: WebIFC.IfcAPI,
  modelID: number
): Promise<IFCSpatialNode | null> {
  try {
    const projectIds = ifcApi.GetLineIDsWithType(modelID, IFC_TYPES.IFCPROJECT);
    if (projectIds.size() === 0) return null;
    
    const projectId = projectIds.get(0);
    const projectProps = ifcApi.GetLine(modelID, projectId);
    
    return {
      expressID: projectId,
      name: projectProps?.Name?.value || 'Project',
      type: 'IfcProject',
      typeCode: IFC_TYPES.IFCPROJECT,
      children: [], // 하위 구조는 필요시 확장
    };
  } catch (err) {
    console.warn("⚠️ 공간 트리 추출 실패:", err);
    return null;
  }
}

/**
 * 특정 요소의 속성 가져오기
 */
export function getElementProperties(
  ifcApi: WebIFC.IfcAPI,
  modelID: number,
  expressID: number
): Record<string, unknown> {
  try {
    const props = ifcApi.GetLine(modelID, expressID, true);
    return props || {};
  } catch (err) {
    console.warn(`⚠️ 속성 조회 실패 (ID: ${expressID}):`, err);
    return {};
  }
}

/**
 * 타입 코드에서 타입 이름 반환
 */
function getTypeNameFromCode(typeCode: number): string {
  for (const [name, code] of Object.entries(IFC_TYPES)) {
    if (code === typeCode) return name;
  }
  return `TYPE_${typeCode}`;
}

/**
 * web-ifc 정리
 */
export function disposeWebIFC(ifcApi: WebIFC.IfcAPI, modelID: number): void {
  try {
    ifcApi.CloseModel(modelID);
  } catch {}
}

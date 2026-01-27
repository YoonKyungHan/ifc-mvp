// IFC 요소 타입 정의
export interface IFCElement {
  expressID: number;
  type: string;
  typeCode: number;
  name?: string;
  description?: string;
  properties: IFCProperty[];
}

export interface IFCProperty {
  name: string;
  value: string | number | boolean | null;
  type?: string;
}

// 선택된 요소들의 집계 정보
export interface SelectionSummary {
  type: string;
  typeCode: number;
  count: number;
  elements: IFCElement[];
  dimensions?: {
    totalLength?: number;
    totalArea?: number;
    totalVolume?: number;
  };
}

// 요소 규격 정보
export interface ElementDimensions {
  width: number;   // mm
  height: number;  // mm
  depth: number;   // mm
  volume?: number; // m³
  area?: number;   // m²
  ifcSpec?: string; // IFC 속성에서 가져온 규격 문자열
}

// 자재 목록 아이템 (타입 + 규격 조합)
export interface MaterialItem {
  id: string;           // 고유 키 (typeCode_spec)
  typeCode: number;
  typeName: string;
  category: string;
  spec: string;         // 규격 문자열 (예: "300×200×2700")
  count: number;
  unit: string;
  expressIDs: number[];
  dimensions?: ElementDimensions;
}

// 층 정보
export interface StoreyInfo {
  id: string;
  name: string;
  elevation: number; // 높이 (m)
  expressIDs: number[]; // 해당 층에 속한 요소들
}

// IFC 공간 구조 트리 노드
export interface IFCSpatialNode {
  expressID: number;
  name: string;
  type: string;
  typeCode: number;
  children: IFCSpatialNode[];
  elements: number[]; // 해당 공간에 포함된 요소들의 expressID
}

// IFC 타입 코드 (공간 구조용)
export const IFC_SPATIAL_TYPES = {
  IFCPROJECT: 103090709,
  IFCSITE: 4097777520,
  IFCBUILDING: 4031249490,
  IFCBUILDINGSTOREY: 3124254112,
  IFCSPACE: 3856911033,
  // 관계
  IFCRELAGGREGATES: 160246688,
  IFCRELCONTAINEDINSPATIALSTRUCTURE: 3242617779,
} as const;

export interface IFCModel {
  id: string;
  name: string;
  elements: IFCElement[];
  modelID: number;
}

export interface ViewerState {
  isLoading: boolean;
  error: string | null;
  selectedElements: IFCElement[];
  model: IFCModel | null;
}

export interface CameraPosition {
  position: [number, number, number];
  target: [number, number, number];
}

export type ViewPreset = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'isometric';

// IFC 타입 코드 매핑
export const IFC_TYPE_NAMES: Record<number, string> = {
  // 벽
  45: "벽",
  46: "벽",
  // 슬라브
  1529196076: "슬라브",
  // 기둥
  843113511: "기둥",
  // 보
  753842376: "보",
  // 문
  395920057: "문",
  // 창문
  3304561284: "창문",
  // 계단
  331165859: "계단",
  // 지붕
  2016517767: "지붕",
  // 난간
  2262370178: "난간",
  // 가구
  263784265: "가구",
  // 판
  3171933400: "판",
  // 부재
  1073191201: "부재",
  // 피복
  1973544240: "피복",
  // 기초
  900683007: "기초",
};

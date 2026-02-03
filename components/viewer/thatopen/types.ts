// ThatOpen Viewer 타입 정의

import * as THREE from "three";
import * as OBC from "@thatopen/components";

// 자재 아이템 (Sidebar 호환)
export interface MaterialItem {
  id: string;
  typeCode: number;
  typeName: string;
  category: string;
  spec: string;
  count: number;
  unit: string;
  totalArea: number;
  expressIDs: number[];
}

// 층 정보 (Sidebar StoreyFilter 호환)
export interface StoreyInfo {
  id: string;
  expressID: number;
  name: string;
  elevation: number;
  expressIDs: number[]; // 해당 층에 속한 요소들
}

// IFC 공간 트리 노드
export interface IFCSpatialNode {
  expressID: number;
  name: string;
  type: string;
  typeCode: number;
  children: IFCSpatialNode[];
}

// 선택된 객체 정보
export interface SelectedObjectInfo {
  expressID: number;
  typeCode: number;
  typeName: string;
  category: string;
  materialName?: string;
  properties?: Record<string, unknown>;
}

// Components 상태
export interface ComponentsState {
  components: OBC.Components | null;
  world: OBC.SimpleWorld<OBC.SimpleScene, OBC.SimpleCamera, OBC.SimpleRenderer> | null;
  fragments: OBC.FragmentsManager | null;
  ifcLoader: OBC.IfcLoader | null;
  isReady: boolean;
}

// 뷰어 설정
export interface ViewerSettings {
  isDarkMode: boolean;
  showEdges: boolean;
  xrayMode: boolean;
  showSidebar: boolean;
}

// 모델 상태
export interface ModelState {
  hasModel: boolean;
  isLoading: boolean;
  progress: number;
  loadingMessage: string;
  error: string | null;
}

// 선택 상태
export interface SelectionState {
  selectedCount: number;
  selectedExpressIDs: number[];
  selectedMaterialId: string | null;
  tableHighlightedIDs: number[];
}

// IFC 카테고리 매핑
export const IFC_CATEGORY_MAP: Record<string, string> = {
  'IFCWALL': '벽',
  'IFCWALLSTANDARDCASE': '벽',
  'IFCSLAB': '슬라브',
  'IFCCOLUMN': '기둥',
  'IFCBEAM': '보',
  'IFCDOOR': '문',
  'IFCWINDOW': '창문',
  'IFCSTAIR': '계단',
  'IFCSTAIRFLIGHT': '계단',
  'IFCRAILING': '난간',
  'IFCROOF': '지붕',
  'IFCCOVERING': '마감재',
  'IFCFURNISHINGELEMENT': '가구',
  'IFCBUILDINGELEMENTPROXY': '부재',
  'IFCMEMBER': '부재',
  'IFCPLATE': '판',
  'IFCFOOTING': '기초',
  'IFCPILE': '파일',
  'IFCCURTAINWALL': '커튼월',
  'IFCSPACE': '공간',
  'IFCBUILDINGSTOREY': '층',
  'IFCBUILDING': '건물',
  'IFCSITE': '대지',
  'IFCPROJECT': '프로젝트',
};

// 카테고리별 단위
export const CATEGORY_UNIT_MAP: Record<string, string> = {
  '벽': 'm²',
  '슬라브': 'm²',
  '지붕': 'm²',
  '마감재': 'm²',
  '커튼월': 'm²',
  '기둥': '개',
  '보': 'm',
  '문': '개',
  '창문': '개',
  '계단': '개',
  '난간': 'm',
  '가구': '개',
  '판': 'm²',
  '부재': '개',
  '기초': '개',
  '파일': '개',
  '공간': 'm²',
};

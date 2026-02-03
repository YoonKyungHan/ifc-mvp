// IFC 카테고리 매핑 유틸리티

import { IFC_CATEGORY_MAP, CATEGORY_UNIT_MAP } from "../types";

/**
 * IFC 카테고리 이름을 한글로 변환
 */
export function getCategoryKoreanName(ifcCategory: string): string {
  const upper = ifcCategory.toUpperCase();
  return IFC_CATEGORY_MAP[upper] || ifcCategory;
}

/**
 * 카테고리에 따른 단위 반환
 */
export function getUnitForCategory(category: string): string {
  return CATEGORY_UNIT_MAP[category] || '개';
}

/**
 * 재질 이름에서 카테고리 추정
 */
export function getCategoryFromMaterialName(name: string): string {
  const lowerName = name.toLowerCase();
  
  if (lowerName.includes('wall') || lowerName.includes('벽')) return '벽';
  if (lowerName.includes('slab') || lowerName.includes('슬라브') || lowerName.includes('floor') || lowerName.includes('바닥')) return '슬라브';
  if (lowerName.includes('column') || lowerName.includes('기둥')) return '기둥';
  if (lowerName.includes('beam') || lowerName.includes('보')) return '보';
  if (lowerName.includes('door') || lowerName.includes('문')) return '문';
  if (lowerName.includes('window') || lowerName.includes('창')) return '창문';
  if (lowerName.includes('stair') || lowerName.includes('계단')) return '계단';
  if (lowerName.includes('roof') || lowerName.includes('지붕')) return '지붕';
  if (lowerName.includes('railing') || lowerName.includes('난간')) return '난간';
  if (lowerName.includes('furniture') || lowerName.includes('가구')) return '가구';
  if (lowerName.includes('covering') || lowerName.includes('마감')) return '마감재';
  if (lowerName.includes('footing') || lowerName.includes('기초')) return '기초';
  if (lowerName.includes('curtain') || lowerName.includes('커튼')) return '커튼월';
  if (lowerName.includes('concrete') || lowerName.includes('콘크리트')) return '콘크리트';
  if (lowerName.includes('steel') || lowerName.includes('철골')) return '철골';
  if (lowerName.includes('glass') || lowerName.includes('유리')) return '유리';
  
  return '기타';
}

/**
 * IFC 타입 코드에서 한글 카테고리 추출
 */
export function getCategoryFromTypeCode(typeCode: number): string {
  // IFC 타입 코드 범위에 따른 분류 (web-ifc 기준)
  const typeCodeMap: Record<number, string> = {
    // 벽 관련
    3512223829: '벽',           // IFCWALL
    2058353004: '벽',           // IFCWALLSTANDARDCASE
    // 슬라브
    1529196076: '슬라브',       // IFCSLAB
    // 기둥
    843113511: '기둥',          // IFCCOLUMN
    // 보
    753842376: '보',            // IFCBEAM
    // 문
    395920057: '문',            // IFCDOOR
    // 창문
    3304561284: '창문',         // IFCWINDOW
    // 계단
    4252922144: '계단',         // IFCSTAIR
    4124788165: '계단',         // IFCSTAIRFLIGHT
    // 지붕
    2016517767: '지붕',         // IFCROOF
    // 난간
    2262370178: '난간',         // IFCRAILING
    // 마감재
    1973544240: '마감재',       // IFCCOVERING
    // 커튼월
    3495092785: '커튼월',       // IFCCURTAINWALL
  };
  
  return typeCodeMap[typeCode] || '기타';
}

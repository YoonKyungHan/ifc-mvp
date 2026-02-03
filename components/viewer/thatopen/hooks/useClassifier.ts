// Classifier Hook - ThatOpen Components Classifier 사용
// https://docs.thatopen.com/Tutorials/Components/Core/Classifier

import { useCallback, useRef, useState } from "react";
import * as OBC from "@thatopen/components";
import { MaterialItem, StoreyInfo } from "../types";
import { getCategoryKoreanName, getUnitForCategory } from "../utils/categoryMap";

interface ClassificationGroup {
  name: string;
  items: Map<string, Set<number>>; // modelId -> Set<expressID>
}

interface ClassifierState {
  categories: Map<string, ClassificationGroup>;
  storeys: Map<string, ClassificationGroup>;
  materials: MaterialItem[];
  storeyList: StoreyInfo[];
  isLoading: boolean;
}

export function useClassifier(componentsRef: React.RefObject<OBC.Components | null>) {
  const [state, setState] = useState<ClassifierState>({
    categories: new Map(),
    storeys: new Map(),
    materials: [],
    storeyList: [],
    isLoading: false,
  });
  
  const classifierRef = useRef<OBC.Classifier | null>(null);
  const typeToExpressIDsRef = useRef<Map<number, number[]>>(new Map());
  
  // Classifier 초기화 및 분류 실행
  const classifyModel = useCallback(async () => {
    const components = componentsRef.current;
    if (!components) {
      console.warn("⚠️ Components가 초기화되지 않음");
      return;
    }
    
    setState(prev => ({ ...prev, isLoading: true }));
    
    try {
      console.log("📊 Classifier 분류 시작...");
      
      // Classifier 가져오기
      const classifier = components.get(OBC.Classifier);
      classifierRef.current = classifier;
      
      // 1. 카테고리별 분류
      console.log("  📁 카테고리별 분류 중...");
      await classifier.byCategory();
      
      // 2. 층별 분류
      console.log("  🏢 층별 분류 중...");
      await classifier.byIfcBuildingStorey({ classificationName: "Levels" });
      
      // 분류 결과 가져오기
      const categories = new Map<string, ClassificationGroup>();
      const storeys = new Map<string, ClassificationGroup>();
      
      // MaterialItem 배열 생성
      const materials: MaterialItem[] = [];
      const typeMap = new Map<number, number[]>();
      let materialIndex = 0;
      
      for (const [classificationName, groups] of classifier.list) {
        console.log(`  📋 분류 "${classificationName}":`, [...groups.keys()]);
        
        if (classificationName === "Levels") {
          // 층 정보
          for (const [groupName] of groups) {
            storeys.set(groupName, {
              name: groupName,
              items: new Map(),
            });
          }
        } else {
          // 카테고리 정보 (Categories, entities 등)
          for (const [groupName, groupData] of groups) {
            categories.set(groupName, {
              name: groupName,
              items: new Map(),
            });
            
            // 카테고리 데이터 추출
            try {
              const modelIdMap = await groupData.get();
              let totalCount = 0;
              const allExpressIDs: number[] = [];
              
              // modelIdMap: { modelId: Set<expressID> }
              if (modelIdMap) {
                for (const [, idSet] of Object.entries(modelIdMap)) {
                  if (idSet instanceof Set) {
                    totalCount += idSet.size;
                    idSet.forEach((id) => {
                      if (typeof id === 'number') {
                        allExpressIDs.push(id);
                      }
                    });
                  }
                }
              }
              
              if (totalCount > 0) {
                const koreanName = getCategoryKoreanName(groupName);
                const unit = getUnitForCategory(koreanName);
                const typeCode = categoryNameToTypeCode(groupName);
                
                materials.push({
                  id: `mat_${materialIndex++}`,
                  typeCode,
                  typeName: groupName,
                  category: koreanName,
                  spec: "-",
                  count: totalCount,
                  unit,
                  totalArea: 0,
                  expressIDs: allExpressIDs,
                });
                
                // typeMap에 추가
                if (!typeMap.has(typeCode)) {
                  typeMap.set(typeCode, []);
                }
                typeMap.get(typeCode)!.push(...allExpressIDs);
              }
            } catch (err) {
              // 조용히 무시 (성능 위해)
            }
          }
        }
      }
      
      // 카테고리별 정렬
      materials.sort((a, b) => a.category.localeCompare(b.category));
      
      // typeMap 저장
      typeToExpressIDsRef.current = typeMap;
      
      // 층 목록 생성 - Classifier API에서 직접 가져오기
      const storeyList: StoreyInfo[] = [];
      let storeyIndex = 0;
      
      const levelsClassification = classifier.list.get("Levels");
      if (levelsClassification) {
        for (const [storeyName, storeyGroupData] of levelsClassification) {
          // 층 데이터에서 expressIDs 추출
          let storeyExpressIDs: number[] = [];
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const storeyModelIdMap = await (storeyGroupData as any).get();
            if (storeyModelIdMap) {
              for (const [, idSet] of Object.entries(storeyModelIdMap)) {
                if (idSet instanceof Set) {
                  idSet.forEach((id) => {
                    if (typeof id === 'number') {
                      storeyExpressIDs.push(id);
                    }
                  });
                }
              }
            }
          } catch {}
          
          storeyList.push({
            id: `storey_${storeyIndex}`,
            expressID: storeyIndex,
            name: storeyName,
            elevation: storeyIndex * 3, // 기본 층고 3m 가정
            expressIDs: storeyExpressIDs,
          });
          storeyIndex++;
        }
      }
      
      console.log(`✅ Classifier 분류 완료: ${materials.length}개 카테고리, ${storeyList.length}개 층`);
      console.log(`✅ typeMap: ${typeMap.size}개 타입`);
      
      setState({
        categories,
        storeys,
        materials,
        storeyList,
        isLoading: false,
      });
      
    } catch (err) {
      console.error("❌ Classifier 분류 실패:", err);
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, [componentsRef]);
  
  // 특정 분류 그룹의 아이템 격리 (Hider 사용)
  const isolateGroup = useCallback(async (classificationName: string, groupName: string) => {
    const components = componentsRef.current;
    const classifier = classifierRef.current;
    
    if (!components || !classifier) return;
    
    try {
      const groupData = classifier.list.get(classificationName)?.get(groupName);
      if (!groupData) {
        console.warn(`⚠️ 그룹 "${classificationName}/${groupName}" 없음`);
        return;
      }
      
      const modelIdMap = await groupData.get();
      const hider = components.get(OBC.Hider);
      await hider.isolate(modelIdMap);
      
      console.log(`✅ 격리됨: ${classificationName}/${groupName}`);
    } catch (err) {
      console.error("❌ 격리 실패:", err);
    }
  }, [componentsRef]);
  
  // 가시성 리셋
  const resetVisibility = useCallback(async () => {
    const components = componentsRef.current;
    if (!components) return;
    
    try {
      const hider = components.get(OBC.Hider);
      await hider.set(true);
      console.log("✅ 가시성 리셋됨");
    } catch (err) {
      console.error("❌ 가시성 리셋 실패:", err);
    }
  }, [componentsRef]);
  
  // 분류 초기화
  const clearClassification = useCallback(() => {
    setState({
      categories: new Map(),
      storeys: new Map(),
      materials: [],
      storeyList: [],
      isLoading: false,
    });
    typeToExpressIDsRef.current = new Map();
  }, []);
  
  return {
    ...state,
    typeToExpressIDsRef,
    classifyModel,
    isolateGroup,
    resetVisibility,
    clearClassification,
  };
}

// 카테고리 이름에서 IFC 타입 코드 추정
function categoryNameToTypeCode(categoryName: string): number {
  const typeCodeMap: { [key: string]: number } = {
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
  };
  
  const upperName = categoryName.toUpperCase();
  return typeCodeMap[upperName] || 0;
}

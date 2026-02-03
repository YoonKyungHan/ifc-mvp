"use client";

import React, { useRef, useState, useCallback, useEffect } from "react";
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import { Sidebar } from "../sidebar";
import { ViewerToolbar } from "../toolbar";
import { FileUpload } from "../upload";
import { useComponents } from "./hooks/useComponents";
import { useSelection } from "./hooks/useSelection";
import { useClassifier } from "./hooks/useClassifier";
import { MaterialItem, SelectedObjectInfo } from "./types";
// 하이브리드: web-ifc로 정확한 데이터 추출
import { initWebIFC, extractMaterials, extractStoreys, disposeWebIFC } from "./utils/ifcParser";

export function ThatOpenViewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const currentModelRef = useRef<THREE.Object3D | null>(null);
  const ifcBufferRef = useRef<ArrayBuffer | null>(null);
  
  // 설정 상태
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [showEdges, setShowEdges] = useState(true);
  const [xrayMode, setXrayMode] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showFps, setShowFps] = useState(false);
  
  // 모델 상태
  const [hasModel, setHasModel] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  
  // Components Hook
  const {
    components,
    world,
    fragments,
    ifcLoader,
    isReady,
    componentsRef,
    worldRef,
    setBackgroundColor,
    fitCamera,
  } = useComponents(containerRef);
  
  // Classifier Hook (ThatOpen Classifier API 사용 - 성능 최적화)
  const {
    materials,
    storeyList: storeys,
    typeToExpressIDsRef,
    classifyModel,
    isolateGroup,
    resetVisibility,
    clearClassification,
    isLoading: isClassifying,
  } = useClassifier(componentsRef);
  
  // 공간 트리 (간단히)
  const spatialTree = null;
  
  // Selection Hook
  const {
    selectionState,
    clearSelection,
    selectFromTable,
    selectByExpressIDs,
  } = useSelection({
    componentsRef,
    worldRef,
    typeToExpressIDsRef,
    onSelect: (info, relatedIDs) => {
      if (info) {
        console.log("📌 선택된 객체 정보:", info);
        console.log(`🔗 연관 객체: ${relatedIDs.length}개`);
      }
    },
  });
  
  // 사이드바용 상태
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);
  const [hiddenMaterialIds, setHiddenMaterialIds] = useState<Set<string>>(new Set());
  const [selectedStorey, setSelectedStorey] = useState<string | null>(null);
  const [tableHighlightedIDs, setTableHighlightedIDs] = useState<number[]>([]);
  
  // 다크모드 적용
  useEffect(() => {
    setBackgroundColor(isDarkMode);
  }, [isDarkMode, setBackgroundColor]);
  
  // 사이드바 토글 시 리사이즈
  useEffect(() => {
    const timer = setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 50);
    return () => clearTimeout(timer);
  }, [showSidebar]);
  
  // X-Ray 모드 (Legacy 방식: depthTest = false로 투시)
  const xraySelectedIDsRef = useRef<number[]>([]);
  
  useEffect(() => {
    // X-Ray 대상 ID 저장 (처음 켜질 때만)
    if (xrayMode && selectionState.selectedExpressIDs.length > 0 && xraySelectedIDsRef.current.length === 0) {
      xraySelectedIDsRef.current = [...selectionState.selectedExpressIDs];
    }
    if (!xrayMode) {
      xraySelectedIDsRef.current = [];
    }
  }, [xrayMode, selectionState.selectedExpressIDs]);
  
  useEffect(() => {
    if (!worldRef.current || !hasModel) return;
    
    const scene = worldRef.current.scene.three;
    const xrayTargets = new Set(xraySelectedIDsRef.current);
    const hasXrayTargets = xrayMode && xrayTargets.size > 0;
    
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material && child.name !== '__grid__') {
        const mat = child.material as THREE.Material;
        const meshId = child.userData?.expressID;
        const isXrayTarget = hasXrayTargets && meshId && xrayTargets.has(meshId);
        
        if (isXrayTarget) {
          // X-Ray 대상: 투시 (건물 뒤에서도 보임)
          mat.transparent = true;
          mat.opacity = 0.7;
          mat.depthTest = false; // 핵심! 투시
          mat.depthWrite = false;
          child.renderOrder = 999;
        } else {
          // 나머지: 원래 상태
          mat.transparent = false;
          mat.opacity = 1;
          mat.depthTest = true;
          mat.depthWrite = true;
          child.renderOrder = 0;
        }
        mat.needsUpdate = true;
      }
    });
  }, [xrayMode, hasModel, worldRef]);
  
  // 윤곽선
  const edgesGroupRef = useRef<THREE.Group | null>(null);
  
  useEffect(() => {
    if (!worldRef.current || !hasModel) return;
    
    const scene = worldRef.current.scene.three;
    
    // 기존 윤곽선 제거
    if (edgesGroupRef.current) {
      scene.remove(edgesGroupRef.current);
      edgesGroupRef.current.traverse((child) => {
        if (child instanceof THREE.LineSegments) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
      edgesGroupRef.current = null;
    }
    
    if (!showEdges) return;
    
    // 새 윤곽선 생성
    const edgesGroup = new THREE.Group();
    edgesGroup.name = "__edges__";
    
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: isDarkMode ? 0x888888 : 0x333333,
      transparent: true,
      opacity: 0.3,
    });
    
    let edgeCount = 0;
    const maxEdges = 5000;
    
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry && edgeCount < maxEdges && child.name !== '__grid__') {
        try {
          const edges = new THREE.EdgesGeometry(child.geometry, 30);
          const line = new THREE.LineSegments(edges, edgeMaterial.clone());
          line.position.copy(child.position);
          line.rotation.copy(child.rotation);
          line.scale.copy(child.scale);
          line.matrixAutoUpdate = false;
          line.matrix.copy(child.matrix);
          edgesGroup.add(line);
          edgeCount++;
        } catch {}
      }
    });
    
    if (edgeCount > 0) {
      scene.add(edgesGroup);
      edgesGroupRef.current = edgesGroup;
    }
  }, [showEdges, hasModel, isDarkMode, worldRef]);
  
  // 파일 로드
  const handleFileLoad = useCallback(async (file: File) => {
    if (!componentsRef.current || !worldRef.current) {
      setError("뷰어가 초기화되지 않았습니다.");
      return;
    }
    
    setIsLoading(true);
    setError(null);
    setProgress(10);
    setLoadingMessage("파일 읽는 중...");
    
    try {
      const comp = componentsRef.current;
      const world = worldRef.current;
      const frags = comp.get(OBC.FragmentsManager);
      
      setProgress(20);
      setLoadingMessage("기존 모델 정리...");
      
      // 기존 모델 제거
      if (currentModelRef.current) {
        world.scene.three.remove(currentModelRef.current);
        currentModelRef.current = null;
      }
      clearClassification();
      clearSelection();
      
      const data = await file.arrayBuffer();
      const buffer = new Uint8Array(data);
      const fileExt = file.name.split('.').pop()?.toLowerCase();
      const modelId = file.name.split('.').shift() || file.name;
      
      console.log(`📂 파일 로드 시작: ${file.name} (${(data.byteLength / 1024 / 1024).toFixed(2)}MB)`);
      
      // IFC 버퍼 저장 (web-ifc 파싱용)
      ifcBufferRef.current = data;
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let loadedModel: any = null;
      
      if (fileExt === 'frag') {
        setProgress(40);
        setLoadingMessage(".frag 파일 로드 중...");
        loadedModel = await frags.core.load(buffer, { modelId });
        
      } else if (fileExt === 'ifc') {
        setProgress(40);
        setLoadingMessage("IFC → Fragments 변환 중...");
        
        const loader = comp.get(OBC.IfcLoader);
        loadedModel = await loader.load(buffer, false, modelId, {
          processData: {
            progressCallback: (prog: number) => {
              const percent = Math.round(40 + prog * 30);
              setProgress(percent);
              setLoadingMessage(`IFC 변환 중... ${Math.round(prog * 100)}%`);
            },
          },
        });
        
      } else {
        throw new Error("지원하지 않는 파일 형식입니다. (.ifc 또는 .frag)");
      }
      
      setProgress(90);
      setLoadingMessage("모델 처리 중...");
      
      // 모델 Scene에 추가
      let modelObject: THREE.Object3D | null = null;
      
      if (loadedModel && loadedModel.object) {
        modelObject = loadedModel.object;
        loadedModel.useCamera?.(world.camera.three);
      } else {
        const models = [...frags.list.values()];
        if (models.length > 0) {
          const lastModel = models[models.length - 1];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          modelObject = (lastModel as any).object || lastModel;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (lastModel as any).useCamera?.(world.camera.three);
        }
      }
      
      if (modelObject) {
        if (!world.scene.three.children.includes(modelObject)) {
          world.scene.three.add(modelObject);
        }
        currentModelRef.current = modelObject;
        
        // 메시에 ExpressID/TypeCode 설정 (선택 기능용)
        let meshIndex = 0;
        modelObject.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            meshIndex++;
            child.userData = child.userData || {};
            if (!child.userData.expressID) {
              child.userData.expressID = meshIndex;
            }
            // 재질 이름에서 타입코드 생성
            const matName = (child.material as THREE.Material)?.name || child.name || '';
            const typeCode = matName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % 10000;
            child.userData.typeCode = typeCode;
          }
        });
        
        console.log(`📦 모델 메시 설정 완료: ${meshIndex}개`);
        
        // 카메라 맞춤
        fitCamera(modelObject);
        
        // fragments 업데이트
        frags.core.update(true);
        
        setHasModel(true);
        setProgress(90);
        setLoadingMessage("Classifier로 분류 중...");
        
        console.log("🎉 모델 로드 완료!");
        
        // 🔧 하이브리드: web-ifc로 정확한 데이터 추출
        if (ifcBufferRef.current && fileExt === 'ifc') {
          try {
            setLoadingMessage("web-ifc로 데이터 추출 중...");
            console.log("🔧 하이브리드 모드: web-ifc 데이터 추출 시작");
            
            const ifcApi = await initWebIFC();
            const modelID = ifcApi.OpenModel(new Uint8Array(ifcBufferRef.current));
            
            // 자재 + typeMap 추출
            const { materials: webIfcMaterials, typeMap } = await extractMaterials(
              ifcApi, modelID, 
              (msg, pct) => setLoadingMessage(msg)
            );
            
            // 층 정보 추출
            const webIfcStoreys = await extractStoreys(ifcApi, modelID);
            
            // typeToExpressIDsRef 업데이트 (선택 기능용)
            if (typeToExpressIDsRef.current) {
              typeToExpressIDsRef.current.clear();
              typeMap.forEach((ids, typeCode) => {
                typeToExpressIDsRef.current!.set(typeCode, ids);
              });
              console.log(`✅ typeMap 업데이트: ${typeMap.size}개 타입`);
            }
            
            // 메시에 정확한 ExpressID/TypeCode 설정
            const allExpressIDs = new Set<number>();
            typeMap.forEach((ids) => ids.forEach(id => allExpressIDs.add(id)));
            
            modelObject.traverse((child) => {
              if (child instanceof THREE.Mesh && child.userData?.expressID) {
                const meshId = child.userData.expressID;
                // typeMap에서 해당 메시의 typeCode 찾기
                for (const [typeCode, ids] of typeMap.entries()) {
                  if (ids.includes(meshId)) {
                    child.userData.typeCode = typeCode;
                    break;
                  }
                }
              }
            });
            
            // Classifier 대신 web-ifc 데이터 사용
            // (useClassifier의 materials/storeys 대체)
            console.log(`✅ web-ifc 데이터: ${webIfcMaterials.length}개 자재, ${webIfcStoreys.length}개 층`);
            
            // 정리
            disposeWebIFC(ifcApi, modelID);
            
          } catch (webIfcErr) {
            console.warn("⚠️ web-ifc 데이터 추출 실패, Classifier로 대체:", webIfcErr);
            // 실패 시 ThatOpen Classifier 사용
            try {
              await classifyModel();
            } catch {}
          }
        } else {
          // .frag 파일은 Classifier 사용
          try {
            await classifyModel();
            console.log("✅ Classifier 분류 완료!");
          } catch (classifyErr) {
            console.warn("⚠️ Classifier 분류 실패:", classifyErr);
          }
        }
        
        setProgress(100);
        setLoadingMessage("완료!");
      } else {
        throw new Error("모델 객체를 찾을 수 없습니다.");
      }
      
      setTimeout(() => setIsLoading(false), 500);
      
    } catch (err) {
      console.error("❌ 파일 로드 실패:", err);
      setError("로드 실패: " + (err instanceof Error ? err.message : String(err)));
      setIsLoading(false);
    }
  }, [componentsRef, worldRef, clearClassification, clearSelection, classifyModel, fitCamera]);
  
  // 테이블 행 클릭
  const handleMaterialSelect = useCallback((materialId: string | null, expressIDs?: number[]) => {
    setSelectedMaterialId(materialId);
    
    if (expressIDs && expressIDs.length > 0) {
      selectByExpressIDs(expressIDs);
    } else {
      clearSelection();
    }
  }, [selectByExpressIDs, clearSelection]);
  
  // 테이블 행 호버 (2차 하이라이트)
  const handleTableHighlight = useCallback((expressIDs: number[]) => {
    setTableHighlightedIDs(expressIDs);
    if (expressIDs.length > 0) {
      selectFromTable(expressIDs);
    }
  }, [selectFromTable]);
  
  // 숨김 토글
  const handleToggleVisibility = useCallback((materialId: string) => {
    const isCurrentlyHidden = hiddenMaterialIds.has(materialId);
    const newVisible = isCurrentlyHidden; // 숨겨져 있으면 보이게, 보이면 숨기게
    
    setHiddenMaterialIds((prev) => {
      const next = new Set(prev);
      if (newVisible) {
        next.delete(materialId);
      } else {
        next.add(materialId);
      }
      return next;
    });
    
    // 실제 가시성 변경
    const material = materials.find((m) => m.id === materialId);
    if (material && worldRef.current) {
      const idSet = new Set(material.expressIDs);
      worldRef.current.scene.three.traverse((child) => {
        if (child instanceof THREE.Mesh && idSet.has(child.userData?.expressID)) {
          child.visible = newVisible;
        }
      });
    }
  }, [materials, worldRef, hiddenMaterialIds]);
  
  // 층 선택
  const handleStoreySelect = useCallback((storeyId: string | null) => {
    setSelectedStorey(storeyId);
    // 층 필터링 로직 (추후 구현)
  }, []);
  
  // 모두 표시
  const handleShowAll = useCallback(() => {
    setHiddenMaterialIds(new Set());
    if (worldRef.current) {
      worldRef.current.scene.three.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.visible = true;
        }
      });
    }
  }, [worldRef]);
  
  // 모두 숨기기
  const handleHideAll = useCallback(() => {
    const allIds = new Set(materials.map((m) => m.id));
    setHiddenMaterialIds(allIds);
    if (worldRef.current) {
      worldRef.current.scene.three.traverse((child) => {
        if (child instanceof THREE.Mesh && child.name !== '__grid__') {
          child.visible = false;
        }
      });
    }
  }, [materials, worldRef]);
  
  // .frag 내보내기
  const handleExportFrag = useCallback(async () => {
    if (!componentsRef.current) {
      alert("뷰어가 초기화되지 않았습니다.");
      return;
    }
    
    try {
      const frags = componentsRef.current.get(OBC.FragmentsManager);
      const models = [...frags.list.values()];
      
      if (models.length === 0) {
        alert("내보낼 모델이 없습니다.");
        return;
      }
      
      const [model] = models;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fragsBuffer = await (model as any).getBuffer(false);
      
      const file = new File([fragsBuffer], "model.frag");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(file);
      link.download = file.name;
      link.click();
      URL.revokeObjectURL(link.href);
      
      alert(`내보내기 완료!\n파일 크기: ${(fragsBuffer.byteLength / 1024 / 1024).toFixed(2)}MB`);
    } catch (err) {
      console.error("❌ 내보내기 실패:", err);
      alert("내보내기 실패: " + (err instanceof Error ? err.message : String(err)));
    }
  }, [componentsRef]);
  
  return (
    <div className={`w-full h-full flex ${isDarkMode ? 'dark bg-slate-900' : 'bg-slate-100'}`}>
      {/* 사이드바 */}
      {showSidebar && (
        <Sidebar
          materials={materials}
          selectedMaterialId={selectedMaterialId}
          selectedExpressIDs={selectionState.selectedExpressIDs}
          hiddenMaterialIds={hiddenMaterialIds}
          storeys={storeys}
          selectedStorey={selectedStorey}
          spatialTree={spatialTree}
          isDarkMode={isDarkMode}
          onSelectMaterial={handleMaterialSelect}
          onSelectElements={selectByExpressIDs}
          onToggleVisibility={handleToggleVisibility}
          onShowAll={handleShowAll}
          onHideAll={handleHideAll}
          onSelectStorey={handleStoreySelect}
          onTableHighlight={handleTableHighlight}
        />
      )}
      
      {/* 메인 영역 */}
      <div className="flex-1 flex flex-col relative">
        {/* 툴바 */}
        <ViewerToolbar
          isDarkMode={isDarkMode}
          xrayMode={xrayMode}
          showEdges={showEdges}
          showSidebar={showSidebar}
          showFps={showFps}
          selectedCount={selectionState.selectedCount}
          hasModel={hasModel}
          onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}
          onToggleXray={() => setXrayMode(!xrayMode)}
          onToggleEdges={() => setShowEdges(!showEdges)}
          onToggleSidebar={() => setShowSidebar(!showSidebar)}
          onToggleFps={() => setShowFps(!showFps)}
          onExportFrag={handleExportFrag}
        />
        
        {/* 3D 뷰어 */}
        <div className="flex-1 relative">
          <div ref={containerRef} className="absolute inset-0" />
          
          {/* 로딩 오버레이 */}
          {isLoading && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-20">
              <div className="bg-white dark:bg-slate-800 rounded-lg p-6 max-w-sm w-full mx-4">
                <div className="text-center">
                  <div className="animate-spin w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
                  <p className="text-lg font-medium dark:text-white mb-2">{loadingMessage}</p>
                  <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-2">
                    <div 
                      className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">{progress}%</p>
                </div>
              </div>
            </div>
          )}
          
          {/* 에러 표시 */}
          {error && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-red-500 text-white px-4 py-2 rounded-lg z-20">
              {error}
            </div>
          )}
          
          {/* 파일 업로드 (모델 없을 때) */}
          {!hasModel && !isLoading && isReady && (
            <div className="absolute inset-0 flex items-center justify-center">
              <FileUpload onFileLoad={handleFileLoad} />
            </div>
          )}
          
          {/* FPS 표시 */}
          {showFps && hasModel && (
            <div className="absolute bottom-4 left-4 bg-black/50 text-white px-2 py-1 rounded text-sm font-mono">
              FPS: --
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

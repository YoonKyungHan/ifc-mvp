"use client";

import { useState, useCallback, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";

// 기능별 컴포넌트
import { IFCScene } from "./scene";
import { Sidebar } from "./sidebar";
import { ViewerToolbar } from "./toolbar";
import { FileUpload } from "./upload";

// 훅 - 클라이언트 로더만 사용
import { useIFCLoader } from "@/hooks/useIFCLoader";
import { useSelection } from "./hooks/useSelection";
import { useVisibility } from "./hooks/useVisibility";

// 타입
import { MaterialItem, StoreyInfo, IFCSpatialNode } from "@/types/ifc";

// 성능 통계 컴포넌트
import { Stats } from "@react-three/drei";

function PerformanceStats() {
  return <Stats showPanel={0} className="stats" />;
}

export function IFCViewer() {
  // 모델 상태
  const [model, setModel] = useState<THREE.Group | null>(null);
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [storeys, setStoreys] = useState<StoreyInfo[]>([]);
  const [spatialTree, setSpatialTree] = useState<IFCSpatialNode | null>(null);
  
  // UI 상태
  const [showSidebar, setShowSidebar] = useState(true);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [xrayMode, setXrayMode] = useState(true);
  const [showEdges, setShowEdges] = useState(true);
  const [showStats, setShowStats] = useState(true);

  // IFC 로더 (web-ifc 직접 사용)
  const { 
    isLoading, loadingMessage, error, progress, 
    loadIFC, getElementsByType, getMaterialList, getStoreyList, getSpatialTree, cleanup
  } = useIFCLoader();

  // 선택 상태
  const {
    selectedExpressIDs, selectedMaterialId,
    handleElementSelect, handleMaterialSelect, handleSelectElements, handleClearSelection
  } = useSelection(getElementsByType);

  // 표시/숨김 상태
  const {
    hiddenMaterialIds, hiddenExpressIDs, selectedStorey, visibleExpressIDs,
    setSelectedStorey, handleToggleVisibility, handleShowAll, handleHideAll, resetVisibility
  } = useVisibility(materials, storeys);

  // 파일 로드
  const handleFileLoad = useCallback(async (file: File) => {
    // 이전 모델 정리
    if (model) {
      model.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach(m => m.dispose());
          } else {
            obj.material?.dispose();
          }
        }
      });
      setModel(null);
    }

    console.log(`📁 IFC 로드 시작`);
    
    const loadedModel = await loadIFC(file);
    if (loadedModel) {
      // 대용량 파일 체크 (10000개 이상 메시면 윤곽선 자동 OFF)
      let meshCount = 0;
      loadedModel.traverse(obj => { if (obj instanceof THREE.Mesh) meshCount++; });
      console.log(`📊 로드 완료: ${meshCount}개 메시`);
      
      if (meshCount > 10000) {
        setShowEdges(false);
        console.log("⚠️ 대용량 모델 - 윤곽선 자동 OFF");
      }
      
      setModel(loadedModel);
      setMaterials(getMaterialList());
      setStoreys(getStoreyList());
      setSpatialTree(getSpatialTree());
      handleClearSelection();
      resetVisibility();
    }
  }, [loadIFC, getMaterialList, getStoreyList, getSpatialTree, handleClearSelection, resetVisibility, model]);

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  const bgClass = isDarkMode ? "bg-slate-900" : "bg-slate-100";

  return (
    <div className={`relative w-full h-full flex ${bgClass}`}>
      {/* 사이드바 */}
      {showSidebar && (
        <div className="w-80 flex-shrink-0">
          <Sidebar
            materials={materials}
            selectedMaterialId={selectedMaterialId}
            selectedExpressIDs={selectedExpressIDs}
            onSelectMaterial={handleMaterialSelect}
            onSelectElements={handleSelectElements}
            isDarkMode={isDarkMode}
            hiddenMaterialIds={hiddenMaterialIds}
            onToggleVisibility={handleToggleVisibility}
            onShowAll={handleShowAll}
            onHideAll={handleHideAll}
            storeys={storeys}
            selectedStorey={selectedStorey}
            onSelectStorey={setSelectedStorey}
            spatialTree={spatialTree}
          />
        </div>
      )}

      {/* 3D 뷰어 영역 */}
      <div className="flex-1 relative">
        <ViewerToolbar
          hasModel={!!model}
          showTable={showSidebar}
          onToggleTable={() => setShowSidebar(!showSidebar)}
          selectedCount={selectedExpressIDs.length}
          isDarkMode={isDarkMode}
          onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}
          xrayMode={xrayMode}
          onToggleXray={() => setXrayMode(!xrayMode)}
          showEdges={showEdges}
          onToggleEdges={() => setShowEdges(!showEdges)}
          onClearSelection={handleClearSelection}
        />

        {/* 파일 업로드 */}
        {!model && !isLoading && (
          <div className={`absolute inset-0 flex items-center justify-center z-10 ${bgClass}/90`}>
            <FileUpload onFileLoad={handleFileLoad} isDarkMode={isDarkMode} />
          </div>
        )}

        {/* 로딩 */}
        {isLoading && (
          <div className={`absolute inset-0 flex flex-col items-center justify-center z-20 ${bgClass}/95`}>
            <div className="w-80">
              <div className="flex justify-between items-center mb-2">
                <p className={`text-sm font-medium ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>{loadingMessage}</p>
                <span className="text-sm text-blue-500 tabular-nums">{progress}%</span>
              </div>
              <div className={`h-2 rounded-full overflow-hidden ${isDarkMode ? "bg-slate-700" : "bg-slate-300"}`}>
                <div 
                  className="h-full transition-all bg-gradient-to-r from-blue-500 to-blue-400" 
                  style={{ width: `${progress}%` }} 
                />
              </div>
            </div>
          </div>
        )}

        {/* 에러 */}
        {error && (
          <div className="absolute top-16 left-4 right-4 z-20 bg-red-500/10 border border-red-500 text-red-400 px-4 py-3 rounded-lg">
            <p className="font-medium">오류 발생</p>
            <p className="text-sm">{error}</p>
          </div>
        )}

        {/* 3D Canvas */}
        <Canvas
          className="w-full h-full"
          gl={{ 
            antialias: true,
            powerPreference: "high-performance", 
            stencil: false, 
            depth: true,
            preserveDrawingBuffer: false,
          }}
          frameloop="demand"
          dpr={[1, 1.5]}
        >
          <IFCScene
            model={model}
            onElementSelect={handleElementSelect}
            selectedExpressIDs={selectedExpressIDs}
            isDarkMode={isDarkMode}
            hiddenExpressIDs={hiddenExpressIDs}
            xrayMode={xrayMode}
            visibleExpressIDs={visibleExpressIDs}
            showEdges={showEdges}
          />
          {showStats && <PerformanceStats />}
        </Canvas>

        {/* 파일 변경 버튼 */}
        {model && !isLoading && (
          <div className="absolute bottom-4 left-4 z-10">
            <FileUpload onFileLoad={handleFileLoad} compact isDarkMode={isDarkMode} />
          </div>
        )}

        {/* 선택 정보 */}
        {selectedExpressIDs.length > 0 && (
          <div className={`absolute bottom-4 right-4 z-10 backdrop-blur-sm px-4 py-2 rounded-lg border ${isDarkMode ? "bg-slate-800/90 border-slate-700" : "bg-white/90 border-slate-300"}`}>
            <p className={`text-sm ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
              <span className="text-blue-400 font-medium">{selectedExpressIDs.length}개</span> 요소 선택됨
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

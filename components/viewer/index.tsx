"use client";

import { useState, useCallback, useEffect, useRef } from "react";
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

// 성능 통계 컴포넌트 (stats.js 직접 사용)
import StatsImpl from "stats.js";

function StatsPanel({ parentRef }: { parentRef: React.RefObject<HTMLDivElement | null> }) {
  useEffect(() => {
    if (!parentRef.current) return;
    
    const stats = new StatsImpl();
    stats.showPanel(0); // 0: FPS
    stats.dom.style.position = 'absolute';
    stats.dom.style.left = '0px';
    stats.dom.style.bottom = '0px';
    stats.dom.style.top = 'auto';
    stats.dom.style.zIndex = '10';
    
    parentRef.current.appendChild(stats.dom);
    
    let animationId: number;
    const animate = () => {
      stats.update();
      animationId = requestAnimationFrame(animate);
    };
    animate();
    
    return () => {
      cancelAnimationFrame(animationId);
      if (stats.dom.parentNode) {
        stats.dom.parentNode.removeChild(stats.dom);
      }
    };
  }, [parentRef]);
  
  return null;
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
  const [tableHighlightedIDs, setTableHighlightedIDs] = useState<number[]>([]); // 테이블에서 강조된 요소 (3D 초록색)

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
  const viewerRef = useRef<HTMLDivElement>(null);
  
  // 사이드바 토글 시 캔버스 리사이즈 트리거
  const [canvasKey, setCanvasKey] = useState(0);
  useEffect(() => {
    // 사이드바 상태 변경 후 약간의 딜레이를 두고 리사이즈 트리거
    const timer = setTimeout(() => {
      setCanvasKey(prev => prev + 1);
      // 윈도우 리사이즈 이벤트 발생시켜 Three.js가 감지하도록 함
      window.dispatchEvent(new Event('resize'));
    }, 50);
    return () => clearTimeout(timer);
  }, [showSidebar]);

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
            onTableHighlight={setTableHighlightedIDs}
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
      <div className="flex-1 relative" ref={viewerRef}>
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
          key={canvasKey}
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
          resize={{ scroll: false, debounce: { scroll: 0, resize: 0 } }}
        >
          <IFCScene
            model={model}
            onElementSelect={handleElementSelect}
            selectedExpressIDs={selectedExpressIDs}
            tableHighlightedIDs={tableHighlightedIDs}
            isDarkMode={isDarkMode}
            hiddenExpressIDs={hiddenExpressIDs}
            xrayMode={xrayMode}
            visibleExpressIDs={visibleExpressIDs}
            showEdges={showEdges}
          />
        </Canvas>

        {/* FPS 통계 */}
        {showStats && <StatsPanel parentRef={viewerRef} />}

        {/* 로고 */}
        <div className="absolute bottom-4 right-4 z-10">
          <img 
            src="/logo.png" 
            alt="Logo" 
            className="h-8 opacity-40 hover:opacity-70 transition-opacity"
          />
        </div>
      </div>
    </div>
  );
}

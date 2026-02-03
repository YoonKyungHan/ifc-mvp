"use client";

import { 
  PanelLeftClose, 
  PanelLeft, 
  Box,
  CheckSquare,
  Sun,
  Moon,
  Scan,
  X,
  Hexagon,
  Download,
  Activity
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

// 개발 모드 확인
const isDev = process.env.NODE_ENV === 'development';

export interface ViewerToolbarProps {
  hasModel: boolean;
  showTable?: boolean;
  showSidebar?: boolean;
  showFps?: boolean;
  onToggleTable?: () => void;
  onToggleSidebar?: () => void;
  onToggleFps?: () => void;
  selectedCount?: number;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  xrayMode: boolean;
  onToggleXray: () => void;
  showEdges: boolean;
  onToggleEdges: () => void;
  onClearSelection?: () => void;
  onExportFrag?: () => void;
}

export function ViewerToolbar({ 
  hasModel, 
  showTable,
  showSidebar,
  showFps,
  onToggleTable,
  onToggleSidebar,
  onToggleFps,
  selectedCount = 0,
  isDarkMode,
  onToggleDarkMode,
  xrayMode,
  onToggleXray,
  showEdges,
  onToggleEdges,
  onClearSelection,
  onExportFrag
}: ViewerToolbarProps) {
  // showSidebar가 있으면 ThatOpen 뷰어, showTable이 있으면 Legacy 뷰어
  const isThatOpenViewer = showSidebar !== undefined;
  const buttonClass = isDarkMode 
    ? "bg-slate-800/90 backdrop-blur-sm border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700"
    : "bg-white/90 backdrop-blur-sm border border-slate-300 text-slate-600 hover:text-slate-900 hover:bg-slate-100";

  const panelClass = isDarkMode
    ? "bg-slate-800/90 backdrop-blur-sm border-slate-700"
    : "bg-white/90 backdrop-blur-sm border-slate-300";

  // 패널 토글 함수 (ThatOpen과 Legacy 호환)
  const handleTogglePanel = () => {
    if (onToggleSidebar) onToggleSidebar();
    else if (onToggleTable) onToggleTable();
  };
  
  const isPanelOpen = showSidebar ?? showTable ?? false;

  return (
    <>
      {/* 왼쪽 - 패널 토글 + 로고 */}
      <div className="absolute top-4 left-4 z-30 flex items-center gap-2">
        <Button 
          variant="ghost" 
          size="icon"
          onClick={handleTogglePanel}
          title={isPanelOpen ? "패널 숨기기" : "패널 표시"}
          className={buttonClass}
        >
          {isPanelOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />}
        </Button>

        <div className={`flex items-center gap-3 px-4 py-2 rounded-lg border shadow-lg ${panelClass}`}>
          <Box className="w-5 h-5 text-blue-500" />
          <span className={`font-semibold ${isDarkMode ? "text-white" : "text-slate-800"}`}>IFC Viewer</span>
          {selectedCount > 0 && (
            <>
              <Separator orientation="vertical" className={`h-4 ${isDarkMode ? "bg-slate-600" : "bg-slate-300"}`} />
              <div className="flex items-center gap-1.5 text-blue-400">
                <CheckSquare className="w-4 h-4" />
                <span className="text-sm font-medium">{selectedCount}개 선택</span>
              </div>
              {onClearSelection && (
                <button onClick={onClearSelection} className="p-1 rounded hover:bg-slate-700/50" title="선택 해제">
                  <X className="w-4 h-4 text-slate-400 hover:text-white" />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* 오른쪽 - 뷰 도구들 (고정 위치) */}
      <div className="absolute top-4 right-4 z-30 flex items-center gap-2">
        {hasModel && (
          <>
            {/* 윤곽선 토글 */}
            <Button 
              variant="ghost" 
              size="sm"
              onClick={onToggleEdges}
              title={showEdges ? "윤곽선 끄기" : "윤곽선 켜기"}
              className={`${buttonClass} gap-2 ${showEdges ? "!bg-blue-500/20 !text-blue-400 !border-blue-500/50" : ""}`}
            >
              <Hexagon className="w-4 h-4" />
              <span className="text-xs font-medium">윤곽선</span>
            </Button>

            {/* X-Ray 모드 */}
            <Button 
              variant="ghost" 
              size="sm"
              onClick={onToggleXray}
              title={xrayMode ? "X-Ray 모드 끄기" : "X-Ray 모드 켜기"}
              className={`${buttonClass} gap-2 ${xrayMode ? "!bg-blue-500/20 !text-blue-400 !border-blue-500/50" : ""}`}
            >
              <Scan className="w-4 h-4" />
              <span className="text-xs font-medium">X-Ray</span>
            </Button>

            {/* FPS 표시 - 개발 모드에서만 */}
            {isDev && onToggleFps && (
              <Button 
                variant="ghost" 
                size="sm"
                onClick={onToggleFps}
                title={showFps ? "FPS 숨기기" : "FPS 표시"}
                className={`${buttonClass} gap-2 ${showFps ? "!bg-green-500/20 !text-green-400 !border-green-500/50" : ""}`}
              >
                <Activity className="w-4 h-4" />
                <span className="text-xs font-medium">FPS</span>
              </Button>
            )}

            {/* 내보내기 - 개발 모드에서만 */}
            {isDev && onExportFrag && (
              <Button 
                variant="ghost" 
                size="sm"
                onClick={onExportFrag}
                title=".frag 파일로 내보내기"
                className={`${buttonClass} gap-2`}
              >
                <Download className="w-4 h-4" />
                <span className="text-xs font-medium">내보내기</span>
              </Button>
            )}
          </>
        )}

        <Button 
          variant="ghost" 
          size="icon"
          onClick={onToggleDarkMode}
          title={isDarkMode ? "라이트 모드" : "다크 모드"}
          className={buttonClass}
        >
          {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </Button>
      </div>
    </>
  );
}

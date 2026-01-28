"use client";

import { useState, memo } from "react";
import { Package, GitBranch } from "lucide-react";
import { MaterialTable, MaterialTableProps } from "./MaterialTable";
import { ModelTree, ModelTreeProps } from "./ModelTree";
import { IFCSpatialNode } from "@/types/ifc";

type TabType = "quantity" | "tree";

export interface SidebarProps extends Omit<MaterialTableProps, 'isDarkMode'> {
  selectedExpressIDs: number[];
  onSelectElements: (expressIDs: number[]) => void;
  onTableHighlight?: (expressIDs: number[]) => void;  // 테이블에서 강조된 요소들 (3D 초록색)
  isDarkMode?: boolean;
  spatialTree?: IFCSpatialNode | null;
}

export const Sidebar = memo(function Sidebar({
  materials,
  selectedMaterialId,
  selectedExpressIDs,
  onSelectMaterial,
  onSelectElements,
  onTableHighlight,
  isDarkMode = true,
  hiddenMaterialIds,
  onToggleVisibility,
  onShowAll,
  onHideAll,
  storeys = [],
  selectedStorey = null,
  onSelectStorey,
  spatialTree = null
}: SidebarProps) {
  const [activeTab, setActiveTab] = useState<TabType>("quantity");

  const theme = {
    bg: isDarkMode ? "bg-slate-800" : "bg-white",
    border: isDarkMode ? "border-slate-700" : "border-slate-200",
    tabActive: isDarkMode ? "bg-slate-700 text-white" : "bg-slate-200 text-slate-900",
    tabInactive: isDarkMode ? "text-slate-400 hover:text-white hover:bg-slate-700/50" : "text-slate-500 hover:text-slate-900 hover:bg-slate-100",
  };

  return (
    <div className={`h-full flex flex-col ${theme.bg} border-r ${theme.border}`}>
      {/* 탭 헤더 */}
      <div className={`flex-shrink-0 flex border-b ${theme.border}`}>
        <button
          onClick={() => setActiveTab("quantity")}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${activeTab === "quantity" ? theme.tabActive : theme.tabInactive}`}
        >
          <Package className="w-4 h-4" />
          수량검토
        </button>
        <button
          onClick={() => setActiveTab("tree")}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${activeTab === "tree" ? theme.tabActive : theme.tabInactive}`}
        >
          <GitBranch className="w-4 h-4" />
          모델트리
        </button>
      </div>

      {/* 탭 콘텐츠 */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === "quantity" ? (
          <MaterialTable
            materials={materials}
            selectedMaterialId={selectedMaterialId}
            selectedExpressIDs={selectedExpressIDs}
            onSelectMaterial={onSelectMaterial}
            onTableHighlight={onTableHighlight}
            isDarkMode={isDarkMode}
            hiddenMaterialIds={hiddenMaterialIds}
            onToggleVisibility={onToggleVisibility}
            onShowAll={onShowAll}
            onHideAll={onHideAll}
            storeys={storeys}
            selectedStorey={selectedStorey}
            onSelectStorey={onSelectStorey}
          />
        ) : (
          <ModelTree
            spatialTree={spatialTree}
            selectedExpressIDs={selectedExpressIDs}
            onSelectElements={onSelectElements}
            isDarkMode={isDarkMode}
          />
        )}
      </div>
    </div>
  );
});

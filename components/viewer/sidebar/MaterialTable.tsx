"use client";

import { useState, useMemo, memo, useCallback } from "react";
import { ChevronDown, ChevronRight, Package, Search, Eye, EyeOff } from "lucide-react";
import { MaterialItem, StoreyInfo } from "@/types/ifc";
import { StoreyFilter } from "./StoreyFilter";

export interface MaterialTableProps {
  materials: MaterialItem[];
  selectedMaterialId: string | null;  // 변경: typeCode → id
  onSelectMaterial: (id: string, expressIDs: number[]) => void;
  isDarkMode?: boolean;
  hiddenMaterialIds: Set<string>;     // 변경: typeCode → id
  onToggleVisibility: (id: string) => void;
  onShowAll: () => void;
  onHideAll: () => void;
  storeys?: StoreyInfo[];
  selectedStorey?: string | null;
  onSelectStorey?: (storeyId: string | null) => void;
}

export const MaterialTable = memo(function MaterialTable({ 
  materials, 
  selectedMaterialId, 
  onSelectMaterial,
  isDarkMode = true,
  hiddenMaterialIds,
  onToggleVisibility,
  onShowAll,
  onHideAll,
  storeys = [],
  selectedStorey = null,
  onSelectStorey
}: MaterialTableProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(["구조", "건축", "기타"]));
  const [searchTerm, setSearchTerm] = useState("");

  // 선택된 층의 expressIDs
  const storeyExpressIDs = useMemo(() => {
    if (!selectedStorey) return null;
    const storey = storeys.find(s => s.id === selectedStorey);
    return storey ? new Set(storey.expressIDs) : null;
  }, [selectedStorey, storeys]);

  // 층 필터링된 자재 목록 (층 선택 시 해당 층의 자재만)
  const filteredMaterials = useMemo(() => {
    if (!storeyExpressIDs) return materials;
    
    return materials
      .map(m => {
        // 해당 층에 포함된 expressIDs만 필터링
        const filteredIDs = m.expressIDs.filter(id => storeyExpressIDs.has(id));
        if (filteredIDs.length === 0) return null;
        return {
          ...m,
          expressIDs: filteredIDs,
          count: filteredIDs.length,
        } as MaterialItem;
      })
      .filter((m): m is MaterialItem => m !== null);
  }, [materials, storeyExpressIDs]);

  // 검색 + 카테고리 그룹화
  const groupedMaterials = useMemo(() => {
    const filtered = searchTerm
      ? filteredMaterials.filter(m => m.typeName.toLowerCase().includes(searchTerm.toLowerCase()))
      : filteredMaterials;

    const groups = new Map<string, MaterialItem[]>();
    for (const material of filtered) {
      const existing = groups.get(material.category) || [];
      existing.push(material);
      groups.set(material.category, existing);
    }
    return groups;
  }, [filteredMaterials, searchTerm]);

  const toggleCategory = useCallback((category: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);

  const totalCount = useMemo(() => filteredMaterials.reduce((sum, m) => sum + m.count, 0), [filteredMaterials]);
  const visibleCount = useMemo(() => 
    filteredMaterials.filter(m => !hiddenMaterialIds.has(m.id)).reduce((sum, m) => sum + m.count, 0), 
    [filteredMaterials, hiddenMaterialIds]
  );

  const theme = {
    bg: isDarkMode ? "bg-slate-800" : "bg-white",
    border: isDarkMode ? "border-slate-700" : "border-slate-200",
    text: isDarkMode ? "text-white" : "text-slate-900",
    textMuted: isDarkMode ? "text-slate-400" : "text-slate-500",
    textSubtle: isDarkMode ? "text-slate-500" : "text-slate-400",
    input: isDarkMode 
      ? "bg-slate-700 border-slate-600 text-white placeholder-slate-500" 
      : "bg-slate-100 border-slate-300 text-slate-900 placeholder-slate-400",
    headerBg: isDarkMode ? "bg-slate-900/50" : "bg-slate-50",
    categoryBg: isDarkMode ? "bg-slate-700/30 hover:bg-slate-700/50" : "bg-slate-100 hover:bg-slate-200",
    itemHover: isDarkMode ? "hover:bg-slate-700/30" : "hover:bg-slate-100",
    itemText: isDarkMode ? "text-slate-200" : "text-slate-700",
    buttonBg: isDarkMode ? "bg-slate-700 hover:bg-slate-600" : "bg-slate-200 hover:bg-slate-300",
  };

  return (
    <div className={`h-full flex flex-col ${theme.bg} overflow-hidden`}>
      {/* 헤더 */}
      <div className={`flex-shrink-0 p-4 border-b ${theme.border}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-blue-500" />
            <h2 className={`font-semibold text-lg ${theme.text}`}>수량검토</h2>
            {selectedStorey && (
              <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-400">
                {storeys.find(s => s.id === selectedStorey)?.name}
              </span>
            )}
          </div>
          {filteredMaterials.length > 0 && (
            <div className="flex gap-1">
              <button onClick={onShowAll} title="전체 표시" className={`p-1.5 rounded ${theme.buttonBg}`}>
                <Eye className={`w-4 h-4 ${theme.textMuted}`} />
              </button>
              <button onClick={onHideAll} title="전체 숨김" className={`p-1.5 rounded ${theme.buttonBg}`}>
                <EyeOff className={`w-4 h-4 ${theme.textMuted}`} />
              </button>
            </div>
          )}
        </div>

        {onSelectStorey && (
          <StoreyFilter
            storeys={storeys}
            selectedStorey={selectedStorey}
            onSelectStorey={onSelectStorey}
            isDarkMode={isDarkMode}
          />
        )}
        
        <div className="relative">
          <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${theme.textSubtle}`} />
          <input
            type="text"
            placeholder="자재 검색..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={`w-full pl-9 pr-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${theme.input}`}
          />
        </div>
      </div>

      {/* 테이블 헤더 */}
      <div className={`flex-shrink-0 grid grid-cols-[28px_1fr_100px_55px] gap-1 px-3 py-2 ${theme.headerBg} border-b ${theme.border} text-xs font-medium ${theme.textMuted}`}>
        <div></div>
        <div>품명</div>
        <div className="text-center">규격</div>
        <div className="text-right">수량</div>
      </div>

      {/* 본문 */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {filteredMaterials.length === 0 ? (
          <div className={`flex flex-col items-center justify-center py-12 ${theme.textSubtle}`}>
            <Package className="w-12 h-12 mb-3 opacity-50" />
            {materials.length === 0 ? (
              <>
                <p>IFC 파일을 로드하면</p>
                <p>자재 목록이 표시됩니다</p>
              </>
            ) : (
              <>
                <p>선택한 층에</p>
                <p>자재가 없습니다</p>
              </>
            )}
          </div>
        ) : (
          <div>
            {Array.from(groupedMaterials.entries()).map(([category, items]) => (
              <div key={category} className={`border-b ${theme.border}/50`}>
                <button
                  onClick={() => toggleCategory(category)}
                  className={`w-full flex items-center gap-2 px-3 py-2 ${theme.categoryBg} transition-colors sticky top-0`}
                >
                  {expandedCategories.has(category) ? (
                    <ChevronDown className={`w-4 h-4 ${theme.textMuted}`} />
                  ) : (
                    <ChevronRight className={`w-4 h-4 ${theme.textMuted}`} />
                  )}
                  <span className={`font-medium text-sm ${theme.text}`}>{category}</span>
                  <span className={`text-xs ml-auto ${theme.textSubtle}`}>
                    {items.length}종 / {items.reduce((s, i) => s + i.count, 0)}개
                  </span>
                </button>

                {expandedCategories.has(category) && items.map((item) => {
                  const isHidden = hiddenMaterialIds.has(item.id);
                  const isSelected = selectedMaterialId === item.id;
                  return (
                    <div
                      key={item.id}
                      onClick={() => onSelectMaterial(item.id, item.expressIDs)}
                      className={`grid grid-cols-[28px_1fr_100px_55px] gap-1 px-3 py-2 items-center cursor-pointer ${theme.itemHover}
                        ${isSelected ? "bg-blue-500/20 border-l-2 border-blue-500" : "border-l-2 border-transparent"}
                        ${isHidden ? "opacity-50" : ""}`}
                    >
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleVisibility(item.id); }}
                        className={`p-1 rounded flex items-center justify-center ${theme.buttonBg}`}
                      >
                        {isHidden ? <EyeOff className="w-3.5 h-3.5 text-slate-500" /> : <Eye className="w-3.5 h-3.5 text-blue-500" />}
                      </button>
                      <div className={`text-sm truncate ${theme.itemText}`}>
                        {item.typeName}
                      </div>
                      <div className={`text-xs text-center ${theme.textSubtle} truncate`} title={item.spec}>
                        {item.spec}
                      </div>
                      <div className={`text-sm text-right font-medium tabular-nums ${isSelected ? "text-blue-500" : theme.text}`}>
                        {item.count.toLocaleString()}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 푸터 */}
      {filteredMaterials.length > 0 && (
        <div className={`flex-shrink-0 p-3 border-t ${theme.border} ${theme.headerBg}`}>
          <div className="flex justify-between text-sm">
            <span className={theme.textMuted}>자재 종류</span>
            <span className={`font-medium ${theme.text}`}>{filteredMaterials.length}종</span>
          </div>
          <div className="flex justify-between text-sm mt-1">
            <span className={theme.textMuted}>표시 중</span>
            <span className={`font-medium tabular-nums ${theme.text}`}>{visibleCount.toLocaleString()} / {totalCount.toLocaleString()}개</span>
          </div>
        </div>
      )}
    </div>
  );
});

"use client";

import { useState, useMemo, memo, useCallback } from "react";
import { ChevronDown, ChevronRight, Building2, Layers, MapPin, FolderOpen, Box, Home } from "lucide-react";
import { IFCSpatialNode, IFC_SPATIAL_TYPES } from "@/types/ifc";

export interface ModelTreeProps {
  spatialTree: IFCSpatialNode | null;
  selectedExpressIDs: number[];
  onSelectElements: (expressIDs: number[]) => void;
  isDarkMode?: boolean;
}

const getNodeIcon = (typeCode: number) => {
  switch (typeCode) {
    case IFC_SPATIAL_TYPES.IFCPROJECT:
      return <FolderOpen className="w-4 h-4 text-yellow-500" />;
    case IFC_SPATIAL_TYPES.IFCSITE:
      return <MapPin className="w-4 h-4 text-green-500" />;
    case IFC_SPATIAL_TYPES.IFCBUILDING:
      return <Building2 className="w-4 h-4 text-blue-500" />;
    case IFC_SPATIAL_TYPES.IFCBUILDINGSTOREY:
      return <Layers className="w-4 h-4 text-purple-500" />;
    case IFC_SPATIAL_TYPES.IFCSPACE:
      return <Home className="w-4 h-4 text-cyan-500" />;
    default:
      return <Box className="w-4 h-4 text-slate-400" />;
  }
};

const TreeNode = memo(function TreeNode({
  node,
  level,
  selectedExpressIDs,
  expandedNodes,
  onToggle,
  onSelect,
  isDarkMode,
}: {
  node: IFCSpatialNode;
  level: number;
  selectedExpressIDs: Set<number>;
  expandedNodes: Set<number>;
  onToggle: (expressID: number) => void;
  onSelect: (expressIDs: number[]) => void;
  isDarkMode: boolean;
}) {
  const isExpanded = expandedNodes.has(node.expressID);
  const hasChildren = node.children.length > 0;
  const hasElements = node.elements.length > 0;
  const isSelected = node.elements.some(id => selectedExpressIDs.has(id));
  const totalElements = node.elements.length;

  const theme = {
    text: isDarkMode ? "text-white" : "text-slate-900",
    textMuted: isDarkMode ? "text-slate-400" : "text-slate-500",
    textSubtle: isDarkMode ? "text-slate-500" : "text-slate-400",
    hover: isDarkMode ? "hover:bg-slate-700/50" : "hover:bg-slate-100",
    selected: isDarkMode ? "bg-blue-500/20" : "bg-blue-100",
  };

  const handleClick = useCallback(() => {
    if (hasElements) {
      onSelect(node.elements);
    } else if (hasChildren) {
      const collectElements = (n: IFCSpatialNode): number[] => {
        let elements = [...n.elements];
        for (const child of n.children) {
          elements = [...elements, ...collectElements(child)];
        }
        return elements;
      };
      const allElements = collectElements(node);
      if (allElements.length > 0) {
        onSelect(allElements);
      }
    }
  }, [node, hasElements, hasChildren, onSelect]);

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-1.5 px-2 cursor-pointer transition-colors ${theme.hover} ${isSelected ? theme.selected : ""}`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
      >
        {hasChildren ? (
          <button onClick={(e) => { e.stopPropagation(); onToggle(node.expressID); }} className={`p-0.5 rounded ${theme.textMuted}`}>
            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        ) : (
          <span className="w-5" />
        )}
        {getNodeIcon(node.typeCode)}
        <button onClick={handleClick} className={`flex-1 text-left text-sm truncate ${theme.text}`}>
          {node.name}
        </button>
        {totalElements > 0 && <span className={`text-xs ${theme.textSubtle}`}>{totalElements}</span>}
      </div>

      {isExpanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.expressID}
              node={child}
              level={level + 1}
              selectedExpressIDs={selectedExpressIDs}
              expandedNodes={expandedNodes}
              onToggle={onToggle}
              onSelect={onSelect}
              isDarkMode={isDarkMode}
            />
          ))}
        </div>
      )}
    </div>
  );
});

export const ModelTree = memo(function ModelTree({ 
  spatialTree,
  selectedExpressIDs,
  onSelectElements,
  isDarkMode = true,
}: ModelTreeProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<number>>(() => {
    const expanded = new Set<number>();
    if (spatialTree) {
      expanded.add(spatialTree.expressID);
      spatialTree.children.forEach(child => {
        expanded.add(child.expressID);
        child.children.forEach(grandChild => expanded.add(grandChild.expressID));
      });
    }
    return expanded;
  });

  const selectedSet = useMemo(() => new Set(selectedExpressIDs), [selectedExpressIDs]);

  const handleToggle = useCallback((expressID: number) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      next.has(expressID) ? next.delete(expressID) : next.add(expressID);
      return next;
    });
  }, []);

  const theme = {
    bg: isDarkMode ? "bg-slate-800" : "bg-white",
    border: isDarkMode ? "border-slate-700" : "border-slate-200",
    text: isDarkMode ? "text-white" : "text-slate-900",
    textSubtle: isDarkMode ? "text-slate-500" : "text-slate-400",
  };

  useMemo(() => {
    if (spatialTree) {
      setExpandedNodes(prev => {
        const next = new Set(prev);
        next.add(spatialTree.expressID);
        spatialTree.children.forEach(child => {
          next.add(child.expressID);
          child.children.forEach(grandChild => next.add(grandChild.expressID));
        });
        return next;
      });
    }
  }, [spatialTree]);

  return (
    <div className={`h-full flex flex-col ${theme.bg} overflow-hidden`}>
      <div className={`flex-shrink-0 p-4 border-b ${theme.border}`}>
        <div className="flex items-center gap-2">
          <Building2 className="w-5 h-5 text-blue-500" />
          <h2 className={`font-semibold text-lg ${theme.text}`}>IFC 구조</h2>
        </div>
        <p className={`text-xs mt-1 ${theme.textSubtle}`}>클릭하여 해당 공간의 요소 선택</p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto py-2">
        {!spatialTree ? (
          <div className={`flex flex-col items-center justify-center py-12 ${theme.textSubtle}`}>
            <Building2 className="w-12 h-12 mb-3 opacity-50" />
            <p>IFC 파일을 로드하면</p>
            <p>공간 구조가 표시됩니다</p>
          </div>
        ) : (
          <TreeNode
            node={spatialTree}
            level={0}
            selectedExpressIDs={selectedSet}
            expandedNodes={expandedNodes}
            onToggle={handleToggle}
            onSelect={onSelectElements}
            isDarkMode={isDarkMode}
          />
        )}
      </div>

      {selectedExpressIDs.length > 0 && (
        <div className={`flex-shrink-0 p-3 border-t ${theme.border}`}>
          <div className={`text-sm ${theme.text}`}>
            <span className="text-blue-400 font-medium">{selectedExpressIDs.length}개</span> 요소 선택됨
          </div>
        </div>
      )}
    </div>
  );
});

"use client";

import { memo } from "react";
import { Layers } from "lucide-react";
import { StoreyInfo } from "@/types/ifc";

interface StoreyFilterProps {
  storeys: StoreyInfo[];
  selectedStorey: string | null;
  onSelectStorey: (storeyId: string | null) => void;
  isDarkMode: boolean;
}

export const StoreyFilter = memo(function StoreyFilter({
  storeys,
  selectedStorey,
  onSelectStorey,
  isDarkMode,
}: StoreyFilterProps) {
  if (storeys.length === 0) return null;

  const theme = {
    text: isDarkMode ? "text-white" : "text-slate-900",
    textMuted: isDarkMode ? "text-slate-400" : "text-slate-500",
    selectBg: isDarkMode ? "bg-slate-700 border-slate-600" : "bg-slate-100 border-slate-300",
  };

  return (
    <div className="flex items-center gap-2 mb-3">
      <Layers className={`w-4 h-4 ${theme.textMuted}`} />
      <select
        value={selectedStorey || ""}
        onChange={(e) => onSelectStorey(e.target.value || null)}
        className={`flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${theme.selectBg} ${theme.text}`}
      >
        <option value="">전체 층</option>
        {storeys.map((storey) => (
          <option key={storey.id} value={storey.id}>
            {storey.name} ({storey.expressIDs?.length || 0}개)
          </option>
        ))}
      </select>
    </div>
  );
});

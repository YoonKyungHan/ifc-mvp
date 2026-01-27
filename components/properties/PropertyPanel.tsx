"use client";

import { X, Package, Hash, Layers, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { SelectionSummary } from "@/types/ifc";
import { useState } from "react";

interface PropertyPanelProps {
  summary: SelectionSummary | null;
  onClose: () => void;
}

export function PropertyPanel({ summary, onClose }: PropertyPanelProps) {
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());

  const toggleExpand = (expressID: number) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(expressID)) {
      newExpanded.delete(expressID);
    } else {
      newExpanded.add(expressID);
    }
    setExpandedItems(newExpanded);
  };

  return (
    <div className="w-80 h-full border-l border-slate-700 bg-slate-800 flex flex-col">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 bg-slate-800/80">
        <h2 className="font-semibold text-white">자재 정보</h2>
        <Button variant="ghost" size="icon" onClick={onClose} className="text-slate-400 hover:text-white">
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* 콘텐츠 */}
      {summary ? (
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            {/* 요약 카드 */}
            <Card className="bg-slate-700/50 border-slate-600">
              <CardContent className="p-4">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                    <Package className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white text-lg">{summary.type}</h3>
                    <p className="text-sm text-slate-400">선택된 자재</p>
                  </div>
                </div>

                <Separator className="bg-slate-600 my-3" />

                {/* 수량 정보 */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-800/50 rounded-lg p-3">
                    <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                      <Hash className="w-3 h-3" />
                      수량
                    </div>
                    <p className="text-2xl font-bold text-white">{summary.count}</p>
                    <p className="text-xs text-slate-500">개</p>
                  </div>
                  <div className="bg-slate-800/50 rounded-lg p-3">
                    <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                      <Layers className="w-3 h-3" />
                      타입 코드
                    </div>
                    <p className="text-lg font-mono text-slate-300">{summary.typeCode}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 개별 요소 리스트 */}
            <div>
              <h4 className="text-sm font-medium text-slate-400 mb-2 px-1">
                선택된 요소 목록 ({summary.elements.length})
              </h4>
              <div className="space-y-1">
                {summary.elements.map((element, index) => (
                  <div
                    key={element.expressID}
                    className="bg-slate-700/30 rounded-lg overflow-hidden"
                  >
                    <button
                      onClick={() => toggleExpand(element.expressID)}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-700/50 transition-colors"
                    >
                      {expandedItems.has(element.expressID) ? (
                        <ChevronDown className="w-4 h-4 text-slate-400" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-slate-400" />
                      )}
                      <span className="text-sm text-white flex-1 text-left">
                        {element.name || `${summary.type} #${index + 1}`}
                      </span>
                      <span className="text-xs text-slate-500 font-mono">
                        #{element.expressID}
                      </span>
                    </button>
                    
                    {/* 확장된 속성 */}
                    {expandedItems.has(element.expressID) && (
                      <div className="px-3 pb-2 pt-1 border-t border-slate-600/50">
                        {element.description && (
                          <div className="py-1">
                            <span className="text-xs text-slate-500">설명: </span>
                            <span className="text-xs text-slate-300">{element.description}</span>
                          </div>
                        )}
                        {element.properties.length > 0 ? (
                          <div className="space-y-1 mt-1">
                            {element.properties.slice(0, 5).map((prop, propIndex) => (
                              <div key={propIndex} className="flex justify-between text-xs">
                                <span className="text-slate-500">{prop.name}</span>
                                <span className="text-slate-300 font-medium">
                                  {String(prop.value)}
                                </span>
                              </div>
                            ))}
                            {element.properties.length > 5 && (
                              <p className="text-xs text-slate-500 mt-1">
                                +{element.properties.length - 5}개 속성 더 있음
                              </p>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-500">추가 속성 없음</p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </ScrollArea>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-slate-700 flex items-center justify-center mb-4">
            <Package className="w-8 h-8 text-slate-500" />
          </div>
          <h3 className="font-medium text-white">요소를 선택하세요</h3>
          <p className="text-sm text-slate-400 mt-2">
            3D 모델에서 요소를 클릭하면<br />
            동일한 타입의 모든 요소가 선택됩니다
          </p>
        </div>
      )}
    </div>
  );
}

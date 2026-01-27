"use client";

import { useCallback, useState } from "react";
import { Upload, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export interface FileUploadProps {
  onFileLoad: (file: File) => void;
  compact?: boolean;
  isDarkMode?: boolean;
}

export function FileUpload({ onFileLoad, compact = false, isDarkMode = true }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = useCallback((file: File) => {
    if (file.name.toLowerCase().endsWith(".ifc")) {
      onFileLoad(file);
    } else {
      alert("IFC 파일만 업로드 가능합니다.");
    }
  }, [onFileLoad]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
  }, [handleFile]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) handleFile(e.target.files[0]);
  }, [handleFile]);

  if (compact) {
    return (
      <Button
        variant="secondary"
        size="sm"
        className={`gap-2 ${isDarkMode ? "bg-slate-700 hover:bg-slate-600 text-white" : "bg-white hover:bg-slate-100 text-slate-700"}`}
        onClick={() => document.getElementById("file-input-compact")?.click()}
      >
        <FileUp className="w-4 h-4" />
        다른 파일 열기
        <input id="file-input-compact" type="file" accept=".ifc" className="hidden" onChange={handleFileInput} />
      </Button>
    );
  }

  const theme = {
    card: isDarkMode ? "bg-slate-800/50 border-slate-600 hover:border-blue-400/50" : "bg-white/80 border-slate-300 hover:border-blue-400/50",
    cardDrag: "border-blue-400 bg-blue-500/10",
    icon: isDarkMode ? "bg-slate-700 text-slate-400" : "bg-slate-200 text-slate-500",
    iconDrag: "bg-blue-500 text-white",
    title: isDarkMode ? "text-white" : "text-slate-800",
    subtitle: isDarkMode ? "text-slate-400" : "text-slate-500",
    button: isDarkMode ? "border-slate-600 text-slate-300 hover:bg-slate-700" : "border-slate-300 text-slate-600 hover:bg-slate-100",
  };

  return (
    <Card
      className={`w-96 p-8 text-center cursor-pointer border-2 border-dashed transition-all duration-200 backdrop-blur-sm ${isDragging ? `${theme.cardDrag} scale-105` : theme.card}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => document.getElementById("file-input")?.click()}
    >
      <div className="flex flex-col items-center gap-4">
        <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-colors ${isDragging ? theme.iconDrag : theme.icon}`}>
          <Upload className="w-8 h-8" />
        </div>
        <div>
          <h3 className={`font-semibold text-lg ${theme.title}`}>IFC 파일 업로드</h3>
          <p className={`text-sm mt-1 ${theme.subtitle}`}>파일을 드래그하거나 클릭하여 선택하세요</p>
        </div>
        <Button variant="outline" className={`mt-2 ${theme.button}`}>파일 선택</Button>
        <p className={`text-xs ${isDarkMode ? "text-slate-500" : "text-slate-400"}`}>지원 형식: .ifc</p>
      </div>
      <input id="file-input" type="file" accept=".ifc" className="hidden" onChange={handleFileInput} />
    </Card>
  );
}

"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

// 개발 모드 확인
const isDev = process.env.NODE_ENV === 'development';

type ViewerType = 'legacy' | 'fragments' | 'thatopen';

// 로딩 컴포넌트
const LoadingSpinner = ({ color, text }: { color: string; text: string }) => (
  <div className="w-full h-screen flex items-center justify-center bg-slate-900">
    <div className="flex flex-col items-center gap-4">
      <div className={`w-12 h-12 border-4 border-${color}-500 border-t-transparent rounded-full animate-spin`} />
      <p className="text-white/70">{text}</p>
    </div>
  </div>
);

// Legacy Viewer - useIFCLoader 훅 사용 (@react-three/fiber 기반)
const LegacyViewer = dynamic(
  () => import("@/components/viewer").then((mod) => mod.IFCViewer),
  {
    ssr: false,
    loading: () => <LoadingSpinner color="blue" text="뷰어 로딩 중..." />,
  }
);

// 개발 모드에서만 다른 뷰어 로드
const FragmentsViewer = isDev ? dynamic(
  () => import("@/components/viewer/FragmentsViewer").then((mod) => mod.FragmentsViewer),
  { ssr: false, loading: () => <LoadingSpinner color="purple" text="Fragments 뷰어 로딩 중..." /> }
) : null;

const ThatOpenViewer = isDev ? dynamic(
  () => import("@/components/viewer/thatopen").then((mod) => mod.ThatOpenViewer),
  { ssr: false, loading: () => <LoadingSpinner color="green" text="ThatOpen 뷰어 로딩 중..." /> }
) : null;

export default function Home() {
  const [viewerType, setViewerType] = useState<ViewerType>('legacy');

  // 프로덕션: Legacy 뷰어만
  if (!isDev) {
    return (
      <main className="w-full h-screen overflow-hidden">
        <LegacyViewer />
      </main>
    );
  }

  // 개발 모드: 뷰어 선택 가능
  return (
    <main className="w-full h-screen overflow-hidden relative">
      {/* 뷰어 타입 선택 버튼 (개발 모드만) */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex gap-1 bg-black/50 backdrop-blur-sm p-1 rounded-lg border border-white/10">
        <button
          onClick={() => setViewerType('legacy')}
          className={`px-3 py-2 rounded text-xs font-medium transition-all ${
            viewerType === 'legacy' 
              ? 'bg-blue-500 text-white shadow-lg' 
              : 'text-white/60 hover:text-white hover:bg-white/10'
          }`}
        >
          🏗️ Legacy
        </button>
        <button
          onClick={() => setViewerType('fragments')}
          className={`px-3 py-2 rounded text-xs font-medium transition-all ${
            viewerType === 'fragments' 
              ? 'bg-purple-500 text-white shadow-lg' 
              : 'text-white/60 hover:text-white hover:bg-white/10'
          }`}
        >
          📦 Fragments
        </button>
        <button
          onClick={() => setViewerType('thatopen')}
          className={`px-3 py-2 rounded text-xs font-medium transition-all ${
            viewerType === 'thatopen' 
              ? 'bg-emerald-500 text-white shadow-lg' 
              : 'text-white/60 hover:text-white hover:bg-white/10'
          }`}
        >
          ⚡ ThatOpen
        </button>
      </div>

      {/* 뷰어 렌더링 */}
      {viewerType === 'legacy' && <LegacyViewer />}
      {viewerType === 'fragments' && FragmentsViewer && <FragmentsViewer />}
      {viewerType === 'thatopen' && ThatOpenViewer && <ThatOpenViewer />}
    </main>
  );
}

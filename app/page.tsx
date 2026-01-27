"use client";

import dynamic from "next/dynamic";

// IFC 뷰어 컴포넌트를 클라이언트 사이드에서만 로드 (SSR 비활성화)
const IFCViewer = dynamic(
  () => import("@/components/viewer").then((mod) => mod.IFCViewer),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground">뷰어 로딩 중...</p>
        </div>
      </div>
    ),
  }
);

export default function Home() {
  return (
    <main className="w-full h-screen overflow-hidden">
      <IFCViewer />
    </main>
  );
}

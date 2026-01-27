import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  transpilePackages: ["three", "@thatopen/components", "@thatopen/fragments"],
  
  // web-ifc를 서버 사이드 번들링에서 제외 (WASM 경로 문제 해결)
  serverExternalPackages: ["web-ifc"],
  
  // WASM 파일 리다이렉트 - webpack 경로를 public 경로로 매핑
  async rewrites() {
    return [
      {
        source: "/_next/static/chunks/wasm/:path*",
        destination: "/wasm/:path*",
      },
      {
        source: "/_next/static/chunks/:path*.wasm",
        destination: "/wasm/:path*.wasm",
      },
    ];
  },

  // WASM MIME 타입 설정
  async headers() {
    return [
      {
        source: "/:path*.wasm",
        headers: [
          {
            key: "Content-Type",
            value: "application/wasm",
          },
        ],
      },
    ];
  },
  
  webpack: (config) => {
    // WebAssembly 지원 활성화
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      syncWebAssembly: true,
      layers: true,
    };

    // WASM 파일 처리
    config.module.rules.push({
      test: /\.wasm$/,
      type: "asset/resource",
    });

    // Node.js 폴백
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
    };

    return config;
  },
};

export default nextConfig;

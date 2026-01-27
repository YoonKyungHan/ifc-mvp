// WASM 로더 - web-ifc 초기화를 위한 헬퍼

export async function initWebIFC() {
  const WebIFC = await import("web-ifc");
  const ifcApi = new WebIFC.IfcAPI();

  // WASM 파일 경로를 명시적으로 설정
  // Next.js public 폴더에서 서빙되는 경로
  ifcApi.SetWasmPath("/wasm/");

  try {
    await ifcApi.Init();
    console.log("✅ web-ifc initialized successfully");
    return ifcApi;
  } catch (error) {
    console.error("❌ web-ifc initialization failed:", error);
    
    // 대안: locateFile 옵션으로 시도
    const ifcApi2 = new WebIFC.IfcAPI();
    
    ifcApi2.SetWasmPath("/wasm/", true);
    
    await ifcApi2.Init();
    return ifcApi2;
  }
}

export async function checkWasmAvailability(): Promise<boolean> {
  try {
    const response = await fetch("/wasm/web-ifc.wasm", { method: "HEAD" });
    console.log("WASM file status:", response.status, response.headers.get("content-type"));
    return response.ok;
  } catch (error) {
    console.error("WASM file check failed:", error);
    return false;
  }
}

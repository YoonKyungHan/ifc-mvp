import * as WebIFC from "web-ifc";

let ifcApi: WebIFC.IfcAPI | null = null;

export async function initializeIfcApi(): Promise<WebIFC.IfcAPI> {
  if (ifcApi) {
    return ifcApi;
  }

  ifcApi = new WebIFC.IfcAPI();

  // WASM 파일 경로 설정
  await ifcApi.Init();

  return ifcApi;
}

export async function loadIfcFile(file: File): Promise<{
  api: WebIFC.IfcAPI;
  modelID: number;
}> {
  const api = await initializeIfcApi();

  const data = await file.arrayBuffer();
  const uint8Array = new Uint8Array(data);

  const modelID = api.OpenModel(uint8Array);

  return { api, modelID };
}

export function closeIfcModel(api: WebIFC.IfcAPI, modelID: number): void {
  api.CloseModel(modelID);
}

export function getAllSpatialStructure(
  api: WebIFC.IfcAPI,
  modelID: number
): unknown[] {
  const spatialStructure: unknown[] = [];

  // IFC 공간 구조 요소 타입들
  const spatialTypes = [
    WebIFC.IFCPROJECT,
    WebIFC.IFCSITE,
    WebIFC.IFCBUILDING,
    WebIFC.IFCBUILDINGSTOREY,
    WebIFC.IFCSPACE,
  ];

  for (const type of spatialTypes) {
    const elements = api.GetLineIDsWithType(modelID, type);
    for (let i = 0; i < elements.size(); i++) {
      const expressID = elements.get(i);
      const props = api.GetLine(modelID, expressID);
      spatialStructure.push(props);
    }
  }

  return spatialStructure;
}

export function getElementProperties(
  api: WebIFC.IfcAPI,
  modelID: number,
  expressID: number
): Record<string, unknown> {
  try {
    const props = api.GetLine(modelID, expressID, true);
    return props as Record<string, unknown>;
  } catch (error) {
    console.error("Error getting element properties:", error);
    return {};
  }
}

export function getAllElements(
  api: WebIFC.IfcAPI,
  modelID: number
): number[] {
  const allElements: number[] = [];

  // 주요 건축 요소 타입들
  const elementTypes = [
    WebIFC.IFCWALL,
    WebIFC.IFCWALLSTANDARDCASE,
    WebIFC.IFCSLAB,
    WebIFC.IFCCOLUMN,
    WebIFC.IFCBEAM,
    WebIFC.IFCDOOR,
    WebIFC.IFCWINDOW,
    WebIFC.IFCSTAIR,
    WebIFC.IFCROOF,
    WebIFC.IFCRAILING,
    WebIFC.IFCFURNISHINGELEMENT,
    WebIFC.IFCPLATE,
    WebIFC.IFCMEMBER,
    WebIFC.IFCCOVERING,
    WebIFC.IFCFOOTING,
    WebIFC.IFCPILE,
    WebIFC.IFCCURTAINWALL,
  ];

  for (const type of elementTypes) {
    try {
      const elements = api.GetLineIDsWithType(modelID, type);
      for (let i = 0; i < elements.size(); i++) {
        allElements.push(elements.get(i));
      }
    } catch {
      // 해당 타입이 모델에 없으면 무시
    }
  }

  return allElements;
}

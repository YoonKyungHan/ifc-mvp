"use client";

/**
 * Legacy IFC Viewer - web-ifc 직접 사용 방식
 * 
 * WASM 파일 경로: /dist/ (public/dist/ 폴더)
 * 참고: https://github.com/ThatOpen/engine_web-ifc
 */

import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
// @thatopen/fragments - .frag 파일 생성용
import * as FRAGS from "@thatopen/fragments";

// UI 컴포넌트
import { Sidebar } from "./sidebar";
import { ViewerToolbar } from "./toolbar";
import { FileUpload } from "./upload";

// 타입
import { MaterialItem, StoreyInfo, IFCSpatialNode, IFC_TYPE_NAMES, ElementDimensions, IFC_SPATIAL_TYPES } from "@/types/ifc";

// 성능 통계
import StatsImpl from "stats.js";

// web-ifc 타입 정의
interface IfcAPI {
  Init(): Promise<void>;
  SetWasmPath(path: string): void;
  OpenModel(data: Uint8Array): number;
  CloseModel(modelID: number): void;
  GetLine(modelID: number, expressID: number, flatten?: boolean): any;
  GetLineIDsWithType(modelID: number, type: number): { size(): number; get(index: number): number };
  StreamAllMeshes(modelID: number, callback: (mesh: FlatMesh) => void): void;
  GetGeometry(modelID: number, geometryExpressID: number): IfcGeometry;
  GetVertexArray(ptr: number, size: number): Float32Array;
  GetIndexArray(ptr: number, size: number): Uint32Array;
}

interface FlatMesh {
  expressID: number;
  geometries: { size(): number; get(index: number): PlacedGeometry };
}

interface PlacedGeometry {
  geometryExpressID: number;
  color: { x: number; y: number; z: number; w: number };
  flatTransformation: number[];
}

interface IfcGeometry {
  GetVertexData(): number;
  GetVertexDataSize(): number;
  GetIndexData(): number;
  GetIndexDataSize(): number;
}

const TYPE_CATEGORIES: Record<number, string> = {
  45: "구조", 46: "구조", 1529196076: "구조", 843113511: "구조",
  753842376: "구조", 900683007: "구조",
  395920057: "건축", 3304561284: "건축", 331165859: "건축",
  2016517767: "건축", 2262370178: "건축", 1973544240: "건축",
  263784265: "가구", 3171933400: "기타", 1073191201: "기타",
};

function StatsPanel({ parentRef }: { parentRef: React.RefObject<HTMLDivElement | null> }) {
  useEffect(() => {
    if (!parentRef.current) return;
    
    const stats = new StatsImpl();
    stats.showPanel(0);
    stats.dom.style.position = 'absolute';
    stats.dom.style.left = '0px';
    stats.dom.style.bottom = '0px';
    stats.dom.style.top = 'auto';
    stats.dom.style.zIndex = '10';
    
    parentRef.current.appendChild(stats.dom);
    
    let animationId: number;
    const animate = () => {
      stats.update();
      animationId = requestAnimationFrame(animate);
    };
    animate();
    
    return () => {
      cancelAnimationFrame(animationId);
      if (stats.dom.parentNode) {
        stats.dom.parentNode.removeChild(stats.dom);
      }
    };
  }, [parentRef]);
  
  return null;
}

export function FragmentsViewer() {
  // 컨테이너 ref
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  
  // Three.js refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);
  
  // web-ifc refs
  const ifcApiRef = useRef<IfcAPI | null>(null);
  const modelIDRef = useRef<number | null>(null);
  
  // 데이터 refs
  const typeToExpressIDsRef = useRef<Map<number, number[]>>(new Map());
  const elementDimensionsRef = useRef<Map<number, ElementDimensions>>(new Map());
  const meshMapRef = useRef<Map<number, THREE.Mesh[]>>(new Map()); // expressID -> Mesh[]
  
  // 모델 상태
  const [hasModel, setHasModel] = useState(false);
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [storeys, setStoreys] = useState<StoreyInfo[]>([]);
  const [spatialTree, setSpatialTree] = useState<IFCSpatialNode | null>(null);
  
  // 로딩 상태
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  
  // UI 상태
  const [showSidebar, setShowSidebar] = useState(true);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [xrayMode, setXrayMode] = useState(false);
  const [showEdges, setShowEdges] = useState(true);
  const [showStats, setShowStats] = useState(true);
  
  // 선택 상태
  const [selectedExpressIDs, setSelectedExpressIDs] = useState<number[]>([]);
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);
  const [tableHighlightedIDs, setTableHighlightedIDs] = useState<number[]>([]);
  
  // 표시/숨김 상태
  const [hiddenMaterialIds, setHiddenMaterialIds] = useState<Set<string>>(new Set());
  const [selectedStorey, setSelectedStorey] = useState<string | null>(null);
  const [visibleExpressIDs, setVisibleExpressIDs] = useState<Set<number> | null>(null);

  // Three.js 초기화
  useEffect(() => {
    if (!containerRef.current || sceneRef.current) return;

    console.log("🎨 Three.js 초기화...");

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1e293b);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(
      45,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      10000
    );
    camera.position.set(50, 50, 50);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ 
      antialias: true,
      powerPreference: "high-performance"
    });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controlsRef.current = controls;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 100, 50);
    scene.add(directionalLight);

    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
    directionalLight2.position.set(-50, 50, -50);
    scene.add(directionalLight2);

    // Grid Helper
    const gridHelper = new THREE.GridHelper(100, 100, 0x444444, 0x333333);
    scene.add(gridHelper);

    // Animation Loop
    let animationId: number;
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Resize Handler
    const handleResize = () => {
      if (!containerRef.current) return;
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    window.addEventListener('resize', handleResize);

    // Raycaster for selection
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    
    // 드래그 vs 클릭 구분
    let pointerDownPos = { x: 0, y: 0 };
    let isDragging = false;
    const DRAG_THRESHOLD = 5; // 픽셀
    
    const handlePointerDown = (event: PointerEvent) => {
      pointerDownPos = { x: event.clientX, y: event.clientY };
      isDragging = false;
    };
    
    const handlePointerMove = (event: PointerEvent) => {
      const dx = event.clientX - pointerDownPos.x;
      const dy = event.clientY - pointerDownPos.y;
      if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
        isDragging = true;
      }
    };
    
    const handlePointerUp = (event: PointerEvent) => {
      // 드래그 중이면 클릭 무시
      if (isDragging) return;
      if (!containerRef.current || !modelRef.current) return;
      
      const rect = containerRef.current.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      
      raycaster.setFromCamera(mouse, camera);
      
      // 모델 내 모든 visible 메시 수집
      const meshesToTest: THREE.Mesh[] = [];
      modelRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh && child.visible) {
          meshesToTest.push(child);
        }
      });
      
      const intersects = raycaster.intersectObjects(meshesToTest, false);
      
      if (intersects.length > 0) {
        const mesh = intersects[0].object as THREE.Mesh;
        const expressID = mesh.userData.expressID;
        const typeCode = mesh.userData.typeCode;
        
        if (expressID !== undefined) {
          // 동일 타입 다중 선택 (typeCode가 있으면 같은 타입 모두 선택)
          const sameTypeIDs = typeToExpressIDsRef.current.get(typeCode);
          
          if (sameTypeIDs && sameTypeIDs.length > 0) {
            console.log(`🖱️ 클릭: expressID=${expressID}, typeCode=${typeCode}, 동일타입=${sameTypeIDs.length}개`);
            setSelectedExpressIDs([...sameTypeIDs]); // 새 배열로 전달
          } else {
            console.log(`🖱️ 클릭: expressID=${expressID}, typeCode=${typeCode}, 단일선택`);
            setSelectedExpressIDs([expressID]);
          }
        }
      } else {
        setSelectedExpressIDs([]);
      }
    };
    
    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointermove', handlePointerMove);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);

    console.log("✅ Three.js 초기화 완료");

    // Cleanup
    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      renderer.dispose();
      if (containerRef.current && renderer.domElement.parentNode) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, []);

  // 다크모드 변경
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.background = new THREE.Color(isDarkMode ? 0x1e293b : 0xf1f5f9);
    }
  }, [isDarkMode]);

  // 선택 하이라이트 + X-Ray 통합 (Legacy 방식)
  const xraySelectedIDsRef = useRef<number[]>([]);
  
  useEffect(() => {
    // X-Ray 대상 ID 저장 (처음 켜질 때만)
    if (xrayMode && selectedExpressIDs.length > 0 && xraySelectedIDsRef.current.length === 0) {
      xraySelectedIDsRef.current = [...selectedExpressIDs];
    }
    if (!xrayMode) {
      xraySelectedIDsRef.current = [];
    }
  }, [xrayMode, selectedExpressIDs]);
  
  useEffect(() => {
    if (!modelRef.current) return;
    
    const highlightColor = new THREE.Color(0x3b82f6); // 파란색 (Tailwind blue-500)
    const tableHighlightColor = new THREE.Color(0x22c55e); // 초록색
    
    // X-Ray 대상 (저장된 ID 사용)
    const xrayTargets = new Set(xraySelectedIDsRef.current);
    const hasXrayTargets = xrayMode && xrayTargets.size > 0;
    
    modelRef.current.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      
      const expressID = child.userData.expressID;
      const originalColor = child.userData.originalColor;
      const originalOpacity = child.userData.originalOpacity ?? 1;
      
      if (!originalColor) return;
      
      const material = child.material as THREE.MeshLambertMaterial;
      const isSelected = selectedExpressIDs.includes(expressID);
      const isTableHighlighted = tableHighlightedIDs.includes(expressID);
      const isXrayTarget = hasXrayTargets && xrayTargets.has(expressID);
      
      if (isTableHighlighted) {
        // 테이블에서 강조 (초록색)
        material.color.copy(tableHighlightColor);
        material.opacity = isXrayTarget ? 0.7 : 1;
        material.transparent = isXrayTarget;
        material.depthTest = !isXrayTarget; // X-Ray 대상이면 투시
        child.renderOrder = isXrayTarget ? 1000 : 1;
      } else if (isSelected) {
        // 3D 선택 (파란색)
        material.color.copy(highlightColor);
        material.opacity = isXrayTarget ? 0.7 : 1;
        material.transparent = isXrayTarget;
        material.depthTest = !isXrayTarget; // X-Ray 대상이면 투시
        child.renderOrder = isXrayTarget ? 999 : 0;
      } else {
        // 원래 상태
        material.color.copy(originalColor);
        material.opacity = originalOpacity;
        material.transparent = originalOpacity < 1;
        material.depthTest = true;
        child.renderOrder = 0;
      }
      
      material.needsUpdate = true;
    });
  }, [selectedExpressIDs, tableHighlightedIDs, xrayMode]);

  // 층 필터링
  useEffect(() => {
    if (selectedStorey) {
      const storey = storeys.find(s => s.id === selectedStorey);
      if (storey?.expressIDs) {
        setVisibleExpressIDs(new Set(storey.expressIDs));
      }
    } else {
      setVisibleExpressIDs(null);
    }
  }, [selectedStorey, storeys]);

  // 가시성 적용
  useEffect(() => {
    if (!modelRef.current) return;
    
    modelRef.current.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      
      const expressID = child.userData.expressID;
      
      if (visibleExpressIDs !== null) {
        child.visible = visibleExpressIDs.has(expressID);
      } else {
        child.visible = true;
      }
    });
  }, [visibleExpressIDs]);

  // 윤곽선 생성
  const edgesGroupRef = useRef<THREE.Group | null>(null);
  
  useEffect(() => {
    if (!sceneRef.current || !hasModel || !modelRef.current) return;
    
    const scene = sceneRef.current;
    
    // 기존 윤곽선 제거
    if (edgesGroupRef.current) {
      scene.remove(edgesGroupRef.current);
      edgesGroupRef.current.traverse((child) => {
        if (child instanceof THREE.LineSegments) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
      edgesGroupRef.current = null;
    }
    
    if (!showEdges) return;
    
    // 새 윤곽선 생성
    const edgesGroup = new THREE.Group();
    edgesGroup.name = "__edges__";
    
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: isDarkMode ? 0x666666 : 0x444444,
      transparent: true,
      opacity: 0.4,
    });
    
    let edgeCount = 0;
    const maxEdges = 10000; // 성능을 위해 제한
    
    // 층 필터가 있으면 해당 층만, 없으면 전체
    const visibleSet = visibleExpressIDs ? visibleExpressIDs : null;
    
    modelRef.current.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry && edgeCount < maxEdges) {
        // 층 필터 적용: visibleExpressIDs가 있으면 해당 ID만 윤곽선 생성
        const expressID = child.userData?.expressID;
        if (visibleSet !== null && expressID !== undefined && !visibleSet.has(expressID)) {
          return; // 보이지 않는 메시는 건너뜀
        }
        
        try {
          const edges = new THREE.EdgesGeometry(child.geometry, 30);
          const line = new THREE.LineSegments(edges, edgeMaterial.clone());
          
          // 메시의 월드 변환 복사
          child.updateWorldMatrix(true, false);
          line.applyMatrix4(child.matrixWorld);
          
          edgesGroup.add(line);
          edgeCount++;
        } catch {}
      }
    });
    
    if (edgeCount > 0) {
      scene.add(edgesGroup);
      edgesGroupRef.current = edgesGroup;
      console.log(`✅ 윤곽선 생성: ${edgeCount}개`);
    }
  }, [showEdges, hasModel, isDarkMode, visibleExpressIDs]);

  // GLB 내보내기 (최적화 버전)
  const handleExportGLB = useCallback(async () => {
    if (!modelRef.current) {
      alert("내보낼 모델이 없습니다.");
      return;
    }

    try {
      setIsLoading(true);
      setLoadingMessage("메시 최적화 중...");
      setProgress(20);

      // 1. 메시들을 재질별로 그룹화하여 병합
      const materialMeshMap = new Map<string, THREE.Mesh[]>();
      
      modelRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh && child.geometry) {
          const material = child.material as THREE.MeshLambertMaterial;
          // 재질 색상으로 그룹화
          const key = material.color ? material.color.getHexString() : 'default';
          if (!materialMeshMap.has(key)) {
            materialMeshMap.set(key, []);
          }
          materialMeshMap.get(key)!.push(child);
        }
      });

      setProgress(40);
      setLoadingMessage("지오메트리 병합 중...");

      // 2. 병합된 메시들로 새 그룹 생성
      const optimizedGroup = new THREE.Group();
      
      for (const [colorKey, meshes] of materialMeshMap) {
        if (meshes.length === 0) continue;
        
        // 지오메트리 병합
        const geometries: THREE.BufferGeometry[] = [];
        
        for (const mesh of meshes) {
          const geo = mesh.geometry.clone();
          // 월드 변환 적용
          geo.applyMatrix4(mesh.matrixWorld);
          geometries.push(geo);
        }
        
        if (geometries.length > 0) {
          // BufferGeometryUtils로 병합
          const BufferGeometryUtils = await import('three/examples/jsm/utils/BufferGeometryUtils.js');
          const mergedGeo = BufferGeometryUtils.mergeGeometries(geometries, false);
          
          if (mergedGeo) {
            // 재질 복사
            const originalMaterial = meshes[0].material as THREE.MeshLambertMaterial;
            const newMaterial = new THREE.MeshStandardMaterial({
              color: originalMaterial.color,
              opacity: originalMaterial.opacity,
              transparent: originalMaterial.transparent,
            });
            
            const mergedMesh = new THREE.Mesh(mergedGeo, newMaterial);
            optimizedGroup.add(mergedMesh);
          }
          
          // 정리
          geometries.forEach(g => g.dispose());
        }
      }

      setProgress(60);
      setLoadingMessage("GLB 내보내기 중...");

      const exporter = new GLTFExporter();
      
      // GLB로 내보내기 (최적화 옵션)
      exporter.parse(
        optimizedGroup,
        (result) => {
          const blob = new Blob([result as ArrayBuffer], { type: "application/octet-stream" });
          const sizeMB = (blob.size / 1024 / 1024).toFixed(2);
          
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "model_optimized.glb";
          a.click();
          URL.revokeObjectURL(url);
          
          // 정리
          optimizedGroup.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.geometry.dispose();
              if (child.material instanceof THREE.Material) {
                child.material.dispose();
              }
            }
          });
          
          setIsLoading(false);
          console.log(`✅ GLB 내보내기 완료! (${sizeMB}MB)`);
          alert(`GLB 내보내기 완료!\n파일 크기: ${sizeMB}MB`);
        },
        (error) => {
          console.error("❌ GLB 내보내기 실패:", error);
          setError("GLB 내보내기 실패: " + error);
          setIsLoading(false);
        },
        { binary: true }
      );
    } catch (err) {
      console.error("❌ GLB 내보내기 실패:", err);
      setError("GLB 내보내기 실패: " + (err instanceof Error ? err.message : String(err)));
      setIsLoading(false);
    }
  }, []);

  // FRAG 내보내기 - IFC 파일 필요
  // 저장된 IFC 버퍼를 .frag로 변환
  const ifcBufferRef = useRef<Uint8Array | null>(null);
  
  const handleExportFRAG = useCallback(async () => {
    if (!ifcBufferRef.current) {
      alert("⚠️ FRAG 내보내기는 IFC 파일 로드 후에만 가능합니다.\n\nIFC 원본 데이터가 필요합니다.");
      return;
    }

    try {
      setIsLoading(true);
      setLoadingMessage("FRAG 변환 준비 중...");
      setProgress(10);

      console.log("📦 FRAG 내보내기 시작...");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const IfcImporter = (FRAGS as any).IfcImporter;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const FragmentsModels = (FRAGS as any).FragmentsModels;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const GeometryEngine = (FRAGS as any).GeometryEngine;
      
      console.log("📊 사용 가능한 클래스:");
      console.log("  - IfcImporter:", !!IfcImporter);
      console.log("  - FragmentsModels:", !!FragmentsModels);
      console.log("  - GeometryEngine:", !!GeometryEngine);

      setProgress(20);
      setLoadingMessage("Worker 로드 중...");

      // Worker URL 설정
      const workerUrl = "https://thatopen.github.io/engine_fragment/resources/worker.mjs";
      const fetchedUrl = await fetch(workerUrl);
      const workerBlob = await fetchedUrl.blob();
      const workerFile = new File([workerBlob], "worker.mjs", { type: "text/javascript" });
      const localWorkerUrl = URL.createObjectURL(workerFile);

      setProgress(30);
      setLoadingMessage("FragmentsModels 초기화 중...");

      // FragmentsModels 인스턴스 생성 및 Worker 초기화
      const fragmentsModels = new FragmentsModels();
      
      // Worker 초기화 시도
      const initMethods = ['init', 'initialize', 'setup', 'start'];
      for (const method of initMethods) {
        if (typeof (fragmentsModels as any)[method] === 'function') {
          try {
            console.log(`📊 fragmentsModels.${method}() 시도...`);
            await (fragmentsModels as any)[method](localWorkerUrl);
            console.log(`✅ fragmentsModels.${method}() 성공!`);
            break;
          } catch (initErr) {
            console.log(`⚠️ fragmentsModels.${method}() 실패:`, initErr);
          }
        }
      }
      
      // 잠시 대기 (Worker 초기화 시간)
      await new Promise(resolve => setTimeout(resolve, 500));

      setProgress(40);
      setLoadingMessage("IFC → Fragments 변환 중...");

      let fragmentsModel;
      
      // GeometryEngine 초기화 시도 (Builder 역할)
      if (GeometryEngine) {
        try {
          console.log("📊 GeometryEngine 초기화 시도...");
          const engine = new GeometryEngine();
          console.log("📊 GeometryEngine 인스턴스:", engine);
          console.log("📊 GeometryEngine 메서드:", Object.getOwnPropertyNames(Object.getPrototypeOf(engine)));
          
          // 초기화 메서드 시도
          for (const method of initMethods) {
            if (typeof (engine as any)[method] === 'function') {
              try {
                await (engine as any)[method]();
                console.log(`✅ GeometryEngine.${method}() 성공!`);
              } catch {}
            }
          }
        } catch (engineErr) {
          console.log("⚠️ GeometryEngine 초기화 실패:", engineErr);
        }
      }

      // IfcImporter 정적 메서드 확인 (안전하게)
      if (IfcImporter) {
        console.log("📊 IfcImporter 정적 메서드:", Object.getOwnPropertyNames(IfcImporter));
        
        // 정적 import 메서드 시도
        if (typeof IfcImporter.import === 'function') {
          try {
            console.log("📊 IfcImporter.import() 정적 메서드 시도...");
            fragmentsModel = await IfcImporter.import(ifcBufferRef.current);
            console.log("✅ IfcImporter.import() 성공!", fragmentsModel);
          } catch (staticErr) {
            console.log("⚠️ IfcImporter.import() 실패:", staticErr);
          }
        }
        
        // new IfcImporter() 시도 (Builder 에러 발생 가능)
        if (!fragmentsModel) {
          try {
            console.log("📊 new IfcImporter() 시도...");
            const importer = new IfcImporter();
            console.log("📊 IfcImporter 생성 성공:", importer);
            
            // 메서드 목록
            const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(importer));
            console.log("📊 IfcImporter 메서드:", methods);
            
            // import 시도
            if (typeof importer.import === 'function') {
              fragmentsModel = await importer.import(ifcBufferRef.current);
              console.log("✅ importer.import() 성공!", fragmentsModel);
            }
          } catch (instanceErr: any) {
            console.log("⚠️ IfcImporter 인스턴스 생성/사용 실패:", instanceErr?.message || instanceErr);
          }
        }
      }

      // FragmentsModels를 통한 로드 시도
      if (!fragmentsModel) {
        console.log("📊 FragmentsModels를 통한 변환 시도...");
        
        const loadMethods = ['load', 'loadIfc', 'importIfc', 'fromIfc', 'parseIfc'];
        for (const method of loadMethods) {
          if (typeof (fragmentsModels as any)[method] === 'function') {
            try {
              console.log(`📊 fragmentsModels.${method}() 시도...`);
              fragmentsModel = await (fragmentsModels as any)[method](ifcBufferRef.current);
              console.log(`✅ fragmentsModels.${method}() 성공!`, fragmentsModel);
              break;
            } catch (loadErr: any) {
              console.log(`⚠️ fragmentsModels.${method}() 실패:`, loadErr?.message || loadErr);
            }
          }
        }
      }

      setProgress(70);
      setLoadingMessage("FRAG 파일 생성 중...");

      if (fragmentsModel) {
        console.log("📊 변환된 모델:", fragmentsModel);
        console.log("📊 모델 메서드:", Object.getOwnPropertyNames(Object.getPrototypeOf(fragmentsModel)));
        
        // getBuffer 메서드로 .frag 데이터 추출
        let fragBuffer;
        if (typeof fragmentsModel.getBuffer === 'function') {
          console.log("📊 getBuffer 호출 중...");
          fragBuffer = await fragmentsModel.getBuffer(false);
        }

        if (fragBuffer) {
          setProgress(90);
          
          const blob = new Blob([fragBuffer], { type: "application/octet-stream" });
          const sizeMB = (blob.size / 1024 / 1024).toFixed(2);
          
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "model.frag";
          a.click();
          URL.revokeObjectURL(url);
          
          setProgress(100);
          console.log(`✅ FRAG 내보내기 완료! (${sizeMB}MB)`);
          alert(`✅ FRAG 내보내기 완료!\n파일 크기: ${sizeMB}MB`);
        } else {
          throw new Error("FRAG 버퍼를 생성할 수 없습니다.\n\n콘솔에서 사용 가능한 API를 확인하세요.");
        }
      } else {
        // 사용 가능한 정보 출력
        alert("⚠️ IFC → Fragments 변환 실패\n\nIfcImporter API가 예상과 다릅니다.\n콘솔에서 사용 가능한 메서드를 확인하세요.");
      }

      URL.revokeObjectURL(localWorkerUrl);
      setIsLoading(false);
    } catch (err) {
      console.error("❌ FRAG 내보내기 실패:", err);
      setError("FRAG 내보내기 실패: " + (err instanceof Error ? err.message : String(err)));
      alert("❌ FRAG 내보내기 실패\n\n" + (err instanceof Error ? err.message : String(err)) + "\n\n콘솔에서 자세한 정보를 확인하세요.");
      setIsLoading(false);
    }
  }, []);

  // GLB 파일 로드
  const loadGLBFile = useCallback(async (file: File) => {
    if (!sceneRef.current || !cameraRef.current) return;

    setIsLoading(true);
    setError(null);
    setProgress(10);
    setLoadingMessage("GLB 파일 로딩...");

    try {
      // 기존 모델 제거
      if (modelRef.current) {
        sceneRef.current.remove(modelRef.current);
        modelRef.current.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (Array.isArray(child.material)) {
              child.material.forEach(m => m.dispose());
            } else {
              child.material.dispose();
            }
          }
        });
        modelRef.current = null;
      }

      setProgress(30);
      setLoadingMessage("GLB 파싱 중...");

      const loader = new GLTFLoader();
      const arrayBuffer = await file.arrayBuffer();
      
      loader.parse(arrayBuffer, "", (gltf) => {
        setProgress(70);
        setLoadingMessage("Scene에 추가...");

        const model = gltf.scene;
        modelRef.current = model;
        sceneRef.current!.add(model);

        // 카메라 맞춤
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);

        cameraRef.current!.position.set(
          center.x + maxDim,
          center.y + maxDim * 0.5,
          center.z + maxDim
        );
        cameraRef.current!.lookAt(center);

        setProgress(100);
        setLoadingMessage("완료!");
        setHasModel(true);
        setIsLoading(false);

        console.log("✅ GLB 로드 완료!");
      }, (error) => {
        console.error("❌ GLB 로드 실패:", error);
        setError("GLB 로드 실패: " + error.message);
        setIsLoading(false);
      });
    } catch (err) {
      console.error("❌ GLB 로드 실패:", err);
      setError("GLB 로드 실패: " + (err instanceof Error ? err.message : String(err)));
      setIsLoading(false);
    }
  }, []);

  // 파일 로드 (IFC, GLB 지원)
  const handleFileLoad = useCallback(async (file: File) => {
    if (!sceneRef.current) {
      setError("뷰어가 초기화되지 않았습니다.");
      return;
    }

    const fileName = file.name.toLowerCase();
    
    // GLB 파일은 별도 처리
    if (fileName.endsWith('.glb') || fileName.endsWith('.gltf')) {
      loadGLBFile(file);
      return;
    }

    // .frag 파일은 ThatOpen 뷰어에서만 지원
    if (fileName.endsWith('.frag')) {
      setError(".frag 파일은 'ThatOpen (.frag)' 뷰어에서만 지원됩니다. 우측 상단에서 뷰어를 전환해주세요.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setProgress(5);
    setLoadingMessage("라이브러리 로딩...");

    try {
      // 기존 모델 제거
      if (modelRef.current) {
        sceneRef.current.remove(modelRef.current);
        modelRef.current.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (Array.isArray(child.material)) {
              child.material.forEach(m => m.dispose());
            } else {
              child.material.dispose();
            }
          }
        });
        modelRef.current = null;
      }

      // 데이터 초기화
      typeToExpressIDsRef.current.clear();
      elementDimensionsRef.current.clear();
      meshMapRef.current.clear();
      setMaterials([]);
      setStoreys([]);
      setSpatialTree(null);
      setSelectedExpressIDs([]);
      setSelectedMaterialId(null);

      setProgress(10);
      setLoadingMessage("web-ifc 초기화...");

      // web-ifc 로드 (동적 import)
      // 참고: https://github.com/ThatOpen/engine_web-ifc/tree/main/examples/usage
      const WebIFC = await import("web-ifc");
      
      let ifcApi = ifcApiRef.current;
      if (!ifcApi) {
        ifcApi = new WebIFC.IfcAPI() as unknown as IfcAPI;
        // WASM 경로: /wasm/ (useIFCLoader와 동일)
        ifcApi.SetWasmPath("/wasm/");
        await ifcApi.Init();
        ifcApiRef.current = ifcApi;
        console.log("✅ web-ifc 초기화 완료");
      }

      setProgress(15);
      setLoadingMessage("파일 읽는 중...");

      // 기존 모델 닫기
      if (modelIDRef.current !== null) {
        try { ifcApi.CloseModel(modelIDRef.current); } catch {}
      }

      const data = await file.arrayBuffer();
      const fileSizeMB = data.byteLength / 1024 / 1024;
      console.log(`📂 IFC 로드: ${file.name} (${fileSizeMB.toFixed(2)}MB)`);

      // IFC 버퍼 저장 (FRAG 내보내기용)
      ifcBufferRef.current = new Uint8Array(data);
      console.log("📦 IFC 버퍼 저장됨 (FRAG 내보내기 가능)");

      setProgress(20);
      setLoadingMessage("모델 파싱 중...");

      const modelID = ifcApi.OpenModel(new Uint8Array(data));
      modelIDRef.current = modelID;

      // 지오메트리 수집
      setProgress(25);
      setLoadingMessage("지오메트리 수집 중...");

      const group = new THREE.Group();
      group.name = file.name;
      
      const materialCache = new Map<string, THREE.MeshLambertMaterial>();
      const getMaterial = (r: number, g: number, b: number, a: number) => {
        const key = `${r.toFixed(2)}_${g.toFixed(2)}_${b.toFixed(2)}_${a.toFixed(2)}`;
        if (!materialCache.has(key)) {
          materialCache.set(key, new THREE.MeshLambertMaterial({
            color: new THREE.Color(r, g, b),
            transparent: a < 1,
            opacity: a,
            side: THREE.DoubleSide,
          }));
        }
        return materialCache.get(key)!.clone(); // 개별 수정을 위해 clone
      };

      interface MeshData {
        expressID: number;
        typeCode: number;
        positions: Float32Array;
        normals: Float32Array;
        indices: Uint32Array;
        color: { x: number; y: number; z: number; w: number };
        transformation: number[];
      }
      
      const meshDataList: MeshData[] = [];
      const tempTypeData: { expressID: number; typeCode: number }[] = [];

      // StreamAllMeshes로 지오메트리 수집
      ifcApi.StreamAllMeshes(modelID, (flatMesh) => {
        const expressID = flatMesh.expressID;
        let typeCode = 0;
        
        try {
          const props = ifcApi!.GetLine(modelID, expressID, false);
          typeCode = props.type || 0;
        } catch {}

        tempTypeData.push({ expressID, typeCode });

        const geometries = flatMesh.geometries;
        for (let i = 0; i < geometries.size(); i++) {
          const pg = geometries.get(i);
          const geo = ifcApi!.GetGeometry(modelID, pg.geometryExpressID);
          
          const vertSize = geo.GetVertexDataSize();
          const indexSize = geo.GetIndexDataSize();
          if (vertSize === 0 || indexSize === 0) continue;
          
          const verts = ifcApi!.GetVertexArray(geo.GetVertexData(), vertSize);
          const indices = ifcApi!.GetIndexArray(geo.GetIndexData(), indexSize);
          if (verts.length === 0 || indices.length === 0) continue;

          const vertexCount = verts.length / 6;
          const positions = new Float32Array(vertexCount * 3);
          const normals = new Float32Array(vertexCount * 3);

          for (let v = 0; v < vertexCount; v++) {
            const srcIdx = v * 6;
            const dstIdx = v * 3;
            positions[dstIdx] = verts[srcIdx];
            positions[dstIdx + 1] = verts[srcIdx + 1];
            positions[dstIdx + 2] = verts[srcIdx + 2];
            normals[dstIdx] = verts[srcIdx + 3];
            normals[dstIdx + 1] = verts[srcIdx + 4];
            normals[dstIdx + 2] = verts[srcIdx + 5];
          }

          meshDataList.push({
            expressID, typeCode, positions, normals,
            indices: new Uint32Array(indices),
            color: pg.color,
            transformation: pg.flatTransformation,
          });
        }
      });

      console.log(`📊 수집: ${meshDataList.length}개 지오메트리`);

      // 메시 생성 (동기 처리 - 제한 없음)
      setProgress(30);
      setLoadingMessage(`메시 생성 중... (0/${meshDataList.length})`);
      
      const totalMeshes = meshDataList.length;

      for (let i = 0; i < totalMeshes; i++) {
        const data = meshDataList[i];
        
        const bufferGeo = new THREE.BufferGeometry();
        bufferGeo.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
        bufferGeo.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
        bufferGeo.setIndex(new THREE.BufferAttribute(data.indices, 1));

        const material = getMaterial(data.color.x, data.color.y, data.color.z, data.color.w);
        const mesh = new THREE.Mesh(bufferGeo, material);
        
        const matrix = new THREE.Matrix4();
        matrix.fromArray(data.transformation);
        mesh.applyMatrix4(matrix);
        
        // 메타데이터 저장
        mesh.userData.expressID = data.expressID;
        mesh.userData.typeCode = data.typeCode;
        mesh.userData.originalColor = new THREE.Color(data.color.x, data.color.y, data.color.z);
        mesh.userData.originalOpacity = data.color.w;

        // 바운딩 박스로 규격 계산
        bufferGeo.computeBoundingBox();
        if (bufferGeo.boundingBox) {
          const box = bufferGeo.boundingBox.clone();
          box.applyMatrix4(matrix);
          const size = box.getSize(new THREE.Vector3());
          const dims = [size.x, size.y, size.z].sort((a, b) => b - a);
          const area = dims[0] * dims[1];
          
          const existing = elementDimensionsRef.current.get(data.expressID);
          if (existing) {
            elementDimensionsRef.current.set(data.expressID, {
              width: Math.max(existing.width, Math.round(size.x * 1000)),
              height: Math.max(existing.height, Math.round(size.y * 1000)),
              depth: Math.max(existing.depth, Math.round(size.z * 1000)),
              area: (existing.area || 0) + area,
            });
          } else {
            elementDimensionsRef.current.set(data.expressID, {
              width: Math.round(size.x * 1000),
              height: Math.round(size.y * 1000),
              depth: Math.round(size.z * 1000),
              area,
            });
          }
        }

        // meshMap에 추가
        const meshes = meshMapRef.current.get(data.expressID) || [];
        meshes.push(mesh);
        meshMapRef.current.set(data.expressID, meshes);

        group.add(mesh);
        
        // 프로그레스 업데이트 (500개마다)
        if (i % 500 === 0 || i === totalMeshes - 1) {
          const meshProgress = 30 + Math.floor((i / totalMeshes) * 50); // 30% ~ 80%
          setProgress(meshProgress);
          setLoadingMessage(`메시 생성 중... (${i + 1}/${totalMeshes})`);
          await new Promise(resolve => setTimeout(resolve, 0)); // UI 업데이트만
        }
      }

      setProgress(80);
      console.log(`✅ 메시 생성: ${group.children.length}개`);

      // 타입별 expressIDs 수집 (선택 기능에 필요)
      setProgress(82);
      setLoadingMessage("타입 정보 수집...");
      
      for (const { expressID, typeCode } of tempTypeData) {
        const existing = typeToExpressIDsRef.current.get(typeCode) || [];
        existing.push(expressID);
        typeToExpressIDsRef.current.set(typeCode, existing);
      }
      
      console.log(`📊 타입 수집: ${typeToExpressIDsRef.current.size}개 타입`);

      // 공간 구조 파싱
      setProgress(85);
      setLoadingMessage("공간 구조 분석...");

      const storeyList: StoreyInfo[] = [];
      try {
        const storeyIds = ifcApi.GetLineIDsWithType(modelID, IFC_SPATIAL_TYPES.IFCBUILDINGSTOREY);
        const containsIds = ifcApi.GetLineIDsWithType(modelID, IFC_SPATIAL_TYPES.IFCRELCONTAINEDINSPATIALSTRUCTURE);
        const storeyElementsMap = new Map<number, number[]>();
        
        // 관계 매핑
        for (let j = 0; j < containsIds.size(); j++) {
          try {
            const rel = ifcApi.GetLine(modelID, containsIds.get(j), false);
            const spatialId = rel.RelatingStructure?.value;
            if (spatialId) {
              const elements = rel.RelatedElements || [];
              const expressIDs: number[] = [];
              for (const elem of elements) {
                if (elem?.value) expressIDs.push(elem.value);
              }
              const existing = storeyElementsMap.get(spatialId) || [];
              storeyElementsMap.set(spatialId, [...existing, ...expressIDs]);
            }
          } catch {}
        }
        
        // 층 정보 생성
        for (let i = 0; i < storeyIds.size(); i++) {
          const storeyId = storeyIds.get(i);
          try {
            const props = ifcApi.GetLine(modelID, storeyId, false);
            const name = props.Name?.value || props.LongName?.value || `층 ${i + 1}`;
            storeyList.push({
              id: `storey_${storeyId}`,
              name,
              elevation: 0,
              expressIDs: storeyElementsMap.get(storeyId) || [],
            });
          } catch {}
        }
      } catch (err) {
        console.warn("층 정보 파싱 실패:", err);
      }
      
      setStoreys(storeyList);
      console.log(`🏢 층 정보: ${storeyList.length}개`);

      // 자재 목록 생성
      setProgress(90);
      setLoadingMessage("자재 목록 생성...");

      const materialMap = new Map<string, {
        typeCode: number;
        spec: string;
        totalArea: number;
        expressIDs: number[];
        dimensions: ElementDimensions;
      }>();

      for (const { expressID, typeCode } of tempTypeData) {
        const dim = elementDimensionsRef.current.get(expressID);
        if (!dim) continue;
        
        const sizes = [dim.width, dim.height, dim.depth].sort((a, b) => b - a);
        const spec = `${sizes[0]}×${sizes[1]}×${sizes[2]}`;
        const key = `${typeCode}_${spec}`;
        
        const existing = materialMap.get(key);
        if (existing) {
          existing.expressIDs.push(expressID);
          existing.totalArea += dim.area || 0;
        } else {
          materialMap.set(key, {
            typeCode, spec,
            totalArea: dim.area || 0,
            expressIDs: [expressID],
            dimensions: dim,
          });
        }
      }

      const materialsList: MaterialItem[] = [];
      materialMap.forEach((data, key) => {
        materialsList.push({
          id: key,
          typeCode: data.typeCode,
          typeName: IFC_TYPE_NAMES[data.typeCode] || `타입 ${data.typeCode}`,
          category: TYPE_CATEGORIES[data.typeCode] || "기타",
          spec: data.spec,
          count: data.expressIDs.length,
          unit: "개",
          totalArea: data.totalArea,
          expressIDs: data.expressIDs,
          dimensions: data.dimensions,
        });
      });

      materialsList.sort((a, b) => 
        a.category.localeCompare(b.category) || 
        a.typeName.localeCompare(b.typeName)
      );

      setMaterials(materialsList);
      console.log(`📦 자재: ${materialsList.length}개`);

      // 모델 중심 정렬
      setProgress(95);
      setLoadingMessage("모델 배치 중...");

      if (group.children.length > 0) {
        const box = new THREE.Box3().setFromObject(group);
        const center = box.getCenter(new THREE.Vector3());
        group.position.set(-center.x, -center.y, -center.z);

        // 카메라 조정
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        
        if (cameraRef.current && controlsRef.current) {
          cameraRef.current.position.set(maxDim, maxDim * 0.7, maxDim);
          controlsRef.current.target.set(0, 0, 0);
          controlsRef.current.update();
        }
      }

      // Scene에 추가
      sceneRef.current.add(group);
      modelRef.current = group;

      setProgress(100);
      setLoadingMessage("완료!");
      setHasModel(true);
      setIsLoading(false);

      console.log(`🎉 로드 완료: ${group.children.length}개 메시`);

    } catch (err) {
      console.error("❌ IFC 로드 실패:", err);
      setError("IFC 로드 실패: " + (err instanceof Error ? err.message : String(err)));
      setIsLoading(false);
    }
  }, []);

  // 선택 핸들러들
  const handleElementSelect = useCallback((expressID: number | null, typeCode?: number) => {
    if (expressID === null) {
      setSelectedExpressIDs([]);
      setSelectedMaterialId(null);
      return;
    }

    if (typeCode && typeCode > 0) {
      const sameTypeIDs = typeToExpressIDsRef.current.get(typeCode) || [expressID];
      setSelectedExpressIDs(sameTypeIDs);
    } else {
      setSelectedExpressIDs([expressID]);
    }
  }, []);

  const handleMaterialSelect = useCallback((materialId: string | null) => {
    setSelectedMaterialId(materialId);
    if (materialId) {
      const material = materials.find(m => m.id === materialId);
      if (material) {
        setSelectedExpressIDs(material.expressIDs);
      }
    }
  }, [materials]);

  const handleSelectElements = useCallback((expressIDs: number[]) => {
    setSelectedExpressIDs(expressIDs);
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedExpressIDs([]);
    setSelectedMaterialId(null);
    setTableHighlightedIDs([]);
  }, []);

  // 가시성 핸들러들
  const handleToggleVisibility = useCallback((materialId: string) => {
    setHiddenMaterialIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(materialId)) {
        newSet.delete(materialId);
      } else {
        newSet.add(materialId);
      }
      return newSet;
    });
  }, []);

  const handleShowAll = useCallback(() => {
    setHiddenMaterialIds(new Set());
  }, []);

  const handleHideAll = useCallback(() => {
    const allIds = new Set(materials.map(m => m.id));
    setHiddenMaterialIds(allIds);
  }, [materials]);

  const resetVisibility = useCallback(() => {
    setHiddenMaterialIds(new Set());
    setSelectedStorey(null);
    setVisibleExpressIDs(null);
  }, []);

  // 사이드바 토글 시 리사이즈
  useEffect(() => {
    const timer = setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 50);
    return () => clearTimeout(timer);
  }, [showSidebar]);

  const bgClass = isDarkMode ? "bg-slate-900" : "bg-slate-100";

  return (
    <div className={`relative w-full h-full flex ${bgClass}`}>
      {/* 사이드바 */}
      {showSidebar && (
        <div className="w-80 flex-shrink-0">
          <Sidebar
            materials={materials}
            selectedMaterialId={selectedMaterialId}
            selectedExpressIDs={selectedExpressIDs}
            onSelectMaterial={handleMaterialSelect}
            onSelectElements={handleSelectElements}
            onTableHighlight={setTableHighlightedIDs}
            isDarkMode={isDarkMode}
            hiddenMaterialIds={hiddenMaterialIds}
            onToggleVisibility={handleToggleVisibility}
            onShowAll={handleShowAll}
            onHideAll={handleHideAll}
            storeys={storeys}
            selectedStorey={selectedStorey}
            onSelectStorey={setSelectedStorey}
            spatialTree={spatialTree}
          />
        </div>
      )}

      {/* 3D 뷰어 영역 */}
      <div className="flex-1 relative" ref={viewerRef}>
        <ViewerToolbar
          hasModel={hasModel}
          showTable={showSidebar}
          onToggleTable={() => setShowSidebar(!showSidebar)}
          selectedCount={selectedExpressIDs.length}
          isDarkMode={isDarkMode}
          onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}
          xrayMode={xrayMode}
          onToggleXray={() => setXrayMode(!xrayMode)}
          showEdges={showEdges}
          onToggleEdges={() => setShowEdges(!showEdges)}
          onClearSelection={handleClearSelection}
        />

        {/* 내보내기 버튼들 */}
        {/* hasModel */}
        { false && (
          <div className="absolute top-4 right-4 z-30 flex gap-2">
            <button
              onClick={handleExportGLB}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isDarkMode 
                  ? "bg-green-600 hover:bg-green-500 text-white" 
                  : "bg-green-500 hover:bg-green-600 text-white"
              }`}
            >
              📦 GLB
            </button>
            <button
              onClick={handleExportFRAG}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isDarkMode 
                  ? "bg-purple-600 hover:bg-purple-500 text-white" 
                  : "bg-purple-500 hover:bg-purple-600 text-white"
              }`}
            >
              🧩 FRAG (실험)
            </button>
          </div>
        )}

        {/* 파일 업로드 */}
        {!hasModel && !isLoading && (
          <div className={`absolute inset-0 flex items-center justify-center z-10 ${bgClass}/90`}>
            <FileUpload onFileLoad={handleFileLoad} isDarkMode={isDarkMode} />
          </div>
        )}

        {/* 로딩 */}
        {isLoading && (
          <div className={`absolute inset-0 flex flex-col items-center justify-center z-20 ${bgClass}/95`}>
            <div className="w-80">
              <div className="flex justify-between items-center mb-2">
                <p className={`text-sm font-medium ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>{loadingMessage}</p>
                <span className="text-sm text-blue-500 tabular-nums">{progress}%</span>
              </div>
              <div className={`h-2 rounded-full overflow-hidden ${isDarkMode ? "bg-slate-700" : "bg-slate-300"}`}>
                <div 
                  className="h-full transition-all bg-gradient-to-r from-blue-500 to-blue-400" 
                  style={{ width: `${progress}%` }} 
                />
              </div>
            </div>
          </div>
        )}

        {/* 에러 */}
        {error && (
          <div className="absolute top-16 left-4 right-4 z-20 bg-red-500/10 border border-red-500 text-red-400 px-4 py-3 rounded-lg">
            <p className="font-medium">오류 발생</p>
            <p className="text-sm">{error}</p>
          </div>
        )}

        {/* Three.js 컨테이너 */}
        <div 
          ref={containerRef}
          className="w-full h-full"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />

        {/* FPS 통계 */}
        {showStats && <StatsPanel parentRef={viewerRef} />}

        {/* 로고 */}
        <div className="absolute bottom-4 right-4 z-10">
          <img 
            src="/logo.png" 
            alt="Logo" 
            className="h-8 opacity-40 hover:opacity-70 transition-opacity"
          />
        </div>
      </div>
    </div>
  );
}

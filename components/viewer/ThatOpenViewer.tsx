"use client";

/**
 * ThatOpen Components 기반 뷰어
 * .frag 파일 로드 및 IFC → Fragments 변환 지원
 * 
 * 참고: https://docs.thatopen.com/Tutorials/Components/Core/FragmentsManager
 */

import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBCF from "@thatopen/components-front";

// 기존 UI 컴포넌트 재사용
import { Sidebar } from "./sidebar";
import { ViewerToolbar } from "./toolbar";
import { FileUpload } from "./upload";

// 타입
import { MaterialItem, StoreyInfo, IFCSpatialNode } from "@/types/ifc";

// 성능 통계
import StatsImpl from "stats.js";

// IFC 카테고리 한글 이름 매핑
function getCategoryKoreanName(ifcType: string): string {
  const mapping: Record<string, string> = {
    'IfcWall': '벽',
    'IfcWallStandardCase': '벽',
    'IfcSlab': '슬라브',
    'IfcColumn': '기둥',
    'IfcBeam': '보',
    'IfcDoor': '문',
    'IfcWindow': '창문',
    'IfcStair': '계단',
    'IfcStairFlight': '계단',
    'IfcRoof': '지붕',
    'IfcRailing': '난간',
    'IfcFurniture': '가구',
    'IfcFurnishingElement': '가구',
    'IfcPlate': '판',
    'IfcMember': '부재',
    'IfcCovering': '마감재',
    'IfcFooting': '기초',
    'IfcPile': '파일',
    'IfcCurtainWall': '커튼월',
    'IfcBuildingElementProxy': '기타요소',
    'IfcSpace': '공간',
    'IfcOpeningElement': '개구부',
    'IfcFlowTerminal': '위생기구',
    'IfcFlowSegment': '배관',
    'IfcFlowFitting': '배관피팅',
    'IfcDistributionElement': '설비요소',
    'IfcReinforcingBar': '철근',
    'IfcReinforcingMesh': '철망',
    // 공정별 분류
    'IfcAnnotation': '가설공사',
    'IfcGrid': '측량',
  };
  
  return mapping[ifcType] || ifcType.replace('Ifc', '');
}

// 카테고리별 단위 결정
function getUnitForCategory(category: string): string {
  const unitMapping: Record<string, string> = {
    '벽': 'm²',
    '슬라브': 'm²',
    '지붕': 'm²',
    '마감재': 'm²',
    '커튼월': 'm²',
    '기둥': '개',
    '보': 'm',
    '문': '개',
    '창문': '개',
    '계단': '개',
    '난간': 'm',
    '가구': '개',
    '판': 'm²',
    '부재': '개',
    '기초': '개',
    '파일': '개',
    '배관': 'm',
    '철근': 'kg',
    '가설공사': '식',
  };
  
  return unitMapping[category] || '개';
}

// 재질 이름에서 카테고리 추정
function getCategoryFromMaterialName(name: string): string {
  const lowerName = name.toLowerCase();
  
  if (lowerName.includes('wall') || lowerName.includes('벽')) return '벽';
  if (lowerName.includes('slab') || lowerName.includes('슬라브') || lowerName.includes('floor') || lowerName.includes('바닥')) return '슬라브';
  if (lowerName.includes('column') || lowerName.includes('기둥')) return '기둥';
  if (lowerName.includes('beam') || lowerName.includes('보')) return '보';
  if (lowerName.includes('door') || lowerName.includes('문')) return '문';
  if (lowerName.includes('window') || lowerName.includes('창')) return '창문';
  if (lowerName.includes('stair') || lowerName.includes('계단')) return '계단';
  if (lowerName.includes('roof') || lowerName.includes('지붕')) return '지붕';
  if (lowerName.includes('railing') || lowerName.includes('난간')) return '난간';
  if (lowerName.includes('furniture') || lowerName.includes('가구')) return '가구';
  if (lowerName.includes('covering') || lowerName.includes('마감')) return '마감재';
  if (lowerName.includes('footing') || lowerName.includes('기초')) return '기초';
  if (lowerName.includes('curtain') || lowerName.includes('커튼')) return '커튼월';
  if (lowerName.includes('concrete') || lowerName.includes('콘크리트')) return '콘크리트';
  if (lowerName.includes('steel') || lowerName.includes('철골')) return '철골';
  if (lowerName.includes('glass') || lowerName.includes('유리')) return '유리';
  
  return '기타';
}

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

export function ThatOpenViewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  
  // ThatOpen Components refs
  const componentsRef = useRef<OBC.Components | null>(null);
  const worldRef = useRef<OBC.World | null>(null);
  const currentModelRef = useRef<THREE.Object3D | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const highlighterRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hiderRef = useRef<any>(null);
  // 타입별 ExpressID 매핑 (일괄선택용)
  const typeToExpressIDsRef = useRef<Map<number, number[]>>(new Map());
  
  // 기본 상태
  const [hasModel, setHasModel] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [selectedCount, setSelectedCount] = useState(0);
  
  // UI 상태 (FragmentsViewer와 동일)
  const [showSidebar, setShowSidebar] = useState(true);
  const [xrayMode, setXrayMode] = useState(false);
  const [showEdges, setShowEdges] = useState(true);
  
  // 데이터 상태 (Sidebar에 필요)
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);
  const [selectedExpressIDs, setSelectedExpressIDs] = useState<number[]>([]);
  const [hiddenMaterialIds, setHiddenMaterialIds] = useState<Set<string>>(new Set());
  const [storeys, setStoreys] = useState<StoreyInfo[]>([]);
  const [selectedStorey, setSelectedStorey] = useState<string | null>(null);
  const [spatialTree, setSpatialTree] = useState<IFCSpatialNode | null>(null);
  const [tableHighlightedIDs, setTableHighlightedIDs] = useState<number[]>([]);

  // ThatOpen Components 초기화
  useEffect(() => {
    if (!containerRef.current || componentsRef.current) return;

    const init = async () => {
      try {
        console.log("🚀 ThatOpen Components 초기화 시작...");
        
        // 1. Components 생성
        const components = new OBC.Components();
        componentsRef.current = components;

        // 2. Worlds 생성
        const worlds = components.get(OBC.Worlds);
        const world = worlds.create<OBC.SimpleScene, OBC.SimpleCamera, OBC.SimpleRenderer>();
        worldRef.current = world;

        // 3. Scene 설정
        world.scene = new OBC.SimpleScene(components);
        world.scene.setup();
        world.scene.three.background = new THREE.Color(0x1e293b);

        // 4. Renderer 설정
        world.renderer = new OBC.SimpleRenderer(components, containerRef.current!);

        // 5. Camera 설정
        world.camera = new OBC.SimpleCamera(components);
        world.camera.controls.setLookAt(20, 20, 20, 0, 0, 0);

        // 6. 조명
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        world.scene.three.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(50, 50, 50);
        world.scene.three.add(directionalLight);

        // 7. Grid (Three.js 직접 생성 - 연한 색상 고정)
        const gridHelper = new THREE.GridHelper(200, 50, 0xcccccc, 0xe0e0e0);
        gridHelper.material.opacity = 0.3;
        gridHelper.material.transparent = true;
        gridHelper.name = "__grid__";
        world.scene.three.add(gridHelper);

        // 🔑 핵심: components.init() 호출 (렌더링 시작!)
        components.init();
        console.log("✅ Components 렌더링 시작");

        // 8. FragmentsManager 초기화
        const fragments = components.get(OBC.FragmentsManager);
        
        // Web Worker 설정 (CDN에서 로드)
        const workerUrl = "https://thatopen.github.io/engine_fragment/resources/worker.mjs";
        try {
          const fetchedUrl = await fetch(workerUrl);
          const workerBlob = await fetchedUrl.blob();
          const workerFile = new File([workerBlob], "worker.mjs", { type: "text/javascript" });
          const localWorkerUrl = URL.createObjectURL(workerFile);
          fragments.init(localWorkerUrl);
          console.log("✅ FragmentsManager Worker 초기화 완료");
        } catch (workerErr) {
          console.warn("⚠️ Worker 로드 실패, 기본 모드로 진행:", workerErr);
        }

        // 카메라 업데이트 시 fragments 업데이트
        world.camera.controls.addEventListener("update", () => {
          fragments.core.update();
        });

        // onItemSet 이벤트: 로깅 및 카메라 설정 (백업용)
        // 주요 처리는 handleFileLoad에서 수행
        fragments.list.onItemSet.add(({ value: model }) => {
          console.log("📦 [onItemSet] 모델 감지:", model);
          // handleFileLoad에서 이미 처리하므로 여기서는 로깅만
        });

        // Z-fighting 방지
        fragments.core.models.materials.list.onItemSet.add(({ value: material }) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (!("isLodMaterial" in material && (material as any).isLodMaterial)) {
            material.polygonOffset = true;
            material.polygonOffsetUnits = 1;
            material.polygonOffsetFactor = Math.random();
          }
        });

        // 9. IFC Loader 설정
        const ifcLoader = components.get(OBC.IfcLoader);
        
        ifcLoader.onIfcImporterInitialized.add((importer) => {
          console.log("📊 IfcImporter 클래스 목록:", importer.classes);
        });
        
        await ifcLoader.setup({
          autoSetWasm: false,
          wasm: {
            path: "https://unpkg.com/web-ifc@0.0.74/",
            absolute: true,
          }
        });
        console.log("✅ IFC Loader WASM 설정 완료");

        // 10. Highlighter 설정 (선택 기능)
        try {
          const highlighter = components.get(OBCF.Highlighter);
          highlighter.setup({ world });
          highlighterRef.current = highlighter;
          
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          highlighter.events.select.onHighlight.add((fragmentIdMap: any) => {
            let count = 0;
            const ids: number[] = [];
            if (fragmentIdMap && typeof fragmentIdMap.forEach === 'function') {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              fragmentIdMap.forEach((idSet: any) => {
                if (idSet && typeof idSet.forEach === 'function') {
                  idSet.forEach((id: number) => {
                    ids.push(id);
                    count++;
                  });
                }
              });
            }
            setSelectedCount(count);
            setSelectedExpressIDs(ids);
            console.log(`🖱️ 선택됨: ${count}개 객체, IDs:`, ids.slice(0, 5));
          });
          
          highlighter.events.select.onClear.add(() => {
            setSelectedCount(0);
            setSelectedExpressIDs([]);
          });
          
          console.log("✅ Highlighter 설정 완료");
        } catch (highlightErr) {
          console.warn("⚠️ Highlighter 설정 실패:", highlightErr);
        }

        // 11. Hider 설정 (X-Ray, 가시성 제어)
        try {
          const hider = components.get(OBC.Hider);
          hiderRef.current = hider;
          console.log("✅ Hider 설정 완료");
        } catch (hiderErr) {
          console.warn("⚠️ Hider 설정 실패:", hiderErr);
        }

        console.log("✅ ThatOpen Components 초기화 완료!");

      } catch (err) {
        console.error("❌ 초기화 실패:", err);
        setError("초기화 실패: " + (err instanceof Error ? err.message : String(err)));
      }
    };

    init();

    return () => {
      if (componentsRef.current) {
        try {
          componentsRef.current.dispose();
        } catch {}
        componentsRef.current = null;
        worldRef.current = null;
      }
    };
  }, []);

  // 다크모드
  useEffect(() => {
    if (worldRef.current?.scene?.three) {
      (worldRef.current.scene.three as THREE.Scene).background = new THREE.Color(
        isDarkMode ? 0x1e293b : 0xf1f5f9
      );
    }
  }, [isDarkMode]);

  // 사이드바 토글 시 리사이즈
  useEffect(() => {
    const timer = setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 50);
    return () => clearTimeout(timer);
  }, [showSidebar]);

  // X-Ray 모드 효과
  useEffect(() => {
    if (!worldRef.current || !hasModel) return;
    
    const scene = worldRef.current.scene.three;
    
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mat = child.material as THREE.Material;
        
        if (xrayMode && selectedExpressIDs.length > 0) {
          // X-Ray: 선택되지 않은 객체를 반투명하게
          const meshId = child.userData?.expressID;
          const isSelected = meshId && selectedExpressIDs.includes(meshId);
          
          if (!isSelected) {
            mat.transparent = true;
            mat.opacity = 0.15;
            mat.depthWrite = false;
          } else {
            mat.transparent = false;
            mat.opacity = 1;
            mat.depthWrite = true;
          }
        } else {
          // X-Ray 해제
          mat.transparent = false;
          mat.opacity = 1;
          mat.depthWrite = true;
        }
        mat.needsUpdate = true;
      }
    });
  }, [xrayMode, selectedExpressIDs, hasModel]);

  // 윤곽선 효과 (Three.js 직접)
  const edgesGroupRef = useRef<THREE.Group | null>(null);
  
  useEffect(() => {
    if (!worldRef.current || !hasModel) return;
    
    const scene = worldRef.current.scene.three;
    
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
    
    // 새 윤곽선 그룹 생성
    const edgesGroup = new THREE.Group();
    edgesGroup.name = "EdgesGroup";
    
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: isDarkMode ? 0x404040 : 0x808080,
      linewidth: 1,
    });
    
    let edgeCount = 0;
    const maxEdges = 5000; // 성능을 위해 제한
    
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry && edgeCount < maxEdges) {
        try {
          const edges = new THREE.EdgesGeometry(child.geometry, 30);
          const line = new THREE.LineSegments(edges, edgeMaterial.clone());
          line.position.copy(child.position);
          line.rotation.copy(child.rotation);
          line.scale.copy(child.scale);
          line.matrixAutoUpdate = false;
          line.matrix.copy(child.matrix);
          edgesGroup.add(line);
          edgeCount++;
        } catch {}
      }
    });
    
    if (edgeCount > 0) {
      scene.add(edgesGroup);
      edgesGroupRef.current = edgesGroup;
      console.log(`🔲 윤곽선 생성: ${edgeCount}개`);
    }
  }, [showEdges, hasModel, isDarkMode]);

  // 자재 정보 수집 함수 (FragmentsModel API 사용)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const collectMaterialsFromModel = useCallback(async (model: any) => {
    let meshCount = 0;
    const materialMap = new Map<string, { count: number; expressIDs: number[]; typeCode: number }>();
    const typeMap = new Map<number, number[]>();
    
    try {
      // 재질별 그룹화를 위한 Map
      const materialGroups = new Map<string, { meshes: THREE.Mesh[], ids: number[] }>();
      
      // 1. model.object (Three.js Object3D) 순회
      if (model.object) {
        console.log("🔍 model.object 순회 시작...", model.object);
        
        model.object.traverse((child: THREE.Object3D) => {
          if (child instanceof THREE.Mesh) {
            meshCount++;
            
            // 재질 이름 추출
            let matName = "기타 요소";
            
            if (child.material) {
              const mat = child.material as THREE.Material;
              if (mat.name && mat.name.trim() !== '') {
                matName = mat.name;
              }
            }
            
            // mesh.name에서 IFC 타입 추론
            if (matName === "기타 요소" && child.name) {
              const ifcMatch = child.name.match(/^(Ifc\w+)/i);
              if (ifcMatch) {
                matName = getCategoryKoreanName(ifcMatch[1].toUpperCase());
              } else if (child.name.trim() !== '') {
                matName = child.name;
              }
            }
            
            // ExpressID 설정
            const expressID = child.userData?.expressID || meshCount;
            child.userData = child.userData || {};
            child.userData.expressID = expressID;
            
            // 재질별 그룹화
            if (!materialGroups.has(matName)) {
              materialGroups.set(matName, { meshes: [], ids: [] });
            }
            materialGroups.get(matName)!.meshes.push(child);
            materialGroups.get(matName)!.ids.push(expressID);
          }
        });
        
        console.log(`📊 model.object에서 수집: ${meshCount}개 메시`);
      }
      
      // 2. tiles Map 순회 (fallback)
      if (meshCount === 0 && model.tiles && typeof model.tiles.forEach === 'function') {
        console.log("🔍 tiles Map 순회 시작...", model.tiles.size || '(size 없음)');
        
        model.tiles.forEach((mesh: THREE.Mesh, tileId: number) => {
          meshCount++;
          
          let matName = "타일 요소";
          if (mesh.material) {
            const mat = mesh.material as THREE.Material;
            if (mat.name) matName = mat.name;
          }
          
          const expressID = Math.abs(tileId);
          mesh.userData = mesh.userData || {};
          mesh.userData.expressID = expressID;
          
          if (!materialGroups.has(matName)) {
            materialGroups.set(matName, { meshes: [], ids: [] });
          }
          materialGroups.get(matName)!.meshes.push(mesh);
          materialGroups.get(matName)!.ids.push(expressID);
        });
        
        console.log(`📊 tiles에서 수집: ${meshCount}개 메시`);
      }
      
      // 3. Scene 전체 순회 (최후 수단)
      if (meshCount === 0 && worldRef.current) {
        console.log("🔍 Scene 전체 순회 시작...");
        
        worldRef.current.scene.three.traverse((child: THREE.Object3D) => {
          // 그리드 제외
          if (child.name === '__grid__') return;
          
          if (child instanceof THREE.Mesh) {
            meshCount++;
            
            let matName = "씬 요소";
            if (child.material) {
              const mat = child.material as THREE.Material;
              if (mat.name) matName = mat.name;
            }
            if (child.name) matName = child.name;
            
            const expressID = child.userData?.expressID || meshCount;
            child.userData = child.userData || {};
            child.userData.expressID = expressID;
            
            if (!materialGroups.has(matName)) {
              materialGroups.set(matName, { meshes: [], ids: [] });
            }
            materialGroups.get(matName)!.meshes.push(child);
            materialGroups.get(matName)!.ids.push(expressID);
          }
        });
        
        console.log(`📊 Scene에서 수집: ${meshCount}개 메시`);
      }
      
      console.log(`📊 총 수집: ${meshCount}개 메시, ${materialGroups.size}개 재질 그룹`);
      
      // 재질 그룹을 자재 맵으로 변환
      materialGroups.forEach((group, matName) => {
        const typeCode = matName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % 10000;
        
        group.meshes.forEach(mesh => {
          mesh.userData.typeCode = typeCode;
        });
        
        materialMap.set(matName, { 
          count: group.ids.length, 
          expressIDs: group.ids, 
          typeCode 
        });
        
        if (!typeMap.has(typeCode)) {
          typeMap.set(typeCode, []);
        }
        group.ids.forEach(id => typeMap.get(typeCode)!.push(id));
        
        console.log(`  📦 ${matName}: ${group.ids.length}개`);
      });
      
      // 2. FragmentsModel API로 카테고리 목록만 가져오기 (참고용)
      if (typeof model.getCategories === 'function') {
        try {
          const categories = await model.getCategories();
          console.log("📋 IFC 카테고리 목록:", categories);
          // API 호출 (getItemsOfCategories)은 호환성 문제로 생략
          // tiles 데이터로 충분히 자재 정보 수집 가능
        } catch (apiErr) {
          console.warn("⚠️ getCategories API 실패:", apiErr);
        }
      }
      
    } catch (err) {
      console.error("❌ 자재 수집 실패:", err);
    }
    
    console.log(`📊 자재 수집 완료: 총 ${meshCount}개 메시, ${materialMap.size}개 자재 종류`);
    
    // MaterialItem 배열 생성
    const newMaterials: MaterialItem[] = Array.from(materialMap.entries()).map(([name, info], idx) => ({
      id: `mat_${idx}`,
      typeCode: info.typeCode,
      typeName: name,
      category: getCategoryFromMaterialName(name),
      spec: "-",
      count: info.count,
      unit: getUnitForCategory(getCategoryFromMaterialName(name)),
      totalArea: 0,
      expressIDs: info.expressIDs,
    }));
    
    // 카테고리별 정렬
    newMaterials.sort((a, b) => a.category.localeCompare(b.category));
    
    return { newMaterials, typeMap, meshCount };
  }, []);

  // 파일 로드
  const handleFileLoad = useCallback(async (file: File) => {
    if (!componentsRef.current || !worldRef.current) {
      setError("뷰어가 초기화되지 않았습니다.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setProgress(10);
    setLoadingMessage("파일 읽는 중...");

    try {
      const components = componentsRef.current;
      const world = worldRef.current;
      const fragments = components.get(OBC.FragmentsManager);

      setProgress(20);
      setLoadingMessage("기존 모델 정리...");

      // 기존 모델 제거
      if (currentModelRef.current) {
        world.scene.three.remove(currentModelRef.current);
        currentModelRef.current = null;
      }

      const data = await file.arrayBuffer();
      const buffer = new Uint8Array(data);
      const fileExt = file.name.split('.').pop()?.toLowerCase();
      const modelId = file.name.split('.').shift() || file.name;
      
      console.log(`📂 파일 로드 시작: ${file.name} (${(data.byteLength / 1024 / 1024).toFixed(2)}MB)`);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let loadedModel: any = null;

      if (fileExt === 'frag') {
        setProgress(40);
        setLoadingMessage(".frag 파일 로드 중...");
        loadedModel = await fragments.core.load(buffer, { modelId });
        
      } else if (fileExt === 'ifc') {
        setProgress(40);
        setLoadingMessage("IFC → Fragments 변환 중...");
        
        const ifcLoader = components.get(OBC.IfcLoader);
        loadedModel = await ifcLoader.load(buffer, false, modelId, {
          processData: {
            progressCallback: (prog: number) => {
              const percent = Math.round(40 + prog * 40);
              setProgress(percent);
              setLoadingMessage(`IFC 변환 중... ${Math.round(prog * 100)}%`);
            },
          },
        });
      } else {
        throw new Error("지원하지 않는 파일 형식입니다. (.ifc 또는 .frag)");
      }

      setProgress(80);
      setLoadingMessage("모델 처리 중...");
      
      // 로드된 모델 처리 (onItemSet 이벤트가 발생하지 않을 때를 대비)
      console.log("📦 로드된 모델:", loadedModel);
      
      // fragments.list에서 모델 가져오기
      let modelObject: THREE.Object3D | null = null;
      
      if (loadedModel && loadedModel.object) {
        modelObject = loadedModel.object;
        loadedModel.useCamera?.(world.camera.three);
      } else {
        // fallback: fragments.list에서 찾기
        const models = [...fragments.list.values()];
        if (models.length > 0) {
          const lastModel = models[models.length - 1];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          modelObject = (lastModel as any).object || lastModel;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (lastModel as any).useCamera?.(world.camera.three);
        }
      }
      
      if (modelObject) {
        // Scene에 추가
        if (!world.scene.three.children.includes(modelObject)) {
          world.scene.three.add(modelObject);
        }
        currentModelRef.current = modelObject;
        
        // 자재 정보 수집 (FragmentsModel API 사용)
        setProgress(85);
        setLoadingMessage("자재 정보 수집 중...");
        
        // loadedModel 또는 fragments.list에서 모델 가져오기
        const fragmentsModel = loadedModel || [...fragments.list.values()].pop();
        const { newMaterials, typeMap, meshCount } = await collectMaterialsFromModel(fragmentsModel);
        
        console.log(`✅ 자재 목록: ${newMaterials.length}개 항목 (메시 ${meshCount}개)`);
        
        typeToExpressIDsRef.current = typeMap;
        setMaterials(newMaterials);
        
        // 카메라 맞춤
        setProgress(90);
        setLoadingMessage("카메라 설정 중...");
        const box = new THREE.Box3().setFromObject(modelObject);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        
        if (maxDim > 0 && world.camera.controls) {
          world.camera.controls.setLookAt(
            center.x + maxDim * 1.2,
            center.y + maxDim * 0.8,
            center.z + maxDim * 1.2,
            center.x,
            center.y,
            center.z,
            true
          );
        }
        
        // fragments 업데이트
        fragments.core.update(true);
        
        setHasModel(true);
        setProgress(100);
        setLoadingMessage("완료!");
        
        console.log("🎉 모델 로드 완료!");
      } else {
        throw new Error("모델 객체를 찾을 수 없습니다.");
      }
      
      setTimeout(() => setIsLoading(false), 500);

    } catch (err) {
      console.error("❌ 파일 로드 실패:", err);
      setError("로드 실패: " + (err instanceof Error ? err.message : String(err)));
      setIsLoading(false);
    }
  }, [collectMaterialsFromModel]);

  // .frag 내보내기
  const handleExportFrag = useCallback(async () => {
    if (!componentsRef.current) {
      alert("뷰어가 초기화되지 않았습니다.");
      return;
    }

    try {
      const fragments = componentsRef.current.get(OBC.FragmentsManager);
      const models = [...fragments.list.values()];
      
      if (models.length === 0) {
        alert("내보낼 모델이 없습니다.");
        return;
      }

      const [model] = models;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fragsBuffer = await (model as any).getBuffer(false);
      
      const file = new File([fragsBuffer], "model.frag");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(file);
      link.download = file.name;
      link.click();
      URL.revokeObjectURL(link.href);
      
      alert(`내보내기 완료!\n파일 크기: ${(fragsBuffer.byteLength / 1024 / 1024).toFixed(2)}MB`);
    } catch (err) {
      console.error("❌ 내보내기 실패:", err);
      alert("내보내기 실패: " + (err instanceof Error ? err.message : String(err)));
    }
  }, []);

  // 핸들러들 (Sidebar용)
  const handleMaterialSelect = useCallback((id: string | null) => {
    setSelectedMaterialId(id);
    
    // 해당 자재의 모든 요소 선택 (일괄선택)
    if (id && worldRef.current) {
      const material = materials.find(m => m.id === id);
      if (material) {
        setSelectedExpressIDs(material.expressIDs);
        setSelectedCount(material.expressIDs.length);
        
        // 3D 하이라이트
        highlightExpressIDs(material.expressIDs);
      }
    }
  }, [materials]);

  // ExpressID 배열로 3D 하이라이트
  const highlightExpressIDs = useCallback((ids: number[]) => {
    if (!worldRef.current) return;
    
    const scene = worldRef.current.scene.three;
    
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const meshId = child.userData?.expressID;
        const isSelected = meshId && ids.includes(meshId);
        const mat = child.material as THREE.MeshStandardMaterial;
        
        if (isSelected) {
          // 선택된 객체: 파란색으로 변경
          if (!child.userData.originalColor) {
            child.userData.originalColor = mat.color.getHex();
          }
          mat.color.setHex(0x3b82f6);
          mat.emissive?.setHex(0x1e3a8a);
          mat.emissiveIntensity = 0.3;
        } else {
          // 선택 해제된 객체: 원래 색상 복원
          if (child.userData.originalColor !== undefined) {
            mat.color.setHex(child.userData.originalColor);
            mat.emissive?.setHex(0x000000);
            mat.emissiveIntensity = 0;
          }
        }
        mat.needsUpdate = true;
      }
    });
  }, []);

  const handleSelectElements = useCallback((expressIDs: number[]) => {
    setSelectedExpressIDs(expressIDs);
    setSelectedCount(expressIDs.length);
    highlightExpressIDs(expressIDs);
  }, [highlightExpressIDs]);

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

  const handleClearSelection = useCallback(() => {
    setSelectedExpressIDs([]);
    setSelectedCount(0);
    setTableHighlightedIDs([]);
    setSelectedMaterialId(null);
    
    // 3D 하이라이트 해제
    if (worldRef.current) {
      worldRef.current.scene.three.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          const mat = child.material as THREE.MeshStandardMaterial;
          if (child.userData.originalColor !== undefined) {
            mat.color.setHex(child.userData.originalColor);
            mat.emissive?.setHex(0x000000);
            mat.emissiveIntensity = 0;
            mat.needsUpdate = true;
          }
        }
      });
    }
  }, []);

  const bgClass = isDarkMode ? "bg-slate-900" : "bg-slate-100";

  return (
    <div className={`relative w-full h-full flex ${bgClass}`}>
      {/* 사이드바 (기존 컴포넌트 재사용) */}
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
        {/* 툴바 (기존 컴포넌트 재사용) */}
        <ViewerToolbar
          hasModel={hasModel}
          showTable={showSidebar}
          onToggleTable={() => setShowSidebar(!showSidebar)}
          selectedCount={selectedCount}
          isDarkMode={isDarkMode}
          onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}
          xrayMode={xrayMode}
          onToggleXray={() => setXrayMode(!xrayMode)}
          showEdges={showEdges}
          onToggleEdges={() => setShowEdges(!showEdges)}
          onClearSelection={handleClearSelection}
        />

        {/* 내보내기 버튼 */}
        {hasModel && (
          <div className="absolute top-4 right-4 z-30 flex gap-2">
            <button
              onClick={handleExportFrag}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isDarkMode 
                  ? "bg-green-600 hover:bg-green-500 text-white" 
                  : "bg-green-500 hover:bg-green-600 text-white"
              }`}
            >
              📦 .frag 내보내기
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
                <p className={`text-sm font-medium ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
                  {loadingMessage}
                </p>
                <span className="text-sm text-green-500 tabular-nums">{progress}%</span>
              </div>
              <div className={`h-2 rounded-full overflow-hidden ${isDarkMode ? "bg-slate-700" : "bg-slate-300"}`}>
                <div 
                  className="h-full transition-all bg-gradient-to-r from-green-500 to-green-400" 
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
        <StatsPanel parentRef={viewerRef} />

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

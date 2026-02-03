// ThatOpen Components 초기화 Hook

import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBCF from "@thatopen/components-front";
import { ComponentsState } from "../types";

export function useComponents(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [state, setState] = useState<ComponentsState>({
    components: null,
    world: null,
    fragments: null,
    ifcLoader: null,
    isReady: false,
  });
  
  const componentsRef = useRef<OBC.Components | null>(null);
  const worldRef = useRef<OBC.SimpleWorld<OBC.SimpleScene, OBC.SimpleCamera, OBC.SimpleRenderer> | null>(null);
  const highlighterRef = useRef<OBCF.Highlighter | null>(null);
  
  // 초기화
  useEffect(() => {
    if (!containerRef.current) return;
    
    const init = async () => {
      try {
        console.log("🚀 ThatOpen Components 초기화 시작...");
        
        // 1. Components 생성
        const components = new OBC.Components();
        componentsRef.current = components;
        
        // 2. Worlds 가져오기
        const worlds = components.get(OBC.Worlds);
        
        // 3. World 생성
        const world = worlds.create<
          OBC.SimpleScene,
          OBC.SimpleCamera,
          OBC.SimpleRenderer
        >();
        worldRef.current = world;
        
        // 4. Renderer 설정
        world.renderer = new OBC.SimpleRenderer(components, containerRef.current!);
        world.renderer.three.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        
        // 5. Scene 설정
        world.scene = new OBC.SimpleScene(components);
        world.scene.three.background = new THREE.Color(0xf1f5f9);
        
        // 6. Camera 설정
        world.camera = new OBC.SimpleCamera(components);
        world.camera.controls.setLookAt(20, 20, 20, 0, 0, 0);
        
        // 7. 조명
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        world.scene.three.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(50, 50, 50);
        world.scene.three.add(directionalLight);
        
        // 8. 그리드 (연한 색상)
        const gridHelper = new THREE.GridHelper(200, 50, 0xcccccc, 0xe0e0e0);
        gridHelper.material.opacity = 0.3;
        gridHelper.material.transparent = true;
        gridHelper.name = "__grid__";
        world.scene.three.add(gridHelper);
        
        // 9. Components 렌더링 시작
        components.init();
        console.log("✅ Components 렌더링 시작");
        
        // 10. FragmentsManager 초기화
        const fragments = components.get(OBC.FragmentsManager);
        
        // Worker 설정
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
        
        // Z-fighting 방지
        fragments.core.models.materials.list.onItemSet.add(({ value: material }) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (!("isLodMaterial" in material && (material as any).isLodMaterial)) {
            material.polygonOffset = true;
            material.polygonOffsetUnits = 1;
            material.polygonOffsetFactor = Math.random();
          }
        });
        
        // 11. IFC Loader 설정
        const ifcLoader = components.get(OBC.IfcLoader);
        
        await ifcLoader.setup({
          autoSetWasm: false,
          wasm: {
            path: "https://unpkg.com/web-ifc@0.0.74/",
            absolute: true,
          }
        });
        console.log("✅ IFC Loader WASM 설정 완료");
        
        // 12. Highlighter 설정
        try {
          const highlighter = components.get(OBCF.Highlighter);
          highlighter.setup({ world });
          highlighterRef.current = highlighter;
          console.log("✅ Highlighter 설정 완료");
        } catch (err) {
          console.warn("⚠️ Highlighter 설정 실패:", err);
        }
        
        // 상태 업데이트
        setState({
          components,
          world,
          fragments,
          ifcLoader,
          isReady: true,
        });
        
        console.log("✅ ThatOpen Components 초기화 완료!");
        
      } catch (err) {
        console.error("❌ 초기화 실패:", err);
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
  }, [containerRef]);
  
  // 배경색 변경
  const setBackgroundColor = useCallback((isDarkMode: boolean) => {
    if (worldRef.current?.scene?.three) {
      (worldRef.current.scene.three as THREE.Scene).background = new THREE.Color(
        isDarkMode ? 0x1e293b : 0xf1f5f9
      );
    }
  }, []);
  
  // 카메라 맞춤
  const fitCamera = useCallback((object: THREE.Object3D) => {
    if (!worldRef.current?.camera?.controls) return;
    
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    
    if (maxDim > 0) {
      worldRef.current.camera.controls.setLookAt(
        center.x + maxDim * 1.2,
        center.y + maxDim * 0.8,
        center.z + maxDim * 1.2,
        center.x,
        center.y,
        center.z,
        true
      );
    }
  }, []);
  
  return {
    ...state,
    componentsRef,
    worldRef,
    highlighterRef,
    setBackgroundColor,
    fitCamera,
  };
}

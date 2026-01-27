/**
 * GPU Stencil Buffer 기반 하이라이팅
 * CPU 부하 없이 즉각적인 시각적 피드백 제공
 */

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { OutlinePass } from "three/examples/jsm/postprocessing/OutlinePass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { FXAAShader } from "three/examples/jsm/shaders/FXAAShader.js";

export interface StencilHighlighterOptions {
  edgeStrength?: number;
  edgeGlow?: number;
  edgeThickness?: number;
  visibleEdgeColor?: THREE.Color;
  hiddenEdgeColor?: THREE.Color;
}

export class StencilHighlighter {
  private composer: EffectComposer | null = null;
  private outlinePass: OutlinePass | null = null;
  private renderPass: RenderPass | null = null;
  private fxaaPass: ShaderPass | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.Camera | null = null;
  
  private options: Required<StencilHighlighterOptions>;
  
  constructor(options?: StencilHighlighterOptions) {
    this.options = {
      edgeStrength: 3,
      edgeGlow: 0.5,
      edgeThickness: 2,
      visibleEdgeColor: new THREE.Color(0x3b82f6), // 파란색
      hiddenEdgeColor: new THREE.Color(0x1e40af), // 어두운 파란색
      ...options,
    };
  }
  
  /**
   * 하이라이터 초기화
   */
  init(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    width: number,
    height: number
  ): void {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    
    // EffectComposer 생성
    this.composer = new EffectComposer(renderer);
    
    // 기본 렌더 패스
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    
    // 아웃라인 패스
    this.outlinePass = new OutlinePass(
      new THREE.Vector2(width, height),
      scene,
      camera
    );
    
    // 아웃라인 스타일 설정
    this.outlinePass.edgeStrength = this.options.edgeStrength;
    this.outlinePass.edgeGlow = this.options.edgeGlow;
    this.outlinePass.edgeThickness = this.options.edgeThickness;
    this.outlinePass.visibleEdgeColor = this.options.visibleEdgeColor;
    this.outlinePass.hiddenEdgeColor = this.options.hiddenEdgeColor;
    this.outlinePass.pulsePeriod = 0; // 펄스 효과 비활성화
    
    this.composer.addPass(this.outlinePass);
    
    // FXAA 안티앨리어싱 패스
    this.fxaaPass = new ShaderPass(FXAAShader);
    this.fxaaPass.uniforms["resolution"].value.set(1 / width, 1 / height);
    this.composer.addPass(this.fxaaPass);
    
    console.log("✅ Stencil Highlighter 초기화 완료");
  }
  
  /**
   * 하이라이트할 객체들 설정
   */
  setSelectedObjects(objects: THREE.Object3D[]): void {
    if (!this.outlinePass) return;
    this.outlinePass.selectedObjects = objects;
  }
  
  /**
   * 선택된 객체들 클리어
   */
  clearSelection(): void {
    if (!this.outlinePass) return;
    this.outlinePass.selectedObjects = [];
  }
  
  /**
   * 하이라이트 색상 변경
   */
  setHighlightColor(visible: THREE.Color, hidden?: THREE.Color): void {
    if (!this.outlinePass) return;
    this.outlinePass.visibleEdgeColor = visible;
    if (hidden) {
      this.outlinePass.hiddenEdgeColor = hidden;
    }
  }
  
  /**
   * 크기 변경 시 업데이트
   */
  resize(width: number, height: number): void {
    if (!this.composer || !this.outlinePass || !this.fxaaPass) return;
    
    this.composer.setSize(width, height);
    this.outlinePass.resolution.set(width, height);
    this.fxaaPass.uniforms["resolution"].value.set(1 / width, 1 / height);
  }
  
  /**
   * 렌더링
   */
  render(): void {
    if (!this.composer) return;
    this.composer.render();
  }
  
  /**
   * 일반 렌더링 사용 (하이라이트 없이)
   */
  renderNormal(): void {
    if (!this.renderer || !this.scene || !this.camera) return;
    this.renderer.render(this.scene, this.camera);
  }
  
  /**
   * 하이라이트 활성화 여부
   */
  get hasSelection(): boolean {
    return (this.outlinePass?.selectedObjects.length ?? 0) > 0;
  }
  
  /**
   * 정리
   */
  dispose(): void {
    if (this.composer) {
      this.composer.dispose();
    }
    this.composer = null;
    this.outlinePass = null;
    this.renderPass = null;
    this.fxaaPass = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
  }
}

/**
 * 간단한 머티리얼 기반 하이라이팅 (폴백)
 * Stencil 대신 머티리얼 색상 변경으로 하이라이트
 */
export class MaterialHighlighter {
  private originalMaterials: Map<THREE.Mesh, THREE.Material | THREE.Material[]> = new Map();
  private highlightMaterial: THREE.MeshBasicMaterial;
  private xrayMaterial: THREE.MeshBasicMaterial;
  
  constructor() {
    // 일반 하이라이트 재질 (반투명 파란색)
    this.highlightMaterial = new THREE.MeshBasicMaterial({
      color: 0x3b82f6,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    });
    
    // X-Ray 하이라이트 재질 (깊이 테스트 무시)
    this.xrayMaterial = new THREE.MeshBasicMaterial({
      color: 0x3b82f6,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
  }
  
  /**
   * 메시 하이라이트
   */
  highlight(meshes: THREE.Mesh[], xray: boolean = false): void {
    // 이전 하이라이트 해제
    this.clearHighlight();
    
    const material = xray ? this.xrayMaterial : this.highlightMaterial;
    
    for (const mesh of meshes) {
      this.originalMaterials.set(mesh, mesh.material);
      mesh.material = material;
      
      if (xray) {
        mesh.renderOrder = 999;
      }
    }
  }
  
  /**
   * 하이라이트 해제
   */
  clearHighlight(): void {
    for (const [mesh, material] of this.originalMaterials) {
      mesh.material = material;
      mesh.renderOrder = 0;
    }
    this.originalMaterials.clear();
  }
  
  /**
   * 정리
   */
  dispose(): void {
    this.clearHighlight();
    this.highlightMaterial.dispose();
    this.xrayMaterial.dispose();
  }
}

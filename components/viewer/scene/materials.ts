/**
 * 3D 씬에서 사용하는 머티리얼 상수
 * 투명도나 색상을 수정하려면 이 파일만 수정하세요!
 */
import * as THREE from "three";

// ============================================
// 🎨 선택 요소 스타일 설정
// ============================================
export const HIGHLIGHT_OPACITY = 0.5; // 투명도 (0.0 ~ 1.0)
export const HIGHLIGHT_COLOR = 0x3b82f6; // 파란색 (Tailwind blue-500)

// X-Ray 모드 하이라이트 (건물 뒤에서도 보임)
export const highlightMaterial = new THREE.MeshBasicMaterial({
  color: HIGHLIGHT_COLOR,
  transparent: true,
  opacity: HIGHLIGHT_OPACITY,
  side: THREE.DoubleSide,
  depthTest: false,
});

// 일반 모드 하이라이트 (건물에 가려짐)
export const normalHighlightMaterial = new THREE.MeshBasicMaterial({
  color: HIGHLIGHT_COLOR,
  transparent: true,
  opacity: HIGHLIGHT_OPACITY,
  side: THREE.DoubleSide,
  depthTest: true,
});

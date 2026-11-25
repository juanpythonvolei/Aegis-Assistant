import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { AegisCoreState } from '../types';

export interface JarvisHologramCoreProps {
  coreState: AegisCoreState;
  audioLevelRef: React.MutableRefObject<number>;
  hasFloatingScreen?: boolean;
  onCoreClick?: () => void;
}

const PLASMA_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uAudio;
  uniform float uIntensity;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying float vNoise;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
          mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
          mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
      f.z
    );
  }

  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p = p * 2.05 + vec3(0.4, -0.3, 0.25);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 n = normalize(normal);
    float t = uTime * (0.55 + uIntensity * 0.45);
    float n1 = fbm(n * 2.6 + vec3(t, -t * 0.7, t * 0.5));
    float n2 = fbm(n * 5.2 - vec3(t * 1.1, t * 0.6, -t * 0.8));
    float combined = n1 * 0.65 + n2 * 0.35;
    vNoise = combined;

    float disp = (combined - 0.48) * (0.14 + uAudio * 0.34 + uIntensity * 0.08);
    vec3 displaced = position + n * disp;
    vec4 worldPosition = modelMatrix * vec4(displaced, 1.0);
    vWorldPos = worldPosition.xyz;
    vNormal = normalize(mat3(modelMatrix) * n);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const PLASMA_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uAudio;
  uniform float uVision;
  uniform float uIntensity;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying float vNoise;

  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float fresnel = pow(1.0 - max(dot(normalize(vNormal), viewDir), 0.0), 2.35);

    vec3 deepAmber = vec3(0.55, 0.21, 0.02);
    vec3 warmGold = vec3(0.98, 0.62, 0.07);
    vec3 hotCore = vec3(1.0, 0.93, 0.68);
    vec3 visionCyan = vec3(0.24, 0.78, 0.98);

    float energy = smoothstep(0.22, 0.85, vNoise + uAudio * 0.38);
    vec3 baseCol = mix(deepAmber, warmGold, energy);
    baseCol = mix(baseCol, hotCore, pow(energy, 2.4) * (0.75 + uAudio * 0.55));
    baseCol += warmGold * fresnel * (1.2 + uAudio * 1.4 + uIntensity * 0.45);

    // Subtle optical scan tint when vision mode is active
    baseCol = mix(baseCol, visionCyan * 1.15, fresnel * uVision * 0.58);

    float pulse = 0.92 + 0.08 * sin(uTime * 3.1 + vNoise * 6.0);
    float alpha = clamp(0.68 + fresnel * 0.32 + uAudio * 0.16, 0.0, 0.98);
    gl_FragColor = vec4(baseCol * pulse, alpha);
  }
`;

function createDialRingTexture(
  primaryHex: string,
  secondaryHex: string,
  tickCount: number,
  arcSegments: number
): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const cx = size / 2;
    const cy = size / 2;
    ctx.clearRect(0, 0, size, size);

    // Outer segmented orbital arcs
    for (let i = 0; i < arcSegments; i++) {
      const start = (i / arcSegments) * Math.PI * 2 + 0.08;
      const end = ((i + 0.74) / arcSegments) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.44, start, end);
      ctx.strokeStyle = primaryHex;
      ctx.lineWidth = 4;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.39, start + 0.05, end - 0.05);
      ctx.strokeStyle = secondaryHex;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }

    // Precision radial telemetry ticks
    for (let i = 0; i < tickCount; i++) {
      const a = (i / tickCount) * Math.PI * 2;
      const isMajor = i % 6 === 0;
      const r0 = size * (isMajor ? 0.355 : 0.375);
      const r1 = size * (isMajor ? 0.43 : 0.415);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.strokeStyle = isMajor ? primaryHex : secondaryHex;
      ctx.lineWidth = isMajor ? 2.8 : 1.1;
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export const JarvisHologramCore: React.FC<JarvisHologramCoreProps> = ({
  coreState,
  audioLevelRef,
  hasFloatingScreen = false,
  onCoreClick,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<AegisCoreState>(coreState);
  const hasScreenRef = useRef<boolean>(hasFloatingScreen);

  useEffect(() => {
    stateRef.current = coreState;
  }, [coreState]);

  useEffect(() => {
    hasScreenRef.current = hasFloatingScreen;
  }, [hasFloatingScreen]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Detect software WebGL renderer so we keep rendering smooth without stalls
    const probeCanvas = document.createElement('canvas');
    const probeGl = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
    let isSoftwareGl = false;
    if (probeGl) {
      const ext = probeGl.getExtension('WEBGL_debug_renderer_info');
      if (ext) {
        const rendererStr = String(probeGl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
        isSoftwareGl = /SwiftShader|llvmpipe|Software|Mesa/i.test(rendererStr);
      }
    }

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isSoftwareGl ? 1.25 : 2));
    renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x05070b, 1);

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x05070b, 0.045);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmrem.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(
      42,
      (container.clientWidth || window.innerWidth) / Math.max(1, container.clientHeight || window.innerHeight),
      0.1,
      100
    );
    camera.position.set(0, 0.35, 7.2);

    // Key, rim, and core point lighting
    const ambient = new THREE.AmbientLight(0x2d1f0d, 0.6);
    scene.add(ambient);

    const coreLight = new THREE.PointLight(0xf59e0b, 7.5, 18, 1.5);
    coreLight.position.set(0, 0, 0);
    scene.add(coreLight);

    const rimLightA = new THREE.DirectionalLight(0xfbbf24, 1.4);
    rimLightA.position.set(5, 6, 4);
    scene.add(rimLightA);

    const rimLightB = new THREE.DirectionalLight(0x38bdf8, 0.65);
    rimLightB.position.set(-5, -3, -4);
    scene.add(rimLightB);

    // Master JARVIS Assembly Group
    const coreGroup = new THREE.Group();
    scene.add(coreGroup);

    // 1. Inner Incandescent Plasma Energy Core
    const plasmaGeo = new THREE.IcosahedronGeometry(1.18, isSoftwareGl ? 4 : 6);
    const plasmaUniforms = {
      uTime: { value: 0 },
      uAudio: { value: 0 },
      uVision: { value: 0 },
      uIntensity: { value: 0.2 },
    };
    const plasmaMat = new THREE.ShaderMaterial({
      uniforms: plasmaUniforms,
      vertexShader: PLASMA_VERT,
      fragmentShader: PLASMA_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const plasmaMesh = new THREE.Mesh(plasmaGeo, plasmaMat);
    coreGroup.add(plasmaMesh);

    // 2. Inner Solid Dark-Gold Energy Nucleus (anchors depth inside additive plasma)
    const nucleusGeo = new THREE.SphereGeometry(0.76, 32, 32);
    const nucleusMat = new THREE.MeshStandardMaterial({
      color: 0x1c1205,
      emissive: 0xd97706,
      emissiveIntensity: 0.9,
      roughness: 0.25,
      metalness: 0.85,
    });
    const nucleusMesh = new THREE.Mesh(nucleusGeo, nucleusMat);
    coreGroup.add(nucleusMesh);

    // 3. Dual-Layer Geodesic Synaptic Neural Lattice
    const latticeOuterGeo = new THREE.IcosahedronGeometry(1.56, 2);
    const latticeWireGeo = new THREE.WireframeGeometry(latticeOuterGeo);
    const latticeMat = new THREE.LineBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
    });
    const latticeMesh = new THREE.LineSegments(latticeWireGeo, latticeMat);
    coreGroup.add(latticeMesh);

    const latticeInnerGeo = new THREE.IcosahedronGeometry(1.34, 1);
    const latticeInnerWireGeo = new THREE.WireframeGeometry(latticeInnerGeo);
    const latticeInnerMat = new THREE.LineBasicMaterial({
      color: 0xfde68a,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
    });
    const latticeInnerMesh = new THREE.LineSegments(latticeInnerWireGeo, latticeInnerMat);
    coreGroup.add(latticeInnerMesh);

    // 4. Instanced Synaptic Neural Nodes (on geodesic shell)
    const posAttr = latticeOuterGeo.attributes.position;
    const uniqueVerts: THREE.Vector3[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i);
      const vy = posAttr.getY(i);
      const vz = posAttr.getZ(i);
      const key = `${vx.toFixed(2)},${vy.toFixed(2)},${vz.toFixed(2)}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueVerts.push(new THREE.Vector3(vx, vy, vz));
      }
    }
    const nodeGeo = new THREE.OctahedronGeometry(0.036, 0);
    const nodeMat = new THREE.MeshBasicMaterial({
      color: 0xfef08a,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
    });
    const nodeInstanced = new THREE.InstancedMesh(nodeGeo, nodeMat, uniqueVerts.length);
    const dummy = new THREE.Object3D();
    uniqueVerts.forEach((v, idx) => {
      dummy.position.copy(v);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      nodeInstanced.setMatrixAt(idx, dummy.matrix);
    });
    nodeInstanced.instanceMatrix.needsUpdate = true;
    coreGroup.add(nodeInstanced);

    // 5. Multi-Axis Counter-Rotating Precision Orbital Rings + Procedural Dial Textures
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const dialTex1 = createDialRingTexture('rgba(251,191,36,0.9)', 'rgba(245,158,11,0.45)', 96, 6);
    dialTex1.anisotropy = maxAniso;
    const dialTex2 = createDialRingTexture('rgba(253,224,71,0.8)', 'rgba(217,119,6,0.38)', 72, 4);
    dialTex2.anisotropy = maxAniso;
    const visionTex = createDialRingTexture('rgba(56,189,248,0.95)', 'rgba(251,191,36,0.55)', 60, 8);
    visionTex.anisotropy = maxAniso;

    const ringPlaneGeo1 = new THREE.PlaneGeometry(4.5, 4.5);
    const ringPlaneMat1 = new THREE.MeshBasicMaterial({
      map: dialTex1,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const dialDisc1 = new THREE.Mesh(ringPlaneGeo1, ringPlaneMat1);
    dialDisc1.rotation.x = Math.PI * 0.42;
    coreGroup.add(dialDisc1);

    const ringPlaneGeo2 = new THREE.PlaneGeometry(5.15, 5.15);
    const ringPlaneMat2 = new THREE.MeshBasicMaterial({
      map: dialTex2,
      transparent: true,
      opacity: 0.52,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const dialDisc2 = new THREE.Mesh(ringPlaneGeo2, ringPlaneMat2);
    dialDisc2.rotation.x = -Math.PI * 0.32;
    dialDisc2.rotation.y = Math.PI * 0.2;
    coreGroup.add(dialDisc2);

    // Solid metallic-gold gyroscopic torus arcs for 3D specular richness
    const gyroMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.45,
      metalness: 0.88,
      roughness: 0.22,
    });
    const gyroRingA = new THREE.Mesh(new THREE.TorusGeometry(1.92, 0.016, 12, 96), gyroMat);
    gyroRingA.rotation.x = Math.PI / 3;
    coreGroup.add(gyroRingA);

    const gyroRingB = new THREE.Mesh(new THREE.TorusGeometry(2.22, 0.012, 12, 96), gyroMat);
    gyroRingB.rotation.y = Math.PI / 2.5;
    gyroRingB.rotation.x = -Math.PI / 5;
    coreGroup.add(gyroRingB);

    // 6. Optical Vision Scanner Ring (illuminates when webcam vision is active)
    const visionRingGeo = new THREE.PlaneGeometry(5.75, 5.75);
    const visionRingMat = new THREE.MeshBasicMaterial({
      map: visionTex,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const visionDisc = new THREE.Mesh(visionRingGeo, visionRingMat);
    coreGroup.add(visionDisc);

    // 7. Volumetric Computational Particle Halo
    const particleCount = isSoftwareGl ? 360 : 880;
    const pPositions = new Float32Array(particleCount * 3);
    const pBaseRadii = new Float32Array(particleCount);
    const pPhases = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) {
      const r = 1.9 + Math.random() * 2.55;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pBaseRadii[i] = r;
      pPhases[i] = Math.random() * Math.PI * 2;
      pPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pPositions[i * 3 + 2] = r * Math.cos(phi);
    }
    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute('position', new THREE.BufferAttribute(pPositions, 3));
    const particleMat = new THREE.PointsMaterial({
      color: 0xfcd34d,
      size: isSoftwareGl ? 0.04 : 0.032,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const particleCloud = new THREE.Points(particleGeo, particleMat);
    coreGroup.add(particleCloud);

    // 8. Spatial Holographic Floor Emitter Projection (for spatial grounding)
    const floorGroup = new THREE.Group();
    floorGroup.position.set(0, -2.55, 0);
    floorGroup.rotation.x = -Math.PI / 2;
    const floorRingGeo1 = new THREE.RingGeometry(1.65, 1.69, 96);
    const floorRingMat1 = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    floorGroup.add(new THREE.Mesh(floorRingGeo1, floorRingMat1));

    const floorRingGeo2 = new THREE.RingGeometry(2.6, 2.63, 96);
    const floorRingMat2 = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    floorGroup.add(new THREE.Mesh(floorRingGeo2, floorRingMat2));
    scene.add(floorGroup);

    // Pointer Parallax Interaction
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    const onPointerMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      pointer.tx = ((e.clientX - rect.left) / Math.max(1, rect.width) - 0.5) * 2;
      pointer.ty = ((e.clientY - rect.top) / Math.max(1, rect.height) - 0.5) * 2;
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });

    // ResizeObserver for responsive full-viewport rendering
    const onResize = () => {
      const w = container.clientWidth || window.innerWidth;
      const h = Math.max(1, container.clientHeight || window.innerHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(container);

    // WebGL Context Loss Recovery
    let contextLost = false;
    const onContextLost = (e: Event) => {
      e.preventDefault();
      contextLost = true;
    };
    const onContextRestored = () => {
      contextLost = false;
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost, false);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored, false);

    // Animation loop with software WebGL fence sync pacing
    let disposed = false;
    let rafId = 0;
    let smoothAudio = 0;
    let smoothIntensity = 0.2;
    let smoothVision = 0;
    let smoothShiftY = 0;
    const clock = new THREE.Clock();

    const glCtx = renderer.getContext();
    const afterDraw = (cb: () => void) => {
      if (!isSoftwareGl) {
        rafId = requestAnimationFrame(cb);
        return;
      }
      const gl2 = glCtx as WebGL2RenderingContext;
      if (typeof gl2.fenceSync === 'function') {
        const sync = gl2.fenceSync(gl2.SYNC_GPU_COMMANDS_COMPLETE, 0);
        if (sync) {
          gl2.flush();
          const poll = () => {
            if (disposed) {
              gl2.deleteSync(sync);
              return;
            }
            const status = gl2.clientWaitSync(sync, 0, 0);
            if (status === gl2.TIMEOUT_EXPIRED) {
              rafId = requestAnimationFrame(poll);
            } else {
              gl2.deleteSync(sync);
              rafId = requestAnimationFrame(cb);
            }
          };
          rafId = requestAnimationFrame(poll);
          return;
        }
      }
      rafId = requestAnimationFrame(cb);
    };

    const tick = () => {
      if (disposed) return;
      if (contextLost) {
        rafId = requestAnimationFrame(tick);
        return;
      }

      const dt = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.elapsedTime;
      const mode = stateRef.current;

      // Target reactive scalars based on state
      const rawAudio = Math.max(0, Math.min(1, audioLevelRef.current || 0));
      const targetAudio =
        mode === 'speaking'
          ? Math.max(rawAudio, 0.25 + 0.18 * Math.sin(elapsed * 9.5))
          : mode === 'listening'
          ? Math.max(rawAudio, 0.14 + 0.06 * Math.sin(elapsed * 5.0))
          : rawAudio;
      const targetIntensity =
        mode === 'thinking'
          ? 1.0
          : mode === 'speaking'
          ? 0.85
          : mode === 'listening'
          ? 0.55
          : mode === 'seeing'
          ? 0.65
          : 0.2;
      const targetVision = mode === 'seeing' ? 1.0 : 0.0;
      const targetShiftY = hasScreenRef.current ? 0.18 : 0.0;

      smoothAudio += (targetAudio - smoothAudio) * Math.min(1, dt * 10);
      smoothIntensity += (targetIntensity - smoothIntensity) * Math.min(1, dt * 4.5);
      smoothVision += (targetVision - smoothVision) * Math.min(1, dt * 5);
      smoothShiftY += (targetShiftY - smoothShiftY) * Math.min(1, dt * 4);

      plasmaUniforms.uTime.value = elapsed;
      plasmaUniforms.uAudio.value = smoothAudio;
      plasmaUniforms.uIntensity.value = smoothIntensity;
      plasmaUniforms.uVision.value = smoothVision;

      // Smooth pointer parallax
      pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 4);
      pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 4);
      camera.position.x = pointer.x * 0.65;
      camera.position.y = 0.35 - pointer.y * 0.42;
      camera.lookAt(0, smoothShiftY, 0);

      // Core scale breathing + speech resonance
      const breath = 1.0 + Math.sin(elapsed * 1.8) * 0.018 + smoothAudio * 0.11;
      coreGroup.scale.setScalar(breath);
      coreGroup.position.y = Math.sin(elapsed * 1.1) * 0.06 + smoothShiftY;

      // Multi-axis rotations accelerated in thinking/speaking states
      const speedMult = 1.0 + smoothIntensity * 1.65 + smoothAudio * 1.4;
      latticeMesh.rotation.y += dt * 0.22 * speedMult;
      latticeMesh.rotation.x += dt * 0.09 * speedMult;
      latticeInnerMesh.rotation.y -= dt * 0.31 * speedMult;
      latticeInnerMesh.rotation.z += dt * 0.14 * speedMult;
      nodeInstanced.rotation.copy(latticeMesh.rotation);

      dialDisc1.rotation.z += dt * 0.28 * speedMult;
      dialDisc2.rotation.z -= dt * 0.21 * speedMult;
      gyroRingA.rotation.z += dt * 0.38 * speedMult;
      gyroRingA.rotation.y += dt * 0.16 * speedMult;
      gyroRingB.rotation.x += dt * 0.24 * speedMult;
      gyroRingB.rotation.z -= dt * 0.29 * speedMult;
      particleCloud.rotation.y += dt * 0.08 * speedMult;
      particleCloud.rotation.x = Math.sin(elapsed * 0.3) * 0.14;

      // Optical Vision Ring animation
      visionRingMat.opacity = smoothVision * (0.68 + 0.2 * Math.sin(elapsed * 4.5));
      visionDisc.rotation.z -= dt * 0.7;
      visionDisc.rotation.y = Math.sin(elapsed * 0.8) * 0.22;

      // Dynamic emissive glow & lighting intensity
      coreLight.intensity = 6.5 + smoothAudio * 8.0 + smoothIntensity * 2.5;
      nucleusMat.emissiveIntensity = 0.75 + smoothAudio * 1.3 + smoothIntensity * 0.4;
      latticeMat.opacity = 0.28 + smoothAudio * 0.35 + smoothIntensity * 0.14;

      // Synaptic firing wave across instanced nodes
      for (let i = 0; i < uniqueVerts.length; i++) {
        const v = uniqueVerts[i];
        const wave = Math.sin(elapsed * (3.2 + smoothIntensity * 3.0) + v.y * 2.8 + v.x * 2.1);
        const s = 0.75 + Math.max(0, wave) * (0.85 + smoothAudio * 1.5);
        dummy.position.copy(v);
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        nodeInstanced.setMatrixAt(i, dummy.matrix);
      }
      nodeInstanced.instanceMatrix.needsUpdate = true;

      renderer.render(scene, camera);
      afterDraw(tick);
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);

      plasmaGeo.dispose();
      plasmaMat.dispose();
      nucleusGeo.dispose();
      nucleusMat.dispose();
      latticeOuterGeo.dispose();
      latticeWireGeo.dispose();
      latticeMat.dispose();
      latticeInnerGeo.dispose();
      latticeInnerWireGeo.dispose();
      latticeInnerMat.dispose();
      nodeGeo.dispose();
      nodeMat.dispose();
      ringPlaneGeo1.dispose();
      ringPlaneMat1.dispose();
      ringPlaneGeo2.dispose();
      ringPlaneMat2.dispose();
      visionRingGeo.dispose();
      visionRingMat.dispose();
      dialTex1.dispose();
      dialTex2.dispose();
      visionTex.dispose();
      gyroRingA.geometry.dispose();
      gyroRingB.geometry.dispose();
      gyroMat.dispose();
      particleGeo.dispose();
      particleMat.dispose();
      floorRingGeo1.dispose();
      floorRingMat1.dispose();
      floorRingGeo2.dispose();
      floorRingMat2.dispose();
      envTarget.dispose();
      renderer.dispose();
    };
  }, [audioLevelRef]);

  return (
    <div
      ref={containerRef}
      onClick={onCoreClick}
      className="fixed inset-0 z-0 h-full w-full cursor-pointer select-none"
      aria-label="Núcleo Holográfico 3D Aegis"
    />
  );
};

import * as THREE from 'three';
import type { CarSpec } from './types';
import type { ProceduralTextureSet } from './textures';

export interface DeformableMeshEntry {
  mesh: THREE.Mesh;
  restPositions: Float32Array;
  maxDeform: number;
}

export type TurnSignalMode = 'none' | 'left' | 'right' | 'hazard';

export interface CarVisualRig {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  roofMesh: THREE.Mesh;
  contactShadow: THREE.Mesh;
  steeringWheel: THREE.Group;
  hoodGroup: THREE.Group;
  frontBumperGroup: THREE.Group;
  rearBumperGroup: THREE.Group;
  spoilerGroup: THREE.Group | null;
  leftDoorGroup: THREE.Group;
  rightDoorGroup: THREE.Group;
  driverGroup: THREE.Group;
  taxiSign: THREE.Mesh | null;
  windshieldMesh: THREE.Mesh;
  leftHeadlightMesh: THREE.Mesh;
  rightHeadlightMesh: THREE.Mesh;
  leftHeadlightMat: THREE.MeshStandardMaterial;
  rightHeadlightMat: THREE.MeshStandardMaterial;
  brakeLightMat: THREE.MeshStandardMaterial;
  leftBlinkerMat: THREE.MeshStandardMaterial;
  rightBlinkerMat: THREE.MeshStandardMaterial;
  paintMat: THREE.MeshPhysicalMaterial;
  glassMat: THREE.MeshPhysicalMaterial;
  crackedGlassMat: THREE.MeshPhysicalMaterial;
  wheelSpinMeshes: THREE.Group[];
  frontSteerPivots: THREE.Group[];
  wheelCamberPivots: THREE.Group[];
  deformableMeshes: DeformableMeshEntry[];
  driverEyeLocal: THREE.Vector3;
  setPaintColor: (hex: number) => void;
  setDriverVisible: (visible: boolean) => void;
  setDoorOpen: (side: 'left' | 'right', openRatio: number) => void;
  updateLightbar: (timeSec: number, active: boolean) => void;
  updateTurnSignals: (timeSec: number, mode: TurnSignalMode) => void;
  deformAtLocalPoint: (lx: number, ly: number, lz: number, nx: number, nz: number, radius: number, strength: number) => void;
  resetDeformation: () => void;
  dispose: () => void;
}

function markShared<T extends THREE.Material | THREE.BufferGeometry>(obj: T): T {
  obj.userData.shared = true;
  return obj;
}

const SHARED_TIRE_MAT = markShared(new THREE.MeshStandardMaterial({ color: 0x16181d, roughness: 0.86, metalness: 0.06 }));
const SHARED_RIM_MAT = markShared(new THREE.MeshStandardMaterial({ color: 0xdbe2ea, roughness: 0.18, metalness: 0.92 }));
const SHARED_DISC_MAT = markShared(new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.32, metalness: 0.85 }));
const SHARED_BARREL_MAT = markShared(new THREE.MeshStandardMaterial({ color: 0x1f242c, roughness: 0.4, metalness: 0.8 }));
const SHARED_TRIM_MAT = markShared(new THREE.MeshStandardMaterial({ color: 0x16191f, roughness: 0.65, metalness: 0.28 }));
const SHARED_CHROME_MAT = markShared(new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.15, metalness: 0.92 }));
const SHARED_INTERIOR_MAT = markShared(new THREE.MeshStandardMaterial({ color: 0x1b1f26, roughness: 0.85, metalness: 0.06 }));
const SHARED_SKIN_MAT = markShared(new THREE.MeshStandardMaterial({ color: 0xe0ac69, roughness: 0.65 }));
const SHARED_HAIR_MAT = markShared(new THREE.MeshStandardMaterial({ color: 0x27272a, roughness: 0.82 }));
const SHARED_ENGINE_MAT = markShared(new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.78, roughness: 0.35 }));
const SHARED_VALVE_MAT = markShared(new THREE.MeshStandardMaterial({ color: 0xdc2626, metalness: 0.4, roughness: 0.35 }));
const SHARED_DIAL_CYAN_MAT = markShared(new THREE.MeshStandardMaterial({ color: 0x090d16, emissive: 0x38bdf8, emissiveIntensity: 0.95 }));
const SHARED_DIAL_AMBER_MAT = markShared(new THREE.MeshStandardMaterial({ color: 0x090d16, emissive: 0xf59e0b, emissiveIntensity: 0.95 }));
const SHARED_NAV_MAT = markShared(new THREE.MeshStandardMaterial({ color: 0x0f172a, emissive: 0x0ea5e9, emissiveIntensity: 0.85 }));

const DRIVER_JACKET_COLORS = [0x2563eb, 0x0f766e, 0x7c3aed, 0xbe123c, 0x334155, 0xb45309, 0x059669];
let driverColorCounter = 0;

function registerDeformable(geo: THREE.BufferGeometry, mesh: THREE.Mesh, maxDeform: number, list: DeformableMeshEntry[]): void {
  const pos = geo.attributes.position;
  const rest = new Float32Array(pos.array.length);
  rest.set(pos.array as Float32Array);
  list.push({ mesh, restPositions: rest, maxDeform });
}

const _outDir = new THREE.Vector3();
const _zAxis = new THREE.Vector3(0, 0, 1);

function createDeformAndScratchHandler(
  bodyGroup: THREE.Group,
  deformableMeshes: DeformableMeshEntry[],
  scratchMap: THREE.CanvasTexture
): {
  deformAtLocalPoint: (
    lx: number,
    ly: number,
    lz: number,
    nx: number,
    nz: number,
    radius: number,
    strength: number
  ) => void;
  clearScratches: () => void;
  disposeScratchMat: () => void;
} {
  const scratchMeshes: THREE.Mesh[] = [];
  const scratchMat = new THREE.MeshStandardMaterial({
    map: scratchMap,
    transparent: true,
    opacity: 0.94,
    roughness: 0.42,
    metalness: 0.55,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
    side: THREE.DoubleSide,
  });

  const deformAtLocalPoint = (
    lx: number,
    ly: number,
    lz: number,
    nx: number,
    nz: number,
    radius: number,
    strength: number
  ) => {
    const rSq = radius * radius;
    let bestMesh: THREE.Mesh | null = null;
    let bestDistSq = Infinity;
    let bestVx = 0;
    let bestVy = 0;
    let bestVz = 0;

    for (const entry of deformableMeshes) {
      const mesh = entry.mesh;
      if (!mesh.visible) continue;
      const hasSubParent = mesh.parent !== null && mesh.parent !== bodyGroup;
      const parentX = hasSubParent ? mesh.parent!.position.x : 0;
      const parentY = hasSubParent ? mesh.parent!.position.y : 0;
      const parentZ = hasSubParent ? mesh.parent!.position.z : 0;

      const offsetX = lx - parentX - mesh.position.x;
      const offsetY = ly - parentY - mesh.position.y;
      const offsetZ = lz - parentZ - mesh.position.z;

      const posAttr = mesh.geometry.attributes.position as THREE.BufferAttribute;
      const arr = posAttr.array as Float32Array;
      const rest = entry.restPositions;
      let modified = false;

      for (let i = 0; i < posAttr.count; i++) {
        const idx = i * 3;
        const vx = arr[idx];
        const vy = arr[idx + 1];
        const vz = arr[idx + 2];

        const dx = vx - offsetX;
        const dy = vy - offsetY;
        const dz = vz - offsetZ;
        const dSq = dx * dx + dy * dy + dz * dz;

        if (dSq < rSq) {
          const dist = Math.sqrt(dSq);
          const falloff = 1 - dist / radius;
          const rx = rest[idx];
          const ry = rest[idx + 1];
          const rz = rest[idx + 2];
          const hash = Math.sin(rx * 19.3 + rz * 27.1 + ry * 11.7);

          const push = strength * falloff * (1.22 + Math.abs(hash) * 0.4);
          let nextX = vx + nx * push + hash * 0.045 * falloff;
          let nextY = vy + (hash > 0 ? 0.08 : -0.05) * push;
          let nextZ = vz + nz * push + Math.cos(rx * 13.7 + rz * 21.3) * 0.03 * falloff;

          const dispX = nextX - rx;
          const dispY = nextY - ry;
          const dispZ = nextZ - rz;
          const dispLen = Math.hypot(dispX, dispY, dispZ);
          if (dispLen > entry.maxDeform) {
            const s = entry.maxDeform / dispLen;
            nextX = rx + dispX * s;
            nextY = ry + dispY * s;
            nextZ = rz + dispZ * s;
          }

          arr[idx] = nextX;
          arr[idx + 1] = nextY;
          arr[idx + 2] = nextZ;
          modified = true;

          if (dSq < bestDistSq) {
            bestDistSq = dSq;
            bestMesh = mesh;
            bestVx = nextX;
            bestVy = nextY;
            bestVz = nextZ;
          }
        }
      }

      if (modified) {
        posAttr.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
      }
    }

    // Stamp a textured paint/metal scratch decal onto the impacted body panel
    if (bestMesh && strength >= 0.04) {
      let outX = -nx;
      let outZ = -nz;
      const outLen = Math.hypot(outX, outZ);
      if (outLen < 0.05) {
        const rLen = Math.hypot(lx, lz) || 1;
        outX = lx / rLen;
        outZ = lz / rLen;
      } else {
        outX /= outLen;
        outZ /= outLen;
      }

      const w = 0.56 + Math.min(0.45, strength * 1.15);
      const h = 0.24 + Math.min(0.2, strength * 0.48);
      const scratchGeo = new THREE.PlaneGeometry(w, h);
      const scratchMesh = new THREE.Mesh(scratchGeo, scratchMat);
      scratchMesh.position.set(bestVx + outX * 0.018, bestVy + 0.02, bestVz + outZ * 0.018);
      _outDir.set(outX, 0.14, outZ).normalize();
      scratchMesh.quaternion.setFromUnitVectors(_zAxis, _outDir);
      scratchMesh.rotateZ(Math.sin(lx * 7.3 + lz * 11.1) * 0.34);
      scratchMesh.renderOrder = 1;
      bestMesh.add(scratchMesh);
      scratchMeshes.push(scratchMesh);

      if (scratchMeshes.length > 16) {
        const oldest = scratchMeshes.shift()!;
        oldest.parent?.remove(oldest);
        oldest.geometry.dispose();
      }
    }
  };

  const clearScratches = () => {
    for (const sm of scratchMeshes) {
      sm.parent?.remove(sm);
      sm.geometry.dispose();
    }
    scratchMeshes.length = 0;
  };

  const disposeScratchMat = () => {
    clearScratches();
    scratchMat.dispose();
  };

  return { deformAtLocalPoint, clearScratches, disposeScratchMat };
}

/**
 * Creates a clean quad mesh directly between 4 exact 3D corners (bottom-left, bottom-right, top-right, top-left)
 * so every windshield, rear glass, and side window sits 100% flush with its surrounding pillars & frames!
 */
function createQuadBetween(
  p00: [number, number, number],
  p10: [number, number, number],
  p11: [number, number, number],
  p01: [number, number, number]
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array([
    ...p00,
    ...p10,
    ...p11,
    ...p01,
  ]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.computeVertexNormals();
  return geo;
}

function addAlignedBeam(
  parent: THREE.Object3D,
  x1: number,
  y1: number,
  z1: number,
  x2: number,
  y2: number,
  z2: number,
  rBot: number,
  rTop: number,
  mat: THREE.Material
): void {
  const start = new THREE.Vector3(x1, y1, z1);
  const end = new THREE.Vector3(x2, y2, z2);
  const dir = new THREE.Vector3().subVectors(end, start);
  const len = dir.length();
  if (len < 0.01) return;
  const geo = new THREE.CylinderGeometry(rTop, rBot, len, 7);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(start).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  parent.add(mesh);
}

function buildSeatedDriver(jacketColor: number, isPolice: boolean): THREE.Group {
  const g = new THREE.Group();
  const jacketMat = new THREE.MeshStandardMaterial({
    color: isPolice ? 0x1e3a8a : jacketColor,
    roughness: 0.74,
  });
  const pantsMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.86 });

  // Thighs seated on cushion
  const thighs = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.34), pantsMat);
  thighs.position.set(0, 0.08, -0.06);
  g.add(thighs);

  // Torso leaning slightly back against seatback
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.44, 0.2), jacketMat);
  torso.position.set(0, 0.33, 0.08);
  torso.rotation.x = -0.18;
  g.add(torso);

  // Shoulders & arms reaching forward onto steering wheel
  for (const ax of [-0.19, 0.19]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.42), jacketMat);
    arm.position.set(ax, 0.44, -0.12);
    arm.rotation.x = 0.22;
    arm.rotation.y = ax < 0 ? -0.16 : 0.16;
    g.add(arm);
  }

  // Head
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.23, 0.21), SHARED_SKIN_MAT);
  head.position.set(0, 0.67, 0.09);
  g.add(head);

  if (isPolice) {
    const capMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.55 });
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.09, 0.25), capMat);
    cap.position.set(0, 0.8, 0.09);
    g.add(cap);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.025, 0.11), capMat);
    visor.position.set(0, 0.765, -0.05);
    g.add(visor);
  } else {
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.08, 0.23), SHARED_HAIR_MAT);
    hair.position.set(0, 0.78, 0.1);
    g.add(hair);
  }

  return g;
}

function createWheelAssembly(radius: number, width: number, caliperColor: number): {
  spinGroup: THREE.Group;
  caliperGroup: THREE.Group;
} {
  const spinGroup = new THREE.Group();
  const caliperGroup = new THREE.Group();

  const caliperMat = new THREE.MeshStandardMaterial({
    color: caliperColor,
    roughness: 0.35,
    metalness: 0.5,
  });

  const outerR = radius;
  const innerR = radius * 0.65;
  const hw = width * 0.48;
  const lathePts = [
    new THREE.Vector2(innerR, -hw * 0.88),
    new THREE.Vector2(outerR * 0.93, -hw),
    new THREE.Vector2(outerR, -hw * 0.72),
    new THREE.Vector2(outerR, hw * 0.72),
    new THREE.Vector2(outerR * 0.93, hw),
    new THREE.Vector2(innerR, hw * 0.88),
  ];
  const tireGeo = new THREE.LatheGeometry(lathePts, 18);
  tireGeo.rotateZ(Math.PI / 2);
  const tire = new THREE.Mesh(tireGeo, SHARED_TIRE_MAT);
  spinGroup.add(tire);

  const rimBarrelGeo = new THREE.CylinderGeometry(innerR * 1.02, innerR * 1.02, width * 0.84, 14, 1);
  rimBarrelGeo.rotateZ(Math.PI / 2);
  const rimBarrel = new THREE.Mesh(rimBarrelGeo, SHARED_BARREL_MAT);
  spinGroup.add(rimBarrel);

  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    const spokeGeo = new THREE.BoxGeometry(width * 0.88, innerR * 1.85, radius * 0.085);
    const spoke = new THREE.Mesh(spokeGeo, SHARED_RIM_MAT);
    spoke.rotation.x = angle;
    spinGroup.add(spoke);
  }

  const capGeo = new THREE.CylinderGeometry(radius * 0.19, radius * 0.21, width * 0.92, 10);
  capGeo.rotateZ(Math.PI / 2);
  const cap = new THREE.Mesh(capGeo, caliperMat);
  spinGroup.add(cap);

  const discGeo = new THREE.CylinderGeometry(innerR * 0.82, innerR * 0.82, 0.04, 14);
  discGeo.rotateZ(Math.PI / 2);
  const disc = new THREE.Mesh(discGeo, SHARED_DISC_MAT);
  spinGroup.add(disc);

  const calGeo = new THREE.BoxGeometry(0.11, radius * 0.36, radius * 0.24);
  const cal = new THREE.Mesh(calGeo, caliperMat);
  cal.position.set(0, radius * 0.24, radius * 0.28);
  caliperGroup.add(cal);

  return { spinGroup, caliperGroup };
}

function createSideFenderGeometry(spec: CarSpec, sideWidth: number): THREE.BufferGeometry {
  const L = spec.length;
  const WB = spec.wheelBase;
  const WR = spec.wheelRadius;
  const clearance = WR * 0.72;
  const archR = WR * 1.24;
  const frontAxleX2d = WB * 0.5;
  const rearAxleX2d = -WB * 0.5;
  const noseX = L * 0.48;
  const tailX = -L * 0.48;

  const isSport = spec.id === 'viper';
  const isMuscle = spec.id === 'dominator';
  const isSuv = spec.id === 'titan';

  const beltY = clearance + (isSuv ? 0.66 : isSport ? 0.48 : 0.54);
  const noseY = clearance + (isSuv ? 0.48 : isSport ? 0.24 : 0.32);
  const hoodTopY = clearance + (isSuv ? 0.64 : isSport ? 0.45 : 0.52);
  const tailY = clearance + (isSuv ? 0.7 : isSport ? 0.56 : 0.58);

  const shape = new THREE.Shape();
  shape.moveTo(tailX + 0.08, clearance + 0.08);
  shape.lineTo(rearAxleX2d - archR, clearance);
  shape.absarc(rearAxleX2d, WR * 0.95, archR, Math.PI, 0, true);
  shape.lineTo(frontAxleX2d - archR, clearance);
  shape.absarc(frontAxleX2d, WR * 0.95, archR, Math.PI, 0, true);
  shape.lineTo(noseX - 0.08, clearance + 0.02);
  shape.quadraticCurveTo(noseX + 0.04, (clearance + noseY) * 0.55, noseX - 0.06, noseY);
  shape.quadraticCurveTo(frontAxleX2d + 0.15, hoodTopY + (isSport ? 0.02 : 0.04), frontAxleX2d - 0.52, beltY);
  if (isMuscle) {
    shape.bezierCurveTo(0.1, beltY - 0.02, -0.4, beltY + 0.07, rearAxleX2d + 0.35, tailY + 0.03);
  } else {
    shape.lineTo(rearAxleX2d + 0.35, tailY);
  }
  shape.lineTo(tailX + 0.06, tailY - 0.04);
  shape.quadraticCurveTo(tailX - 0.04, (tailY + clearance) * 0.55, tailX + 0.08, clearance + 0.08);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: sideWidth,
    steps: 6,
    curveSegments: 12,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.035,
    bevelSegments: 2,
  });

  geo.translate(0, 0, -sideWidth * 0.5);
  geo.rotateY(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function createSculptedHoodGeometry(spec: CarSpec, width: number): THREE.BufferGeometry {
  const L = spec.length;
  const WR = spec.wheelRadius;
  const clearance = WR * 0.72;
  const isSport = spec.id === 'viper';
  const isSuv = spec.id === 'titan';

  const noseY = clearance + (isSuv ? 0.51 : isSport ? 0.29 : 0.36);
  const cowlY = clearance + (isSuv ? 0.67 : isSport ? 0.51 : 0.57);
  const hoodLen = L * 0.32;

  const shape = new THREE.Shape();
  shape.moveTo(-hoodLen * 0.5, cowlY - 0.06);
  shape.lineTo(hoodLen * 0.5, noseY - 0.05);
  shape.lineTo(hoodLen * 0.5, noseY + 0.01);
  shape.quadraticCurveTo(0, (noseY + cowlY) * 0.5 + 0.05, -hoodLen * 0.5, cowlY + 0.01);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    steps: 3,
    curveSegments: 8,
    bevelEnabled: true,
    bevelThickness: 0.03,
    bevelSize: 0.025,
    bevelSegments: 2,
  });
  geo.translate(0, 0, -width * 0.5);
  geo.rotateY(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function createSculptedRoofGeometry(spec: CarSpec, width: number, cabinLen: number, roofBaseY: number): THREE.BufferGeometry {
  const isSuv = spec.id === 'titan';
  const isSport = spec.id === 'viper';
  const crown = isSuv ? 0.04 : isSport ? 0.08 : 0.065;

  const shape = new THREE.Shape();
  const halfL = cabinLen * 0.42;
  shape.moveTo(-halfL, roofBaseY - 0.02);
  shape.lineTo(halfL, roofBaseY - 0.02);
  shape.quadraticCurveTo(halfL * 0.45, roofBaseY + crown, 0, roofBaseY + crown + 0.015);
  shape.quadraticCurveTo(-halfL * 0.45, roofBaseY + crown, -halfL, roofBaseY - 0.02);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    steps: 3,
    curveSegments: 10,
    bevelEnabled: true,
    bevelThickness: 0.03,
    bevelSize: 0.02,
    bevelSegments: 2,
  });
  geo.translate(0, 0, -width * 0.5);
  geo.rotateY(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function createContouredBumperGeometry(width: number, height: number, depth: number): THREE.BufferGeometry {
  const hw = width * 0.48;
  const hd = depth * 0.5;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, -hd * 0.4);
  shape.quadraticCurveTo(-hw * 0.85, hd, -hw * 0.45, hd);
  shape.lineTo(hw * 0.45, hd);
  shape.quadraticCurveTo(hw * 0.85, hd, hw, -hd * 0.4);
  shape.lineTo(hw * 0.9, -hd);
  shape.lineTo(-hw * 0.9, -hd);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    steps: 2,
    curveSegments: 8,
    bevelEnabled: true,
    bevelThickness: 0.028,
    bevelSize: 0.022,
    bevelSegments: 2,
  });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, height * 0.5, 0);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Heavy Cargo Truck Builder (Titan Hauler 8x4)
 */
function buildTruckVisualRig(
  spec: CarSpec,
  textures: ProceduralTextureSet,
  isSoftwareGl: boolean,
  colorHex: number
): CarVisualRig {
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const deformableMeshes: DeformableMeshEntry[] = [];
  const { length: L, width: W, height: H, wheelRadius: WR, wheelBase: WB, trackWidth: TW } = spec;

  const paintMat = new THREE.MeshPhysicalMaterial({
    color: colorHex,
    metalness: 0.35,
    roughness: 0.32,
    clearcoat: 0.45,
    clearcoatRoughness: 0.24,
  });
  const cargoMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.58, metalness: 0.16 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xa5d8ff,
    metalness: 0.05,
    roughness: 0.05,
    transparent: true,
    opacity: isSoftwareGl ? 0.24 : 0.28,
    clearcoat: 1.0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const crackedGlassMat = new THREE.MeshPhysicalMaterial({
    color: 0xdbeafe,
    map: textures.crackedGlassMap,
    metalness: 0.1,
    roughness: 0.28,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const leftHeadlightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3c4, emissiveIntensity: 1.7 });
  const rightHeadlightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3c4, emissiveIntensity: 1.7 });
  const brakeLightMat = new THREE.MeshStandardMaterial({ color: 0x991b1b, emissive: 0xef4444, emissiveIntensity: 0.9 });
  const leftBlinkerMat = new THREE.MeshStandardMaterial({ color: 0x78350f, emissive: 0xf59e0b, emissiveIntensity: 0.05 });
  const rightBlinkerMat = new THREE.MeshStandardMaterial({ color: 0x78350f, emissive: 0xf59e0b, emissiveIntensity: 0.05 });

  // Shadow
  const shadowGeo = new THREE.PlaneGeometry(W * 1.28, L * 1.12);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({ map: textures.contactShadowMap, transparent: true, opacity: 0.55, depthWrite: false });
  const contactShadow = new THREE.Mesh(shadowGeo, shadowMat);
  contactShadow.position.y = 0.025;
  root.add(contactShadow);

  // Heavy steel ladder frame + side diesel tanks
  const chassisY = WR * 0.92;
  const frameMesh = new THREE.Mesh(new THREE.BoxGeometry(W * 0.58, 0.24, L * 0.92), SHARED_TRIM_MAT);
  frameMesh.position.set(0, chassisY, 0);
  bodyGroup.add(frameMesh);

  for (const side of [-1, 1] as const) {
    const tankGeo = new THREE.CylinderGeometry(0.24, 0.24, 1.35, 10);
    tankGeo.rotateX(Math.PI / 2);
    const tank = new THREE.Mesh(tankGeo, SHARED_CHROME_MAT);
    tank.position.set(side * (W * 0.36), chassisY - 0.06, -0.45);
    bodyGroup.add(tank);
  }

  // Forward Cab Base + Lower Nose + Grille
  const cabZ = -L * 0.28;
  const cabFloorY = chassisY + 0.22;
  const beltY = cabFloorY + 0.85;
  const roofBaseY = H - 0.22;

  const cabLowerGeo = new THREE.BoxGeometry(W * 0.94, 0.88, 2.05, 3, 2, 3);
  const cabLower = new THREE.Mesh(cabLowerGeo, paintMat);
  cabLower.position.set(0, cabFloorY + 0.42, cabZ);
  cabLower.castShadow = true;
  bodyGroup.add(cabLower);
  registerDeformable(cabLowerGeo, cabLower, 0.32, deformableMeshes);

  // Hood / front grille panel (detachable hoodGroup)
  const hoodGroup = new THREE.Group();
  hoodGroup.position.set(0, cabFloorY + 0.44, cabZ - 1.02);
  const grilleBox = new THREE.Mesh(new THREE.BoxGeometry(W * 0.72, 0.72, 0.14), SHARED_CHROME_MAT);
  hoodGroup.add(grilleBox);
  for (let slat = -2; slat <= 2; slat++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(W * 0.64, 0.05, 0.16), SHARED_TRIM_MAT);
    bar.position.y = slat * 0.13;
    hoodGroup.add(bar);
  }
  bodyGroup.add(hoodGroup);

  // Framed Cab Greenhouse (A/B/C pillars + Roof + Flush Framed Windshield)
  const roofGeo = new THREE.BoxGeometry(W * 0.92, 0.14, 1.95, 2, 1, 2);
  const roofMesh = new THREE.Mesh(roofGeo, paintMat);
  roofMesh.position.set(0, roofBaseY + 0.06, cabZ + 0.08);
  roofMesh.castShadow = true;
  bodyGroup.add(roofMesh);
  registerDeformable(roofGeo, roofMesh, 0.22, deformableMeshes);

  // Roof Aero Deflector + Amber Clearance Lights
  const deflector = new THREE.Mesh(new THREE.BoxGeometry(W * 0.86, 0.34, 0.9), paintMat);
  deflector.position.set(0, roofBaseY + 0.28, cabZ + 0.45);
  deflector.rotation.x = 0.24;
  bodyGroup.add(deflector);
  for (const mx of [-0.55, 0, 0.55]) {
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.07, 0.08),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 1.5 })
    );
    marker.position.set(mx, roofBaseY + 0.14, cabZ - 0.86);
    bodyGroup.add(marker);
  }

  // Twin Chrome Vertical Exhaust Stacks behind cab
  for (const sx of [-W * 0.44, W * 0.44]) {
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.075, 2.35, 10), SHARED_CHROME_MAT);
    stack.position.set(sx, cabFloorY + 1.45, cabZ + 1.12);
    bodyGroup.add(stack);
  }

  const wsBotZ = cabZ - 0.96;
  const wsTopZ = cabZ - 0.78;
  const cabBackZ = cabZ + 0.98;
  for (const side of [-1, 1] as const) {
    addAlignedBeam(bodyGroup, side * (W * 0.45), beltY - 0.02, wsBotZ, side * (W * 0.43), roofBaseY, wsTopZ, 0.055, 0.05, SHARED_TRIM_MAT);
    addAlignedBeam(bodyGroup, side * (W * 0.45), beltY - 0.02, cabBackZ, side * (W * 0.43), roofBaseY, cabBackZ, 0.08, 0.08, paintMat);
    addAlignedBeam(bodyGroup, side * (W * 0.43), roofBaseY, wsTopZ, side * (W * 0.43), roofBaseY, cabBackZ, 0.05, 0.05, SHARED_TRIM_MAT);
  }
  // Cab rear solid wall
  const cabBackWall = new THREE.Mesh(new THREE.BoxGeometry(W * 0.88, roofBaseY - beltY + 0.05, 0.12), paintMat);
  cabBackWall.position.set(0, (beltY + roofBaseY) * 0.5, cabBackZ);
  bodyGroup.add(cabBackWall);

  // Exact-fit Framed Truck Windshield
  const wsGeo = createQuadBetween(
    [-W * 0.44, beltY - 0.01, wsBotZ],
    [W * 0.44, beltY - 0.01, wsBotZ],
    [W * 0.42, roofBaseY, wsTopZ],
    [-W * 0.42, roofBaseY, wsTopZ]
  );
  const windshieldMesh = new THREE.Mesh(wsGeo, glassMat);
  windshieldMesh.renderOrder = 2;
  bodyGroup.add(windshieldMesh);

  // Cab Interior + Steering Wheel + Seated Truck Driver
  const dash = new THREE.Mesh(new THREE.BoxGeometry(W * 0.82, 0.22, 0.34), SHARED_INTERIOR_MAT);
  dash.position.set(0, beltY - 0.1, cabZ - 0.72);
  bodyGroup.add(dash);

  const steeringWheel = new THREE.Group();
  steeringWheel.position.set(-0.5, beltY + 0.02, cabZ - 0.45);
  steeringWheel.rotation.x = -0.65;
  steeringWheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.02, 8, 18), SHARED_TRIM_MAT));
  bodyGroup.add(steeringWheel);

  const driverGroup = buildSeatedDriver(DRIVER_JACKET_COLORS[driverColorCounter++ % DRIVER_JACKET_COLORS.length], false);
  driverGroup.position.set(-0.5, cabFloorY + 0.38, cabZ - 0.05);
  bodyGroup.add(driverGroup);

  const driverEyeLocal = new THREE.Vector3(-0.5, beltY + 0.48, cabZ - 0.25);

  // Framed Cab Doors pivoted at front A-pillar hinge so doors swing outward realistically
  const buildTruckDoor = (side: -1 | 1): THREE.Group => {
    const dg = new THREE.Group();
    const dx = side * (W * 0.465);
    const doorPivotZ = cabZ - 0.82;
    dg.position.set(dx, 0, doorPivotZ);
    const doorSkinGeo = new THREE.BoxGeometry(0.08, 0.82, 1.5);
    const doorSkin = new THREE.Mesh(doorSkinGeo, paintMat);
    doorSkin.position.set(0, cabFloorY + 0.44, cabZ - doorPivotZ);
    dg.add(doorSkin);
    registerDeformable(doorSkinGeo, doorSkin, 0.2, deformableMeshes);

    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.05, 0.18), SHARED_CHROME_MAT);
    handle.position.set(side * 0.05, beltY - 0.14, 1.32);
    dg.add(handle);

    const sashTop = roofBaseY;
    const sashBot = beltY - 0.01;
    const fzBot = 0;
    const fzTop = 0.14;
    const rz = 1.6;
    addAlignedBeam(dg, 0, sashBot, fzBot, -side * 0.02, sashTop, fzTop, 0.03, 0.03, SHARED_TRIM_MAT);
    addAlignedBeam(dg, -side * 0.02, sashTop, fzTop, -side * 0.02, sashTop, rz, 0.03, 0.03, SHARED_TRIM_MAT);
    addAlignedBeam(dg, 0, sashBot, rz, -side * 0.02, sashTop, rz, 0.03, 0.03, SHARED_TRIM_MAT);

    const doorGlassGeo = createQuadBetween(
      [0, sashBot, fzBot],
      [0, sashBot, rz],
      [-side * 0.02, sashTop, rz],
      [-side * 0.02, sashTop, fzTop]
    );
    const doorGlass = new THREE.Mesh(doorGlassGeo, glassMat);
    doorGlass.renderOrder = 2;
    dg.add(doorGlass);

    // Tall truck side mirror on dual bracket
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.34, 0.1), SHARED_TRIM_MAT);
    mirror.position.set(side * 0.18, beltY + 0.24, 0.06);
    dg.add(mirror);
    return dg;
  };
  const leftDoorGroup = buildTruckDoor(-1);
  const rightDoorGroup = buildTruckDoor(1);
  bodyGroup.add(leftDoorGroup);
  bodyGroup.add(rightDoorGroup);

  // Heavy Ribbed Cargo Box Body behind cab
  const cargoLen = L * 0.62;
  const cargoH = H - cabFloorY - 0.05;
  const cargoZ = L * 0.16;
  const cargoGeo = new THREE.BoxGeometry(W * 0.96, cargoH, cargoLen, 3, 2, 4);
  const cargoBox = new THREE.Mesh(cargoGeo, cargoMat);
  cargoBox.position.set(0, cabFloorY + cargoH * 0.5 + 0.02, cargoZ);
  cargoBox.castShadow = true;
  cargoBox.receiveShadow = true;
  bodyGroup.add(cargoBox);
  registerDeformable(cargoGeo, cargoBox, 0.25, deformableMeshes);

  // Colored stripe along cargo sides
  for (const sx of [-W * 0.485, W * 0.485]) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.26, cargoLen * 0.92), paintMat);
    stripe.position.set(sx, cabFloorY + cargoH * 0.48, cargoZ);
    bodyGroup.add(stripe);
  }

  // Front Bumper + Headlights + Amber Blinkers
  const frontBumperGroup = new THREE.Group();
  frontBumperGroup.position.set(0, chassisY + 0.05, -L * 0.48);
  const fBumpGeo = createContouredBumperGeometry(W * 0.98, 0.32, 0.28);
  const fBumpMesh = new THREE.Mesh(fBumpGeo, SHARED_CHROME_MAT);
  frontBumperGroup.add(fBumpMesh);
  registerDeformable(fBumpGeo, fBumpMesh, 0.28, deformableMeshes);
  bodyGroup.add(frontBumperGroup);

  const hlGeo = new THREE.BoxGeometry(0.28, 0.16, 0.08);
  const leftHeadlightMesh = new THREE.Mesh(hlGeo, leftHeadlightMat);
  leftHeadlightMesh.position.set(-W * 0.34, chassisY + 0.28, -L * 0.47);
  bodyGroup.add(leftHeadlightMesh);
  const rightHeadlightMesh = new THREE.Mesh(hlGeo, rightHeadlightMat);
  rightHeadlightMesh.position.set(W * 0.34, chassisY + 0.28, -L * 0.47);
  bodyGroup.add(rightHeadlightMesh);

  const blinkGeo = new THREE.BoxGeometry(0.14, 0.14, 0.1);
  const flB = new THREE.Mesh(blinkGeo, leftBlinkerMat);
  flB.position.set(-W * 0.44, chassisY + 0.28, -L * 0.465);
  bodyGroup.add(flB);
  const frB = new THREE.Mesh(blinkGeo, rightBlinkerMat);
  frB.position.set(W * 0.44, chassisY + 0.28, -L * 0.465);
  bodyGroup.add(frB);

  // Rear Bumper + Taillights + Rear Amber Blinkers
  const rearBumperGroup = new THREE.Group();
  rearBumperGroup.position.set(0, chassisY + 0.02, L * 0.48);
  const rBumpGeo = createContouredBumperGeometry(W * 0.96, 0.26, 0.24);
  rBumpGeo.rotateY(Math.PI);
  const rBumpMesh = new THREE.Mesh(rBumpGeo, SHARED_TRIM_MAT);
  rearBumperGroup.add(rBumpMesh);
  registerDeformable(rBumpGeo, rBumpMesh, 0.26, deformableMeshes);
  bodyGroup.add(rearBumperGroup);

  for (const tx of [-W * 0.33, W * 0.33]) {
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.08), brakeLightMat);
    tl.position.set(tx, chassisY + 0.24, L * 0.48);
    bodyGroup.add(tl);
  }
  const rlB = new THREE.Mesh(blinkGeo, leftBlinkerMat);
  rlB.position.set(-W * 0.44, chassisY + 0.24, L * 0.48);
  bodyGroup.add(rlB);
  const rrB = new THREE.Mesh(blinkGeo, rightBlinkerMat);
  rrB.position.set(W * 0.44, chassisY + 0.24, L * 0.48);
  bodyGroup.add(rrB);

  // 6 Heavy Truck Wheels (2 front steer + 4 tandem rear)
  const wheelSpinMeshes: THREE.Group[] = [];
  const frontSteerPivots: THREE.Group[] = [];
  const wheelCamberPivots: THREE.Group[] = [];
  const wheelCoords: Array<{ x: number; z: number; front: boolean }> = [
    { x: -TW * 0.5, z: -WB * 0.5, front: true },
    { x: TW * 0.5, z: -WB * 0.5, front: true },
    { x: -TW * 0.5, z: WB * 0.34, front: false },
    { x: TW * 0.5, z: WB * 0.34, front: false },
    { x: -TW * 0.5, z: WB * 0.62, front: false },
    { x: TW * 0.5, z: WB * 0.62, front: false },
  ];

  for (const wc of wheelCoords) {
    const pivot = new THREE.Group();
    pivot.position.set(wc.x, WR, wc.z);
    const camberGroup = new THREE.Group();
    const { spinGroup, caliperGroup } = createWheelAssembly(WR, 0.36, 0x38bdf8);
    camberGroup.add(spinGroup);
    camberGroup.add(caliperGroup);
    pivot.add(camberGroup);
    root.add(pivot);
    wheelSpinMeshes.push(spinGroup);
    wheelCamberPivots.push(camberGroup);
    if (wc.front) frontSteerPivots.push(pivot);
  }

  const updateTurnSignals = (timeSec: number, mode: TurnSignalMode) => {
    const blinkOn = Math.sin(timeSec * 14) > 0;
    const leftOn = (mode === 'left' || mode === 'hazard') && blinkOn;
    const rightOn = (mode === 'right' || mode === 'hazard') && blinkOn;
    leftBlinkerMat.emissiveIntensity = leftOn ? 3.8 : 0.04;
    leftBlinkerMat.color.setHex(leftOn ? 0xfbbf24 : 0x78350f);
    rightBlinkerMat.emissiveIntensity = rightOn ? 3.8 : 0.04;
    rightBlinkerMat.color.setHex(rightOn ? 0xfbbf24 : 0x78350f);
  };

  const { deformAtLocalPoint, clearScratches, disposeScratchMat } = createDeformAndScratchHandler(
    bodyGroup,
    deformableMeshes,
    textures.scratchDecalMap
  );

  const resetDeformation = () => {
    for (const entry of deformableMeshes) {
      const posAttr = entry.mesh.geometry.attributes.position as THREE.BufferAttribute;
      (posAttr.array as Float32Array).set(entry.restPositions);
      posAttr.needsUpdate = true;
      entry.mesh.geometry.computeVertexNormals();
    }
    clearScratches();
    hoodGroup.visible = true;
    frontBumperGroup.visible = true;
    rearBumperGroup.visible = true;
    leftDoorGroup.visible = true;
    rightDoorGroup.visible = true;
    leftDoorGroup.rotation.y = 0;
    rightDoorGroup.rotation.y = 0;
    windshieldMesh.material = glassMat;
    leftHeadlightMat.emissiveIntensity = 1.7;
    rightHeadlightMat.emissiveIntensity = 1.7;
  };

  const dispose = () => {
    disposeScratchMat();
    root.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const m = obj as THREE.Mesh;
        if (!m.geometry?.userData?.shared) m.geometry?.dispose();
        if (Array.isArray(m.material)) {
          m.material.forEach((mat) => {
            if (!mat.userData?.shared) mat.dispose();
          });
        } else if (m.material && !m.material.userData?.shared) {
          m.material.dispose();
        }
      }
    });
  };

  return {
    root,
    bodyGroup,
    roofMesh,
    contactShadow,
    steeringWheel,
    hoodGroup,
    frontBumperGroup,
    rearBumperGroup,
    spoilerGroup: null,
    leftDoorGroup,
    rightDoorGroup,
    driverGroup,
    taxiSign: null,
    windshieldMesh,
    leftHeadlightMesh,
    rightHeadlightMesh,
    leftHeadlightMat,
    rightHeadlightMat,
    brakeLightMat,
    leftBlinkerMat,
    rightBlinkerMat,
    paintMat,
    glassMat,
    crackedGlassMat,
    wheelSpinMeshes,
    frontSteerPivots,
    wheelCamberPivots,
    deformableMeshes,
    driverEyeLocal,
    setPaintColor: (hex: number) => paintMat.color.setHex(hex),
    setDriverVisible: (visible: boolean) => {
      driverGroup.visible = visible;
    },
    setDoorOpen: (side: 'left' | 'right', openRatio: number) => {
      const clamped = Math.max(0, Math.min(1, openRatio));
      if (side === 'left') {
        leftDoorGroup.rotation.y = -clamped * 1.08;
      } else {
        rightDoorGroup.rotation.y = clamped * 1.08;
      }
    },
    updateLightbar: () => {},
    updateTurnSignals,
    deformAtLocalPoint,
    resetDeformation,
    dispose,
  };
}

export function buildCarVisualRig(
  spec: CarSpec,
  textures: ProceduralTextureSet,
  isSoftwareGl: boolean,
  customColor?: number,
  isPolice = false
): CarVisualRig {
  const colorHex = isPolice ? 0xf8fafc : (customColor ?? spec.defaultColor);
  if (spec.isTruck) {
    return buildTruckVisualRig(spec, textures, isSoftwareGl, colorHex);
  }

  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const deformableMeshes: DeformableMeshEntry[] = [];

  const paintMat = new THREE.MeshPhysicalMaterial({
    color: colorHex,
    metalness: 0.38,
    roughness: 0.28,
    clearcoat: 0.52,
    clearcoatRoughness: 0.2,
    envMapIntensity: 0.48,
  });

  const seatMat = new THREE.MeshStandardMaterial({
    color: spec.id === 'viper' ? 0x27272a : 0x2a2f3a,
    roughness: 0.78,
    metalness: 0.05,
  });

  const seatBolsterMat = new THREE.MeshStandardMaterial({
    color: spec.id === 'viper' ? 0x991b1b : spec.id === 'dominator' ? 0x78350f : 0x334155,
    roughness: 0.7,
    metalness: 0.08,
  });

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xa5d8ff,
    metalness: 0.05,
    roughness: 0.05,
    transparent: true,
    opacity: isSoftwareGl ? 0.24 : 0.28,
    clearcoat: 1.0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const crackedGlassMat = new THREE.MeshPhysicalMaterial({
    color: 0xdbeafe,
    map: textures.crackedGlassMap,
    metalness: 0.1,
    roughness: 0.28,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const leftHeadlightMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xfff3c4,
    emissiveIntensity: 1.7,
    roughness: 0.12,
  });
  const rightHeadlightMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xfff3c4,
    emissiveIntensity: 1.7,
    roughness: 0.12,
  });
  const brakeLightMat = new THREE.MeshStandardMaterial({
    color: 0x991b1b,
    emissive: 0xef4444,
    emissiveIntensity: 0.9,
    roughness: 0.22,
  });
  const leftBlinkerMat = new THREE.MeshStandardMaterial({
    color: 0x78350f,
    emissive: 0xf59e0b,
    emissiveIntensity: 0.04,
    roughness: 0.2,
  });
  const rightBlinkerMat = new THREE.MeshStandardMaterial({
    color: 0x78350f,
    emissive: 0xf59e0b,
    emissiveIntensity: 0.04,
    roughness: 0.2,
  });

  const { length: L, width: W, height: H, wheelRadius: WR, wheelBase: WB, trackWidth: TW } = spec;
  const clearance = WR * 0.72;
  const isSuv = spec.id === 'titan';
  const isSport = spec.id === 'viper';
  const beltY = clearance + (isSuv ? 0.66 : isSport ? 0.48 : 0.54);
  const cabinZOffset = isSport ? 0.2 : isSuv ? 0.12 : 0.1;
  const cabinL = isSuv ? L * 0.56 : L * 0.45;
  const roofBaseY = H - 0.06;
  const cabinH = roofBaseY - beltY;

  // 1. Contact shadow disc
  const shadowGeo = new THREE.PlaneGeometry(W * 1.32, L * 1.16);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: textures.contactShadowMap,
    transparent: true,
    opacity: 0.52,
    depthWrite: false,
  });
  const contactShadow = new THREE.Mesh(shadowGeo, shadowMat);
  contactShadow.position.y = 0.025;
  root.add(contactShadow);

  // 2. Sculpted Left & Right Side Bodywork / Wheel-Arch Fenders
  const sideThick = W * 0.19;
  const sideCenterX = W * 0.5 - sideThick * 0.5 - 0.015;

  for (const side of [-1, 1] as const) {
    const fenderGeo = createSideFenderGeometry(spec, sideThick);
    const fenderMesh = new THREE.Mesh(fenderGeo, paintMat);
    fenderMesh.position.set(side * sideCenterX, 0, 0);
    fenderMesh.castShadow = true;
    fenderMesh.receiveShadow = true;
    bodyGroup.add(fenderMesh);
    registerDeformable(fenderGeo, fenderMesh, 0.44, deformableMeshes);

    const skirtGeo = new THREE.BoxGeometry(0.1, 0.08, WB - WR * 2.5);
    const skirt = new THREE.Mesh(skirtGeo, SHARED_TRIM_MAT);
    skirt.position.set(side * (W * 0.47), clearance + 0.04, 0);
    bodyGroup.add(skirt);
  }

  // 3. Open Cabin Floorpan, Firewall Cowl, Engine Bay, & Full Rear Trunk Deck
  const innerWidth = W - sideThick * 2 - 0.02;
  const floorMesh = new THREE.Mesh(new THREE.BoxGeometry(innerWidth + 0.12, 0.07, L * 0.9), SHARED_INTERIOR_MAT);
  floorMesh.position.set(0, clearance + 0.05, 0);
  bodyGroup.add(floorMesh);

  const aPillarTopZ = cabinZOffset - cabinL * 0.36;
  const aPillarBotZ = cabinZOffset - cabinL * 0.54;
  const bPillarZ = cabinZOffset + 0.08;
  const cPillarTopZ = cabinZOffset + cabinL * 0.36;
  const cPillarBotZ = cabinZOffset + cabinL * 0.54;

  const firewallMesh = new THREE.Mesh(new THREE.BoxGeometry(innerWidth + 0.1, beltY - clearance - 0.05, 0.14), SHARED_INTERIOR_MAT);
  firewallMesh.position.set(0, clearance + (beltY - clearance) * 0.48, aPillarBotZ);
  bodyGroup.add(firewallMesh);

  // Windshield cowl base trim bar (solid anchor for windshield bottom edge)
  const cowlBar = new THREE.Mesh(new THREE.BoxGeometry(W * 0.86, 0.06, 0.1), SHARED_TRIM_MAT);
  cowlBar.position.set(0, beltY - 0.01, aPillarBotZ);
  bodyGroup.add(cowlBar);

  const engineBlock = new THREE.Mesh(new THREE.BoxGeometry(innerWidth * 0.56, 0.28, 0.62), SHARED_ENGINE_MAT);
  engineBlock.position.set(0, clearance + 0.24, -L * 0.28);
  bodyGroup.add(engineBlock);
  const valveCover = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, 0.46), SHARED_VALVE_MAT);
  valveCover.position.set(0, clearance + 0.4, -L * 0.28);
  bodyGroup.add(valveCover);

  // Full Rear Trunk / Fastback Deck
  const rearDeckStartZ = cPillarBotZ - 0.16;
  const rearDeckEndZ = L * 0.465;
  const rearDeckLen = Math.max(0.4, rearDeckEndZ - rearDeckStartZ);
  const rearDeckGeo = new THREE.BoxGeometry(innerWidth + 0.14, 0.16, rearDeckLen, 4, 1, 3);
  const rearDeckMesh = new THREE.Mesh(rearDeckGeo, paintMat);
  rearDeckMesh.position.set(0, beltY - 0.02, (rearDeckStartZ + rearDeckEndZ) * 0.5);
  rearDeckMesh.castShadow = true;
  bodyGroup.add(rearDeckMesh);
  registerDeformable(rearDeckGeo, rearDeckMesh, 0.32, deformableMeshes);

  const rearShelf = new THREE.Mesh(new THREE.BoxGeometry(innerWidth + 0.1, 0.09, 0.38), SHARED_INTERIOR_MAT);
  rearShelf.position.set(0, beltY - 0.03, cPillarBotZ - 0.18);
  bodyGroup.add(rearShelf);

  const rearBulkhead = new THREE.Mesh(new THREE.BoxGeometry(innerWidth + 0.06, beltY - clearance, 0.14), SHARED_INTERIOR_MAT);
  rearBulkhead.position.set(0, clearance + (beltY - clearance) * 0.45, cPillarBotZ - 0.3);
  bodyGroup.add(rearBulkhead);

  // 4. Sculpted Curved Roof Cap & Continuous Greenhouse Cage + EXACT-FIT Flush Glass!
  const roofGeo = createSculptedRoofGeometry(spec, W * 0.74, cabinL, roofBaseY);
  const roofMesh = new THREE.Mesh(roofGeo, paintMat);
  roofMesh.position.set(0, 0, cabinZOffset);
  roofMesh.castShadow = true;
  bodyGroup.add(roofMesh);
  registerDeformable(roofGeo, roofMesh, 0.24, deformableMeshes);

  const botX = W * 0.425;
  const topX = W * 0.36;

  for (const side of [-1, 1] as const) {
    // A-pillar
    addAlignedBeam(bodyGroup, side * botX, beltY - 0.02, aPillarBotZ, side * topX, roofBaseY - 0.01, aPillarTopZ, 0.04, 0.032, SHARED_TRIM_MAT);
    // B-pillar
    addAlignedBeam(bodyGroup, side * (botX + 0.01), beltY - 0.02, bPillarZ, side * topX, roofBaseY - 0.01, bPillarZ, 0.044, 0.036, SHARED_TRIM_MAT);
    // C-pillar
    addAlignedBeam(bodyGroup, side * botX, beltY - 0.02, cPillarBotZ, side * topX, roofBaseY - 0.01, cPillarTopZ, 0.048, 0.034, SHARED_TRIM_MAT);
    // Roof side cantrail connecting A-pillar top -> B-pillar top -> C-pillar top (solid frame above side glass!)
    addAlignedBeam(bodyGroup, side * topX, roofBaseY - 0.01, aPillarTopZ, side * topX, roofBaseY - 0.01, cPillarTopZ, 0.036, 0.036, SHARED_TRIM_MAT);
    // Side beltline trim connecting A-pillar bot -> C-pillar bot
    addAlignedBeam(bodyGroup, side * botX, beltY - 0.01, aPillarBotZ, side * botX, beltY - 0.01, cPillarBotZ, 0.032, 0.032, SHARED_TRIM_MAT);

    // Framed Rear Quarter Glass (between B-pillar and C-pillar!)
    const qGlassGeo = createQuadBetween(
      [side * (botX + 0.005), beltY - 0.01, bPillarZ],
      [side * botX, beltY - 0.01, cPillarBotZ],
      [side * topX, roofBaseY - 0.01, cPillarTopZ],
      [side * topX, roofBaseY - 0.01, bPillarZ]
    );
    const qGlass = new THREE.Mesh(qGlassGeo, glassMat);
    qGlass.renderOrder = 2;
    bodyGroup.add(qGlass);
  }

  // Upper & lower headers for Front Windshield and Rear Glass
  const wsHeader = new THREE.Mesh(new THREE.BoxGeometry(W * 0.74, 0.045, 0.08), SHARED_TRIM_MAT);
  wsHeader.position.set(0, roofBaseY - 0.015, aPillarTopZ);
  bodyGroup.add(wsHeader);
  const rwHeader = new THREE.Mesh(new THREE.BoxGeometry(W * 0.74, 0.045, 0.08), SHARED_TRIM_MAT);
  rwHeader.position.set(0, roofBaseY - 0.015, cPillarTopZ);
  bodyGroup.add(rwHeader);
  const rwBaseBar = new THREE.Mesh(new THREE.BoxGeometry(W * 0.85, 0.055, 0.09), SHARED_TRIM_MAT);
  rwBaseBar.position.set(0, beltY - 0.01, cPillarBotZ);
  bodyGroup.add(rwBaseBar);

  // EXACT 4-Corner Front Windshield (seated flush between A-pillars, cowl, and roof header!)
  const windshieldGeo = createQuadBetween(
    [-botX + 0.01, beltY - 0.01, aPillarBotZ],
    [botX - 0.01, beltY - 0.01, aPillarBotZ],
    [topX - 0.01, roofBaseY - 0.01, aPillarTopZ],
    [-topX + 0.01, roofBaseY - 0.01, aPillarTopZ]
  );
  const windshieldMesh = new THREE.Mesh(windshieldGeo, glassMat);
  windshieldMesh.renderOrder = 2;
  bodyGroup.add(windshieldMesh);

  // EXACT 4-Corner Rear Windshield (seated flush between C-pillars, rear deck, and roof rear header!)
  const rearGlassGeo = createQuadBetween(
    [-botX + 0.01, beltY - 0.01, cPillarBotZ],
    [botX - 0.01, beltY - 0.01, cPillarBotZ],
    [topX - 0.01, roofBaseY - 0.01, cPillarTopZ],
    [-topX + 0.01, roofBaseY - 0.01, cPillarTopZ]
  );
  const rearGlass = new THREE.Mesh(rearGlassGeo, glassMat);
  rearGlass.renderOrder = 2;
  bodyGroup.add(rearGlass);

  // Interior Rearview Mirror
  const rvmStem = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.055, 6), SHARED_TRIM_MAT);
  rvmStem.position.set(0, roofBaseY - 0.05, aPillarTopZ + 0.02);
  bodyGroup.add(rvmStem);
  const rvmHousing = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.044, 0.025), SHARED_TRIM_MAT);
  rvmHousing.position.set(0, roofBaseY - 0.078, aPillarTopZ + 0.03);
  bodyGroup.add(rvmHousing);

  // 5. Detailed Interior + Seated Driver
  const dashZ = cabinZOffset - cabinL * 0.4;
  const dashY = beltY - 0.02;

  const dashBody = new THREE.Mesh(new THREE.BoxGeometry(innerWidth * 0.96, 0.19, 0.32), SHARED_INTERIOR_MAT);
  dashBody.position.set(0, dashY - 0.02, dashZ);
  bodyGroup.add(dashBody);

  const binnacle = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.11, 0.14), SHARED_INTERIOR_MAT);
  binnacle.position.set(-0.34, dashY + 0.09, dashZ + 0.06);
  bodyGroup.add(binnacle);

  for (const [dx, mat] of [[-0.42, SHARED_DIAL_CYAN_MAT], [-0.26, SHARED_DIAL_AMBER_MAT]] as const) {
    const dial = new THREE.Mesh(new THREE.CircleGeometry(0.042, 12), mat);
    dial.position.set(dx, dashY + 0.09, dashZ + 0.132);
    bodyGroup.add(dial);
  }

  const navScreen = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.13, 0.02), SHARED_NAV_MAT);
  navScreen.position.set(0, dashY + 0.04, dashZ + 0.16);
  navScreen.rotation.x = -0.18;
  bodyGroup.add(navScreen);

  const consoleTunnel = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.2, cabinL * 0.72), SHARED_INTERIOR_MAT);
  consoleTunnel.position.set(0, clearance + 0.17, cabinZOffset + 0.02);
  bodyGroup.add(consoleTunnel);

  const shifterStalk = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.015, 0.14, 6), SHARED_CHROME_MAT);
  shifterStalk.position.set(0, clearance + 0.32, cabinZOffset - 0.14);
  shifterStalk.rotation.x = 0.15;
  bodyGroup.add(shifterStalk);
  const shifterKnob = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), SHARED_TRIM_MAT);
  shifterKnob.position.set(0, clearance + 0.39, cabinZOffset - 0.13);
  bodyGroup.add(shifterKnob);

  for (const [px, pw] of [[-0.27, 0.045], [-0.36, 0.065]] as const) {
    const pedal = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.09, 0.02), SHARED_CHROME_MAT);
    pedal.position.set(px, clearance + 0.16, dashZ + 0.05);
    pedal.rotation.x = -0.4;
    bodyGroup.add(pedal);
  }

  for (const sx of [-0.34, 0.34]) {
    const seatGroup = new THREE.Group();
    seatGroup.position.set(sx, clearance + 0.12, cabinZOffset + 0.1);
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.44), seatMat);
    cushion.position.set(0, 0.05, 0);
    seatGroup.add(cushion);
    for (const bx of [-0.19, 0.19]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.13, 0.42), seatBolsterMat);
      b.position.set(bx, 0.08, 0);
      seatGroup.add(b);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.52, 0.11), seatMat);
    back.position.set(0, 0.32, 0.18);
    back.rotation.x = -0.22;
    seatGroup.add(back);
    const headrest = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.09), seatBolsterMat);
    headrest.position.set(0, 0.67, 0.23);
    headrest.rotation.x = -0.15;
    seatGroup.add(headrest);
    bodyGroup.add(seatGroup);
  }

  if (!isSport) {
    const rearCushion = new THREE.Mesh(new THREE.BoxGeometry(innerWidth * 0.88, 0.1, 0.36), seatMat);
    rearCushion.position.set(0, clearance + 0.16, cPillarBotZ - 0.54);
    bodyGroup.add(rearCushion);
    const rearBack = new THREE.Mesh(new THREE.BoxGeometry(innerWidth * 0.88, 0.42, 0.1), seatMat);
    rearBack.position.set(0, clearance + 0.38, cPillarBotZ - 0.38);
    rearBack.rotation.x = -0.18;
    bodyGroup.add(rearBack);
  }

  const steeringCol = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.042, 0.22, 8), SHARED_TRIM_MAT);
  steeringCol.rotation.x = Math.PI * 0.38;
  steeringCol.position.set(-0.34, dashY + 0.02, dashZ + 0.14);
  bodyGroup.add(steeringCol);

  const steeringWheel = new THREE.Group();
  steeringWheel.position.set(-0.34, dashY + 0.06, dashZ + 0.23);
  steeringWheel.rotation.x = -0.38;
  steeringWheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.016, 8, 18), SHARED_TRIM_MAT));
  for (const rotZ of [0, -Math.PI * 0.35, Math.PI * 0.35]) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.12, 0.015), SHARED_CHROME_MAT);
    sp.position.set(Math.sin(rotZ) * 0.06, -Math.cos(rotZ) * 0.06, 0);
    sp.rotation.z = rotZ;
    steeringWheel.add(sp);
  }
  const hubPad = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.024, 10), SHARED_TRIM_MAT);
  hubPad.rotation.x = Math.PI / 2;
  steeringWheel.add(hubPad);
  bodyGroup.add(steeringWheel);

  // Seated Driver inside Left Seat (visible through windshield & door windows!)
  const driverGroup = buildSeatedDriver(DRIVER_JACKET_COLORS[driverColorCounter++ % DRIVER_JACKET_COLORS.length], isPolice);
  driverGroup.position.set(-0.34, clearance + 0.19, cabinZOffset + 0.08);
  bodyGroup.add(driverGroup);

  const driverEyeLocal = new THREE.Vector3(-0.34, beltY + cabinH * 0.5, cabinZOffset - 0.06);

  // 6. Detachable Sculpted Hood
  const hoodGroup = new THREE.Group();
  const hoodGeo = createSculptedHoodGeometry(spec, innerWidth + 0.02);
  const hoodMesh = new THREE.Mesh(hoodGeo, paintMat);
  hoodMesh.castShadow = true;
  hoodGroup.position.set(0, 0, -L * 0.29);
  hoodGroup.add(hoodMesh);
  registerDeformable(hoodGeo, hoodMesh, 0.28, deformableMeshes);

  if (spec.id === 'dominator') {
    const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.13, 0.52), SHARED_CHROME_MAT);
    scoop.position.set(0, beltY + 0.04, 0);
    hoodGroup.add(scoop);
  } else if (spec.id === 'viper') {
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.03, 0.26), SHARED_TRIM_MAT);
    vent.position.set(0, beltY - 0.05, 0.04);
    hoodGroup.add(vent);
  }
  bodyGroup.add(hoodGroup);

  // 7. Detachable Contoured Front Bumper + Mesh Grille + Blinkers
  const frontBumperGroup = new THREE.Group();
  frontBumperGroup.position.set(0, clearance + 0.16, -L * 0.46);
  const fBumpGeo = createContouredBumperGeometry(W * 0.96, 0.24, 0.22);
  const fBumpMesh = new THREE.Mesh(fBumpGeo, spec.id === 'titan' ? SHARED_TRIM_MAT : paintMat);
  fBumpMesh.castShadow = true;
  frontBumperGroup.add(fBumpMesh);
  registerDeformable(fBumpGeo, fBumpMesh, 0.26, deformableMeshes);

  const grilleMesh = new THREE.Mesh(new THREE.BoxGeometry(W * 0.54, 0.14, 0.12), SHARED_TRIM_MAT);
  grilleMesh.position.set(0, 0.02, -0.09);
  frontBumperGroup.add(grilleMesh);

  if (isSport) {
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(W * 0.94, 0.035, 0.26), SHARED_TRIM_MAT);
    splitter.position.set(0, -0.12, -0.03);
    frontBumperGroup.add(splitter);
  }
  bodyGroup.add(frontBumperGroup);

  // 8. Detachable Contoured Rear Bumper + Diffuser + Twin Exhausts
  const rearBumperGroup = new THREE.Group();
  rearBumperGroup.position.set(0, clearance + 0.16, L * 0.46);
  const rBumpGeo = createContouredBumperGeometry(W * 0.95, 0.24, 0.22);
  rBumpGeo.rotateY(Math.PI);
  const rBumpMesh = new THREE.Mesh(rBumpGeo, spec.id === 'titan' ? SHARED_TRIM_MAT : paintMat);
  rBumpMesh.castShadow = true;
  rearBumperGroup.add(rBumpMesh);
  registerDeformable(rBumpGeo, rBumpMesh, 0.26, deformableMeshes);

  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(W * 0.68, 0.1, 0.12), SHARED_TRIM_MAT);
  diffuser.position.set(0, -0.07, 0.08);
  rearBumperGroup.add(diffuser);

  for (const ex of [-W * 0.28, W * 0.28]) {
    const exGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.18, 10);
    exGeo.rotateX(Math.PI / 2);
    const exMesh = new THREE.Mesh(exGeo, SHARED_CHROME_MAT);
    exMesh.position.set(ex, -0.06, 0.1);
    rearBumperGroup.add(exMesh);
  }
  bodyGroup.add(rearBumperGroup);

  // 9. Detachable Sculpted Doors pivoted at Front A-Pillar Edge + Exact-Fit Side Glass!
  const buildDoor = (side: -1 | 1): THREE.Group => {
    const dg = new THREE.Group();
    const doorPivotX = side * (W * 0.475);
    const doorPivotZ = aPillarBotZ;
    const doorCenterZ = cabinZOffset - 0.04;
    const localCenterZ = doorCenterZ - doorPivotZ;
    dg.position.set(doorPivotX, 0, doorPivotZ);

    const doorGeo = new THREE.BoxGeometry(0.075, beltY - clearance - 0.08, cabinL * 0.7, 1, 2, 3);
    const doorMesh = new THREE.Mesh(doorGeo, paintMat);
    doorMesh.position.set(0, clearance + (beltY - clearance) * 0.52, localCenterZ);
    dg.add(doorMesh);
    registerDeformable(doorGeo, doorMesh, 0.32, deformableMeshes);

    const armrest = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, cabinL * 0.45), SHARED_INTERIOR_MAT);
    armrest.position.set(-side * 0.04, beltY - 0.14, localCenterZ);
    dg.add(armrest);

    // Exact local anchor coordinates matching A-pillar, B-pillar & Roof cantrail!
    const localBotX = side * botX - doorPivotX;
    const localTopX = side * topX - doorPivotX;
    const localFrontBotZ = 0;
    const localFrontTopZ = aPillarTopZ - doorPivotZ;
    const localRearZ = bPillarZ - doorPivotZ;
    const winBotY = beltY - 0.01;
    const winTopY = roofBaseY - 0.01;

    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.16), SHARED_CHROME_MAT);
    handle.position.set(side * 0.042, beltY - 0.11, Math.max(0.2, localRearZ - 0.18));
    dg.add(handle);

    // Solid door upper window frame (front slanted sash, top roof rail, rear vertical sash)
    addAlignedBeam(dg, localBotX, winBotY, localFrontBotZ, localTopX, winTopY, localFrontTopZ, 0.025, 0.025, SHARED_TRIM_MAT);
    addAlignedBeam(dg, localTopX, winTopY, localFrontTopZ, localTopX, winTopY, localRearZ, 0.025, 0.025, SHARED_TRIM_MAT);
    addAlignedBeam(dg, localBotX, winBotY, localRearZ, localTopX, winTopY, localRearZ, 0.025, 0.025, SHARED_TRIM_MAT);

    // Exact 4-corner side window pane sitting 100% inside the door sash!
    const sideGlassGeo = createQuadBetween(
      [localBotX, winBotY, localFrontBotZ],
      [localBotX, winBotY, localRearZ],
      [localTopX, winTopY, localRearZ],
      [localTopX, winTopY, localFrontTopZ]
    );
    const sideGlass = new THREE.Mesh(sideGlassGeo, glassMat);
    sideGlass.renderOrder = 2;
    dg.add(sideGlass);

    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.08, 0.1), paintMat);
    mirror.position.set(side * 0.09, beltY + 0.04, 0.08);
    dg.add(mirror);
    return dg;
  };
  const leftDoorGroup = buildDoor(-1);
  const rightDoorGroup = buildDoor(1);
  bodyGroup.add(leftDoorGroup);
  bodyGroup.add(rightDoorGroup);

  // 10. Police Lightbar / Spoiler / Roof Rack / Taxi Sign
  let spoilerGroup: THREE.Group | null = null;
  let taxiSign: THREE.Mesh | null = null;
  let policeRedMat: THREE.MeshStandardMaterial | null = null;
  let policeBlueMat: THREE.MeshStandardMaterial | null = null;

  if (isPolice) {
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.45, metalness: 0.3 });
    const sideStripeL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, L * 0.72), stripeMat);
    sideStripeL.position.set(-W * 0.49, beltY - 0.12, 0);
    bodyGroup.add(sideStripeL);
    const sideStripeR = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, L * 0.72), stripeMat);
    sideStripeR.position.set(W * 0.49, beltY - 0.12, 0);
    bodyGroup.add(sideStripeR);

    const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.08, 0.24), SHARED_TRIM_MAT);
    barBase.position.set(0, roofBaseY + 0.11, cabinZOffset);
    bodyGroup.add(barBase);

    policeRedMat = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xef4444, emissiveIntensity: 0.2 });
    policeBlueMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, emissive: 0x3b82f6, emissiveIntensity: 0.2 });
    const redPod = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.11, 0.22), policeRedMat);
    redPod.position.set(-0.31, roofBaseY + 0.17, cabinZOffset);
    bodyGroup.add(redPod);
    const bluePod = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.11, 0.22), policeBlueMat);
    bluePod.position.set(0.31, roofBaseY + 0.17, cabinZOffset);
    bodyGroup.add(bluePod);
  } else if (spec.id === 'viper' || spec.id === 'dominator') {
    spoilerGroup = new THREE.Group();
    spoilerGroup.position.set(0, beltY + 0.05, L * 0.42);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(W * 0.84, 0.04, 0.24), SHARED_TRIM_MAT);
    wing.position.y = 0.14;
    spoilerGroup.add(wing);
    for (const sx of [-W * 0.26, W * 0.26]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.15, 0.12), SHARED_TRIM_MAT);
      strut.position.set(sx, 0.06, 0);
      spoilerGroup.add(strut);
    }
    bodyGroup.add(spoilerGroup);
  } else if (spec.id === 'titan') {
    spoilerGroup = new THREE.Group();
    spoilerGroup.position.set(0, roofBaseY + 0.09, cabinZOffset);
    for (const rx of [-W * 0.3, W * 0.3]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, cabinL * 0.72), SHARED_TRIM_MAT);
      rail.position.x = rx;
      spoilerGroup.add(rail);
    }
    bodyGroup.add(spoilerGroup);
  } else if (spec.isTaxi) {
    const signMat = new THREE.MeshStandardMaterial({ color: 0xfef08a, emissive: 0xfacc15, emissiveIntensity: 0.8 });
    taxiSign = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.14, 0.2), signMat);
    taxiSign.position.set(0, roofBaseY + 0.14, cabinZOffset);
    bodyGroup.add(taxiSign);
  }

  // 11. Twin Recessed Headlights, LED Taillights & Working Front/Rear Amber Turn Signals
  const hlGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.06, 10);
  hlGeo.rotateX(Math.PI / 2);
  const leftHeadlightMesh = new THREE.Mesh(hlGeo, leftHeadlightMat);
  leftHeadlightMesh.position.set(-W * 0.33, clearance + 0.26, -L * 0.455);
  bodyGroup.add(leftHeadlightMesh);

  const rightHeadlightMesh = new THREE.Mesh(hlGeo, rightHeadlightMat);
  rightHeadlightMesh.position.set(W * 0.33, clearance + 0.26, -L * 0.455);
  bodyGroup.add(rightHeadlightMesh);

  const fBlinkGeo = new THREE.BoxGeometry(0.11, 0.08, 0.08);
  const flBlinker = new THREE.Mesh(fBlinkGeo, leftBlinkerMat);
  flBlinker.position.set(-W * 0.43, clearance + 0.25, -L * 0.45);
  bodyGroup.add(flBlinker);
  const frBlinker = new THREE.Mesh(fBlinkGeo, rightBlinkerMat);
  frBlinker.position.set(W * 0.43, clearance + 0.25, -L * 0.45);
  bodyGroup.add(frBlinker);

  const tlGeo = new THREE.BoxGeometry(0.32, 0.09, 0.06);
  for (const tx of [-W * 0.28, W * 0.28]) {
    const tl = new THREE.Mesh(tlGeo, brakeLightMat);
    tl.position.set(tx, beltY - 0.08, L * 0.455);
    bodyGroup.add(tl);
  }
  const rlBlinker = new THREE.Mesh(fBlinkGeo, leftBlinkerMat);
  rlBlinker.position.set(-W * 0.43, beltY - 0.08, L * 0.452);
  bodyGroup.add(rlBlinker);
  const rrBlinker = new THREE.Mesh(fBlinkGeo, rightBlinkerMat);
  rrBlinker.position.set(W * 0.43, beltY - 0.08, L * 0.452);
  bodyGroup.add(rrBlinker);

  // 12. 4 Multi-Spoke Wheels
  const wheelSpinMeshes: THREE.Group[] = [];
  const frontSteerPivots: THREE.Group[] = [];
  const wheelCamberPivots: THREE.Group[] = [];
  const wheelWidth = spec.id === 'titan' ? 0.32 : 0.27;
  const caliperColor = spec.id === 'viper' ? 0xef4444 : spec.id === 'dominator' ? 0xf59e0b : 0x38bdf8;

  const wheelCoords: Array<{ x: number; z: number; front: boolean }> = [
    { x: -TW * 0.5, z: -WB * 0.5, front: true },
    { x: TW * 0.5, z: -WB * 0.5, front: true },
    { x: -TW * 0.5, z: WB * 0.5, front: false },
    { x: TW * 0.5, z: WB * 0.5, front: false },
  ];

  for (const wc of wheelCoords) {
    const pivot = new THREE.Group();
    pivot.position.set(wc.x, WR, wc.z);
    const camberGroup = new THREE.Group();
    const { spinGroup, caliperGroup } = createWheelAssembly(WR, wheelWidth, caliperColor);
    camberGroup.add(spinGroup);
    camberGroup.add(caliperGroup);
    pivot.add(camberGroup);
    root.add(pivot);
    wheelSpinMeshes.push(spinGroup);
    wheelCamberPivots.push(camberGroup);
    if (wc.front) {
      frontSteerPivots.push(pivot);
    }
  }

  const setPaintColor = (hex: number) => {
    paintMat.color.setHex(hex);
  };

  const setDriverVisible = (visible: boolean) => {
    driverGroup.visible = visible;
  };

  const updateLightbar = (timeSec: number, active: boolean) => {
    if (!policeRedMat || !policeBlueMat) return;
    if (!active) {
      policeRedMat.emissiveIntensity = 0.2;
      policeBlueMat.emissiveIntensity = 0.2;
      return;
    }
    const pulse = Math.sin(timeSec * 18) > 0;
    policeRedMat.emissiveIntensity = pulse ? 3.5 : 0.15;
    policeBlueMat.emissiveIntensity = pulse ? 0.15 : 3.5;
  };

  const updateTurnSignals = (timeSec: number, mode: TurnSignalMode) => {
    const blinkOn = Math.sin(timeSec * 14) > 0;
    const leftOn = (mode === 'left' || mode === 'hazard') && blinkOn;
    const rightOn = (mode === 'right' || mode === 'hazard') && blinkOn;
    leftBlinkerMat.emissiveIntensity = leftOn ? 3.8 : 0.04;
    leftBlinkerMat.color.setHex(leftOn ? 0xfbbf24 : 0x78350f);
    rightBlinkerMat.emissiveIntensity = rightOn ? 3.8 : 0.04;
    rightBlinkerMat.color.setHex(rightOn ? 0xfbbf24 : 0x78350f);
  };

  const { deformAtLocalPoint, clearScratches, disposeScratchMat } = createDeformAndScratchHandler(
    bodyGroup,
    deformableMeshes,
    textures.scratchDecalMap
  );

  const resetDeformation = () => {
    for (const entry of deformableMeshes) {
      const posAttr = entry.mesh.geometry.attributes.position as THREE.BufferAttribute;
      (posAttr.array as Float32Array).set(entry.restPositions);
      posAttr.needsUpdate = true;
      entry.mesh.geometry.computeVertexNormals();
    }
    clearScratches();
    hoodGroup.visible = true;
    frontBumperGroup.visible = true;
    rearBumperGroup.visible = true;
    if (spoilerGroup) spoilerGroup.visible = true;
    leftDoorGroup.visible = true;
    rightDoorGroup.visible = true;
    leftDoorGroup.rotation.y = 0;
    rightDoorGroup.rotation.y = 0;
    if (taxiSign) taxiSign.visible = true;
    windshieldMesh.material = glassMat;
    leftHeadlightMat.emissiveIntensity = 1.7;
    rightHeadlightMat.emissiveIntensity = 1.7;
  };

  const dispose = () => {
    disposeScratchMat();
    root.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const m = obj as THREE.Mesh;
        if (!m.geometry?.userData?.shared) m.geometry?.dispose();
        if (Array.isArray(m.material)) {
          m.material.forEach((mat) => {
            if (!mat.userData?.shared) mat.dispose();
          });
        } else if (m.material && !m.material.userData?.shared) {
          m.material.dispose();
        }
      }
    });
  };

  return {
    root,
    bodyGroup,
    roofMesh,
    contactShadow,
    steeringWheel,
    hoodGroup,
    frontBumperGroup,
    rearBumperGroup,
    spoilerGroup,
    leftDoorGroup,
    rightDoorGroup,
    driverGroup,
    taxiSign,
    windshieldMesh,
    leftHeadlightMesh,
    rightHeadlightMesh,
    leftHeadlightMat,
    rightHeadlightMat,
    brakeLightMat,
    leftBlinkerMat,
    rightBlinkerMat,
    paintMat,
    glassMat,
    crackedGlassMat,
    wheelSpinMeshes,
    frontSteerPivots,
    wheelCamberPivots,
    deformableMeshes,
    driverEyeLocal,
    setPaintColor,
    setDriverVisible,
    setDoorOpen: (side: 'left' | 'right', openRatio: number) => {
      const clamped = Math.max(0, Math.min(1, openRatio));
      if (side === 'left') {
        leftDoorGroup.rotation.y = -clamped * 1.08;
      } else {
        rightDoorGroup.rotation.y = clamped * 1.08;
      }
    },
    updateLightbar,
    updateTurnSignals,
    deformAtLocalPoint,
    resetDeformation,
    dispose,
  };
}

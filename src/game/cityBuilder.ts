import * as THREE from 'three';
import { buildCarVisualRig } from './carBuilder';
import { CAR_SPECS } from './physics';
import type { ProceduralTextureSet } from './textures';
import type { MallSpec, ShipSpec } from './types';
import {
  DEFAULT_LOAD_RADIUS_CHUNKS,
  DEFAULT_UNLOAD_RADIUS_CHUNKS,
  getChunkKey,
  getStreamingChunkPlan,
  worldToChunkCoord,
} from './worldChunks';
import {
  BRIDGES,
  CITY_BUILDINGS,
  FOLIAGE_PLACEMENTS,
  GAS_STATION_CENTER,
  HIGHWAY_X_COORDS,
  HIGHWAY_Z_COORDS,
  MALL_SPECS,
  NORTH_ROAD_Z_COORDS,
  PARK_CENTER,
  ROAD_X_COORDS,
  SIDEWALK_WIDTH,
  SOUTH_ROAD_Z_COORDS,
  TRAFFIC_LIGHT_PLACEMENTS,
  WATER_LEVEL,
  WATER_Z_MAX,
  WATER_Z_MIN,
  WORLD_HALF_SIZE,
  getBridgeElevationAt,
  getRoadHalfWidthX,
  getRoadHalfWidthZ,
  getTrafficLightState,
  isHighwayX,
  isHighwayZ,
  type BuildingFootprint,
  type TrafficLightPlacement,
} from './worldLayout';

export interface DestructibleProp {
  id: number;
  kind: 'hydrant' | 'lamp' | 'cone';
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rotVx: number;
  rotVz: number;
  broken: boolean;
  hitTime: number;
  mesh: THREE.Object3D;
}

interface AutoDoorEntry {
  doorX: number;
  doorZ: number;
  axis: 'x' | 'z';
  slideDistance: number;
  openAmount: number;
  leftPanel: THREE.Mesh;
  rightPanel: THREE.Mesh;
  leftRestX: number;
  leftRestZ: number;
  rightRestX: number;
  rightRestZ: number;
  sensorMat: THREE.MeshStandardMaterial;
}

interface DestructibleBlueprint {
  id: number;
  kind: 'hydrant' | 'lamp' | 'cone';
  x: number;
  z: number;
  armDirX: number;
}

interface ChunkBlueprint {
  blockPads: Array<{ cx: number; cz: number; w: number; d: number }>;
  dashes: Array<{ x: number; y: number; z: number; rotY: number; sx?: number; sz?: number }>;
  yellows: Array<{ x: number; y: number; z: number; rotY: number; sx?: number; sz?: number }>;
  buildings: BuildingFootprint[];
  gantries: Array<{ x: number; z: number; rotY: number; spanW: number; title: string; subtitle: string }>;
  trafficLights: TrafficLightPlacement[];
  malls: MallSpec[];
  hasPark: boolean;
  hasGasStation: boolean;
  craneXs: number[];
  trees: Array<[number, number, number]>;
  bushes: Array<[number, number, number]>;
  destructibles: DestructibleBlueprint[];
}

interface LoadedChunk {
  key: string;
  group: THREE.Group;
  doors: AutoDoorEntry[];
  destructibles: DestructibleProp[];
  podiums: THREE.Object3D[];
  showroomRigs: Array<{ dispose: () => void }>;
}

export interface CityWorldVisuals {
  root: THREE.Group;
  waterMesh: THREE.Mesh;
  buildingMat: THREE.MeshStandardMaterial;
  lampBulbMat: THREE.MeshStandardMaterial;
  destructibles: DestructibleProp[];
  updateStreaming: (
    px: number,
    pz: number,
    heading: number,
    dt: number,
    maxBuildsPerFrame?: number
  ) => void;
  getLoadedChunkCount: () => number;
  updateWater: (dt: number) => void;
  updateTrafficLights: (simTimeSec: number) => void;
  updateDoors: (px: number, pz: number, dt: number) => void;
  setNightModeFactor: (nightFactor: number) => void;
  dispose: () => void;
}

export function buildShipVisual(spec: ShipSpec): THREE.Group {
  const g = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.45, metalness: 0.35 });
  const darkDeckMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.78, metalness: 0.18 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35, metalness: 0.15 });
  const bridgeGlassMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    emissive: 0x0284c7,
    emissiveIntensity: 0.35,
    roughness: 0.12,
    metalness: 0.7,
  });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.6, metalness: 0.5 });

  const L = spec.length;
  const W = spec.width;
  const H = spec.hullHeight;

  const hull = new THREE.Mesh(new THREE.BoxGeometry(L * 0.84, H, W), hullMat);
  hull.position.set(-L * 0.05, H * 0.35, 0);
  hull.castShadow = true;
  hull.receiveShadow = true;
  g.add(hull);

  const bow = new THREE.Mesh(new THREE.ConeGeometry(W * 0.56, L * 0.24, 4), hullMat);
  bow.rotation.y = Math.PI * 0.25;
  bow.rotation.z = -Math.PI * 0.5;
  bow.scale.set(0.65, 1, 1.12);
  bow.position.set(L * 0.43, H * 0.38, 0);
  bow.castShadow = true;
  g.add(bow);

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(L * 0.85, 0.35, W + 0.12), trimMat);
  stripe.position.set(-L * 0.05, 0.22, 0);
  g.add(stripe);

  const deck = new THREE.Mesh(new THREE.BoxGeometry(L * 0.82, 0.18, W * 0.94), darkDeckMat);
  deck.position.set(-L * 0.05, H * 0.85, 0);
  deck.receiveShadow = true;
  g.add(deck);

  if (spec.kind === 'cargo') {
    const bridgeBase = new THREE.Mesh(new THREE.BoxGeometry(5.6, 5.2, W * 0.78), whiteMat);
    bridgeBase.position.set(-L * 0.33, H * 0.85 + 2.6, 0);
    bridgeBase.castShadow = true;
    g.add(bridgeBase);

    const wheelhouse = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.0, W * 0.88), whiteMat);
    wheelhouse.position.set(-L * 0.32, H * 0.85 + 5.9, 0);
    g.add(wheelhouse);

    const bridgeWin = new THREE.Mesh(new THREE.BoxGeometry(4.52, 0.85, W * 0.9), bridgeGlassMat);
    bridgeWin.position.set(-L * 0.32, H * 0.85 + 6.0, 0);
    g.add(bridgeWin);

    const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.8, 2.8, 10), hullMat);
    funnel.position.set(-L * 0.4, H * 0.85 + 7.4, 0);
    g.add(funnel);

    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 4.2, 6), trimMat);
    mast.position.set(-L * 0.32, H * 0.85 + 8.6, 0);
    g.add(mast);

    const contColors = [0xdc2626, 0x2563eb, 0xf59e0b, 0x10b981, 0xe2e8f0];
    for (let row = 0; row < 3; row++) {
      for (let col = -1; col <= 1; col += 2) {
        const tiers = (row + (col > 0 ? 1 : 0)) % 2 === 0 ? 2 : 1;
        for (let t = 0; t < tiers; t++) {
          const cMat = new THREE.MeshStandardMaterial({
            color: contColors[(row * 2 + (col > 0 ? 1 : 0) + t) % contColors.length],
            roughness: 0.65,
          });
          const box = new THREE.Mesh(new THREE.BoxGeometry(6.4, 2.15, 2.6), cMat);
          box.position.set(-1.5 + row * 7.2, H * 0.85 + 1.15 + t * 2.2, col * 1.65);
          box.castShadow = true;
          g.add(box);
        }
      }
    }
  } else if (spec.kind === 'tug') {
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(4.6, 2.6, W * 0.68), whiteMat);
    cabin.position.set(0.4, H * 0.85 + 1.3, 0);
    cabin.castShadow = true;
    g.add(cabin);

    const win = new THREE.Mesh(new THREE.BoxGeometry(4.7, 0.85, W * 0.7), bridgeGlassMat);
    win.position.set(0.4, H * 0.85 + 1.8, 0);
    g.add(win);

    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 2.2, 10), trimMat);
    stack.position.set(-2.4, H * 0.85 + 1.6, 0);
    g.add(stack);

    for (const side of [-1, 1]) {
      for (let fx = -3.8; fx <= 3.8; fx += 2.5) {
        const tire = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.16, 6, 12), trimMat);
        tire.position.set(fx, H * 0.55, side * (W * 0.5 + 0.08));
        g.add(tire);
      }
    }
  } else {
    const superStruct = new THREE.Mesh(new THREE.BoxGeometry(L * 0.52, 1.85, W * 0.76), whiteMat);
    superStruct.position.set(-1.0, H * 0.85 + 0.9, 0);
    superStruct.castShadow = true;
    g.add(superStruct);

    const glassBand = new THREE.Mesh(new THREE.BoxGeometry(L * 0.53, 0.75, W * 0.78), bridgeGlassMat);
    glassBand.position.set(-1.0, H * 0.85 + 1.0, 0);
    g.add(glassBand);

    const flyDeck = new THREE.Mesh(new THREE.BoxGeometry(L * 0.34, 0.35, W * 0.64), whiteMat);
    flyDeck.position.set(-1.6, H * 0.85 + 2.0, 0);
    g.add(flyDeck);

    const radarArch = new THREE.Mesh(new THREE.TorusGeometry(W * 0.3, 0.14, 6, 14, Math.PI), whiteMat);
    radarArch.rotation.y = Math.PI * 0.5;
    radarArch.position.set(-2.0, H * 0.85 + 2.2, 0);
    g.add(radarArch);
  }

  return g;
}

export function buildCityWorld(textures: ProceduralTextureSet): CityWorldVisuals {
  const root = new THREE.Group();
  const sharedGeos: THREE.BufferGeometry[] = [];
  const sharedMats: THREE.Material[] = [];

  const shareGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    g.userData.shared = true;
    sharedGeos.push(g);
    return g;
  };
  const shareMat = <T extends THREE.Material>(m: T): T => {
    m.userData.shared = true;
    sharedMats.push(m);
    return m;
  };

  const unitBoxGeo = shareGeo(new THREE.BoxGeometry(1, 1, 1));

  // 1. Persistent Ocean Water & Base North/South Island Slabs
  const waterGeo = new THREE.PlaneGeometry(3400, 3400, 1, 1);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMat = shareMat(
    new THREE.MeshStandardMaterial({
      color: 0x0c4a6e,
      roughness: 0.16,
      metalness: 0.72,
      bumpMap: textures.waterBumpMap,
      bumpScale: 0.34,
    })
  );
  const waterMesh = new THREE.Mesh(waterGeo, waterMat);
  waterMesh.position.y = WATER_LEVEL;
  waterMesh.receiveShadow = true;
  root.add(waterMesh);

  const islandW = WORLD_HALF_SIZE * 2;
  const northDepth = Math.abs(-WORLD_HALF_SIZE - WATER_Z_MIN);
  const northCenterZ = (-WORLD_HALF_SIZE + WATER_Z_MIN) * 0.5;
  const southDepth = Math.abs(WORLD_HALF_SIZE - WATER_Z_MAX);
  const southCenterZ = (WORLD_HALF_SIZE + WATER_Z_MAX) * 0.5;

  const asphaltBaseMat = shareMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.asphaltMap,
      bumpMap: textures.asphaltBump,
      bumpScale: 0.04,
      roughness: 0.86,
      metalness: 0.06,
    })
  );
  const seawallMat = shareMat(
    new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.9,
      metalness: 0.08,
    })
  );

  const buildIslandSlab = (centerZ: number, depth: number) => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(islandW, 4.5, depth), seawallMat);
    wall.position.set(0, -2.25, centerZ);
    wall.receiveShadow = true;
    root.add(wall);

    const roadTopGeo = new THREE.PlaneGeometry(islandW, depth);
    roadTopGeo.rotateX(-Math.PI / 2);
    const roadTop = new THREE.Mesh(roadTopGeo, asphaltBaseMat);
    roadTop.position.set(0, 0.02, centerZ);
    roadTop.receiveShadow = true;
    root.add(roadTop);
  };
  buildIslandSlab(northCenterZ, northDepth);
  buildIslandSlab(southCenterZ, southDepth);

  // 2. Shared Palette & Material Pools (Eliminates GPU shader/material spikes when streaming chunks!)
  const sidewalkMat = shareMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.sidewalkMap,
      roughness: 0.88,
      metalness: 0.05,
    })
  );
  const dashGeo = shareGeo(new THREE.PlaneGeometry(0.28, 3.6));
  dashGeo.rotateX(-Math.PI / 2);
  const dashMat = shareMat(
    new THREE.MeshBasicMaterial({
      color: 0xe2e8f0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
  );
  const yellowLineMat = shareMat(
    new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
  );

  const buildingMat = shareMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.buildingFacadeMap,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: textures.buildingFacadeEmissive,
      emissiveIntensity: 0.05,
      roughness: 0.58,
      metalness: 0.22,
      envMapIntensity: 0.45,
    })
  );
  const industrialMat = shareMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.industrialFacadeMap,
      roughness: 0.72,
      metalness: 0.25,
    })
  );

  const buildingMatVariants = new Map<number, THREE.MeshStandardMaterial>();
  const getBuildingMat = (hex: number) => {
    let m = buildingMatVariants.get(hex);
    if (!m) {
      m = shareMat(buildingMat.clone());
      m.color.setHex(hex);
      buildingMatVariants.set(hex, m);
    }
    return m;
  };

  const industrialMatVariants = new Map<number, THREE.MeshStandardMaterial>();
  const getIndustrialMat = (hex: number) => {
    let m = industrialMatVariants.get(hex);
    if (!m) {
      m = shareMat(industrialMat.clone());
      m.color.setHex(hex);
      industrialMatVariants.set(hex, m);
    }
    return m;
  };

  const spireGeo = shareGeo(new THREE.CylinderGeometry(0.15, 0.45, 7, 8));
  const spireMatVariants = new Map<number, THREE.MeshStandardMaterial>();
  const getSpireMat = (hex: number) => {
    let m = spireMatVariants.get(hex);
    if (!m) {
      m = shareMat(
        new THREE.MeshStandardMaterial({
          color: hex,
          emissive: hex,
          emissiveIntensity: 0.85,
        })
      );
      spireMatVariants.set(hex, m);
    }
    return m;
  };

  const roofTrimMat = shareMat(new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7, metalness: 0.3 }));
  const helipadMat = shareMat(
    new THREE.MeshStandardMaterial({ color: 0xffffff, map: textures.helipadMap, roughness: 0.85 })
  );
  const signSupportMat = shareMat(new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.6, metalness: 0.4 }));

  const signFaces: THREE.MeshStandardMaterial[] = [];
  const signMatCache = new Map<string, THREE.MeshStandardMaterial>();
  const getSignFaceMat = (
    title: string,
    subtitle: string,
    bg: string,
    fg: string,
    accent: string,
    emissiveInt: number
  ) => {
    const key = `${title}|${subtitle}|${bg}|${fg}|${accent}`;
    let m = signMatCache.get(key);
    if (!m) {
      const tex = textures.createSignTexture(title, subtitle, bg, fg, accent);
      m = shareMat(
        new THREE.MeshStandardMaterial({
          map: tex,
          emissiveMap: tex,
          emissive: new THREE.Color(0xffffff),
          emissiveIntensity: emissiveInt,
          roughness: 0.32,
        })
      );
      signMatCache.set(key, m);
      signFaces.push(m);
    }
    return m;
  };

  const makeSignBox = (
    title: string,
    subtitle: string,
    bg: string,
    fg: string,
    accent: string,
    w: number,
    h: number,
    emissiveInt = 0.72
  ) => {
    const mat = getSignFaceMat(title, subtitle, bg, fg, accent, emissiveInt);
    const mesh = new THREE.Mesh(unitBoxGeo, [
      signSupportMat,
      signSupportMat,
      signSupportMat,
      signSupportMat,
      mat,
      mat,
    ]);
    mesh.scale.set(w, h, 0.28);
    return mesh;
  };

  // Traffic Light shared geometries & live signal materials
  const tlPoleMat = shareMat(new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.45, metalness: 0.72 }));
  const tlBoxMat = shareMat(new THREE.MeshStandardMaterial({ color: 0x090d14, roughness: 0.65, metalness: 0.35 }));
  const makeLensMat = () =>
    shareMat(
      new THREE.MeshStandardMaterial({
        color: 0x171b22,
        emissive: 0x000000,
        emissiveIntensity: 0.02,
        roughness: 0.2,
        toneMapped: false,
      })
    );
  const nsRedMat = makeLensMat();
  const nsYellowMat = makeLensMat();
  const nsGreenMat = makeLensMat();
  const ewRedMat = makeLensMat();
  const ewYellowMat = makeLensMat();
  const ewGreenMat = makeLensMat();

  const tlPoleGeo = shareGeo(new THREE.CylinderGeometry(0.12, 0.16, 5.6, 7));
  const tlArmGeo = shareGeo(new THREE.BoxGeometry(3.6, 0.15, 0.15));
  const tlHeadGeo = shareGeo(new THREE.BoxGeometry(0.56, 1.56, 0.38));
  const tlLensGeo = shareGeo(new THREE.SphereGeometry(0.18, 12, 10));
  const tlVisorGeo = shareGeo(new THREE.BoxGeometry(0.42, 0.06, 0.22));

  // Shared foliage geometries & materials
  const planterGeo = shareGeo(new THREE.BoxGeometry(1.85, 0.2, 1.85));
  planterGeo.translate(0, 0.1, 0);
  const planterMat = shareMat(new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.85 }));
  const soilGeo = shareGeo(new THREE.BoxGeometry(1.45, 0.22, 1.45));
  soilGeo.translate(0, 0.11, 0);
  const soilMat = shareMat(new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.95 }));
  const trunkGeo = shareGeo(new THREE.CylinderGeometry(0.18, 0.28, 4.2, 7));
  trunkGeo.translate(0, 2.1, 0);
  const trunkMat = shareMat(new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.9 }));
  const canopyGeo = shareGeo(new THREE.DodecahedronGeometry(1.85, 0));
  canopyGeo.translate(0, 4.6, 0);
  const canopyMat = shareMat(new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.78 }));
  const bushGeo = shareGeo(new THREE.DodecahedronGeometry(0.9, 0));
  bushGeo.translate(0, 0.62, 0);
  const bushMat = shareMat(new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.85 }));

  // Shared destructible prop materials & geometries
  const poleMat = shareMat(new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.7, roughness: 0.4 }));
  const lampBulbMat = shareMat(
    new THREE.MeshStandardMaterial({
      color: 0xfef3c7,
      emissive: 0xfde68a,
      emissiveIntensity: 0.4,
    })
  );
  const hydrantMat = shareMat(new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.35, metalness: 0.4 }));
  const coneMat = shareMat(new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.6 }));
  const hydBodyGeo = shareGeo(new THREE.CylinderGeometry(0.18, 0.22, 0.72, 10));
  const hydCapGeo = shareGeo(new THREE.SphereGeometry(0.18, 8, 6));
  const lampPoleGeo = shareGeo(new THREE.CylinderGeometry(0.09, 0.14, 5.2, 8));
  const coneGeo = shareGeo(new THREE.ConeGeometry(0.16, 0.62, 10));

  // Shared mall / interior / gantry / bridge materials
  const glassMat = shareMat(
    new THREE.MeshStandardMaterial({
      color: 0xbae6fd,
      roughness: 0.12,
      metalness: 0.25,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    })
  );
  const doorGlassMat = shareMat(
    new THREE.MeshStandardMaterial({
      color: 0x7dd3fc,
      roughness: 0.1,
      metalness: 0.35,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
    })
  );
  const mallFloorMat = shareMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.mallFloorMap,
      roughness: 0.32,
      metalness: 0.12,
    })
  );
  const mallWallMat = shareMat(new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.65, metalness: 0.08 }));
  const mallRoofMat = shareMat(new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.72, metalness: 0.25 }));
  const chromeMat = shareMat(new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.85, roughness: 0.22 }));
  const woodMat = shareMat(new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.72, metalness: 0.05 }));
  const darkMetalMat = shareMat(new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.45, metalness: 0.65 }));
  const screenGlowMat = shareMat(
    new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.95,
      roughness: 0.2,
    })
  );
  const neonStripMat = shareMat(
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe0f2fe, emissiveIntensity: 1.5 })
  );
  const gantrySteelMat = shareMat(new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.45, metalness: 0.72 }));
  const bridgeSteelRed = shareMat(new THREE.MeshStandardMaterial({ color: 0xd9482b, roughness: 0.45, metalness: 0.65 }));
  const bridgeArchCyan = shareMat(new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.35, metalness: 0.72 }));
  const bridgeArchAmber = shareMat(new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.38, metalness: 0.68 }));
  const cableMat = shareMat(new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.3, metalness: 0.85 }));
  const guardrailMat = shareMat(new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.5, metalness: 0.65 }));
  const craneMat = shareMat(new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.45, metalness: 0.5 }));

  // 3. Bucket Static World Blueprints into 8x8 Spatial Chunks (pure coordinate math, zero meshes yet!)
  const chunkBlueprints = new Map<string, ChunkBlueprint>();
  const getBlueprint = (x: number, z: number): ChunkBlueprint => {
    const { cx, cz } = worldToChunkCoord(x, z);
    const key = getChunkKey(cx, cz);
    let bp = chunkBlueprints.get(key);
    if (!bp) {
      bp = {
        blockPads: [],
        dashes: [],
        yellows: [],
        buildings: [],
        gantries: [],
        trafficLights: [],
        malls: [],
        hasPark: false,
        hasGasStation: false,
        craneXs: [],
        trees: [],
        bushes: [],
        destructibles: [],
      };
      chunkBlueprints.set(key, bp);
    }
    return bp;
  };

  // Sidewalk block pads
  const xSegments: Array<[number, number]> = [
    [-WORLD_HALF_SIZE, ROAD_X_COORDS[0] - getRoadHalfWidthX(ROAD_X_COORDS[0])],
  ];
  for (let i = 0; i < ROAD_X_COORDS.length - 1; i++) {
    const r0 = ROAD_X_COORDS[i];
    const r1 = ROAD_X_COORDS[i + 1];
    xSegments.push([r0 + getRoadHalfWidthX(r0), r1 - getRoadHalfWidthX(r1)]);
  }
  xSegments.push([
    ROAD_X_COORDS[ROAD_X_COORDS.length - 1] + getRoadHalfWidthX(ROAD_X_COORDS[ROAD_X_COORDS.length - 1]),
    WORLD_HALF_SIZE,
  ]);

  const northZSegments: Array<[number, number]> = [
    [-WORLD_HALF_SIZE, NORTH_ROAD_Z_COORDS[0] - getRoadHalfWidthZ(NORTH_ROAD_Z_COORDS[0])],
  ];
  for (let i = 0; i < NORTH_ROAD_Z_COORDS.length - 1; i++) {
    const z0 = NORTH_ROAD_Z_COORDS[i];
    const z1 = NORTH_ROAD_Z_COORDS[i + 1];
    northZSegments.push([z0 + getRoadHalfWidthZ(z0), z1 - getRoadHalfWidthZ(z1)]);
  }
  northZSegments.push([
    NORTH_ROAD_Z_COORDS[NORTH_ROAD_Z_COORDS.length - 1] +
      getRoadHalfWidthZ(NORTH_ROAD_Z_COORDS[NORTH_ROAD_Z_COORDS.length - 1]),
    WATER_Z_MIN,
  ]);

  const southZSegments: Array<[number, number]> = [
    [WATER_Z_MAX, SOUTH_ROAD_Z_COORDS[0] - getRoadHalfWidthZ(SOUTH_ROAD_Z_COORDS[0])],
  ];
  for (let i = 0; i < SOUTH_ROAD_Z_COORDS.length - 1; i++) {
    const z0 = SOUTH_ROAD_Z_COORDS[i];
    const z1 = SOUTH_ROAD_Z_COORDS[i + 1];
    southZSegments.push([z0 + getRoadHalfWidthZ(z0), z1 - getRoadHalfWidthZ(z1)]);
  }
  southZSegments.push([
    SOUTH_ROAD_Z_COORDS[SOUTH_ROAD_Z_COORDS.length - 1] +
      getRoadHalfWidthZ(SOUTH_ROAD_Z_COORDS[SOUTH_ROAD_Z_COORDS.length - 1]),
    WORLD_HALF_SIZE,
  ]);

  for (const zList of [northZSegments, southZSegments]) {
    for (const [x0, x1] of xSegments) {
      for (const [z0, z1] of zList) {
        const w = x1 - x0;
        const d = z1 - z0;
        if (w <= 1 || d <= 1) continue;
        const cx = (x0 + x1) * 0.5;
        const cz = (z0 + z1) * 0.5;
        getBlueprint(cx, cz).blockPads.push({ cx, cz, w, d });
      }
    }
  }

  // Road dashes & crosswalks
  const roadEdge = WORLD_HALF_SIZE - 18;
  const allZRoads = [...NORTH_ROAD_Z_COORDS, ...SOUTH_ROAD_Z_COORDS];
  const isInsideIntersectionZ = (z: number) =>
    allZRoads.some((rz) => Math.abs(z - rz) < getRoadHalfWidthZ(rz) + 3.2);
  const isInsideIntersectionX = (x: number) =>
    ROAD_X_COORDS.some((rx) => Math.abs(x - rx) < getRoadHalfWidthX(rx) + 3.2);

  for (const rx of ROAD_X_COORDS) {
    const hwy = isHighwayX(rx);
    for (let z = -roadEdge; z <= roadEdge; z += 9) {
      if (z > WATER_Z_MIN - 2 && z < WATER_Z_MAX + 2) continue;
      if (isInsideIntersectionZ(z)) continue;
      const bp = getBlueprint(rx, z);
      if (hwy) {
        bp.yellows.push({ x: rx - 0.25, y: 0.033, z, rotY: 0, sx: 0.85, sz: 2.3 });
        bp.yellows.push({ x: rx + 0.25, y: 0.033, z, rotY: 0, sx: 0.85, sz: 2.3 });
        for (const off of [-8.0, -4.0, 4.0, 8.0]) {
          bp.dashes.push({ x: rx + off, y: 0.032, z, rotY: 0 });
        }
      } else {
        bp.yellows.push({ x: rx - 0.14, y: 0.032, z, rotY: 0, sx: 0.65, sz: 2.35 });
        bp.yellows.push({ x: rx + 0.14, y: 0.032, z, rotY: 0, sx: 0.65, sz: 2.35 });
        for (const off of [-4.0, 4.0]) {
          bp.dashes.push({ x: rx + off, y: 0.031, z, rotY: 0, sx: 0.68, sz: 0.85 });
        }
      }
    }
  }

  for (const rz of allZRoads) {
    const hwy = isHighwayZ(rz);
    for (let x = -roadEdge; x <= roadEdge; x += 9) {
      if (isInsideIntersectionX(x)) continue;
      const bp = getBlueprint(x, rz);
      if (hwy) {
        bp.yellows.push({ x, y: 0.033, z: rz - 0.25, rotY: Math.PI / 2, sx: 0.85, sz: 2.3 });
        bp.yellows.push({ x, y: 0.033, z: rz + 0.25, rotY: Math.PI / 2, sx: 0.85, sz: 2.3 });
        for (const off of [-8.0, -4.0, 4.0, 8.0]) {
          bp.dashes.push({ x, y: 0.032, z: rz + off, rotY: Math.PI / 2 });
        }
      } else {
        bp.yellows.push({ x, y: 0.032, z: rz - 0.14, rotY: Math.PI / 2, sx: 0.65, sz: 2.35 });
        bp.yellows.push({ x, y: 0.032, z: rz + 0.14, rotY: Math.PI / 2, sx: 0.65, sz: 2.35 });
        for (const off of [-4.0, 4.0]) {
          bp.dashes.push({ x, y: 0.031, z: rz + off, rotY: Math.PI / 2, sx: 0.68, sz: 0.85 });
        }
      }
    }
  }

  for (const rx of ROAD_X_COORDS) {
    const hwX = getRoadHalfWidthX(rx);
    for (const rz of allZRoads) {
      const hwZ = getRoadHalfWidthZ(rz);
      const bp = getBlueprint(rx, rz);
      const stripeSpanX = Math.floor(hwX - 2);
      const stripeSpanZ = Math.floor(hwZ - 2);
      for (let s = -stripeSpanX; s <= stripeSpanX; s += 2.2) {
        bp.dashes.push({ x: rx + s, y: 0.034, z: rz - (hwZ + 1.4), rotY: 0, sx: 2.2, sz: 0.72 });
        bp.dashes.push({ x: rx + s, y: 0.034, z: rz + (hwZ + 1.4), rotY: 0, sx: 2.2, sz: 0.72 });
      }
      for (let s = -stripeSpanZ; s <= stripeSpanZ; s += 2.2) {
        bp.dashes.push({ x: rx - (hwX + 1.4), y: 0.034, z: rz + s, rotY: Math.PI / 2, sx: 2.2, sz: 0.72 });
        bp.dashes.push({ x: rx + (hwX + 1.4), y: 0.034, z: rz + s, rotY: Math.PI / 2, sx: 2.2, sz: 0.72 });
      }
    }
  }

  // Buildings & containers
  for (const b of CITY_BUILDINGS) {
    if (b.kind === 'pylon' || b.kind === 'wall') continue;
    const cx = (b.minX + b.maxX) * 0.5;
    const cz = (b.minZ + b.maxZ) * 0.5;
    getBlueprint(cx, cz).buildings.push(b);
  }

  // Highway Gantries
  for (const hz of HIGHWAY_Z_COORDS) {
    for (const gx of [-212, 42]) {
      getBlueprint(gx, hz).gantries.push({
        x: gx,
        z: hz,
        rotY: Math.PI * 0.5,
        spanW: 26.5,
        title: hz < 0 ? 'ШОССЕ М-7 ↑' : 'ЮЖНОЕ ШОССЕ →',
        subtitle: '6 ПОЛОС · 110 КМ/Ч · ВЫЕЗД НА МАГИСТРАЛЬ',
      });
    }
  }
  for (const hx of HIGHWAY_X_COORDS) {
    for (const gz of [-182, 190]) {
      getBlueprint(hx, gz).gantries.push({
        x: hx,
        z: gz,
        rotY: 0,
        spanW: 26.5,
        title: 'ВОСТОЧНАЯ МАГИСТРАЛЬ ↑',
        subtitle: 'МОСТ · ПОРТ · СКОРОСТНАЯ ТРАССА',
      });
    }
  }

  // Traffic Lights
  for (const tl of TRAFFIC_LIGHT_PLACEMENTS) {
    getBlueprint(tl.x, tl.z).trafficLights.push(tl);
  }

  // Malls, Park, Gas Station, Harbor Cranes
  for (const mall of MALL_SPECS) {
    getBlueprint(mall.cx, mall.cz).malls.push(mall);
  }
  getBlueprint(PARK_CENTER.x, PARK_CENTER.z).hasPark = true;
  getBlueprint(GAS_STATION_CENTER.x, GAS_STATION_CENTER.z).hasGasStation = true;
  for (const cx of [127, 212]) {
    getBlueprint(cx, 102).craneXs.push(cx);
  }

  // Trees & Bushes
  for (const t of FOLIAGE_PLACEMENTS.trees) {
    getBlueprint(t[0], t[2]).trees.push(t);
  }
  for (const b of FOLIAGE_PLACEMENTS.bushes) {
    getBlueprint(b[0], b[2]).bushes.push(b);
  }

  // Destructible Streetlamps, Hydrants & Cones
  let propId = 1;
  for (const rx of [-255, -170, -85, 0, 85, 170, 255]) {
    const hwX = getRoadHalfWidthX(rx);
    for (const z of [-420, -340, -260, -185, -110, 110, 190, 268, 345]) {
      getBlueprint(rx - hwX - 1.35, z).destructibles.push({
        id: propId++,
        kind: 'lamp',
        x: rx - hwX - 1.35,
        z,
        armDirX: 1,
      });
      getBlueprint(rx + hwX + 1.35, z).destructibles.push({
        id: propId++,
        kind: 'lamp',
        x: rx + hwX + 1.35,
        z,
        armDirX: -1,
      });
    }
    for (const z of [-350, -245, -165, -125, 128, 175, 255]) {
      getBlueprint(rx - hwX - 1.5, z).destructibles.push({
        id: propId++,
        kind: 'hydrant',
        x: rx - hwX - 1.5,
        z,
        armDirX: 0,
      });
    }
  }
  for (let i = -2; i <= 2; i++) {
    getBlueprint(127 + i * 3.5, 84).destructibles.push({
      id: propId++,
      kind: 'cone',
      x: 127 + i * 3.5,
      z: 84,
      armDirX: 0,
    });
  }

  // 4. Active Streaming State (Only Loaded Chunks & Nearby Bridges Exist in Scene!)
  const loadedChunks = new Map<string, LoadedChunk>();
  const loadedBridges = new Map<string, THREE.Group>();
  const brokenPropIds = new Set<number>();
  let activeDoors: AutoDoorEntry[] = [];
  let activeDestructibles: DestructibleProp[] = [];
  let activePodiums: THREE.Object3D[] = [];
  let currentNightFactor = 0;

  const dummy = new THREE.Object3D();
  const treeColor = new THREE.Color();

  const rebuildActiveCaches = () => {
    activeDoors = [];
    activeDestructibles = [];
    activePodiums = [];
    for (const ch of loadedChunks.values()) {
      for (const d of ch.doors) activeDoors.push(d);
      for (const p of ch.destructibles) activeDestructibles.push(p);
      for (const pod of ch.podiums) activePodiums.push(pod);
    }
  };

  const disposeSubtree = (grp: THREE.Object3D) => {
    grp.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const m = obj as THREE.Mesh;
        if (m.geometry && !m.geometry.userData?.shared) {
          m.geometry.dispose();
        }
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

  const buildBridgeGroup = (bridge: (typeof BRIDGES)[number]): THREE.Group => {
    const bg = new THREE.Group();
    const segments = 32;
    const totalLen = bridge.zEnd - bridge.zStart;
    const segLen = totalLen / segments;
    const isHwyBridge = bridge.deckWidth >= 22;

    for (let i = 0; i < segments; i++) {
      const z0 = bridge.zStart + i * segLen;
      const z1 = z0 + segLen;
      const zMid = (z0 + z1) * 0.5;
      const y0 = getBridgeElevationAt(bridge.centerX, z0).height;
      const y1 = getBridgeElevationAt(bridge.centerX, z1).height;
      const yMid = (y0 + y1) * 0.5;
      const slopeAngle = Math.atan2(y1 - y0, segLen);
      const actualLen = Math.hypot(segLen, y1 - y0) + 0.08;

      const deckMesh = new THREE.Mesh(unitBoxGeo, asphaltBaseMat);
      deckMesh.scale.set(bridge.deckWidth, 0.36, actualLen);
      deckMesh.position.set(bridge.centerX, yMid - 0.18, zMid);
      deckMesh.rotation.x = -slopeAngle;
      deckMesh.receiveShadow = true;
      deckMesh.castShadow = true;
      bg.add(deckMesh);

      if (i >= 1 && i <= segments - 2) {
        const line = new THREE.Mesh(unitBoxGeo, yellowLineMat);
        line.scale.set(0.24, 0.04, actualLen * 0.85);
        line.position.set(bridge.centerX, yMid + 0.02, zMid);
        line.rotation.x = -slopeAngle;
        bg.add(line);
        if (isHwyBridge) {
          for (const laneOff of [-8.0, -4.0, 4.0, 8.0]) {
            const subLine = new THREE.Mesh(unitBoxGeo, dashMat);
            subLine.scale.set(0.18, 0.04, actualLen * 0.55);
            subLine.position.set(bridge.centerX + laneOff, yMid + 0.02, zMid);
            subLine.rotation.x = -slopeAngle;
            bg.add(subLine);
          }
        }
      }

      if (i >= 2 && i <= segments - 3) {
        for (const side of [-1, 1]) {
          const rail = new THREE.Mesh(unitBoxGeo, guardrailMat);
          rail.scale.set(0.42, 0.85, actualLen);
          rail.position.set(bridge.centerX + side * (bridge.deckWidth * 0.5 - 0.25), yMid + 0.42, zMid);
          rail.rotation.x = -slopeAngle;
          bg.add(rail);
        }
      }
    }

    if (bridge.style === 'suspension') {
      const pylonZs = [-28, 28];
      const pylonH = bridge.deckHeight + 35;
      const sagMin = bridge.deckHeight + 4.5;
      const steelMat = bridge.centerX > 0 ? bridgeArchCyan : bridgeSteelRed;

      for (const pz of pylonZs) {
        const pier = new THREE.Mesh(unitBoxGeo, seawallMat);
        pier.scale.set(bridge.deckWidth + 6, 8, 5);
        pier.position.set(bridge.centerX, -1, pz);
        bg.add(pier);

        for (const side of [-1, 1]) {
          const tower = new THREE.Mesh(unitBoxGeo, steelMat);
          tower.scale.set(2.1, pylonH, 2.8);
          tower.position.set(bridge.centerX + side * (bridge.deckWidth * 0.5 + 1.4), pylonH * 0.5 - 1, pz);
          tower.castShadow = true;
          bg.add(tower);
        }

        for (const cy of [bridge.deckHeight + 14.5, pylonH - 6.5]) {
          const beam = new THREE.Mesh(unitBoxGeo, steelMat);
          beam.scale.set(bridge.deckWidth + 4.8, 2.2, 2.2);
          beam.position.set(bridge.centerX, cy, pz);
          beam.castShadow = true;
          bg.add(beam);
        }
      }

      const evalCableY = (z: number) => {
        if (z < -28) {
          const u = (z - bridge.zStart) / (-28 - bridge.zStart);
          return 2 + Math.pow(u, 1.45) * (pylonH - 4);
        }
        if (z > 28) {
          const u = (bridge.zEnd - z) / (bridge.zEnd - 28);
          return 2 + Math.pow(u, 1.45) * (pylonH - 4);
        }
        const u = z / 28;
        return sagMin + u * u * (pylonH - 2 - sagMin);
      };

      for (const side of [-1, 1]) {
        const cx = bridge.centerX + side * (bridge.deckWidth * 0.5 + 1.4);
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 24; i++) {
          const t = i / 24;
          const z = bridge.zStart + t * (bridge.zEnd - bridge.zStart);
          pts.push(new THREE.Vector3(cx, evalCableY(z), z));
        }
        const curve = new THREE.CatmullRomCurve3(pts);
        const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, 36, 0.35, 8, false), steelMat);
        bg.add(cable);

        for (let z = -52; z <= 52; z += 6.5) {
          const deckY = getBridgeElevationAt(bridge.centerX, z).height;
          const cableY = evalCableY(z);
          const h = Math.max(1, cableY - deckY);
          const susp = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, h, 6), cableMat);
          susp.position.set(cx, deckY + h * 0.5, z);
          bg.add(susp);
        }
      }
    } else {
      const archMat = bridge.centerX < 0 ? bridgeArchAmber : bridgeArchCyan;
      const apex = bridge.deckHeight + 18;
      for (const side of [-1, 1]) {
        const cx = bridge.centerX + side * (bridge.deckWidth * 0.5 + 1.0);
        const archPts: THREE.Vector3[] = [];
        for (let i = 0; i <= 20; i++) {
          const u = (i / 20) * 2 - 1;
          const z = u * 50;
          const ay = 2 + (1 - u * u) * apex;
          archPts.push(new THREE.Vector3(cx, ay, z));
        }
        const archCurve = new THREE.CatmullRomCurve3(archPts);
        const arch = new THREE.Mesh(new THREE.TubeGeometry(archCurve, 28, 0.65, 8, false), archMat);
        arch.castShadow = true;
        bg.add(arch);

        for (let z = -40; z <= 40; z += 8) {
          const u = z / 50;
          const ay = 2 + (1 - u * u) * apex;
          const deckY = getBridgeElevationAt(bridge.centerX, z).height;
          if (ay > deckY + 1) {
            const h = ay - deckY;
            const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, h, 6), cableMat);
            hanger.position.set(cx, deckY + h * 0.5, z);
            bg.add(hanger);
          }
        }
      }
    }
    return bg;
  };

  const buildMallIntoChunk = (
    mall: MallSpec,
    cg: THREE.Group,
    chunkDoors: AutoDoorEntry[],
    chunkPodiums: THREE.Object3D[],
    chunkRigs: Array<{ dispose: () => void }>
  ) => {
    const xMin = mall.cx - mall.w * 0.5;
    const xMax = mall.cx + mall.w * 0.5;
    const zMin = mall.cz - mall.d * 0.5;
    const zMax = mall.cz + mall.d * 0.5;

    const floor = new THREE.Mesh(unitBoxGeo, mallFloorMat);
    floor.scale.set(mall.w, 0.06, mall.d);
    floor.position.set(mall.cx, 0.15, mall.cz);
    floor.receiveShadow = true;
    cg.add(floor);

    const roofRimThick = 6;
    const roofY = 0.14 + mall.h;
    const rN = new THREE.Mesh(unitBoxGeo, mallRoofMat);
    rN.scale.set(mall.w + 0.8, 0.6, roofRimThick);
    rN.position.set(mall.cx, roofY, zMin + roofRimThick * 0.5);
    cg.add(rN);
    const rS = new THREE.Mesh(unitBoxGeo, mallRoofMat);
    rS.scale.set(mall.w + 0.8, 0.6, roofRimThick);
    rS.position.set(mall.cx, roofY, zMax - roofRimThick * 0.5);
    cg.add(rS);
    const rW = new THREE.Mesh(unitBoxGeo, mallRoofMat);
    rW.scale.set(roofRimThick, 0.6, mall.d - roofRimThick * 2);
    rW.position.set(xMin + roofRimThick * 0.5, roofY, mall.cz);
    cg.add(rW);
    const rE = new THREE.Mesh(unitBoxGeo, mallRoofMat);
    rE.scale.set(roofRimThick, 0.6, mall.d - roofRimThick * 2);
    rE.position.set(xMax - roofRimThick * 0.5, roofY, mall.cz);
    cg.add(rE);

    const skylight = new THREE.Mesh(
      new THREE.PlaneGeometry(mall.w - roofRimThick * 2, mall.d - roofRimThick * 2),
      glassMat
    );
    skylight.rotation.x = -Math.PI / 2;
    skylight.position.set(mall.cx, roofY + 0.1, mall.cz);
    cg.add(skylight);

    for (const lz of [-mall.d * 0.25, mall.d * 0.25]) {
      const strip = new THREE.Mesh(unitBoxGeo, neonStripMat);
      strip.scale.set(mall.w * 0.6, 0.18, 0.45);
      strip.position.set(mall.cx, roofY - 0.35, mall.cz + lz);
      cg.add(strip);
    }

    const buildVisualWall = (
      fixedCoord: number,
      spanMin: number,
      spanMax: number,
      isHorizontal: boolean,
      wallDoors: MallSpec['doors']
    ) => {
      const sorted = [...wallDoors].sort((a, b) => (isHorizontal ? a.x - b.x : a.z - b.z));
      let cursor = spanMin;

      const emitWallSegment = (s0: number, s1: number) => {
        const len = s1 - s0;
        if (len < 0.4) return;
        const mid = (s0 + s1) * 0.5;
        const lowMesh = new THREE.Mesh(unitBoxGeo, mallWallMat);
        lowMesh.scale.set(isHorizontal ? len : 0.42, 1.1, isHorizontal ? 0.42 : len);
        lowMesh.position.set(isHorizontal ? mid : fixedCoord, 0.14 + 0.55, isHorizontal ? fixedCoord : mid);
        cg.add(lowMesh);

        const glassH = 4.4;
        const winMesh = new THREE.Mesh(unitBoxGeo, glassMat);
        winMesh.scale.set(isHorizontal ? len : 0.14, glassH, isHorizontal ? 0.14 : len);
        winMesh.position.set(isHorizontal ? mid : fixedCoord, 0.14 + 1.1 + glassH * 0.5, isHorizontal ? fixedCoord : mid);
        cg.add(winMesh);

        const topH = mall.h - 5.5;
        if (topH > 0.2) {
          const topMesh = new THREE.Mesh(unitBoxGeo, mallWallMat);
          topMesh.scale.set(isHorizontal ? len : 0.46, topH, isHorizontal ? 0.46 : len);
          topMesh.position.set(
            isHorizontal ? mid : fixedCoord,
            0.14 + 5.5 + topH * 0.5,
            isHorizontal ? fixedCoord : mid
          );
          cg.add(topMesh);
        }
      };

      for (const d of sorted) {
        const pos = isHorizontal ? d.x : d.z;
        const g0 = Math.max(spanMin, pos - d.width * 0.5);
        const g1 = Math.min(spanMax, pos + d.width * 0.5);
        emitWallSegment(cursor, g0);
        const aboveH = mall.h - 3.65;
        if (aboveH > 0.2) {
          const overDoor = new THREE.Mesh(unitBoxGeo, mallWallMat);
          overDoor.scale.set(isHorizontal ? d.width : 0.45, aboveH, isHorizontal ? 0.45 : d.width);
          overDoor.position.set(
            isHorizontal ? pos : fixedCoord,
            0.14 + 3.65 + aboveH * 0.5,
            isHorizontal ? fixedCoord : pos
          );
          cg.add(overDoor);
        }
        cursor = Math.max(cursor, g1);
      }
      emitWallSegment(cursor, spanMax);
    };

    buildVisualWall(zMin, xMin, xMax, true, mall.doors.filter((d) => d.axis === 'x' && Math.abs(d.z - zMin) < 1));
    buildVisualWall(zMax, xMin, xMax, true, mall.doors.filter((d) => d.axis === 'x' && Math.abs(d.z - zMax) < 1));
    buildVisualWall(xMin, zMin, zMax, false, mall.doors.filter((d) => d.axis === 'z' && Math.abs(d.x - xMin) < 1));
    buildVisualWall(xMax, zMin, zMax, false, mall.doors.filter((d) => d.axis === 'z' && Math.abs(d.x - xMax) < 1));

    for (const door of mall.doors) {
      const frameH = 3.5;
      const grp = new THREE.Group();
      const leftPost = new THREE.Mesh(unitBoxGeo, chromeMat);
      leftPost.scale.set(0.24, frameH, 0.45);
      leftPost.position.set(-door.width * 0.5, frameH * 0.5, 0);
      grp.add(leftPost);
      const rightPost = new THREE.Mesh(unitBoxGeo, chromeMat);
      rightPost.scale.set(0.24, frameH, 0.45);
      rightPost.position.set(door.width * 0.5, frameH * 0.5, 0);
      grp.add(rightPost);
      const header = new THREE.Mesh(unitBoxGeo, mallRoofMat);
      header.scale.set(door.width + 0.5, 0.45, 0.52);
      header.position.set(0, frameH + 0.15, 0);
      grp.add(header);

      const sensorMat = new THREE.MeshStandardMaterial({
        color: 0x22c55e,
        emissive: 0x22c55e,
        emissiveIntensity: 0.85,
      });
      const sensorBar = new THREE.Mesh(unitBoxGeo, sensorMat);
      sensorBar.scale.set(1.4, 0.16, 0.58);
      sensorBar.position.set(0, frameH + 0.15, 0);
      grp.add(sensorBar);

      const enterSign = makeSignBox('ВХОД · АВТОДВЕРИ', 'ДОБРО ПОЖАЛОВАТЬ', '#064e3b', '#ecfdf5', '#34d399', 3.8, 0.95);
      enterSign.position.set(0, frameH + 0.95, 0);
      grp.add(enterSign);

      grp.position.set(door.x, 0.14, door.z);
      if (door.axis === 'z') grp.rotation.y = Math.PI * 0.5;
      cg.add(grp);

      const panelW = door.width * 0.5 - 0.1;
      const leftPanel = new THREE.Mesh(unitBoxGeo, doorGlassMat);
      leftPanel.scale.set(door.axis === 'x' ? panelW : 0.1, frameH - 0.15, door.axis === 'x' ? 0.1 : panelW);
      const rightPanel = new THREE.Mesh(unitBoxGeo, doorGlassMat);
      rightPanel.scale.copy(leftPanel.scale);

      const off = panelW * 0.5 + 0.04;
      const leftRestX = door.axis === 'x' ? door.x - off : door.x;
      const leftRestZ = door.axis === 'x' ? door.z : door.z - off;
      const rightRestX = door.axis === 'x' ? door.x + off : door.x;
      const rightRestZ = door.axis === 'x' ? door.z : door.z + off;

      leftPanel.position.set(leftRestX, 0.14 + (frameH - 0.15) * 0.5, leftRestZ);
      rightPanel.position.set(rightRestX, 0.14 + (frameH - 0.15) * 0.5, rightRestZ);
      cg.add(leftPanel);
      cg.add(rightPanel);

      chunkDoors.push({
        doorX: door.x,
        doorZ: door.z,
        axis: door.axis,
        slideDistance: panelW * 0.88,
        openAmount: 0,
        leftPanel,
        rightPanel,
        leftRestX,
        leftRestZ,
        rightRestX,
        rightRestZ,
        sensorMat,
      });
    }

    if (mall.kind === 'mall') {
      const mainSign = makeSignBox('ТРЦ «НЕО-ПЛАЗА»', 'ЭЛЕКТРОНИКА · МОДА · ФУД-КОРТ · 24/7', '#090d16', '#f8fafc', '#38bdf8', 18, 3.4);
      mainSign.position.set(mall.cx, 0.14 + mall.h - 1.8, zMax + 0.35);
      cg.add(mainSign);

      const westSign = makeSignBox('ТРЦ «НЕО-ПЛАЗА»', 'АВТОМАТИЧЕСКИЕ ДВЕРИ · ВХОД', '#090d16', '#f8fafc', '#38bdf8', 15, 3.0);
      westSign.rotation.y = -Math.PI * 0.5;
      westSign.position.set(xMin - 0.35, 0.14 + mall.h - 1.8, mall.cz);
      cg.add(westSign);

      const rim = new THREE.Mesh(
        new THREE.CylinderGeometry(2.5, 2.7, 0.65, 14),
        new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.4 })
      );
      rim.position.set(mall.cx, 0.48, mall.cz);
      cg.add(rim);
      const pool = new THREE.Mesh(
        new THREE.CylinderGeometry(2.1, 2.1, 0.55, 14),
        new THREE.MeshStandardMaterial({ color: 0x0ea5e9, emissive: 0x0284c7, emissiveIntensity: 0.55, roughness: 0.15 })
      );
      pool.position.set(mall.cx, 0.56, mall.cz);
      cg.add(pool);
      const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.48, 1.6, 10), chromeMat);
      spout.position.set(mall.cx, 1.25, mall.cz);
      cg.add(spout);

      const plantMat = new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.8 });
      for (const [bx, bz] of [
        [mall.cx - 5.5, mall.cz - 4.5],
        [mall.cx + 5.5, mall.cz - 4.5],
        [mall.cx - 5.5, mall.cz + 4.5],
        [mall.cx + 5.5, mall.cz + 4.5],
      ]) {
        const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.45, 0.75, 8), woodMat);
        pot.position.set(bx, 0.55, bz);
        cg.add(pot);
        const plant = new THREE.Mesh(new THREE.DodecahedronGeometry(0.85, 0), plantMat);
        plant.position.set(bx, 1.45, bz);
        cg.add(plant);
      }

      const elecSign = makeSignBox('ТЕХНО-МИР', 'СМАРТФОНЫ · НОУТБУКИ · 4K ТВ', '#0f172a', '#e0f2fe', '#22d3ee', 8, 1.6);
      elecSign.position.set(mall.cx - 12, 4.4, zMin + 0.4);
      cg.add(elecSign);
      const elecCounter = new THREE.Mesh(unitBoxGeo, darkMetalMat);
      elecCounter.scale.set(9.6, 1.05, 1.8);
      elecCounter.position.set(mall.cx - 12, 0.7, mall.cz - 10.5);
      cg.add(elecCounter);
      for (let t = -3; t <= 3; t += 3) {
        const tv = new THREE.Mesh(unitBoxGeo, screenGlowMat);
        tv.scale.set(2.2, 1.25, 0.14);
        tv.position.set(mall.cx - 12 + t, 2.75, zMin + 0.55);
        cg.add(tv);
      }
      for (const tz of [mall.cz - 6.2, mall.cz - 2.6]) {
        const demoTbl = new THREE.Mesh(unitBoxGeo, mallWallMat);
        demoTbl.scale.set(7.0, 0.92, 1.5);
        demoTbl.position.set(mall.cx - 12, 0.62, tz);
        cg.add(demoTbl);
        for (let d = -2.4; d <= 2.4; d += 1.6) {
          const laptopBase = new THREE.Mesh(unitBoxGeo, chromeMat);
          laptopBase.scale.set(0.55, 0.04, 0.4);
          laptopBase.position.set(mall.cx - 12 + d, 1.1, tz);
          cg.add(laptopBase);
          const laptopLid = new THREE.Mesh(unitBoxGeo, screenGlowMat);
          laptopLid.scale.set(0.54, 0.36, 0.04);
          laptopLid.position.set(mall.cx - 12 + d, 1.28, tz - 0.18);
          laptopLid.rotation.x = -0.25;
          cg.add(laptopLid);
          const phone = new THREE.Mesh(unitBoxGeo, screenGlowMat);
          phone.scale.set(0.22, 0.04, 0.42);
          phone.position.set(mall.cx - 12 + d + 0.6, 1.1, tz + 0.28);
          cg.add(phone);
        }
      }

      const foodSign = makeSignBox('ФУД-КОРТ · КОФЕ', 'БУРГЕРЫ · ПИЦЦА · НАПИТКИ', '#451a03', '#fef3c7', '#f59e0b', 9, 1.6);
      foodSign.position.set(mall.cx + 12, 4.4, zMin + 0.4);
      cg.add(foodSign);
      const foodCounter = new THREE.Mesh(
        unitBoxGeo,
        new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.45 })
      );
      foodCounter.scale.set(10.5, 1.15, 2.2);
      foodCounter.position.set(mall.cx + 12, 0.75, mall.cz - 10);
      cg.add(foodCounter);
      const chairMat = new THREE.MeshStandardMaterial({ color: 0xe11d48, roughness: 0.65 });
      const trayMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5 });
      const burgerMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.7 });
      for (const [tx, tz] of [
        [mall.cx + 7.5, mall.cz - 5.4],
        [mall.cx + 12.5, mall.cz - 5.4],
        [mall.cx + 17.0, mall.cz - 5.4],
        [mall.cx + 7.5, mall.cz - 1.4],
        [mall.cx + 12.5, mall.cz - 1.4],
        [mall.cx + 17.0, mall.cz - 1.4],
      ]) {
        const table = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.08, 12), woodMat);
        table.position.set(tx, 0.95, tz);
        cg.add(table);
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 0.8, 8), chromeMat);
        leg.position.set(tx, 0.55, tz);
        cg.add(leg);
        for (const cxOff of [-1.05, 1.05]) {
          const seat = new THREE.Mesh(unitBoxGeo, chairMat);
          seat.scale.set(0.46, 0.5, 0.46);
          seat.position.set(tx + cxOff, 0.4, tz);
          cg.add(seat);
        }
        const tray = new THREE.Mesh(unitBoxGeo, trayMat);
        tray.scale.set(0.65, 0.04, 0.45);
        tray.position.set(tx, 1.01, tz);
        cg.add(tray);
        const burger = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.14, 0.12, 8), burgerMat);
        burger.position.set(tx - 0.12, 1.09, tz);
        cg.add(burger);
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.055, 0.22, 8), chairMat);
        cup.position.set(tx + 0.16, 1.14, tz);
        cg.add(cup);
      }

      const clothSign = makeSignBox('ОДЕЖДА «STYLE»', 'НОВАЯ КОЛЛЕКЦИЯ · СКИДКИ', '#3b0764', '#fae8ff', '#e879f9', 8, 1.6);
      clothSign.rotation.y = -Math.PI * 0.5;
      clothSign.position.set(xMax - 0.4, 4.4, mall.cz + 6);
      cg.add(clothSign);
      const rackColors = [0xef4444, 0x3b82f6, 0xfacc15, 0xa855f7, 0x10b981];
      const rackMats = rackColors.map((col) => new THREE.MeshStandardMaterial({ color: col, roughness: 0.72 }));
      for (let r = 0; r < 3; r++) {
        const rz = mall.cz + 3.8 + r * 2.8;
        const rack = new THREE.Mesh(unitBoxGeo, chromeMat);
        rack.scale.set(5.8, 1.5, 0.7);
        rack.position.set(mall.cx + 11.5, 0.9, rz);
        cg.add(rack);
        for (let gIdx = 0; gIdx < 5; gIdx++) {
          const shirt = new THREE.Mesh(unitBoxGeo, rackMats[(r + gIdx) % rackMats.length]);
          shirt.scale.set(0.82, 0.88, 0.48);
          shirt.position.set(mall.cx + 9.4 + gIdx * 1.05, 0.98, rz);
          cg.add(shirt);
        }
      }
      for (const mz of [mall.cz + 5.2, mall.cz + 8.6]) {
        const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 0.24, 10), mallWallMat);
        ped.position.set(mall.cx + 5.6, 0.27, mz);
        cg.add(ped);
        const manBody = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.2, 1.35, 8), chromeMat);
        manBody.position.set(mall.cx + 5.6, 1.06, mz);
        cg.add(manBody);
        const manHead = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), chromeMat);
        manHead.position.set(mall.cx + 5.6, 1.88, mz);
        cg.add(manHead);
      }

      const jewelSign = makeSignBox('ЧАСЫ И ЮВЕЛИРКА', 'LUXURY · ЗОЛОТО · БРИЛЛИАНТЫ', '#422006', '#fef9c3', '#facc15', 7.5, 1.5);
      jewelSign.position.set(mall.cx - 12.5, 4.4, zMax - 0.4);
      cg.add(jewelSign);
      const vitBase = new THREE.Mesh(unitBoxGeo, darkMetalMat);
      vitBase.scale.set(7.2, 0.95, 1.5);
      vitBase.position.set(mall.cx - 12.5, 0.62, mall.cz + 7.5);
      cg.add(vitBase);
      const vitGlass = new THREE.Mesh(unitBoxGeo, glassMat);
      vitGlass.scale.set(7.0, 0.65, 1.35);
      vitGlass.position.set(mall.cx - 12.5, 1.42, mall.cz + 7.5);
      cg.add(vitGlass);
      const goldMat = new THREE.MeshStandardMaterial({
        color: 0xfacc15,
        emissive: 0xca8a04,
        emissiveIntensity: 0.4,
        metalness: 0.9,
        roughness: 0.15,
      });
      for (let j = -2.4; j <= 2.4; j += 1.2) {
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), goldMat);
        gem.position.set(mall.cx - 12.5 + j, 1.26, mall.cz + 7.5);
        cg.add(gem);
      }

      const mezz = new THREE.Mesh(unitBoxGeo, mallFloorMat);
      mezz.scale.set(8, 0.45, 22);
      mezz.position.set(xMax - 4.5, 4.8, mall.cz);
      cg.add(mezz);
      const stairRamp = new THREE.Mesh(unitBoxGeo, chromeMat);
      stairRamp.scale.set(2.2, 0.3, 8.5);
      stairRamp.position.set(xMax - 9.8, 2.55, mall.cz + 3);
      stairRamp.rotation.z = 0.56;
      cg.add(stairRamp);
    } else if (mall.kind === 'showroom') {
      const eastSign = makeSignBox('VIPER MOTORS', 'ОФИЦИАЛЬНЫЙ АВТОСАЛОН · СУПЕРКАРЫ', '#18040a', '#fff1f2', '#e11d48', 15, 2.8);
      eastSign.rotation.y = Math.PI * 0.5;
      eastSign.position.set(xMax + 0.35, 0.14 + mall.h - 1.6, mall.cz);
      cg.add(eastSign);

      const southSign = makeSignBox('VIPER MOTORS', 'ТЕСТ-ДРАЙВ · ТЮНИНГ · ДИСКИ', '#18040a', '#fff1f2', '#e11d48', 15, 2.8);
      southSign.position.set(mall.cx, 0.14 + mall.h - 1.6, zMax + 0.35);
      cg.add(southSign);

      const podiumGroup = new THREE.Group();
      const podiumBase = new THREE.Mesh(
        new THREE.CylinderGeometry(3.8, 4.1, 0.4, 24),
        new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.25, metalness: 0.65 })
      );
      podiumBase.position.y = 0.2;
      podiumGroup.add(podiumBase);
      const podiumRing = new THREE.Mesh(
        new THREE.TorusGeometry(3.85, 0.08, 8, 32),
        new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x38bdf8, emissiveIntensity: 1.8 })
      );
      podiumRing.rotation.x = Math.PI / 2;
      podiumRing.position.y = 0.4;
      podiumGroup.add(podiumRing);

      const heroCarRig = buildCarVisualRig(CAR_SPECS.viper, textures, true, 0xe11d48, false);
      heroCarRig.setDriverVisible(false);
      heroCarRig.root.position.set(0, 0.42, 0);
      podiumGroup.add(heroCarRig.root);
      chunkRigs.push(heroCarRig);

      podiumGroup.position.set(mall.cx - 2, 0.16, mall.cz);
      cg.add(podiumGroup);
      chunkPodiums.push(podiumGroup);

      const floorCars: Array<{ model: 'dominator' | 'titan' | 'cruiser'; x: number; z: number; rotY: number; color: number }> = [
        { model: 'dominator', x: mall.cx - 12, z: mall.cz + 5.5, rotY: 0.42, color: 0xf59e0b },
        { model: 'titan', x: mall.cx + 7, z: mall.cz - 6.8, rotY: -0.35, color: 0x1e293b },
        { model: 'cruiser', x: mall.cx + 11, z: mall.cz + 1.5, rotY: Math.PI * 0.5, color: 0xe2e8f0 },
      ];
      for (const fc of floorCars) {
        const rig = buildCarVisualRig(CAR_SPECS[fc.model], textures, true, fc.color, false);
        rig.setDriverVisible(false);
        rig.root.position.set(fc.x, 0.18, fc.z);
        rig.root.rotation.y = fc.rotY;
        cg.add(rig.root);
        chunkRigs.push(rig);
      }

      const rimSign = makeSignBox('ТЮНИНГ · ДИСКИ · V8', 'КОВАНЫЕ КОЛЁСА · ДВИГАТЕЛИ', '#1e293b', '#f8fafc', '#f59e0b', 9, 1.5);
      rimSign.position.set(mall.cx + 6, 4.5, zMin + 0.4);
      cg.add(rimSign);
      for (let w = 0; w < 5; w++) {
        const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.24, 14), chromeMat);
        rim.rotation.x = Math.PI * 0.5;
        rim.position.set(mall.cx + 2 + w * 2.1, 1.9, zMin + 0.6);
        cg.add(rim);
      }

      const engStand = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.05, 0.5, 12), darkMetalMat);
      engStand.position.set(mall.cx - 14.5, 0.43, mall.cz - 1.5);
      cg.add(engStand);
      const engBlock = new THREE.Mesh(unitBoxGeo, chromeMat);
      engBlock.scale.set(0.9, 0.85, 1.15);
      engBlock.position.set(mall.cx - 14.5, 1.1, mall.cz - 1.5);
      cg.add(engBlock);
      const redHead = new THREE.Mesh(
        unitBoxGeo,
        new THREE.MeshStandardMaterial({ color: 0xdc2626, metalness: 0.5, roughness: 0.3 })
      );
      redHead.scale.set(1.05, 0.24, 1.0);
      redHead.position.set(mall.cx - 14.5, 1.58, mall.cz - 1.5);
      cg.add(redHead);

      const desk = new THREE.Mesh(unitBoxGeo, darkMetalMat);
      desk.scale.set(5.6, 1.1, 1.6);
      desk.position.set(mall.cx - 11, 0.7, mall.cz - 8.5);
      cg.add(desk);
      for (const mx of [-1.5, 1.5]) {
        const mon = new THREE.Mesh(unitBoxGeo, screenGlowMat);
        mon.scale.set(0.8, 0.5, 0.08);
        mon.position.set(mall.cx - 11 + mx, 1.52, mall.cz - 8.5);
        cg.add(mon);
      }
      const sofa = new THREE.Mesh(unitBoxGeo, new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.7 }));
      sofa.scale.set(4.2, 0.85, 1.2);
      sofa.position.set(mall.cx + 8, 0.58, mall.cz + 8.0);
      cg.add(sofa);
    } else if (mall.kind === 'supermarket') {
      const northSign = makeSignBox('МЕГА-МАРТ 24/7', 'ПРОДУКТЫ · ВЫПЕЧКА · ГИПЕРМАРКЕТ', '#2e1065', '#faf5ff', '#a855f7', 16, 3.0);
      northSign.position.set(mall.cx, 0.14 + mall.h - 1.6, zMin - 0.35);
      cg.add(northSign);

      const westSign = makeSignBox('МЕГА-МАРТ 24/7', 'ВХОД · СКИДКИ КАЖДЫЙ ДЕНЬ', '#2e1065', '#faf5ff', '#a855f7', 15, 2.8);
      westSign.rotation.y = -Math.PI * 0.5;
      westSign.position.set(xMin - 0.35, 0.14 + mall.h - 1.6, mall.cz);
      cg.add(westSign);

      const shelfMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.5, metalness: 0.25 });
      const itemColors = [0xef4444, 0x22c55e, 0xf59e0b, 0x3b82f6, 0xec4899, 0xa855f7];
      const itemMats = itemColors.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.58 }));
      const aisleNames = ['НАПИТКИ', 'БАКАЛЕЯ', 'ВЫПЕЧКА', 'СНЕКИ', 'ХОЗТОВАРЫ'];
      const aisleOffsets = [-8.0, -4.0, 0, 4.0, 8.0];
      aisleOffsets.forEach((offsetZ, idx) => {
        const rack = new THREE.Mesh(unitBoxGeo, shelfMat);
        rack.scale.set(15.0, 2.2, 1.4);
        rack.position.set(mall.cx + 4.5, 1.24, mall.cz + offsetZ);
        cg.add(rack);

        const aisleSign = makeSignBox(aisleNames[idx], `РЯД ${idx + 1}`, '#1e1b4b', '#f8fafc', '#a855f7', 4.4, 0.9);
        aisleSign.position.set(mall.cx + 4.5, 3.1, mall.cz + offsetZ);
        cg.add(aisleSign);

        for (let tier = 0; tier < 3; tier++) {
          for (let b = 0; b < 11; b++) {
            const prod = new THREE.Mesh(unitBoxGeo, itemMats[(b + tier + idx) % itemMats.length]);
            prod.scale.set(0.95, 0.42, 1.56);
            prod.position.set(mall.cx - 2.4 + b * 1.38, 0.72 + tier * 0.62, mall.cz + offsetZ);
            cg.add(prod);
          }
        }
      });

      const fridgeBody = new THREE.Mesh(unitBoxGeo, chromeMat);
      fridgeBody.scale.set(1.4, 2.5, 22.5);
      fridgeBody.position.set(xMax - 1.2, 1.4, mall.cz);
      cg.add(fridgeBody);
      const fridgeGlow = new THREE.Mesh(
        unitBoxGeo,
        new THREE.MeshStandardMaterial({ color: 0xe0f2fe, emissive: 0x38bdf8, emissiveIntensity: 0.9 })
      );
      fridgeGlow.scale.set(0.2, 1.85, 21.5);
      fridgeGlow.position.set(xMax - 1.85, 1.5, mall.cz);
      cg.add(fridgeGlow);

      const produceTbl = new THREE.Mesh(unitBoxGeo, woodMat);
      produceTbl.scale.set(3.0, 0.9, 8.2);
      produceTbl.position.set(mall.cx - 6.5, 0.6, mall.cz);
      cg.add(produceTbl);
      const produceColors = [0xef4444, 0xf97316, 0x22c55e, 0xfacc15];
      for (let p = 0; p < 4; p++) {
        const crate = new THREE.Mesh(
          unitBoxGeo,
          new THREE.MeshStandardMaterial({ color: produceColors[p], roughness: 0.75 })
        );
        crate.scale.set(2.2, 0.35, 1.6);
        crate.position.set(mall.cx - 6.5, 1.2, mall.cz - 2.8 + p * 1.85);
        cg.add(crate);
      }

      for (const czOff of [-9.0, -4.0, 4.5, 9.5]) {
        const belt = new THREE.Mesh(unitBoxGeo, darkMetalMat);
        belt.scale.set(1.8, 1.05, 3.6);
        belt.position.set(mall.cx - 12.5, 0.68, mall.cz + czOff);
        cg.add(belt);
        const posMonitor = new THREE.Mesh(unitBoxGeo, screenGlowMat);
        posMonitor.scale.set(0.42, 0.38, 0.12);
        posMonitor.position.set(mall.cx - 12.2, 1.45, mall.cz + czOff - 1.1);
        cg.add(posMonitor);
      }
      for (let c = 0; c < 3; c++) {
        const cart = new THREE.Mesh(unitBoxGeo, chromeMat);
        cart.scale.set(0.9, 0.85, 0.65);
        cart.position.set(mall.cx - 16.5, 0.62, mall.cz - 3.5 + c * 1.3);
        cg.add(cart);
      }
    }
  };

  const buildChunk = (key: string): LoadedChunk => {
    const bp = chunkBlueprints.get(key);
    const cg = new THREE.Group();
    const chunkDoors: AutoDoorEntry[] = [];
    const chunkDestructibles: DestructibleProp[] = [];
    const chunkPodiums: THREE.Object3D[] = [];
    const chunkRigs: Array<{ dispose: () => void }> = [];

    if (!bp) {
      root.add(cg);
      return { key, group: cg, doors: chunkDoors, destructibles: chunkDestructibles, podiums: chunkPodiums, showroomRigs: chunkRigs };
    }

    // Sidewalk Pads
    for (const p of bp.blockPads) {
      const pad = new THREE.Mesh(unitBoxGeo, sidewalkMat);
      pad.scale.set(p.w, 0.13, p.d);
      pad.position.set(p.cx, 0.075, p.cz);
      pad.receiveShadow = true;
      cg.add(pad);
    }

    // Chunk-local Instanced Road Markings
    const emitStripes = (
      list: Array<{ x: number; y: number; z: number; rotY: number; sx?: number; sz?: number }>,
      mat: THREE.Material
    ) => {
      if (list.length === 0) return;
      const inst = new THREE.InstancedMesh(dashGeo, mat, list.length);
      for (let idx = 0; idx < list.length; idx++) {
        const d = list[idx];
        dummy.position.set(d.x, d.y, d.z);
        dummy.rotation.set(0, d.rotY, 0);
        dummy.scale.set(d.sx ?? 1, 1, d.sz ?? 1);
        dummy.updateMatrix();
        inst.setMatrixAt(idx, dummy.matrix);
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      cg.add(inst);
    };
    emitStripes(bp.dashes, dashMat);
    emitStripes(bp.yellows, yellowLineMat);

    // Buildings, Skyscrapers & Shipping Containers
    for (const b of bp.buildings) {
      const w = b.maxX - b.minX;
      const d = b.maxZ - b.minZ;
      const cx = (b.minX + b.maxX) * 0.5;
      const cz = (b.minZ + b.maxZ) * 0.5;

      if (b.kind === 'container') {
        const box = new THREE.Mesh(unitBoxGeo, getIndustrialMat(b.color ?? 0xdc2626));
        box.scale.set(w, b.height, d);
        box.position.set(cx, 0.14 + b.height * 0.5, cz);
        box.castShadow = true;
        box.receiveShadow = true;
        cg.add(box);
        continue;
      }

      const isSky = b.style === 'skyscraper';
      const isMid = b.style === 'midrise';
      const baseMat = isSky || isMid ? getBuildingMat(b.color ?? 0x475569) : getIndustrialMat(b.color ?? 0x475569);

      if (b.style === 'skyscraper') {
        const mainH = b.height * 0.84;
        const tower = new THREE.Mesh(unitBoxGeo, baseMat);
        tower.scale.set(w, mainH, d);
        tower.position.set(cx, 0.14 + mainH * 0.5, cz);
        tower.castShadow = true;
        tower.receiveShadow = true;
        cg.add(tower);

        const crownH = b.height * 0.16;
        const crown = new THREE.Mesh(unitBoxGeo, baseMat);
        crown.scale.set(w * 0.76, crownH, d * 0.76);
        crown.position.set(cx, 0.14 + mainH + crownH * 0.5, cz);
        crown.castShadow = true;
        cg.add(crown);

        const spire = new THREE.Mesh(spireGeo, getSpireMat(b.accentColor));
        spire.position.set(cx, 0.14 + b.height + 3.5, cz);
        cg.add(spire);

        if (b.hasHelipad) {
          const hpGeo = new THREE.PlaneGeometry(Math.min(w, d) * 0.65, Math.min(w, d) * 0.65);
          hpGeo.rotateX(-Math.PI / 2);
          const hp = new THREE.Mesh(hpGeo, helipadMat);
          hp.position.set(cx, 0.14 + b.height + 0.05, cz);
          cg.add(hp);
        }
      } else {
        const box = new THREE.Mesh(unitBoxGeo, baseMat);
        box.scale.set(w, b.height, d);
        box.position.set(cx, 0.14 + b.height * 0.5, cz);
        box.castShadow = true;
        box.receiveShadow = true;
        cg.add(box);

        const cap = new THREE.Mesh(unitBoxGeo, roofTrimMat);
        cap.scale.set(w + 0.3, 0.45, d + 0.3);
        cap.position.set(cx, 0.14 + b.height + 0.22, cz);
        cg.add(cap);
      }

      if (b.signTitle) {
        const accentCss = '#' + b.accentColor.toString(16).padStart(6, '0');
        const sMat = getSignFaceMat(
          b.signTitle,
          b.signSubtitle ?? '',
          '#0b1120',
          '#f8fafc',
          accentCss,
          0.55 + currentNightFactor * 0.85
        );
        const signW = Math.min(w * 0.82, 14);
        const signH = signW * 0.25;
        const signY = Math.min(b.height - 2, 7.2);
        const f1 = new THREE.Mesh(unitBoxGeo, [
          signSupportMat, signSupportMat, signSupportMat, signSupportMat, sMat, signSupportMat,
        ]);
        f1.scale.set(signW, signH, 0.25);
        f1.position.set(cx, signY, b.maxZ + 0.22);
        cg.add(f1);

        const f2 = new THREE.Mesh(unitBoxGeo, [
          signSupportMat, sMat, signSupportMat, signSupportMat, signSupportMat, signSupportMat,
        ]);
        f2.scale.set(0.25, signH, Math.min(d * 0.82, 14));
        f2.position.set(b.minX - 0.22, signY, cz);
        cg.add(f2);
      }
    }

    // Highway Overhead Gantries
    for (const gInfo of bp.gantries) {
      const gg = new THREE.Group();
      for (const sx of [-gInfo.spanW * 0.5, gInfo.spanW * 0.5]) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 7.2, 8), gantrySteelMat);
        col.position.set(sx, 3.6, 0);
        gg.add(col);
      }
      const truss = new THREE.Mesh(unitBoxGeo, gantrySteelMat);
      truss.scale.set(gInfo.spanW + 0.8, 0.55, 0.55);
      truss.position.set(0, 7.1, 0);
      gg.add(truss);

      const board = makeSignBox(gInfo.title, gInfo.subtitle, '#064e3b', '#ecfdf5', '#34d399', 11.5, 2.3, 0.55 + currentNightFactor * 0.85);
      board.position.set(0, 6.9, 0.35);
      gg.add(board);

      gg.position.set(gInfo.x, 0.14, gInfo.z);
      gg.rotation.y = gInfo.rotY;
      cg.add(gg);
    }

    // Traffic Lights
    for (const tl of bp.trafficLights) {
      const redM = tl.axis === 'ns' ? nsRedMat : ewRedMat;
      const yelM = tl.axis === 'ns' ? nsYellowMat : ewYellowMat;
      const grnM = tl.axis === 'ns' ? nsGreenMat : ewGreenMat;

      const g = new THREE.Group();
      const pole = new THREE.Mesh(tlPoleGeo, tlPoleMat);
      pole.position.y = 2.8;
      g.add(pole);

      const arm = new THREE.Mesh(tlArmGeo, tlPoleMat);
      arm.position.set(1.7, 5.45, 0);
      g.add(arm);

      const head = new THREE.Mesh(tlHeadGeo, tlBoxMat);
      head.position.set(3.0, 5.15, 0);
      g.add(head);

      for (const zSide of [-0.17, 0.17]) {
        const zSign = Math.sign(zSide);
        const rLens = new THREE.Mesh(tlLensGeo, redM);
        rLens.position.set(3.0, 5.62, zSide);
        g.add(rLens);
        const yLens = new THREE.Mesh(tlLensGeo, yelM);
        yLens.position.set(3.0, 5.15, zSide);
        g.add(yLens);
        const gLens = new THREE.Mesh(tlLensGeo, grnM);
        gLens.position.set(3.0, 4.68, zSide);
        g.add(gLens);
        for (const vy of [5.8, 5.33, 4.86]) {
          const visor = new THREE.Mesh(tlVisorGeo, tlBoxMat);
          visor.position.set(3.0, vy, zSide + zSign * 0.1);
          g.add(visor);
        }
      }

      g.position.set(tl.x, 0.14, tl.z);
      g.rotation.y = tl.rotY;
      cg.add(g);
    }

    // Malls
    for (const mall of bp.malls) {
      buildMallIntoChunk(mall, cg, chunkDoors, chunkPodiums, chunkRigs);
    }

    // Central Park
    if (bp.hasPark) {
      const lawn = new THREE.Mesh(
        unitBoxGeo,
        new THREE.MeshStandardMaterial({ color: 0xffffff, map: textures.grassMap, roughness: 0.92 })
      );
      lawn.scale.set(56, 0.12, 46);
      lawn.position.set(PARK_CENTER.x, 0.17, PARK_CENTER.z);
      lawn.receiveShadow = true;
      cg.add(lawn);

      const pathNS = new THREE.Mesh(unitBoxGeo, sidewalkMat);
      pathNS.scale.set(5.5, 0.05, 46);
      pathNS.position.set(PARK_CENTER.x, 0.22, PARK_CENTER.z);
      cg.add(pathNS);
      const pathEW = new THREE.Mesh(unitBoxGeo, sidewalkMat);
      pathEW.scale.set(56, 0.05, 5.5);
      pathEW.position.set(PARK_CENTER.x, 0.22, PARK_CENTER.z);
      cg.add(pathEW);

      const fRim = new THREE.Mesh(
        new THREE.CylinderGeometry(4.2, 4.5, 0.7, 16),
        new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.5 })
      );
      fRim.position.set(PARK_CENTER.x, 0.55, PARK_CENTER.z);
      cg.add(fRim);
      const fWater = new THREE.Mesh(
        new THREE.CylinderGeometry(3.6, 3.6, 0.55, 16),
        new THREE.MeshStandardMaterial({ color: 0x0ea5e9, emissive: 0x0369a1, emissiveIntensity: 0.4, roughness: 0.15 })
      );
      fWater.position.set(PARK_CENTER.x, 0.68, PARK_CENTER.z);
      cg.add(fWater);

      const parkSign = makeSignBox('ЦЕНТРАЛЬНЫЙ ПАРК', 'ОТДЫХ · ФОНТАН · АЛЛЕИ', '#052e16', '#ecfdf5', '#22c55e', 10, 2.2);
      parkSign.position.set(PARK_CENTER.x, 3.4, PARK_CENTER.z + 22);
      cg.add(parkSign);
    }

    // Gas Station
    if (bp.hasGasStation) {
      const gx = GAS_STATION_CENTER.x;
      const gz = GAS_STATION_CENTER.z;
      const canopyMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.45, metalness: 0.35 });
      const orangeAccent = new THREE.MeshStandardMaterial({
        color: 0xf97316,
        emissive: 0xf97316,
        emissiveIntensity: 0.75,
      });

      const canopy = new THREE.Mesh(unitBoxGeo, canopyMat);
      canopy.scale.set(16, 0.8, 18);
      canopy.position.set(gx - 5, 5.2, gz);
      canopy.castShadow = true;
      cg.add(canopy);
      const trim = new THREE.Mesh(unitBoxGeo, orangeAccent);
      trim.scale.set(16.3, 0.35, 18.3);
      trim.position.set(gx - 5, 5.4, gz);
      cg.add(trim);

      const gasSign = makeSignBox('АЗС «НЕО-ОЙЛ» 24/7', 'АИ-95 · АИ-100 · ЭЛЕКТРО', '#431407', '#fff7ed', '#f97316', 12, 2.4);
      gasSign.rotation.y = -Math.PI * 0.5;
      gasSign.position.set(gx - 13.2, 5.3, gz);
      cg.add(gasSign);

      const pumpMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.4 });
      for (const px of [-9, -1]) {
        for (const pz of [-6, 6]) {
          const col = new THREE.Mesh(unitBoxGeo, chromeMat);
          col.scale.set(0.9, 5.0, 0.9);
          col.position.set(gx + px, 2.64, gz + pz);
          cg.add(col);
        }
        for (const pz of [-2.2, 2.2]) {
          const pump = new THREE.Mesh(unitBoxGeo, pumpMat);
          pump.scale.set(1.1, 1.85, 0.8);
          pump.position.set(gx + px, 1.08, gz + pz);
          cg.add(pump);
        }
      }

      const kiosk = new THREE.Mesh(unitBoxGeo, new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.65 }));
      kiosk.scale.set(11, 4.4, 18);
      kiosk.position.set(gx + 13.5, 2.34, gz);
      kiosk.castShadow = true;
      cg.add(kiosk);
      const kioskSign = makeSignBox('МАРКЕТ · КОФЕ', 'ОТКРЫТО 24 ЧАСА', '#0f172a', '#ffffff', '#f59e0b', 9, 1.8);
      kioskSign.rotation.y = -Math.PI * 0.5;
      kioskSign.position.set(gx + 7.9, 3.8, gz);
      cg.add(kioskSign);
    }

    // Harbor Gantry Cranes
    for (const cx of bp.craneXs) {
      const legL = new THREE.Mesh(unitBoxGeo, craneMat);
      legL.scale.set(1.4, 18, 1.4);
      legL.position.set(cx - 12, 9.14, 102);
      cg.add(legL);
      const legR = new THREE.Mesh(unitBoxGeo, craneMat);
      legR.scale.set(1.4, 18, 1.4);
      legR.position.set(cx + 12, 9.14, 102);
      cg.add(legR);
      const boom = new THREE.Mesh(unitBoxGeo, craneMat);
      boom.scale.set(28, 1.8, 3.2);
      boom.position.set(cx, 18.2, 102);
      cg.add(boom);
    }

    // Instanced Trees + Planters
    if (bp.trees.length > 0) {
      const planterInst = new THREE.InstancedMesh(planterGeo, planterMat, bp.trees.length);
      const soilInst = new THREE.InstancedMesh(soilGeo, soilMat, bp.trees.length);
      const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, bp.trees.length);
      const canopyInst = new THREE.InstancedMesh(canopyGeo, canopyMat, bp.trees.length);
      bp.trees.forEach(([tx, ty, tz], i) => {
        dummy.position.set(tx, ty, tz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        planterInst.setMatrixAt(i, dummy.matrix);
        soilInst.setMatrixAt(i, dummy.matrix);

        const s = 0.88 + ((i * 17) % 10) * 0.028;
        dummy.rotation.set(0, (i * 1.1) % (Math.PI * 2), 0);
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        trunkInst.setMatrixAt(i, dummy.matrix);
        canopyInst.setMatrixAt(i, dummy.matrix);
        treeColor.setHSL(0.34 + ((i % 5) - 2) * 0.015, 0.62, 0.34 + (i % 3) * 0.04);
        canopyInst.setColorAt(i, treeColor);
      });
      trunkInst.castShadow = true;
      canopyInst.castShadow = true;
      planterInst.receiveShadow = true;
      planterInst.instanceMatrix.needsUpdate = true;
      soilInst.instanceMatrix.needsUpdate = true;
      trunkInst.instanceMatrix.needsUpdate = true;
      canopyInst.instanceMatrix.needsUpdate = true;
      if (canopyInst.instanceColor) canopyInst.instanceColor.needsUpdate = true;
      planterInst.computeBoundingSphere();
      soilInst.computeBoundingSphere();
      trunkInst.computeBoundingSphere();
      canopyInst.computeBoundingSphere();
      cg.add(planterInst, soilInst, trunkInst, canopyInst);
    }

    // Instanced Bushes
    if (bp.bushes.length > 0) {
      const bushInst = new THREE.InstancedMesh(bushGeo, bushMat, bp.bushes.length);
      bp.bushes.forEach(([bx, by, bz], i) => {
        const s = 0.92 + (i % 4) * 0.06;
        dummy.position.set(bx, by, bz);
        dummy.rotation.set(0, (i * 0.9) % (Math.PI * 2), 0);
        dummy.scale.set(s, s * 0.82, s);
        dummy.updateMatrix();
        bushInst.setMatrixAt(i, dummy.matrix);
        treeColor.setHSL(0.35 + ((i % 3) - 1) * 0.02, 0.65, 0.32 + (i % 3) * 0.03);
        bushInst.setColorAt(i, treeColor);
      });
      bushInst.castShadow = true;
      bushInst.receiveShadow = true;
      bushInst.instanceMatrix.needsUpdate = true;
      if (bushInst.instanceColor) bushInst.instanceColor.needsUpdate = true;
      bushInst.computeBoundingSphere();
      cg.add(bushInst);
    }

    // Destructible Lamps, Hydrants & Cones
    for (const spec of bp.destructibles) {
      if (brokenPropIds.has(spec.id)) continue;
      const g = new THREE.Group();
      const yBase = spec.kind === 'cone' ? 0.02 : 0.14;
      if (spec.kind === 'hydrant') {
        const body = new THREE.Mesh(hydBodyGeo, hydrantMat);
        body.position.y = 0.36;
        g.add(body);
        const cap = new THREE.Mesh(hydCapGeo, hydrantMat);
        cap.position.y = 0.72;
        g.add(cap);
      } else if (spec.kind === 'lamp') {
        const pole = new THREE.Mesh(lampPoleGeo, poleMat);
        pole.position.y = 2.6;
        g.add(pole);
        const arm = new THREE.Mesh(unitBoxGeo, poleMat);
        arm.scale.set(1.4, 0.1, 0.1);
        arm.position.set(spec.armDirX * 0.65, 5.15, 0);
        g.add(arm);
        const bulb = new THREE.Mesh(unitBoxGeo, lampBulbMat);
        bulb.scale.set(0.45, 0.12, 0.24);
        bulb.position.set(spec.armDirX * 1.15, 5.05, 0);
        g.add(bulb);
      } else {
        const base = new THREE.Mesh(unitBoxGeo, poleMat);
        base.scale.set(0.44, 0.06, 0.44);
        base.position.y = 0.03;
        g.add(base);
        const cone = new THREE.Mesh(coneGeo, coneMat);
        cone.position.y = 0.34;
        g.add(cone);
      }
      g.position.set(spec.x, yBase, spec.z);
      cg.add(g);
      chunkDestructibles.push({
        id: spec.id,
        kind: spec.kind,
        x: spec.x,
        y: yBase,
        z: spec.z,
        vx: 0,
        vy: 0,
        vz: 0,
        rotVx: 0,
        rotVz: 0,
        broken: false,
        hitTime: 0,
        mesh: g,
      });
    }

    root.add(cg);
    return {
      key,
      group: cg,
      doors: chunkDoors,
      destructibles: chunkDestructibles,
      podiums: chunkPodiums,
      showroomRigs: chunkRigs,
    };
  };

  const unloadChunk = (key: string) => {
    const ch = loadedChunks.get(key);
    if (!ch) return;
    for (const p of ch.destructibles) {
      if (p.broken) brokenPropIds.add(p.id);
    }
    for (const rig of ch.showroomRigs) {
      rig.dispose();
    }
    root.remove(ch.group);
    disposeSubtree(ch.group);
    loadedChunks.delete(key);
  };

  const updateStreaming = (
    px: number,
    pz: number,
    heading: number,
    _dt: number,
    maxBuildsPerFrame = 1
  ) => {
    const plan = getStreamingChunkPlan(
      px,
      pz,
      heading,
      loadedChunks,
      DEFAULT_LOAD_RADIUS_CHUNKS,
      DEFAULT_UNLOAD_RADIUS_CHUNKS
    );

    let changed = false;

    for (const uKey of plan.toUnload) {
      unloadChunk(uKey);
      changed = true;
    }

    let builds = 0;
    for (const item of plan.toLoad) {
      if (builds >= maxBuildsPerFrame) break;
      const chunk = buildChunk(item.key);
      loadedChunks.set(item.key, chunk);
      builds++;
      changed = true;
    }

    // Stream Bridges by proximity; urgent close-range bridges (< 240m) always load immediately
    for (const bridge of BRIDGES) {
      const dist = Math.hypot(px - bridge.centerX, pz);
      const existing = loadedBridges.get(bridge.id);
      if (existing && dist > 435) {
        root.remove(existing);
        disposeSubtree(existing);
        loadedBridges.delete(bridge.id);
      } else if (!existing && (dist < 240 || (dist < 355 && builds < maxBuildsPerFrame))) {
        const bg = buildBridgeGroup(bridge);
        root.add(bg);
        loadedBridges.set(bridge.id, bg);
        builds++;
      }
    }

    if (changed) {
      rebuildActiveCaches();
    }
  };

  let waterScroll = 0;
  const updateWater = (dt: number) => {
    waterScroll = (waterScroll + dt * 0.025) % 1;
    textures.waterBumpMap.offset.set(waterScroll, waterScroll * 0.6);
    for (const pod of activePodiums) {
      pod.rotation.y += dt * 0.45;
    }
  };

  const applyLampColor = (mat: THREE.MeshStandardMaterial, active: boolean, activeHex: number, intensity: number) => {
    if (active) {
      mat.color.setHex(activeHex);
      mat.emissive.setHex(activeHex);
      mat.emissiveIntensity = intensity;
    } else {
      mat.color.setHex(0x171b22);
      mat.emissive.setHex(0x000000);
      mat.emissiveIntensity = 0.02;
    }
  };

  const updateTrafficLights = (simTimeSec: number) => {
    const ns = getTrafficLightState(simTimeSec, 'ns');
    const ew = getTrafficLightState(simTimeSec, 'ew');

    applyLampColor(nsRedMat, ns === 'red', 0xff2626, 3.6);
    applyLampColor(nsYellowMat, ns === 'yellow', 0xfacc15, 3.4);
    applyLampColor(nsGreenMat, ns === 'green', 0x22ff66, 3.6);

    applyLampColor(ewRedMat, ew === 'red', 0xff2626, 3.6);
    applyLampColor(ewYellowMat, ew === 'yellow', 0xfacc15, 3.4);
    applyLampColor(ewGreenMat, ew === 'green', 0x22ff66, 3.6);
  };

  const updateDoors = (px: number, pz: number, dt: number) => {
    for (const d of activeDoors) {
      const dist = Math.hypot(px - d.doorX, pz - d.doorZ);
      const targetOpen = dist < 7.5 ? 1 : 0;
      d.openAmount += (targetOpen - d.openAmount) * Math.min(1, 7.5 * dt);
      const offset = d.openAmount * d.slideDistance;
      if (d.axis === 'x') {
        d.leftPanel.position.x = d.leftRestX - offset;
        d.rightPanel.position.x = d.rightRestX + offset;
      } else {
        d.leftPanel.position.z = d.leftRestZ - offset;
        d.rightPanel.position.z = d.rightRestZ + offset;
      }
      d.sensorMat.emissiveIntensity = targetOpen > 0.5 ? 2.6 : 0.7;
    }
  };

  const setNightModeFactor = (nightFactor: number) => {
    currentNightFactor = nightFactor;
    const bIntensity = 0.06 + nightFactor * 1.35;
    buildingMat.emissiveIntensity = bIntensity;
    for (const m of buildingMatVariants.values()) {
      m.emissiveIntensity = bIntensity;
    }
    lampBulbMat.emissiveIntensity = 0.35 + nightFactor * 2.2;
    for (const s of signFaces) {
      s.emissiveIntensity = 0.55 + nightFactor * 0.85;
    }
  };

  const dispose = () => {
    for (const key of [...loadedChunks.keys()]) {
      unloadChunk(key);
    }
    for (const bg of loadedBridges.values()) {
      root.remove(bg);
      disposeSubtree(bg);
    }
    loadedBridges.clear();
    disposeSubtree(root);
    for (const g of sharedGeos) g.dispose();
    for (const m of sharedMats) m.dispose();
  };

  void SIDEWALK_WIDTH;

  return {
    root,
    waterMesh,
    buildingMat,
    lampBulbMat,
    get destructibles() {
      return activeDestructibles;
    },
    updateStreaming,
    getLoadedChunkCount: () => loadedChunks.size,
    updateWater,
    updateTrafficLights,
    updateDoors,
    setNightModeFactor,
    dispose,
  };
}

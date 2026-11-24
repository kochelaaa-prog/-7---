import type { BridgeSpec, MallSpec, ShipSpec, StaticAABB, StaticCircle } from './types';
import { CHUNK_GRID_COUNT, buildSpatialColliderIndex, worldToChunkCoord } from './worldChunks';

/**
 * World coordinate system:
 * X: East (+) / West (-), span [-540, +540] (1080m x 1080m)
 * Z: South (+) / North (-), span [-540, +540]
 *
 * Bay / Channel runs East-West across Z in [-52, +52]
 * North Island (Downtown, Malls, Park, Gas Station, North Ring Highway): Z in [-540, -52]
 * South Island (Cargo Port, Supermarket, South Highway & Industrial): Z in [+52, +540]
 */
export const WORLD_HALF_SIZE = 540;
export const WATER_Z_MIN = -52;
export const WATER_Z_MAX = 52;
export const WATER_LEVEL = -1.6;

/** Road grid coordinates (11 North-South avenues x 12 East-West avenues) */
export const ROAD_X_COORDS = [-425, -340, -255, -170, -85, 0, 85, 170, 255, 340, 425] as const;
export const NORTH_ROAD_Z_COORDS = [-460, -380, -300, -220, -145, -72] as const;
export const SOUTH_ROAD_Z_COORDS = [72, 150, 230, 305, 385, 465] as const;

/** Multi-lane 6-lane Express Highways (Шоссе) */
export const HIGHWAY_X_COORDS = [170] as const;
export const HIGHWAY_Z_COORDS = [-300, 230] as const;

export const ROAD_WIDTH = 16; // 4-lane avenue width
export const HIGHWAY_WIDTH = 24; // 6-lane express highway width
export const SIDEWALK_WIDTH = 4.2;

export function isHighwayX(rx: number): boolean {
  return (HIGHWAY_X_COORDS as readonly number[]).includes(rx);
}

export function isHighwayZ(rz: number): boolean {
  return (HIGHWAY_Z_COORDS as readonly number[]).includes(rz);
}

export function getRoadHalfWidthX(rx: number): number {
  return isHighwayX(rx) ? HIGHWAY_WIDTH * 0.5 : ROAD_WIDTH * 0.5;
}

export function getRoadHalfWidthZ(rz: number): number {
  return isHighwayZ(rz) ? HIGHWAY_WIDTH * 0.5 : ROAD_WIDTH * 0.5;
}

/** 5 Bridges spanning the Bay (including the 6-lane East Highway Bridge at x = 170) */
export const BRIDGES: BridgeSpec[] = [
  {
    id: 'west-viaduct-bridge',
    name: 'Западный Виадук',
    centerX: -255,
    zStart: -62,
    zEnd: 62,
    deckWidth: 16,
    deckHeight: 8.2,
    rampLength: 34,
    style: 'arch',
  },
  {
    id: 'golden-bay-bridge',
    name: 'Мост Золотого Залива',
    centerX: -85,
    zStart: -62,
    zEnd: 62,
    deckWidth: 18,
    deckHeight: 9.5,
    rampLength: 38,
    style: 'suspension',
  },
  {
    id: 'harbor-arch-bridge',
    name: 'Центральный Арочный Мост',
    centerX: 85,
    zStart: -62,
    zEnd: 62,
    deckWidth: 16,
    deckHeight: 8.5,
    rampLength: 36,
    style: 'arch',
  },
  {
    id: 'highway-express-bridge',
    name: 'Мост Восточного Шоссе',
    centerX: 170,
    zStart: -62,
    zEnd: 62,
    deckWidth: 24,
    deckHeight: 10.5,
    rampLength: 40,
    style: 'suspension',
  },
  {
    id: 'far-east-bridge',
    name: 'Восточный Промышленный Мост',
    centerX: 340,
    zStart: -62,
    zEnd: 62,
    deckWidth: 16,
    deckHeight: 8.0,
    rampLength: 34,
    style: 'arch',
  },
];

export const BRIDGE_CENTER_XS = new Set(BRIDGES.map((b) => b.centerX));

/** Physical floating ships patrolling the bay lanes cleanly between bridge piers */
export const SHIP_SPECS: ShipSpec[] = [
  {
    id: 'ship-cargo-west',
    name: 'Контейнеровоз «Атлантик»',
    kind: 'cargo',
    length: 36,
    width: 9.2,
    hullHeight: 3.4,
    zLane: -14,
    xStart: -375,
    xMin: -490,
    xMax: -285,
    dir: 1,
    speed: 4.5,
    color: 0xb91c1c,
  },
  {
    id: 'ship-tug-west',
    name: 'Буксир «Портовый»',
    kind: 'tug',
    length: 14,
    width: 5.4,
    hullHeight: 2.2,
    zLane: 22,
    xStart: -170,
    xMin: -230,
    xMax: -112,
    dir: -1,
    speed: 6.0,
    color: 0xf59e0b,
  },
  {
    id: 'ship-cargo-center',
    name: 'Сухогруз «Нео-Порт»',
    kind: 'cargo',
    length: 34,
    width: 9.0,
    hullHeight: 3.4,
    zLane: 14,
    xStart: 0,
    xMin: -60,
    xMax: 60,
    dir: 1,
    speed: 4.2,
    color: 0x0f766e,
  },
  {
    id: 'ship-yacht-center',
    name: 'Яхта «Мираж»',
    kind: 'yacht',
    length: 18,
    width: 5.2,
    hullHeight: 2.0,
    zLane: -24,
    xStart: 12,
    xMin: -62,
    xMax: 62,
    dir: -1,
    speed: 7.4,
    color: 0xf8fafc,
  },
  {
    id: 'ship-tug-mid',
    name: 'Катер береговой охраны',
    kind: 'tug',
    length: 14,
    width: 5.0,
    hullHeight: 2.1,
    zLane: -18,
    xStart: 127,
    xMin: 106,
    xMax: 146,
    dir: 1,
    speed: 3.8,
    color: 0x2563eb,
  },
  {
    id: 'ship-cargo-east',
    name: 'Танкер «Мегаполис»',
    kind: 'cargo',
    length: 36,
    width: 9.2,
    hullHeight: 3.4,
    zLane: 8,
    xStart: 255,
    xMin: 196,
    xMax: 314,
    dir: -1,
    speed: 4.6,
    color: 0x1d4ed8,
  },
  {
    id: 'ship-yacht-east',
    name: 'Яхта «Горизонт»',
    kind: 'yacht',
    length: 20,
    width: 5.6,
    hullHeight: 2.1,
    zLane: -16,
    xStart: 430,
    xMin: 368,
    xMax: 505,
    dir: 1,
    speed: 6.8,
    color: 0xe2e8f0,
  },
];

/** Enterable commercial interiors with automatic sliding glass doors */
export const MALL_SPECS: MallSpec[] = [
  {
    id: 'neo-plaza',
    name: 'ТРЦ «НЕО-ПЛАЗА»',
    cx: -42.5,
    cz: -108.5,
    w: 44,
    d: 30,
    h: 11,
    kind: 'mall',
    doors: [
      { x: -64.5, z: -108.5, axis: 'z', width: 4.6 },
      { x: -42.5, z: -93.5, axis: 'x', width: 4.6 },
    ],
  },
  {
    id: 'viper-motors',
    name: 'Автосалон «VIPER MOTORS»',
    cx: -127.5,
    cz: -108.5,
    w: 36,
    d: 26,
    h: 8.5,
    kind: 'showroom',
    doors: [{ x: -109.5, z: -108.5, axis: 'z', width: 4.6 }],
  },
  {
    id: 'mega-mart',
    name: 'Гипермаркет «МЕГА-МАРТ»',
    cx: -42.5,
    cz: 111,
    w: 40,
    d: 28,
    h: 8.5,
    kind: 'supermarket',
    doors: [
      { x: -62.5, z: 111, axis: 'z', width: 4.6 },
      { x: -42.5, z: 97, axis: 'x', width: 4.6 },
    ],
  },
];

export const GAS_STATION_CENTER = { x: 42.5, z: -108.5 };
export const PARK_CENTER = { x: 42.5, z: -182.5 };
export const PORT_YARD_WEST = { xMin: 98, xMax: 150, zMin: 86, zMax: 135 };
export const PORT_YARD_EAST = { xMin: 192, xMax: 241, zMin: 86, zMax: 135 };

export const LANDMARK_MINIMAP_DOTS: Array<{ x: number; z: number; label: string; color: string }> = [
  { x: -42.5, z: -108.5, label: 'ТРЦ', color: '#38bdf8' },
  { x: -127.5, z: -108.5, label: 'АВТО', color: '#e11d48' },
  { x: 42.5, z: -108.5, label: 'АЗС', color: '#f97316' },
  { x: 42.5, z: -182.5, label: 'ПАРК', color: '#22c55e' },
  { x: -42.5, z: 111, label: 'МАРТ', color: '#a855f7' },
  { x: 127, z: 111, label: 'ПОРТ', color: '#eab308' },
  { x: 170, z: -300, label: 'ШОССЕ', color: '#10b981' },
];

export type TrafficSignalColor = 'green' | 'yellow' | 'red';

/** Deterministic 18-second intersection signal cycle shared by visuals and AI cars */
export function getTrafficLightState(simTimeSec: number, axis: 'ns' | 'ew'): TrafficSignalColor {
  const phase = ((simTimeSec % 18) + 18) % 18;
  if (axis === 'ns') {
    if (phase < 7) return 'green';
    if (phase < 9) return 'yellow';
    return 'red';
  }
  if (phase < 9) return 'red';
  if (phase < 16) return 'green';
  return 'yellow';
}

export interface TrafficLightPlacement {
  x: number;
  z: number;
  rotY: number;
  axis: 'ns' | 'ew';
}

/**
 * Generates traffic light mast placements cleanly on sidewalk corners outside any road or bridge deck.
 */
export function generateTrafficLightPlacements(): TrafficLightPlacement[] {
  const list: TrafficLightPlacement[] = [];

  for (const rx of ROAD_X_COORDS) {
    const hwX = getRoadHalfWidthX(rx);
    const offX = hwX + 1.25;
    for (const rz of [...NORTH_ROAD_Z_COORDS, ...SOUTH_ROAD_Z_COORDS]) {
      const hwZ = getRoadHalfWidthZ(rz);
      const offZ = hwZ + 1.25;
      const hasBridge = BRIDGE_CENTER_XS.has(rx) && (rz === -72 || rz === 72);
      if (hasBridge) {
        const inlandZ = rz < 0 ? rz - offZ : rz + offZ;
        const ewRotY = rz < 0 ? -Math.PI * 0.5 : Math.PI * 0.5;
        list.push({ x: rx + offX, z: inlandZ, rotY: Math.PI, axis: 'ns' });
        list.push({ x: rx - offX, z: inlandZ, rotY: ewRotY, axis: 'ew' });
      } else {
        list.push({ x: rx + offX, z: rz - offZ, rotY: Math.PI, axis: 'ns' });
        list.push({ x: rx - offX, z: rz + offZ, rotY: Math.PI * 0.5, axis: 'ew' });
      }
    }
  }
  return list;
}

export const TRAFFIC_LIGHT_PLACEMENTS: TrafficLightPlacement[] = generateTrafficLightPlacements();

function isFoliageClearOfRoadsAndMalls(x: number, z: number, minRoadPad: number): boolean {
  if (Math.abs(x) > WORLD_HALF_SIZE - 16 || Math.abs(z) > WORLD_HALF_SIZE - 16) return false;
  if (z > WATER_Z_MIN - 14 && z < WATER_Z_MAX + 14) return false;
  if (isOnRoad(x, z)) return false;

  for (const rx of ROAD_X_COORDS) {
    const hwX = getRoadHalfWidthX(rx);
    if (Math.abs(x - rx) < hwX + 1.7) return false;
  }
  for (const rz of [...NORTH_ROAD_Z_COORDS, ...SOUTH_ROAD_Z_COORDS]) {
    const hwZ = getRoadHalfWidthZ(rz);
    if (Math.abs(z - rz) < hwZ + minRoadPad) return false;
  }

  for (const mall of MALL_SPECS) {
    if (Math.abs(x - mall.cx) <= mall.w * 0.5 + 2.5 && Math.abs(z - mall.cz) <= mall.d * 0.5 + 2.5) {
      return false;
    }
    for (const d of mall.doors) {
      if (Math.hypot(x - d.x, z - d.z) < 7.0) return false;
    }
  }

  if (Math.abs(x - GAS_STATION_CENTER.x) < 28 && Math.abs(z - GAS_STATION_CENTER.z) < 22) {
    return false;
  }
  return true;
}

/** Deterministic tree & bush coordinates strictly on sidewalks/park — NEVER on asphalt roads! */
export function generateFoliagePlacements(): {
  trees: Array<[number, number, number]>;
  bushes: Array<[number, number, number]>;
} {
  const trees: Array<[number, number, number]> = [];
  const bushes: Array<[number, number, number]> = [];

  for (const rx of ROAD_X_COORDS) {
    const hwX = getRoadHalfWidthX(rx);
    const curbXLeft = rx - hwX - 2.3;
    const curbXRight = rx + hwX + 2.3;

    for (let z = -505; z <= 505; z += 30) {
      for (const tx of [curbXLeft, curbXRight]) {
        if (isFoliageClearOfRoadsAndMalls(tx, z, 4.2)) {
          trees.push([tx, 0.14, z]);
        }
      }

      // Check BOTH z+12 and z-12 explicitly against EVERY road & mall before placing a bush!
      if (Math.abs(z) % 60 < 30) {
        const bzL = z + 12;
        if (isFoliageClearOfRoadsAndMalls(curbXLeft, bzL, 3.6)) {
          bushes.push([curbXLeft, 0.14, bzL]);
        }
        const bzR = z - 12;
        if (isFoliageClearOfRoadsAndMalls(curbXRight, bzR, 3.6)) {
          bushes.push([curbXRight, 0.14, bzR]);
        }
      }
    }
  }

  // Central Park grove trees & perimeter shrubs
  for (const [ox, oz] of [
    [-18, -14], [18, -14], [-18, 14], [18, 14], [-12, -7], [12, -7], [-12, 7], [12, 7],
  ]) {
    trees.push([PARK_CENTER.x + ox, 0.22, PARK_CENTER.z + oz]);
  }
  for (const [ox, oz] of [
    [-22, -18], [-8, -18], [8, -18], [22, -18],
    [-22, 18], [-8, 18], [8, 18], [22, 18],
    [-24, -6], [-24, 6], [24, -6], [24, 6],
  ]) {
    bushes.push([PARK_CENTER.x + ox, 0.22, PARK_CENTER.z + oz]);
  }

  return { trees, bushes };
}

export const FOLIAGE_PLACEMENTS = generateFoliagePlacements();

/** Deterministic PRNG for building generation so physics & visuals match 100% */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BuildingFootprint extends StaticAABB {
  style: 'skyscraper' | 'midrise' | 'industrial' | 'warehouse';
  hasHelipad: boolean;
  accentColor: number;
  signTitle?: string;
  signSubtitle?: string;
}

function addWallWithDoorGaps(
  buildings: BuildingFootprint[],
  fixedCoord: number,
  spanMin: number,
  spanMax: number,
  thickness: number,
  height: number,
  isHorizontalWall: boolean,
  doors: Array<{ posAlongWall: number; width: number }>
): void {
  const sorted = [...doors].sort((a, b) => a.posAlongWall - b.posAlongWall);
  const halfT = thickness * 0.5;
  let cursor = spanMin;

  const pushSeg = (s0: number, s1: number) => {
    if (s1 - s0 < 0.4) return;
    buildings.push({
      minX: isHorizontalWall ? s0 : fixedCoord - halfT,
      maxX: isHorizontalWall ? s1 : fixedCoord + halfT,
      minZ: isHorizontalWall ? fixedCoord - halfT : s0,
      maxZ: isHorizontalWall ? fixedCoord + halfT : s1,
      height,
      kind: 'wall',
      style: 'midrise',
      hasHelipad: false,
      accentColor: 0x38bdf8,
    });
  };

  for (const d of sorted) {
    const gapStart = Math.max(spanMin, d.posAlongWall - d.width * 0.5);
    const gapEnd = Math.min(spanMax, d.posAlongWall + d.width * 0.5);
    pushSeg(cursor, gapStart);
    cursor = Math.max(cursor, gapEnd);
  }
  pushSeg(cursor, spanMax);
}

function addEnterableMallWalls(
  mall: MallSpec,
  buildings: BuildingFootprint[],
  circles: StaticCircle[]
): void {
  const xMin = mall.cx - mall.w * 0.5;
  const xMax = mall.cx + mall.w * 0.5;
  const zMin = mall.cz - mall.d * 0.5;
  const zMax = mall.cz + mall.d * 0.5;
  const wallT = 0.75;

  const northDoors = mall.doors
    .filter((d) => d.axis === 'x' && Math.abs(d.z - zMin) < 1.0)
    .map((d) => ({ posAlongWall: d.x, width: d.width }));
  const southDoors = mall.doors
    .filter((d) => d.axis === 'x' && Math.abs(d.z - zMax) < 1.0)
    .map((d) => ({ posAlongWall: d.x, width: d.width }));
  const westDoors = mall.doors
    .filter((d) => d.axis === 'z' && Math.abs(d.x - xMin) < 1.0)
    .map((d) => ({ posAlongWall: d.z, width: d.width }));
  const eastDoors = mall.doors
    .filter((d) => d.axis === 'z' && Math.abs(d.x - xMax) < 1.0)
    .map((d) => ({ posAlongWall: d.z, width: d.width }));

  addWallWithDoorGaps(buildings, zMin, xMin, xMax, wallT, mall.h, true, northDoors);
  addWallWithDoorGaps(buildings, zMax, xMin, xMax, wallT, mall.h, true, southDoors);
  addWallWithDoorGaps(buildings, xMin, zMin, zMax, wallT, mall.h, false, westDoors);
  addWallWithDoorGaps(buildings, xMax, zMin, zMax, wallT, mall.h, false, eastDoors);

  const pushProp = (cx: number, cz: number, hw: number, hd: number, h: number) => {
    buildings.push({
      minX: cx - hw,
      maxX: cx + hw,
      minZ: cz - hd,
      maxZ: cz + hd,
      height: h,
      kind: 'wall',
      style: 'midrise',
      hasHelipad: false,
      accentColor: 0x38bdf8,
    });
  };

  if (mall.kind === 'mall') {
    // Central atrium fountain + 4 curved benches + planters
    circles.push({ x: mall.cx, z: mall.cz, radius: 2.8, height: 2.4, kind: 'fountain' });
    for (const [bx, bz] of [
      [mall.cx - 5.5, mall.cz - 4.5],
      [mall.cx + 5.5, mall.cz - 4.5],
      [mall.cx - 5.5, mall.cz + 4.5],
      [mall.cx + 5.5, mall.cz + 4.5],
    ]) {
      circles.push({ x: bx, z: bz, radius: 0.9, height: 2.4, kind: 'bush' });
    }
    // Tech Zone counter & 2 demo tables
    pushProp(mall.cx - 12, mall.cz - 10.5, 4.9, 1.0, 2.0);
    pushProp(mall.cx - 12, mall.cz - 6.2, 3.6, 0.85, 1.2);
    pushProp(mall.cx - 12, mall.cz - 2.6, 3.6, 0.85, 1.2);
    // Food court counter & 6 café tables
    pushProp(mall.cx + 12, mall.cz - 10, 5.4, 1.2, 2.2);
    for (const [tx, tz] of [
      [mall.cx + 7.5, mall.cz - 5.4],
      [mall.cx + 12.5, mall.cz - 5.4],
      [mall.cx + 17.0, mall.cz - 5.4],
      [mall.cx + 7.5, mall.cz - 1.4],
      [mall.cx + 12.5, mall.cz - 1.4],
      [mall.cx + 17.0, mall.cz - 1.4],
    ]) {
      circles.push({ x: tx, z: tz, radius: 1.05, height: 1.4, kind: 'furniture' });
    }
    // Clothing boutique racks & jewelry vitrine
    for (let r = 0; r < 3; r++) {
      pushProp(mall.cx + 11.5, mall.cz + 3.8 + r * 2.8, 3.1, 0.55, 1.7);
    }
    pushProp(mall.cx - 12.5, mall.cz + 7.5, 3.8, 0.9, 1.4);
    // Mezzanine staircase base support
    pushProp(xMax - 9.8, mall.cz + 3, 1.2, 3.8, 3.2);
  } else if (mall.kind === 'showroom') {
    // Rotating supercar turntable + 3 diagonal showroom car bays
    circles.push({ x: mall.cx - 2, z: mall.cz, radius: 4.15, height: 2.0, kind: 'fountain' });
    pushProp(mall.cx - 12, mall.cz + 5.5, 2.4, 1.4, 1.6);
    pushProp(mall.cx + 7, mall.cz - 6.8, 2.4, 1.4, 1.6);
    pushProp(mall.cx + 11, mall.cz + 1.5, 1.5, 2.4, 1.9);
    // Reception desk, wheel/rim display wall, engine stand & customer lounge sofa
    pushProp(mall.cx - 11, mall.cz - 8.5, 3.0, 0.9, 1.4);
    pushProp(mall.cx + 8, mall.cz + 8.0, 2.4, 0.8, 1.1);
    circles.push({ x: mall.cx - 14.5, z: mall.cz - 1.5, radius: 1.1, height: 1.6, kind: 'furniture' });
  } else if (mall.kind === 'supermarket') {
    // 5 stocked grocery aisles
    for (const offsetZ of [-8.0, -4.0, 0, 4.0, 8.0]) {
      pushProp(mall.cx + 4.5, mall.cz + offsetZ, 7.6, 0.85, 2.3);
    }
    // Refrigerated dairy/drinks wall along East wall
    pushProp(xMax - 1.2, mall.cz, 0.9, 11.5, 2.6);
    // Fresh produce island & 4 checkout lanes
    pushProp(mall.cx - 6.5, mall.cz, 1.6, 4.2, 1.4);
    for (const czOff of [-9.0, -4.0, 4.5, 9.5]) {
      pushProp(mall.cx - 12.5, mall.cz + czOff, 1.0, 1.9, 1.4);
    }
  }
}

export function generateCityColliders(): {
  buildings: BuildingFootprint[];
  circles: StaticCircle[];
} {
  const rand = mulberry32(7072026);
  const buildings: BuildingFootprint[] = [];
  const circles: StaticCircle[] = [];

  const xMargins = ROAD_X_COORDS.map((rx) => ({
    rx,
    pad: getRoadHalfWidthX(rx) + SIDEWALK_WIDTH,
  }));
  const blockXBounds: Array<[number, number]> = [
    [-WORLD_HALF_SIZE + 20, xMargins[0].rx - xMargins[0].pad],
  ];
  for (let i = 0; i < xMargins.length - 1; i++) {
    blockXBounds.push([xMargins[i].rx + xMargins[i].pad, xMargins[i + 1].rx - xMargins[i + 1].pad]);
  }
  blockXBounds.push([xMargins[xMargins.length - 1].rx + xMargins[xMargins.length - 1].pad, WORLD_HALF_SIZE - 20]);

  const nzMargins = NORTH_ROAD_Z_COORDS.map((rz) => ({
    rz,
    pad: getRoadHalfWidthZ(rz) + SIDEWALK_WIDTH,
  }));
  const northZBounds: Array<[number, number]> = [
    [-WORLD_HALF_SIZE + 20, nzMargins[0].rz - nzMargins[0].pad],
  ];
  for (let i = 0; i < nzMargins.length - 1; i++) {
    northZBounds.push([nzMargins[i].rz + nzMargins[i].pad, nzMargins[i + 1].rz - nzMargins[i + 1].pad]);
  }

  const szMargins = SOUTH_ROAD_Z_COORDS.map((rz) => ({
    rz,
    pad: getRoadHalfWidthZ(rz) + SIDEWALK_WIDTH,
  }));
  const southZBounds: Array<[number, number]> = [];
  for (let i = 0; i < szMargins.length - 1; i++) {
    southZBounds.push([szMargins[i].rz + szMargins[i].pad, szMargins[i + 1].rz - szMargins[i + 1].pad]);
  }
  southZBounds.push([szMargins[szMargins.length - 1].rz + szMargins[szMargins.length - 1].pad, WORLD_HALF_SIZE - 20]);

  const towerColors = [0x2a3441, 0x384659, 0x1f2a38, 0x45505e, 0x323b48, 0x525d6d];
  const accentColors = [0x38bdf8, 0xf59e0b, 0x22d3ee, 0xf97316, 0xe2e8f0];
  const commercialSigns: Array<[string, string]> = [
    ['КИНО · БОУЛИНГ', 'IMAX · 5 ЭТАЖ'],
    ['НЕО-БАНК', 'ФИНАНСОВЫЙ ЦЕНТР'],
    ['ОТЕЛЬ «ГРАНД»', 'VIP · ПЕНТХАУСЫ'],
    ['БИЗНЕС-ТАУЭР', 'ОФИСЫ КЛАССА А'],
    ['КИБЕР-АРЕНА', '24 ЧАСА · ИГРЫ'],
    ['РЕСТОРАН «НЕБО»', 'ПАНОРАМНЫЙ ВИД'],
  ];
  let signIdx = 0;

  for (let bx = 0; bx < blockXBounds.length; bx++) {
    const [x0, x1] = blockXBounds[bx];
    for (let bz = 0; bz < northZBounds.length; bz++) {
      const [z0, z1] = northZBounds[bz];
      // Preserve custom landmark blocks: Viper Motors (bx=4,bz=4), Neo-Plaza (bx=5,bz=4), Gas Station (bx=6,bz=4), Central Park (bx=6,bz=3)
      if (bz === 4 && (bx === 4 || bx === 5 || bx === 6)) continue;
      if (bz === 3 && bx === 6) continue;

      const bw = x1 - x0;
      const bd = z1 - z0;
      if (bw < 16 || bd < 16) continue;
      const subCols = bw > 44 ? 2 : 1;
      const subRows = bd > 44 ? 2 : 1;
      const gap = 3.8;
      const cellW = (bw - gap * (subCols + 1)) / subCols;
      const cellD = (bd - gap * (subRows + 1)) / subRows;

      for (let sc = 0; sc < subCols; sc++) {
        for (let sr = 0; sr < subRows; sr++) {
          if (rand() < 0.16) continue;
          const minX = x0 + gap + sc * (cellW + gap);
          const maxX = minX + cellW;
          const minZ = z0 + gap + sr * (cellD + gap);
          const maxZ = minZ + cellD;
          const distFromCenter = Math.hypot((minX + maxX) * 0.5, (minZ + maxZ) * 0.5 + 170);
          const isSkyscraper = distFromCenter < 220 || rand() < 0.45;
          const height = isSkyscraper ? 26 + rand() * 64 : 11 + rand() * 18;

          let signTitle: string | undefined;
          let signSubtitle: string | undefined;
          if (distFromCenter < 210 && rand() < 0.28) {
            const pair = commercialSigns[signIdx % commercialSigns.length];
            signIdx++;
            signTitle = pair[0];
            signSubtitle = pair[1];
          }

          buildings.push({
            minX,
            maxX,
            minZ,
            maxZ,
            height,
            kind: 'building',
            style: isSkyscraper ? 'skyscraper' : 'midrise',
            hasHelipad: isSkyscraper && height > 56 && rand() < 0.36,
            color: towerColors[Math.floor(rand() * towerColors.length)],
            accentColor: accentColors[Math.floor(rand() * accentColors.length)],
            signTitle,
            signSubtitle,
          });
        }
      }
    }
  }

  const indColors = [0x475569, 0x64748b, 0x7c2d12, 0x1e3a5f, 0x3f4e4f, 0x57534e];
  for (let bx = 0; bx < blockXBounds.length; bx++) {
    const [x0, x1] = blockXBounds[bx];
    for (let bz = 0; bz < southZBounds.length; bz++) {
      const [z0, z1] = southZBounds[bz];
      // Preserve Mega-Mart (bx=5,bz=0) and Container Ports (bx=7,8,bz=0)
      if (bz === 0 && (bx === 5 || bx === 7 || bx === 8)) continue;

      const bw = x1 - x0;
      const bd = z1 - z0;
      if (bw < 16 || bd < 16) continue;
      const subCols = bw > 44 ? 2 : 1;
      const subRows = bd > 44 ? 2 : 1;
      const gap = 4.6;
      const cellW = (bw - gap * (subCols + 1)) / subCols;
      const cellD = (bd - gap * (subRows + 1)) / subRows;

      for (let sc = 0; sc < subCols; sc++) {
        for (let sr = 0; sr < subRows; sr++) {
          if (rand() < 0.22) continue;
          const minX = x0 + gap + sc * (cellW + gap);
          const maxX = minX + cellW;
          const minZ = z0 + gap + sr * (cellD + gap);
          const maxZ = minZ + cellD;
          const isWarehouse = rand() < 0.6;
          const height = isWarehouse ? 8 + rand() * 8 : 16 + rand() * 28;

          buildings.push({
            minX,
            maxX,
            minZ,
            maxZ,
            height,
            kind: 'building',
            style: isWarehouse ? 'warehouse' : 'industrial',
            hasHelipad: false,
            color: indColors[Math.floor(rand() * indColors.length)],
            accentColor: accentColors[Math.floor(rand() * accentColors.length)],
          });
        }
      }
    }
  }

  for (const mall of MALL_SPECS) {
    addEnterableMallWalls(mall, buildings, circles);
  }

  // Park fountain collider
  circles.push({ x: PARK_CENTER.x, z: PARK_CENTER.z, radius: 4.55, height: 2.5, kind: 'fountain' });

  // Gas Station kiosk, canopy pillars & fuel pumps
  buildings.push({
    minX: GAS_STATION_CENTER.x + 8,
    maxX: GAS_STATION_CENTER.x + 19,
    minZ: GAS_STATION_CENTER.z - 9,
    maxZ: GAS_STATION_CENTER.z + 9,
    height: 4.5,
    kind: 'wall',
    style: 'midrise',
    hasHelipad: false,
    accentColor: 0xf97316,
  });
  for (const px of [-9, -1]) {
    for (const pz of [-6, 6]) {
      buildings.push({
        minX: GAS_STATION_CENTER.x + px - 0.55,
        maxX: GAS_STATION_CENTER.x + px + 0.55,
        minZ: GAS_STATION_CENTER.z + pz - 0.55,
        maxZ: GAS_STATION_CENTER.z + pz + 0.55,
        height: 4.8,
        kind: 'pylon',
        style: 'industrial',
        hasHelipad: false,
        accentColor: 0xf97316,
      });
    }
    for (const pz of [-2.2, 2.2]) {
      circles.push({
        x: GAS_STATION_CENTER.x + px,
        z: GAS_STATION_CENTER.z + pz,
        radius: 0.72,
        height: 2.2,
        kind: 'pump',
      });
    }
  }

  // Cargo Port stacked shipping containers
  const containerColors = [0xdc2626, 0x2563eb, 0xd97706, 0x0d9488];
  const portZones = [PORT_YARD_WEST, PORT_YARD_EAST];
  portZones.forEach((zone, zi) => {
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const cx = zone.xMin + 8 + col * 15;
        const cz = zone.zMin + 8 + row * 14;
        const stackH = (row + col + zi) % 2 === 0 ? 5.6 : 2.8;
        buildings.push({
          minX: cx - 5.2,
          maxX: cx + 5.2,
          minZ: cz - 1.5,
          maxZ: cz + 1.5,
          height: stackH,
          kind: 'container',
          style: 'industrial',
          hasHelipad: false,
          color: containerColors[(row * 3 + col + zi) % containerColors.length],
          accentColor: 0xfacc15,
        });
      }
    }
  });

  // Bridge pylon colliders on suspension bridges
  for (const bridge of BRIDGES) {
    if (bridge.style === 'suspension') {
      const pylonZs = [-28, 28];
      for (const pz of pylonZs) {
        buildings.push({
          minX: bridge.centerX - bridge.deckWidth / 2 - 2.6,
          maxX: bridge.centerX - bridge.deckWidth / 2 - 0.3,
          minZ: pz - 1.6,
          maxZ: pz + 1.6,
          height: 44,
          kind: 'pylon',
          style: 'industrial',
          hasHelipad: false,
          color: 0xd9482b,
          accentColor: 0xf59e0b,
        });
        buildings.push({
          minX: bridge.centerX + bridge.deckWidth / 2 + 0.3,
          maxX: bridge.centerX + bridge.deckWidth / 2 + 2.6,
          minZ: pz - 1.6,
          maxZ: pz + 1.6,
          height: 44,
          kind: 'pylon',
          style: 'industrial',
          hasHelipad: false,
          color: 0xd9482b,
          accentColor: 0xf59e0b,
        });
      }
    }
  }

  // Physical circle colliders for EVERY street/park tree, bush, and traffic light pole!
  for (const [tx, , tz] of FOLIAGE_PLACEMENTS.trees) {
    circles.push({ x: tx, z: tz, radius: 0.48, height: 5.5, kind: 'tree' });
  }
  for (const [bx, , bz] of FOLIAGE_PLACEMENTS.bushes) {
    circles.push({ x: bx, z: bz, radius: 0.88, height: 1.6, kind: 'bush' });
  }
  for (const tl of TRAFFIC_LIGHT_PLACEMENTS) {
    circles.push({ x: tl.x, z: tl.z, radius: 0.26, height: 5.6, kind: 'pole' });
  }

  return { buildings, circles };
}

const GENERATED_COLLIDERS = generateCityColliders();
export const CITY_BUILDINGS: BuildingFootprint[] = GENERATED_COLLIDERS.buildings;
export const CITY_CIRCLES: StaticCircle[] = GENERATED_COLLIDERS.circles;
const CITY_SPATIAL_INDEX = buildSpatialColliderIndex(CITY_BUILDINGS, CITY_CIRCLES);

/** Smooth bridge deck & approach ramp elevation profile */
export function getBridgeElevationAt(x: number, z: number): { onBridge: boolean; height: number; bridge: BridgeSpec | null } {
  for (const bridge of BRIDGES) {
    const halfW = bridge.deckWidth * 0.5;
    if (Math.abs(x - bridge.centerX) <= halfW) {
      const spanStart = bridge.zStart;
      const spanEnd = bridge.zEnd;
      const ramp = bridge.rampLength;
      const flatStart = spanStart + ramp;
      const flatEnd = spanEnd - ramp;

      if (z >= spanStart && z <= spanEnd) {
        if (z < flatStart) {
          const t = (z - spanStart) / ramp;
          const smooth = t * t * (3 - 2 * t);
          return { onBridge: true, height: smooth * bridge.deckHeight, bridge };
        }
        if (z > flatEnd) {
          const t = (spanEnd - z) / ramp;
          const smooth = t * t * (3 - 2 * t);
          return { onBridge: true, height: smooth * bridge.deckHeight, bridge };
        }
        return { onBridge: true, height: bridge.deckHeight, bridge };
      }
    }
  }
  return { onBridge: false, height: 0, bridge: null };
}

/**
 * Resolves collisions with bridge approach embankment side walls when below the deck surface.
 */
export function resolveRampAndBridgeWallCollisions(
  x: number,
  z: number,
  y: number,
  radius: number,
  prevX?: number
): { x: number; z: number; hit: boolean; normalX: number; normalZ: number } {
  let outX = x;
  let outZ = z;
  let anyHit = false;
  let nxOut = 0;
  let nzOut = 0;

  for (const b of BRIDGES) {
    if (outZ >= b.zStart + 2 && outZ <= b.zEnd - 2) {
      const deckH = getBridgeElevationAt(b.centerX, outZ).height;
      // Only block vehicles hitting the bridge embankment from OUTSIDE/BELOW the deck —
      // never teleport a vehicle that is already driving along the bridge deck/ramp!
      if (deckH > 0.85 && y < deckH - 1.25) {
        const halfDeck = b.deckWidth * 0.5;
        const hw = halfDeck + radius;
        const dx = outX - b.centerX;
        const wasOutside = prevX !== undefined ? Math.abs(prevX - b.centerX) >= halfDeck - 0.35 : Math.abs(dx) >= halfDeck - 1.2;
        if (Math.abs(dx) < hw && wasOutside) {
          const sign = dx >= 0 ? 1 : -1;
          outX = b.centerX + sign * hw;
          anyHit = true;
          nxOut = sign;
          nzOut = 0;
        }
      }
    }
  }

  return { x: outX, z: outZ, hit: anyHit, normalX: nxOut, normalZ: nzOut };
}

export function isOverWater(x: number, z: number): boolean {
  if (z > WATER_Z_MIN && z < WATER_Z_MAX) {
    const bridgeCheck = getBridgeElevationAt(x, z);
    if (bridgeCheck.onBridge) return false;
    return true;
  }
  if (Math.abs(x) > WORLD_HALF_SIZE || Math.abs(z) > WORLD_HALF_SIZE) {
    return true;
  }
  return false;
}

/** Ground surface height at (x, z) including roads, sidewalks, bridges, and underwater basin */
export function getGroundHeightAt(x: number, z: number): number {
  const bridge = getBridgeElevationAt(x, z);
  if (bridge.onBridge) {
    return bridge.height;
  }
  if (z > WATER_Z_MIN && z < WATER_Z_MAX) {
    return WATER_LEVEL - 2.5;
  }
  if (Math.abs(x) > WORLD_HALF_SIZE || Math.abs(z) > WORLD_HALF_SIZE) {
    return WATER_LEVEL - 2.5;
  }
  if (isOnRoad(x, z)) {
    return 0.02;
  }
  return 0.14;
}

export function isOnRoad(x: number, z: number): boolean {
  for (const rx of ROAD_X_COORDS) {
    const hw = getRoadHalfWidthX(rx);
    if (Math.abs(x - rx) <= hw && z >= -WORLD_HALF_SIZE + 15 && z <= WORLD_HALF_SIZE - 15) {
      if (z > WATER_Z_MIN && z < WATER_Z_MAX) {
        return getBridgeElevationAt(x, z).onBridge;
      }
      return true;
    }
  }
  for (const rz of NORTH_ROAD_Z_COORDS) {
    const hw = getRoadHalfWidthZ(rz);
    if (Math.abs(z - rz) <= hw && x >= -WORLD_HALF_SIZE + 18 && x <= WORLD_HALF_SIZE - 18) return true;
  }
  for (const rz of SOUTH_ROAD_Z_COORDS) {
    const hw = getRoadHalfWidthZ(rz);
    if (Math.abs(z - rz) <= hw && x >= -WORLD_HALF_SIZE + 18 && x <= WORLD_HALF_SIZE - 18) return true;
  }
  return false;
}

export function getMallAt(x: number, z: number): MallSpec | null {
  for (const mall of MALL_SPECS) {
    if (Math.abs(x - mall.cx) <= mall.w * 0.5 && Math.abs(z - mall.cz) <= mall.d * 0.5) {
      return mall;
    }
  }
  return null;
}

export function getDistrictAt(x: number, z: number): string {
  const mall = getMallAt(x, z);
  if (mall) return mall.name;

  const bridge = getBridgeElevationAt(x, z);
  if (bridge.onBridge && bridge.bridge) {
    return bridge.bridge.name;
  }
  if (Math.abs(z - -300) < 22) return 'Северное Скоростное Шоссе М-7';
  if (Math.abs(z - 230) < 22) return 'Южное Портовое Шоссе';
  if (Math.abs(x - 170) < 22 && Math.abs(z) > 62) return 'Восточная Магистраль';
  if (Math.abs(x - PARK_CENTER.x) < 32 && Math.abs(z - PARK_CENTER.z) < 28) {
    return 'Центральный Парк';
  }
  if (Math.abs(x - GAS_STATION_CENTER.x) < 32 && Math.abs(z - GAS_STATION_CENTER.z) < 26) {
    return 'АЗС «НЕО-ОЙЛ»';
  }
  if (z < WATER_Z_MIN) {
    if (Math.abs(x) < 120 && z > -240) return 'Торговый Центр (Даунтаун)';
    if (x < -120) return 'Западная Деловая Набережная';
    if (z <= -320) return 'Северные Небоскрёбы и Пригород';
    return 'Северный Финансовый Квартал';
  }
  if (z > WATER_Z_MAX) {
    if (x >= 90 && x <= 250 && z < 150) return 'Контейнерный Порт';
    if (x < 0) return 'Южный Мега-Молл и Доки';
    return 'Промзона и Терминалы';
  }
  return 'Залив Нео-Мегаполиса';
}

export function getBridgeGuardrailCollision(
  x: number,
  z: number,
  y: number,
  radius: number
): { hit: boolean; pushX: number; normalX: number } {
  for (const bridge of BRIDGES) {
    if (z >= bridge.zStart + 5 && z <= bridge.zEnd - 5) {
      const deckH = getBridgeElevationAt(bridge.centerX, z).height;
      if (deckH < 0.45 || y < deckH - 0.9) continue;
      const halfW = bridge.deckWidth * 0.5 - 0.6;
      const dx = x - bridge.centerX;
      if (Math.abs(dx) <= bridge.deckWidth * 0.5 + 0.5) {
        if (dx > halfW - radius && dx < halfW + 1.2) {
          return { hit: true, pushX: bridge.centerX + halfW - radius, normalX: -1 };
        }
        if (dx < -halfW + radius && dx > -halfW - 1.2) {
          return { hit: true, pushX: bridge.centerX - halfW + radius, normalX: 1 };
        }
      }
    }
  }
  return { hit: false, pushX: x, normalX: 0 };
}

/** Resolve circle against all static building/wall/container/pylon AABBs and tree/bush/furniture circles */
export function resolveStaticCollisions(
  x: number,
  z: number,
  y: number,
  radius: number,
  colliders: StaticAABB[] = CITY_BUILDINGS,
  circleColliders: StaticCircle[] = colliders === CITY_BUILDINGS ? CITY_CIRCLES : []
): { x: number; z: number; hit: boolean; normalX: number; normalZ: number; penetration: number } {
  let outX = x;
  let outZ = z;
  let anyHit = false;
  let bestNormalX = 0;
  let bestNormalZ = 0;
  let maxPen = 0;

  const checkBox = (b: StaticAABB) => {
    if (y > b.height) return;
    if (
      outX + radius < b.minX ||
      outX - radius > b.maxX ||
      outZ + radius < b.minZ ||
      outZ - radius > b.maxZ
    ) {
      return;
    }

    const closestX = Math.max(b.minX, Math.min(outX, b.maxX));
    const closestZ = Math.max(b.minZ, Math.min(outZ, b.maxZ));
    const dx = outX - closestX;
    const dz = outZ - closestZ;
    const distSq = dx * dx + dz * dz;

    if (distSq < radius * radius) {
      anyHit = true;
      if (distSq > 1e-6) {
        const dist = Math.sqrt(distSq);
        const pen = radius - dist;
        const nx = dx / dist;
        const nz = dz / dist;
        outX += nx * pen;
        outZ += nz * pen;
        if (pen > maxPen) {
          maxPen = pen;
          bestNormalX = nx;
          bestNormalZ = nz;
        }
      } else {
        const dLeft = Math.abs(outX - b.minX);
        const dRight = Math.abs(b.maxX - outX);
        const dTop = Math.abs(outZ - b.minZ);
        const dBot = Math.abs(b.maxZ - outZ);
        const minEdge = Math.min(dLeft, dRight, dTop, dBot);
        if (minEdge === dLeft) {
          outX = b.minX - radius;
          bestNormalX = -1;
          bestNormalZ = 0;
        } else if (minEdge === dRight) {
          outX = b.maxX + radius;
          bestNormalX = 1;
          bestNormalZ = 0;
        } else if (minEdge === dTop) {
          outZ = b.minZ - radius;
          bestNormalX = 0;
          bestNormalZ = -1;
        } else {
          outZ = b.maxZ + radius;
          bestNormalX = 0;
          bestNormalZ = 1;
        }
        maxPen = minEdge + radius;
      }
    }
  };

  const checkCircle = (c: StaticCircle) => {
    if (y > c.height) return;
    const minDist = radius + c.radius;
    const dx = outX - c.x;
    const dz = outZ - c.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < minDist * minDist) {
      anyHit = true;
      const dist = distSq > 1e-6 ? Math.sqrt(distSq) : 0.001;
      const nx = distSq > 1e-6 ? dx / dist : 1;
      const nz = distSq > 1e-6 ? dz / dist : 0;
      const pen = minDist - dist;
      outX += nx * pen;
      outZ += nz * pen;
      if (pen > maxPen) {
        maxPen = pen;
        bestNormalX = nx;
        bestNormalZ = nz;
      }
    }
  };

  if (colliders === CITY_BUILDINGS && circleColliders === CITY_CIRCLES) {
    const pad = radius + 2.0;
    const cMin = worldToChunkCoord(outX - pad, outZ - pad);
    const cMax = worldToChunkCoord(outX + pad, outZ + pad);
    const token = ++CITY_SPATIAL_INDEX.stampToken;

    for (let cx = cMin.cx; cx <= cMax.cx; cx++) {
      for (let cz = cMin.cz; cz <= cMax.cz; cz++) {
        const cellIdx = cx * CHUNK_GRID_COUNT + cz;
        const bList = CITY_SPATIAL_INDEX.buildingsByCell[cellIdx];
        for (let i = 0; i < bList.length; i++) {
          const idx = bList[i];
          if (CITY_SPATIAL_INDEX.buildingStamp[idx] === token) continue;
          CITY_SPATIAL_INDEX.buildingStamp[idx] = token;
          checkBox(CITY_BUILDINGS[idx]);
        }
        const cList = CITY_SPATIAL_INDEX.circlesByCell[cellIdx];
        for (let i = 0; i < cList.length; i++) {
          const idx = cList[i];
          if (CITY_SPATIAL_INDEX.circleStamp[idx] === token) continue;
          CITY_SPATIAL_INDEX.circleStamp[idx] = token;
          checkCircle(CITY_CIRCLES[idx]);
        }
      }
    }
  } else {
    for (let i = 0; i < colliders.length; i++) {
      checkBox(colliders[i]);
    }
    for (let i = 0; i < circleColliders.length; i++) {
      checkCircle(circleColliders[i]);
    }
  }

  return {
    x: outX,
    z: outZ,
    hit: anyHit,
    normalX: bestNormalX,
    normalZ: bestNormalZ,
    penetration: maxPen,
  };
}

/**
 * Resolves solid physical hull collisions against floating ships in the bay!
 */
export function resolveShipCollisions(
  x: number,
  z: number,
  y: number,
  radius: number,
  ships: ReadonlyArray<{ x: number; z: number; length: number; width: number; hullHeight: number }>
): { x: number; z: number; hit: boolean; normalX: number; normalZ: number } {
  let outX = x;
  let outZ = z;
  let anyHit = false;
  let bestNx = 0;
  let bestNz = 0;

  // Ships sail East-West along X, so hull AABB half-extents are (length/2, width/2)
  for (let i = 0; i < ships.length; i++) {
    const s = ships[i];
    if (y > s.hullHeight + 1.2) continue;
    const hx = s.length * 0.5;
    const hz = s.width * 0.5;
    const minX = s.x - hx;
    const maxX = s.x + hx;
    const minZ = s.z - hz;
    const maxZ = s.z + hz;

    if (outX + radius < minX || outX - radius > maxX || outZ + radius < minZ || outZ - radius > maxZ) {
      continue;
    }

    const cx = Math.max(minX, Math.min(outX, maxX));
    const cz = Math.max(minZ, Math.min(outZ, maxZ));
    const dx = outX - cx;
    const dz = outZ - cz;
    const dSq = dx * dx + dz * dz;
    if (dSq < radius * radius) {
      anyHit = true;
      if (dSq > 1e-6) {
        const d = Math.sqrt(dSq);
        const pen = radius - d;
        const nx = dx / d;
        const nz = dz / d;
        outX += nx * pen;
        outZ += nz * pen;
        bestNx = nx;
        bestNz = nz;
      } else {
        const dTop = Math.abs(outZ - minZ);
        const dBot = Math.abs(maxZ - outZ);
        if (dTop < dBot) {
          outZ = minZ - radius;
          bestNx = 0;
          bestNz = -1;
        } else {
          outZ = maxZ + radius;
          bestNx = 0;
          bestNz = 1;
        }
      }
    }
  }

  return { x: outX, z: outZ, hit: anyHit, normalX: bestNx, normalZ: bestNz };
}

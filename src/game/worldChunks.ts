import type { StaticAABB, StaticCircle } from './types';

export const CHUNK_WORLD_HALF = 540;
export const CHUNK_SIZE = 135; // 1080 / 135 = 8 chunks per axis (64 chunks total)
export const CHUNK_GRID_COUNT = Math.round((CHUNK_WORLD_HALF * 2) / CHUNK_SIZE);

export const DEFAULT_LOAD_RADIUS_CHUNKS = 2;
export const DEFAULT_UNLOAD_RADIUS_CHUNKS = 3;

export interface ChunkCoord {
  cx: number;
  cz: number;
}

export interface ChunkBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  centerX: number;
  centerZ: number;
}

export interface StreamingChunkPlan {
  wantedKeys: Set<string>;
  toLoad: Array<{ key: string; cx: number; cz: number; distSq: number }>;
  toUnload: string[];
}

export function clampChunkIndex(idx: number): number {
  return Math.max(0, Math.min(CHUNK_GRID_COUNT - 1, idx));
}

export function worldToChunkCoord(x: number, z: number): ChunkCoord {
  const rawX = Math.floor((x + CHUNK_WORLD_HALF) / CHUNK_SIZE);
  const rawZ = Math.floor((z + CHUNK_WORLD_HALF) / CHUNK_SIZE);
  return {
    cx: clampChunkIndex(rawX),
    cz: clampChunkIndex(rawZ),
  };
}

export function getChunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export function parseChunkKey(key: string): ChunkCoord {
  const [sx, sz] = key.split(',');
  return {
    cx: Number(sx),
    cz: Number(sz),
  };
}

export function getChunkBounds(cx: number, cz: number): ChunkBounds {
  const minX = -CHUNK_WORLD_HALF + cx * CHUNK_SIZE;
  const maxX = minX + CHUNK_SIZE;
  const minZ = -CHUNK_WORLD_HALF + cz * CHUNK_SIZE;
  const maxZ = minZ + CHUNK_SIZE;
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    centerX: (minX + maxX) * 0.5,
    centerZ: (minZ + maxZ) * 0.5,
  };
}

/**
 * Computes which map chunks should stream in (sorted nearest-first with forward lookahead
 * along the car's heading) and which distant chunks should unload with hysteresis.
 */
export function getStreamingChunkPlan(
  playerX: number,
  playerZ: number,
  heading: number,
  loadedKeys: ReadonlySet<string> | ReadonlyMap<string, unknown>,
  loadRadius = DEFAULT_LOAD_RADIUS_CHUNKS,
  unloadRadius = DEFAULT_UNLOAD_RADIUS_CHUNKS
): StreamingChunkPlan {
  const pChunk = worldToChunkCoord(playerX, playerZ);
  const fx = -Math.sin(heading);
  const fz = -Math.cos(heading);
  const lookX = playerX + fx * (CHUNK_SIZE * 0.85);
  const lookZ = playerZ + fz * (CHUNK_SIZE * 0.85);
  const lChunk = worldToChunkCoord(lookX, lookZ);

  const wantedKeys = new Set<string>();
  const toLoad: Array<{ key: string; cx: number; cz: number; distSq: number }> = [];

  for (let cx = 0; cx < CHUNK_GRID_COUNT; cx++) {
    for (let cz = 0; cz < CHUNK_GRID_COUNT; cz++) {
      const distPlayerChunks = Math.hypot(cx - pChunk.cx, cz - pChunk.cz);
      const distLookChunks = Math.hypot(cx - lChunk.cx, cz - lChunk.cz);
      const isWanted = distPlayerChunks <= loadRadius + 0.35 || distLookChunks <= 1.45;
      if (!isWanted) continue;

      const key = getChunkKey(cx, cz);
      wantedKeys.add(key);

      if (!loadedKeys.has(key)) {
        const bounds = getChunkBounds(cx, cz);
        const dx = bounds.centerX - playerX;
        const dz = bounds.centerZ - playerZ;
        // Current chunk under player always builds first, then lookahead chunks along heading
        const isCurrent = cx === pChunk.cx && cz === pChunk.cz;
        const forwardBias = (dx * fx + dz * fz) * 28;
        const distSq = isCurrent ? -1e9 : dx * dx + dz * dz - forwardBias;
        toLoad.push({ key, cx, cz, distSq });
      }
    }
  }

  toLoad.sort((a, b) => a.distSq - b.distSq);

  const toUnload: string[] = [];
  for (const key of loadedKeys.keys()) {
    if (wantedKeys.has(key)) continue;
    const { cx, cz } = parseChunkKey(key);
    const distPlayerChunks = Math.hypot(cx - pChunk.cx, cz - pChunk.cz);
    const distLookChunks = Math.hypot(cx - lChunk.cx, cz - lChunk.cz);
    if (distPlayerChunks > unloadRadius + 0.35 && distLookChunks > 2.2) {
      toUnload.push(key);
    }
  }

  return { wantedKeys, toLoad, toUnload };
}

export interface SpatialColliderIndex {
  buildingsByCell: number[][];
  circlesByCell: number[][];
  buildingStamp: Int32Array;
  circleStamp: Int32Array;
  stampToken: number;
}

/**
 * Spatial hash grid partitioned by CHUNK_SIZE for O(1) static collision queries.
 */
export function buildSpatialColliderIndex(
  buildings: ReadonlyArray<StaticAABB>,
  circles: ReadonlyArray<StaticCircle>
): SpatialColliderIndex {
  const totalCells = CHUNK_GRID_COUNT * CHUNK_GRID_COUNT;
  const buildingsByCell: number[][] = Array.from({ length: totalCells }, () => []);
  const circlesByCell: number[][] = Array.from({ length: totalCells }, () => []);

  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    const cMin = worldToChunkCoord(b.minX, b.minZ);
    const cMax = worldToChunkCoord(b.maxX, b.maxZ);
    for (let cx = cMin.cx; cx <= cMax.cx; cx++) {
      for (let cz = cMin.cz; cz <= cMax.cz; cz++) {
        buildingsByCell[cx * CHUNK_GRID_COUNT + cz].push(i);
      }
    }
  }

  for (let i = 0; i < circles.length; i++) {
    const c = circles[i];
    const cMin = worldToChunkCoord(c.x - c.radius, c.z - c.radius);
    const cMax = worldToChunkCoord(c.x + c.radius, c.z + c.radius);
    for (let cx = cMin.cx; cx <= cMax.cx; cx++) {
      for (let cz = cMin.cz; cz <= cMax.cz; cz++) {
        circlesByCell[cx * CHUNK_GRID_COUNT + cz].push(i);
      }
    }
  }

  return {
    buildingsByCell,
    circlesByCell,
    buildingStamp: new Int32Array(buildings.length),
    circleStamp: new Int32Array(circles.length),
    stampToken: 0,
  };
}

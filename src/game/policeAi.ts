import type { VehicleControlInput } from './physics';

export interface PursuitAiState {
  reverseTimer: number;
  reverseSteer: number;
  stuckTimer: number;
}

export interface PursuitControlParams {
  x: number;
  y: number;
  z: number;
  heading: number;
  vx: number;
  vz: number;
  halfWidth: number;
  halfLength: number;
  targetX: number;
  targetZ: number;
  desiredSpeed: number;
  dt: number;
  ai: PursuitAiState;
  /** Returns true if a circle centered at (px, pz) with given radius overlaps a wall, pole, tree, water, or other car */
  isBlocked: (px: number, pz: number, radius: number) => boolean;
}

function wrapAngle(a: number): number {
  let out = a;
  while (out > Math.PI) out -= Math.PI * 2;
  while (out < -Math.PI) out += Math.PI * 2;
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function probeClear(
  x: number,
  z: number,
  heading: number,
  dist: number,
  radius: number,
  isBlocked: (px: number, pz: number, r: number) => boolean
): boolean {
  const px = x - Math.sin(heading) * dist;
  const pz = z - Math.cos(heading) * dist;
  return !isBlocked(px, pz, radius);
}

/**
 * Computes obstacle-aware steering + automatic reverse-escape maneuvers for police cruisers
 * and pursuing NPC drivers so they steer cleanly around buildings, trees, water, and cars,
 * and back out when nose-blocked or pinned.
 */
export function computeSmartPursuitControl(params: PursuitControlParams): VehicleControlInput {
  const {
    x,
    z,
    heading,
    vx,
    vz,
    halfWidth,
    halfLength,
    targetX,
    targetZ,
    desiredSpeed,
    dt,
    ai,
    isBlocked,
  } = params;

  const dx = targetX - x;
  const dz = targetZ - z;
  const distToTarget = Math.hypot(dx, dz);
  const currentSpeed = Math.hypot(vx, vz);
  const fx = -Math.sin(heading);
  const fz = -Math.cos(heading);
  const forwardSpeed = vx * fx + vz * fz;

  const probeRadius = Math.max(0.85, halfWidth * 0.92);
  const closeNoseDist = halfLength + 1.35;
  const rearProbeDist = halfLength + 1.45;
  const midProbeDist = Math.max(5.5, halfLength + 3.4);
  const farProbeDist = Math.max(11.5, halfLength + 8.5);

  const noseBlocked = !probeClear(x, z, heading, closeNoseDist, probeRadius, isBlocked);
  const leftCornerBlocked = !probeClear(x, z, heading + 0.34, closeNoseDist + 0.3, probeRadius * 0.85, isBlocked);
  const rightCornerBlocked = !probeClear(x, z, heading - 0.34, closeNoseDist + 0.3, probeRadius * 0.85, isBlocked);
  const rearBlocked = !probeClear(x, z, heading + Math.PI, rearProbeDist, probeRadius, isBlocked);

  const pickReverseSteer = (): number => {
    // Steer the rear away from the blocked front side so the nose swings toward open space.
    // Note: in our vehicle kinematics, positive steer while reversing rotates heading right (away from left obstacle).
    if (leftCornerBlocked && !rightCornerBlocked) return 0.95;
    if (rightCornerBlocked && !leftCornerBlocked) return -0.95;

    const rearLeftClear = probeClear(x, z, heading + Math.PI - 0.45, rearProbeDist + 1.5, probeRadius, isBlocked);
    const rearRightClear = probeClear(x, z, heading + Math.PI + 0.45, rearProbeDist + 1.5, probeRadius, isBlocked);
    if (rearLeftClear && !rearRightClear) return -0.9;
    if (rearRightClear && !rearLeftClear) return 0.9;

    const directTargetHeading = Math.atan2(-dx, -dz);
    const targetDiff = wrapAngle(directTargetHeading - heading);
    // Swing nose toward target side when reversing
    return targetDiff >= 0 ? -0.85 : 0.85;
  };

  // 1. Continue active reverse-escape maneuver if ongoing
  if (ai.reverseTimer > 0) {
    ai.reverseTimer = Math.max(0, ai.reverseTimer - dt);
    if (rearBlocked) {
      // Stop reversing if an obstacle is directly behind us; pivot forward instead
      ai.reverseTimer = 0;
      ai.stuckTimer = 0;
    } else {
      return {
        throttle: -0.86,
        steer: ai.reverseSteer,
        handbrake: false,
        nitro: false,
      };
    }
  }

  // 2. Detect trapped / nose-blocked condition when trying to pursue a non-adjacent target
  const tryingToAdvance = distToTarget > 4.2;
  if (tryingToAdvance && noseBlocked && forwardSpeed < 4.5 && !rearBlocked) {
    ai.reverseTimer = 1.05;
    ai.reverseSteer = pickReverseSteer();
    ai.stuckTimer = 0;
    return {
      throttle: -0.86,
      steer: ai.reverseSteer,
      handbrake: false,
      nitro: false,
    };
  }

  if (tryingToAdvance && currentSpeed < 1.35) {
    ai.stuckTimer += dt;
    if (ai.stuckTimer > 0.55 && !rearBlocked) {
      ai.reverseTimer = 1.15;
      ai.reverseSteer = pickReverseSteer();
      ai.stuckTimer = 0;
      return {
        throttle: -0.88,
        steer: ai.reverseSteer,
        handbrake: false,
        nitro: false,
      };
    }
  } else {
    ai.stuckTimer = Math.max(0, ai.stuckTimer - dt * 2.5);
  }

  // 3. Multi-ray forward obstacle avoidance (checks close, mid & far corridors around current heading & target heading)
  const targetHeading = Math.atan2(-dx, -dz);
  const directDiff = wrapAngle(targetHeading - heading);

  const isRayClear = (candHeading: number): boolean => {
    const c1 = probeClear(x, z, candHeading, closeNoseDist + 0.5, probeRadius * 0.9, isBlocked);
    if (!c1) return false;
    const c2 = probeClear(x, z, candHeading, midProbeDist, probeRadius, isBlocked);
    if (!c2) return false;
    const c3 = probeClear(x, z, candHeading, Math.min(farProbeDist, Math.max(midProbeDist, distToTarget)), probeRadius, isBlocked);
    return c3;
  };

  let chosenHeading = targetHeading;
  if (!isRayClear(targetHeading)) {
    // Test symmetric deflection angles biased toward the smaller turn from current heading
    const candOffsets = [0.35, -0.35, 0.72, -0.72, 1.08, -1.08, 1.45, -1.45];
    let bestHeading: number | null = null;
    let bestScore = Infinity;

    for (const off of candOffsets) {
      const candH = targetHeading + off;
      if (isRayClear(candH)) {
        const turnCost = Math.abs(wrapAngle(candH - heading)) * 0.55;
        const targetCost = Math.abs(off);
        const score = targetCost + turnCost;
        if (score < bestScore) {
          bestScore = score;
          bestHeading = candH;
        }
      }
    }

    if (bestHeading !== null) {
      chosenHeading = bestHeading;
    } else {
      // Mid-range partial escape: test shorter mid-probe only
      for (const off of candOffsets) {
        const candH = heading + off;
        if (
          probeClear(x, z, candH, closeNoseDist + 0.4, probeRadius * 0.85, isBlocked) &&
          probeClear(x, z, candH, midProbeDist, probeRadius * 0.9, isBlocked)
        ) {
          chosenHeading = candH;
          break;
        }
      }
      // If every forward ray is still blocked and rear is clear, reverse immediately
      if (chosenHeading === targetHeading && (leftCornerBlocked || rightCornerBlocked) && !rearBlocked) {
        ai.reverseTimer = 0.95;
        ai.reverseSteer = pickReverseSteer();
        return {
          throttle: -0.84,
          steer: ai.reverseSteer,
          handbrake: false,
          nitro: false,
        };
      }
    }
  }

  const steerDiff = wrapAngle(chosenHeading - heading);
  const absDiff = Math.abs(steerDiff);

  // Cornering speed control so police don't understeer wide into buildings
  const cornerSpeedCap =
    absDiff > 1.1 ? 7.5 : absDiff > 0.65 ? Math.min(desiredSpeed, 12.5) : desiredSpeed;
  const effectiveSpeed = Math.min(desiredSpeed, cornerSpeedCap);

  const shouldBrake =
    distToTarget < 3.5 || (absDiff > 1.25 && currentSpeed > 8.5) || (Math.abs(directDiff) > 1.55 && currentSpeed > 13);

  const throttle = shouldBrake
    ? currentSpeed > 1.5
      ? -0.75
      : 0
    : currentSpeed < effectiveSpeed
    ? 0.85
    : 0.08;

  return {
    throttle,
    steer: clamp(steerDiff * 2.15, -1, 1),
    handbrake: distToTarget < 2.8 && currentSpeed < 2.2,
    nitro: false,
  };
}

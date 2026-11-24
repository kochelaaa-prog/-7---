import type { CarModelId, CarSpec, DamageZones } from './types';
import {
  getBridgeElevationAt,
  getBridgeGuardrailCollision,
  getGroundHeightAt,
  isOverWater,
  resolveRampAndBridgeWallCollisions,
  resolveStaticCollisions,
  WATER_LEVEL,
  WORLD_HALF_SIZE,
} from './worldLayout';

export const CAR_SPECS: Record<CarModelId, CarSpec> = {
  viper: {
    id: 'viper',
    name: 'Viper GT-X',
    category: 'Спорткар',
    length: 4.5,
    width: 2.0,
    height: 1.24,
    wheelBase: 2.7,
    trackWidth: 1.72,
    wheelRadius: 0.36,
    mass: 1350,
    maxEngineForce: 36,
    maxSpeedKmh: 255,
    grip: 9.2,
    driftFactor: 0.38,
    suspensionStiffness: 18,
    defaultColor: 0xe11d48, // crimson red
  },
  dominator: {
    id: 'dominator',
    name: 'Dominator V8',
    category: 'Маслкар',
    length: 4.75,
    width: 2.08,
    height: 1.36,
    wheelBase: 2.82,
    trackWidth: 1.78,
    wheelRadius: 0.39,
    mass: 1620,
    maxEngineForce: 33,
    maxSpeedKmh: 230,
    grip: 7.4,
    driftFactor: 0.28,
    suspensionStiffness: 15,
    defaultColor: 0xf59e0b, // amber muscle
  },
  titan: {
    id: 'titan',
    name: 'Titan 4x4',
    category: 'Внедорожник',
    length: 4.95,
    width: 2.18,
    height: 1.82,
    wheelBase: 2.95,
    trackWidth: 1.88,
    wheelRadius: 0.46,
    mass: 2450,
    maxEngineForce: 28,
    maxSpeedKmh: 185,
    grip: 8.4,
    driftFactor: 0.42,
    suspensionStiffness: 12,
    defaultColor: 0x334155, // tactical slate
  },
  cruiser: {
    id: 'cruiser',
    name: 'Metro Cruiser',
    category: 'Седан',
    length: 4.55,
    width: 1.94,
    height: 1.44,
    wheelBase: 2.72,
    trackWidth: 1.66,
    wheelRadius: 0.36,
    mass: 1480,
    maxEngineForce: 26,
    maxSpeedKmh: 190,
    grip: 8.6,
    driftFactor: 0.44,
    suspensionStiffness: 14,
    defaultColor: 0xfacc15, // taxi yellow
    isTaxi: true,
  },
  truck: {
    id: 'truck',
    name: 'Titan Hauler 8x4',
    category: 'Грузовик',
    length: 7.4,
    width: 2.48,
    height: 3.15,
    wheelBase: 4.45,
    trackWidth: 2.06,
    wheelRadius: 0.54,
    mass: 4600,
    maxEngineForce: 22,
    maxSpeedKmh: 138,
    grip: 7.2,
    driftFactor: 0.55,
    suspensionStiffness: 11,
    defaultColor: 0x0284c7, // commercial hauler blue
    isTruck: true,
  },
};

export interface VehiclePhysicsState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  heading: number; // rad around Y; 0 = -Z (North)
  angularVel: number;
  steerAngle: number;
  wheelSpin: number;
  pitch: number; // suspension dive/squat
  roll: number;  // body roll in corners
  terrainPitch: number; // road/bridge/ramp longitudinal slope
  terrainRoll: number;  // road/ramp lateral tilt
  sagPitch: number;     // collapsed front/rear suspension pitch
  sagRoll: number;      // collapsed left/right suspension roll
  rideHeightOffset: number; // lowered ride height from blown shocks
  wheelCamber: [number, number, number, number]; // FL, FR, RL, RR bent camber angles
  pitchVel: number;
  rollVel: number;
  grounded: boolean;
  waterTimer: number; // seconds submerged in deep water
  nitro: number; // 0..100
  integrity: number; // 0..100
  zones: DamageZones;
  detachedParts: {
    frontBumper: boolean;
    rearBumper: boolean;
    hood: boolean;
    spoiler: boolean;
    leftDoor: boolean;
    rightDoor: boolean;
    leftHeadlightBroken: boolean;
    rightHeadlightBroken: boolean;
    windshieldCracked: boolean;
  };
  spec: CarSpec;
}

export interface VehicleControlInput {
  throttle: number; // -1..1 (1 forward, -1 brake/reverse)
  steer: number;    // -1..1 (+1 left, -1 right)
  handbrake: boolean;
  nitro: boolean;
}

export interface ImpactEvent {
  worldX: number;
  worldY: number;
  worldZ: number;
  localX: number;
  localZ: number;
  normalX: number;
  normalZ: number;
  impulseSpeed: number; // m/s
  newlyDetached: string[];
}

export function createDefaultDamageZones(): DamageZones {
  return {
    frontLeft: 0,
    frontRight: 0,
    rearLeft: 0,
    rearRight: 0,
    leftSide: 0,
    rightSide: 0,
  };
}

export function createVehicleState(spec: CarSpec, x: number, z: number, heading: number): VehiclePhysicsState {
  const y = getGroundHeightAt(x, z);
  return {
    x,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    heading,
    angularVel: 0,
    steerAngle: 0,
    wheelSpin: 0,
    pitch: 0,
    roll: 0,
    terrainPitch: 0,
    terrainRoll: 0,
    sagPitch: 0,
    sagRoll: 0,
    rideHeightOffset: 0,
    wheelCamber: [0, 0, 0, 0],
    pitchVel: 0,
    rollVel: 0,
    grounded: true,
    waterTimer: 0,
    nitro: 100,
    integrity: 100,
    zones: createDefaultDamageZones(),
    detachedParts: {
      frontBumper: false,
      rearBumper: false,
      hood: false,
      spoiler: false,
      leftDoor: false,
      rightDoor: false,
      leftHeadlightBroken: false,
      rightHeadlightBroken: false,
      windshieldCracked: false,
    },
    spec,
  };
}

/** Computes car forward and right basis vectors in XZ plane */
export function getCarBasis(heading: number) {
  const fx = -Math.sin(heading);
  const fz = -Math.cos(heading);
  const rx = Math.cos(heading);
  const rz = -Math.sin(heading);
  return { fx, fz, rx, rz };
}

/** Compute overall structural integrity (0..100) from the 6 zones */
export function computeIntegrity(zones: DamageZones): number {
  const avg =
    (zones.frontLeft +
      zones.frontRight +
      zones.rearLeft +
      zones.rearRight +
      zones.leftSide +
      zones.rightSide) /
    6;
  return Math.max(0, Math.round((1 - avg) * 100));
}

/**
 * Applies a crash impulse at a world-space contact normal to the vehicle,
 * updating damage zones, triggering detachable body panels, and returning an ImpactEvent.
 */
export function applyVehicleImpact(
  car: VehiclePhysicsState,
  worldNormalX: number,
  worldNormalZ: number,
  impulseSpeed: number,
  contactOffsetX = 0,
  contactOffsetZ = 0
): ImpactEvent | null {
  if (impulseSpeed < 1.4) return null;

  const { fx, fz, rx, rz } = getCarBasis(car.heading);
  // Transform incoming impact direction (opposite of push normal) into car-local coordinates
  const hitDirX = -worldNormalX;
  const hitDirZ = -worldNormalZ;
  const localHitX = hitDirX * rx + hitDirZ * rz + contactOffsetX * 0.25;
  const localHitZ = -(hitDirX * fx + hitDirZ * fz) + contactOffsetZ * 0.25;
  // Note: car local -Z is front, +Z is rear, -X is left, +X is right.

  const damageDelta = Math.min(0.65, Math.max(0.018, (impulseSpeed - 1.2) * 0.022));
  const z = car.zones;

  const isFront = localHitZ < -0.2;
  const isRear = localHitZ > 0.2;
  const isLeft = localHitX < -0.15;
  const isRight = localHitX > 0.15;

  if (isFront) {
    if (isLeft) z.frontLeft = Math.min(1, z.frontLeft + damageDelta);
    else if (isRight) z.frontRight = Math.min(1, z.frontRight + damageDelta);
    else {
      z.frontLeft = Math.min(1, z.frontLeft + damageDelta * 0.85);
      z.frontRight = Math.min(1, z.frontRight + damageDelta * 0.85);
    }
  } else if (isRear) {
    if (isLeft) z.rearLeft = Math.min(1, z.rearLeft + damageDelta);
    else if (isRight) z.rearRight = Math.min(1, z.rearRight + damageDelta);
    else {
      z.rearLeft = Math.min(1, z.rearLeft + damageDelta * 0.85);
      z.rearRight = Math.min(1, z.rearRight + damageDelta * 0.85);
    }
  } else {
    if (localHitX < 0) z.leftSide = Math.min(1, z.leftSide + damageDelta);
    else z.rightSide = Math.min(1, z.rightSide + damageDelta);
  }

  car.integrity = computeIntegrity(z);

  const newlyDetached: string[] = [];
  const d = car.detachedParts;
  const frontAvg = (z.frontLeft + z.frontRight) * 0.5;
  const rearAvg = (z.rearLeft + z.rearRight) * 0.5;

  if (!d.leftHeadlightBroken && z.frontLeft > 0.26) {
    d.leftHeadlightBroken = true;
  }
  if (!d.rightHeadlightBroken && z.frontRight > 0.26) {
    d.rightHeadlightBroken = true;
  }
  if (!d.windshieldCracked && frontAvg > 0.35) {
    d.windshieldCracked = true;
  }
  if (!d.frontBumper && frontAvg > 0.32) {
    d.frontBumper = true;
    newlyDetached.push('frontBumper');
  }
  if (!d.hood && frontAvg > 0.58) {
    d.hood = true;
    newlyDetached.push('hood');
  }
  if (!d.rearBumper && rearAvg > 0.34) {
    d.rearBumper = true;
    newlyDetached.push('rearBumper');
  }
  if (!d.spoiler && rearAvg > 0.55) {
    d.spoiler = true;
    newlyDetached.push('spoiler');
  }
  if (!d.leftDoor && z.leftSide > 0.52) {
    d.leftDoor = true;
    newlyDetached.push('leftDoor');
  }
  if (!d.rightDoor && z.rightSide > 0.52) {
    d.rightDoor = true;
    newlyDetached.push('rightDoor');
  }

  // Approximate local contact coordinates on car perimeter
  const localX = Math.max(-car.spec.width * 0.5, Math.min(car.spec.width * 0.5, localHitX * car.spec.width * 0.5));
  const localZ = Math.max(-car.spec.length * 0.5, Math.min(car.spec.length * 0.5, localHitZ * car.spec.length * 0.5));

  return {
    worldX: car.x + localX * rx - localZ * fx,
    worldY: car.y + 0.65,
    worldZ: car.z + localX * rz - localZ * fz,
    localX,
    localZ,
    normalX: worldNormalX,
    normalZ: worldNormalZ,
    impulseSpeed,
    newlyDetached,
  };
}

/**
 * Step a single vehicle's physics for `dt` seconds.
 * Returns any high-energy ImpactEvent produced by building/guardrail collisions.
 */
export function stepVehiclePhysics(
  car: VehiclePhysicsState,
  input: VehicleControlInput,
  dt: number
): { impacts: ImpactEvent[]; lateralSlip: number; submerged: boolean } {
  if (dt > 0.025) {
    const halfDt = dt * 0.5;
    const r1 = stepVehiclePhysics(car, input, halfDt);
    const r2 = stepVehiclePhysics(car, input, halfDt);
    if (r1.impacts.length > 0 && r2.impacts.length > 0) {
      r2.impacts.unshift(...r1.impacts);
    } else if (r1.impacts.length > 0) {
      return { impacts: r1.impacts, lateralSlip: r2.lateralSlip, submerged: r2.submerged };
    }
    return r2;
  }

  const impacts: ImpactEvent[] = [];
  const { spec } = car;
  const { fx, fz, rx, rz } = getCarBasis(car.heading);

  // Decompose current world velocity into car-local forward and lateral components
  let forwardSpeed = car.vx * fx + car.vz * fz;
  let lateralSpeed = car.vx * rx + car.vz * rz;

  // Corner & structural damage calculations
  const z = car.zones;
  const frontAvg = (z.frontLeft + z.frontRight) * 0.5;
  const rearAvg = (z.rearLeft + z.rearRight) * 0.5;
  const leftAvg = (z.frontLeft + z.rearLeft + z.leftSide) / 3;
  const rightAvg = (z.frontRight + z.rearRight + z.rightSide) / 3;

  // Engine, speed, steering, grip & suspension degradation from crash damage
  const engineHealth = Math.max(0.15, (car.integrity / 100) * (1 - frontAvg * 0.42));
  const sputter = car.integrity < 38 ? 0.72 + 0.28 * Math.sin(car.wheelSpin * 0.45) : 1.0;
  const healthFactor = (0.34 + 0.66 * engineHealth) * sputter;
  const alignmentPull = (z.frontLeft - z.frontRight) * 0.24 + (z.leftSide - z.rightSide) * 0.1;
  const effectiveStiffness = spec.suspensionStiffness * (0.35 + 0.65 * (car.integrity / 100));

  car.sagRoll = (leftAvg - rightAvg) * 0.14;
  car.sagPitch = (rearAvg - frontAvg) * 0.08;
  car.rideHeightOffset = -((z.frontLeft + z.frontRight + z.rearLeft + z.rearRight) * 0.25) * 0.12;
  car.wheelCamber = [
    z.frontLeft * 0.28,
    -z.frontRight * 0.28,
    z.rearLeft * 0.24,
    -z.rearRight * 0.24,
  ];

  // Check if submerged in water (no driving on water!)
  const inWater = isOverWater(car.x, car.z) && car.y <= WATER_LEVEL + 0.35;

  // Steering smoothing & speed sensitivity (wobbles slightly when front axle is damaged)
  const wobble = frontAvg > 0.35 ? Math.sin(car.wheelSpin * 0.7) * frontAvg * 0.05 : 0;
  const targetSteer = inWater
    ? input.steer * 0.25
    : input.steer * 0.58 + (alignmentPull + wobble) * Math.min(1, Math.abs(forwardSpeed) / 10);
  const steerRate = 6.5;
  car.steerAngle += (targetSteer - car.steerAngle) * Math.min(1, steerRate * dt);

  // Nitro consumption & regen
  const usingNitro = !inWater && input.nitro && car.nitro > 1 && input.throttle > 0 && car.integrity > 10;
  if (usingNitro) {
    car.nitro = Math.max(0, car.nitro - 28 * dt);
  } else {
    car.nitro = Math.min(100, car.nitro + 8 * dt);
  }

  const maxSpeedMs =
    (spec.maxSpeedKmh / 3.6) * (0.38 + 0.62 * engineHealth) * (usingNitro ? 1.24 : 1);

  if (inWater) {
    // Hydrodynamic water resistance: car floods, loses traction, and sinks smoothly
    car.waterTimer += dt;
    car.grounded = false;
    forwardSpeed *= Math.exp(-5.0 * dt);
    lateralSpeed *= Math.exp(-5.5 * dt);
    car.angularVel *= Math.exp(-4.0 * dt);
    car.pitch *= Math.exp(-3.0 * dt);
    car.roll *= Math.exp(-3.0 * dt);
    car.terrainPitch += (-0.15 - car.terrainPitch) * Math.min(1, 3.0 * dt);
    car.terrainRoll *= Math.exp(-3.0 * dt);
  } else if (car.grounded) {
    car.waterTimer = 0;
    // Longitudinal engine & braking forces + slope gravity component
    const slopeGravity = -Math.sin(car.terrainPitch) * 9.8;
    let accel = slopeGravity;
    if (input.throttle > 0) {
      const speedRatio = Math.max(0, forwardSpeed / Math.max(1, maxSpeedMs));
      const torqueCurve = Math.max(0.12, 1 - speedRatio * 0.85);
      accel += input.throttle * spec.maxEngineForce * healthFactor * torqueCurve * (usingNitro ? 1.55 : 1);
    } else if (input.throttle < 0) {
      if (forwardSpeed > 1.5) {
        // Braking (weakened slightly when brakes/front are damaged)
        accel += input.throttle * (24 + 10 * (car.integrity / 100));
      } else {
        // Reverse gear
        accel +=
          forwardSpeed > -maxSpeedMs * 0.42
            ? input.throttle * spec.maxEngineForce * 0.55 * healthFactor
            : 0;
      }
    } else {
      // Rolling resistance / engine braking (higher rolling drag on wrecked wheels)
      const damageDrag = 0.65 + (1 - car.integrity / 100) * 0.9;
      accel += -forwardSpeed * damageDrag;
    }

    if (input.handbrake) {
      forwardSpeed *= Math.exp(-3.4 * dt);
    }

    forwardSpeed += accel * dt;
    forwardSpeed = Math.max(-maxSpeedMs * 0.45, Math.min(maxSpeedMs, forwardSpeed));

    // Lateral tire grip (damaged suspension/tires lose cornering grip)
    const gripHealth = 0.45 + 0.55 * (car.integrity / 100);
    const effectiveGrip = (input.handbrake ? spec.grip * spec.driftFactor : spec.grip) * gripHealth;
    lateralSpeed *= Math.exp(-effectiveGrip * dt);

    // Steering yaw moment
    const speedFactor = Math.min(1, Math.abs(forwardSpeed) / 5.5);
    const reverseSign = forwardSpeed >= -0.2 ? 1 : -1;
    const yawRate = car.steerAngle * 2.55 * speedFactor * reverseSign * (input.handbrake ? 1.35 : 1.0);
    car.angularVel += (yawRate - car.angularVel) * Math.min(1, 10 * dt);
    car.heading += car.angularVel * dt;

    // Suspension pitch (squat/dive) and roll (cornering lean), amplified by worn shocks
    const wearAmp = 1 + (1 - car.integrity / 100) * 0.65;
    const targetPitch = Math.max(-0.11, Math.min(0.11, -accel * 0.0022 * wearAmp));
    const targetRoll = Math.max(
      -0.14,
      Math.min(0.14, (lateralSpeed * 0.012 + car.angularVel * forwardSpeed * 0.0022) * wearAmp)
    );
    car.pitch += (targetPitch - car.pitch) * Math.min(1, effectiveStiffness * dt);
    car.roll += (targetRoll - car.roll) * Math.min(1, effectiveStiffness * dt);
  } else {
    // Airborne pitch stabilization
    car.pitch *= Math.exp(-1.5 * dt);
    car.roll *= Math.exp(-1.5 * dt);
    car.terrainPitch += (-0.18 - car.terrainPitch) * Math.min(1, 1.35 * dt);
    car.terrainRoll *= Math.exp(-1.8 * dt);
  }

  // Reconstruct world velocity using updated heading
  const newBasis = getCarBasis(car.heading);
  car.vx = newBasis.fx * forwardSpeed + newBasis.rx * lateralSpeed;
  car.vz = newBasis.fz * forwardSpeed + newBasis.rz * lateralSpeed;

  // Air drag
  car.vx *= Math.exp(-0.12 * dt);
  car.vz *= Math.exp(-0.12 * dt);

  // Wheel rotation
  car.wheelSpin += (forwardSpeed / spec.wheelRadius) * dt;

  // Integrate XZ
  const prevX = car.x;
  const prevZ = car.z;
  const prevGroundY = getGroundHeightAt(prevX, prevZ);
  const prevBridge = getBridgeElevationAt(prevX, prevZ);
  const wasOnBridgeDeck = prevBridge.onBridge && car.y >= prevBridge.height - 1.25;

  car.x += car.vx * dt;
  car.z += car.vz * dt;

  // Solid side walls of bridge embankments (only when approaching from outside/below the deck)
  const colRadius = spec.width * 0.52;
  if (!wasOnBridgeDeck) {
    const wallRes = resolveRampAndBridgeWallCollisions(car.x, car.z, car.y, colRadius, prevX);
    if (wallRes.hit) {
      car.x = wallRes.x;
      car.z = wallRes.z;
      const vn = car.vx * wallRes.normalX + car.vz * wallRes.normalZ;
      if (vn < 0) {
        const impactSpeed = -vn;
        const restitution = 0.26;
        car.vx -= (1 + restitution) * vn * wallRes.normalX;
        car.vz -= (1 + restitution) * vn * wallRes.normalZ;
        car.vx *= 0.85;
        car.vz *= 0.85;
        const evt = applyVehicleImpact(car, wallRes.normalX, wallRes.normalZ, impactSpeed);
        if (evt) impacts.push(evt);
      }
    }
  }

  // Vertical terrain, slope pitch/roll, water buoyancy, & gravity
  let groundY = getGroundHeightAt(car.x, car.z);
  const nowOverWater = isOverWater(car.x, car.z);
  const nowBridge = getBridgeElevationAt(car.x, car.z);
  const climbingSmoothBridge =
    nowBridge.onBridge &&
    ((prevBridge.onBridge && prevBridge.bridge === nowBridge.bridge) || nowBridge.height <= 1.2);

  // Prevent climbing up sheer cliffs (e.g. underwater -> seawall), never blocking smooth bridge ramps
  if (!climbingSmoothBridge && groundY - car.y > 0.72) {
    const pushDx = prevX - car.x;
    const pushDz = prevZ - car.z;
    const pushLen = Math.hypot(pushDx, pushDz);
    const nx = pushLen > 1e-4 ? pushDx / pushLen : -newBasis.fx;
    const nz = pushLen > 1e-4 ? pushDz / pushLen : -newBasis.fz;
    const impactSpeed = Math.hypot(car.vx, car.vz);
    car.x = prevX;
    car.z = prevZ;
    car.vx *= -0.25;
    car.vz *= -0.25;
    groundY = prevGroundY;
    if (impactSpeed > 2.6) {
      const evt = applyVehicleImpact(car, nx, nz, impactSpeed * 0.85);
      if (evt) impacts.push(evt);
    }
  }

  if (nowOverWater && car.y <= WATER_LEVEL + 0.35) {
    // Sink smoothly into water without bouncing off underwater seabed
    const targetSinkY = WATER_LEVEL - 1.35;
    car.vy += (targetSinkY - car.y) * 5.0 * dt - 1.2 * dt;
    car.vy = Math.max(-5.5, Math.min(0.6, car.vy * Math.exp(-3.5 * dt)));
    car.y += car.vy * dt;
    if (car.y < groundY) {
      car.y = groundY;
      car.vy = 0;
    }
    car.grounded = false;
  } else if (car.y <= groundY + 0.14 && car.vy <= 1.2) {
    if (car.grounded && prevGroundY - groundY > 0.65) {
      // Drove off a sheer drop (pier/ledge) -> freefall naturally with forward momentum, NO skyward launch!
      car.vy = Math.min(0, Math.sin(car.terrainPitch) * forwardSpeed);
      car.grounded = false;
    } else {
      // Smoothly planted on road / bridge!
      car.y = groundY;
      car.vy = 0;
      car.grounded = true;
    }
  } else {
    car.vy -= 22.0 * dt; // Gravity
    car.y += car.vy * dt;
    if (car.y <= groundY) {
      const landingImpact = Math.abs(car.vy);
      if (landingImpact > 9.5 && !nowOverWater) {
        const evt = applyVehicleImpact(car, 0, 0, landingImpact * 0.55);
        if (evt) impacts.push(evt);
        car.pitchVel -= 0.25;
      }
      car.y = groundY;
      car.vy = 0;
      car.grounded = !nowOverWater;
    } else {
      car.grounded = false;
    }
  }

  // Sample 4 axle/track contact points for realistic slope pitch & roll on bridges and ramps!
  if (car.grounded && !nowOverWater) {
    const halfWB = spec.wheelBase * 0.5;
    const halfTW = spec.trackWidth * 0.5;
    const frontX = car.x + newBasis.fx * halfWB;
    const frontZ = car.z + newBasis.fz * halfWB;
    const rearX = car.x - newBasis.fx * halfWB;
    const rearZ = car.z - newBasis.fz * halfWB;
    const leftX = car.x - newBasis.rx * halfTW;
    const leftZ = car.z - newBasis.rz * halfTW;
    const rightX = car.x + newBasis.rx * halfTW;
    const rightZ = car.z + newBasis.rz * halfTW;

    const sampleSlopeY = (sx: number, sz: number) => {
      if (isOverWater(sx, sz)) return Math.max(car.y - 0.6, WATER_LEVEL);
      const gy = getGroundHeightAt(sx, sz);
      // Ignore sharp discontinuous drop/wall steps when computing chassis slope
      if (Math.abs(gy - car.y) > 1.25) return car.y;
      return gy;
    };

    const yF = sampleSlopeY(frontX, frontZ);
    const yR = sampleSlopeY(rearX, rearZ);
    const yL = sampleSlopeY(leftX, leftZ);
    const yRgt = sampleSlopeY(rightX, rightZ);

    const targetTerrainPitch = Math.max(-0.48, Math.min(0.48, Math.atan2(yF - yR, spec.wheelBase)));
    const targetTerrainRoll = Math.max(-0.35, Math.min(0.35, Math.atan2(yRgt - yL, spec.trackWidth)));
    car.terrainPitch += (targetTerrainPitch - car.terrainPitch) * Math.min(1, 16 * dt);
    car.terrainRoll += (targetTerrainRoll - car.terrainRoll) * Math.min(1, 16 * dt);
  }

  // Bridge guardrails
  const railHit = getBridgeGuardrailCollision(car.x, car.z, car.y, spec.width * 0.5);
  if (railHit.hit) {
    car.x = railHit.pushX;
    const normalImpact = Math.abs(car.vx * railHit.normalX);
    car.vx *= -0.35;
    if (normalImpact > 2.4) {
      const evt = applyVehicleImpact(car, railHit.normalX, 0, normalImpact);
      if (evt) impacts.push(evt);
    }
  }

  // Static building collisions
  const staticRes = resolveStaticCollisions(car.x, car.z, car.y, colRadius);
  if (staticRes.hit) {
    car.x = staticRes.x;
    car.z = staticRes.z;
    const vn = car.vx * staticRes.normalX + car.vz * staticRes.normalZ;
    if (vn < 0) {
      const impactSpeed = -vn;
      const restitution = 0.28;
      car.vx -= (1 + restitution) * vn * staticRes.normalX;
      car.vz -= (1 + restitution) * vn * staticRes.normalZ;
      // Friction on wall scrape
      car.vx *= 0.85;
      car.vz *= 0.85;

      const evt = applyVehicleImpact(car, staticRes.normalX, staticRes.normalZ, impactSpeed);
      if (evt) impacts.push(evt);
    }
  }

  // World bounds clamp
  const maxBound = WORLD_HALF_SIZE - 10;
  car.x = Math.max(-maxBound, Math.min(maxBound, car.x));
  car.z = Math.max(-maxBound, Math.min(maxBound, car.z));

  const submerged = isOverWater(car.x, car.z) && car.y < WATER_LEVEL + 0.1;

  return {
    impacts,
    lateralSlip: Math.abs(lateralSpeed),
    submerged,
  };
}

export interface CarCollisionPairResult {
  evtA: ImpactEvent | null;
  evtB: ImpactEvent | null;
}

/** Resolve dynamic vehicle-vs-vehicle collision with mass-weighted impulse & symmetric damage events for both cars */
export function resolveCarToCarCollisionPair(
  a: VehiclePhysicsState,
  b: VehiclePhysicsState
): CarCollisionPairResult | null {
  if (Math.abs(a.y - b.y) > 2.2) return null;

  const ra = (a.spec.width + a.spec.length) * 0.27;
  const rb = (b.spec.width + b.spec.length) * 0.27;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const distSq = dx * dx + dz * dz;
  const minDist = ra + rb;

  if (distSq >= minDist * minDist || distSq < 1e-6) return null;

  const dist = Math.sqrt(distSq);
  const nx = dx / dist;
  const nz = dz / dist;
  const overlap = minDist - dist;

  const invMa = 1 / a.spec.mass;
  const invMb = 1 / b.spec.mass;
  const invMSum = invMa + invMb;

  // Separate positions proportional to inverse mass
  a.x -= nx * overlap * (invMa / invMSum);
  a.z -= nz * overlap * (invMa / invMSum);
  b.x += nx * overlap * (invMb / invMSum);
  b.z += nz * overlap * (invMb / invMSum);

  // Relative velocity along normal
  const rvx = b.vx - a.vx;
  const rvz = b.vz - a.vz;
  const velAlongNormal = rvx * nx + rvz * nz;

  if (velAlongNormal > 0) return null;

  const restitution = 0.35;
  const j = (-(1 + restitution) * velAlongNormal) / invMSum;

  a.vx -= j * invMa * nx;
  a.vz -= j * invMa * nz;
  b.vx += j * invMb * nx;
  b.vz += j * invMb * nz;

  // Spin torque on off-center hit
  const impactSpeed = -velAlongNormal;
  if (impactSpeed > 3) {
    a.angularVel += (nx * a.vz - nz * a.vx) * 0.04;
    b.angularVel -= (nx * b.vz - nz * b.vx) * 0.04;
  }

  const evtA = applyVehicleImpact(a, -nx, -nz, impactSpeed * (invMa / invMSum) * 1.85);
  const evtB = applyVehicleImpact(b, nx, nz, impactSpeed * (invMb / invMSum) * 1.85);

  return { evtA, evtB };
}

/** Resolve dynamic vehicle-vs-vehicle collision with mass-weighted impulse & damage to both cars */
export function resolveCarToCarCollision(
  a: VehiclePhysicsState,
  b: VehiclePhysicsState
): ImpactEvent | null {
  const pair = resolveCarToCarCollisionPair(a, b);
  return pair ? pair.evtA : null;
}

export interface CarCircleCollisionResult {
  x: number;
  z: number;
  hit: boolean;
  normalX: number;
  normalZ: number;
}

/**
 * Resolves solid 2D Oriented Bounding Box (OBB) collision between a standing/walking
 * character (circle of `radius` at `px, pz, py`) and a vehicle at any heading angle.
 */
export function resolveCircleVsOrientedCar(
  px: number,
  pz: number,
  py: number,
  radius: number,
  car: VehiclePhysicsState
): CarCircleCollisionResult {
  if (py > car.y + car.spec.height - 0.15 || py + 1.75 < car.y) {
    return { x: px, z: pz, hit: false, normalX: 0, normalZ: 0 };
  }

  const dx = px - car.x;
  const dz = pz - car.z;
  const maxReach = car.spec.length * 0.55 + car.spec.width * 0.55 + radius;
  if (Math.abs(dx) > maxReach || Math.abs(dz) > maxReach) {
    return { x: px, z: pz, hit: false, normalX: 0, normalZ: 0 };
  }

  const { fx, fz, rx, rz } = getCarBasis(car.heading);
  const halfLen = car.spec.length * 0.5;
  const halfWid = car.spec.width * 0.5;

  const localRight = dx * rx + dz * rz;
  const localForward = dx * fx + dz * fz;

  const clampedR = Math.max(-halfWid, Math.min(halfWid, localRight));
  const clampedF = Math.max(-halfLen, Math.min(halfLen, localForward));

  const diffR = localRight - clampedR;
  const diffF = localForward - clampedF;
  const distSq = diffR * diffR + diffF * diffF;

  if (distSq >= radius * radius) {
    return { x: px, z: pz, hit: false, normalX: 0, normalZ: 0 };
  }

  let newLocalR = localRight;
  let newLocalF = localForward;
  let nLocalR = 0;
  let nLocalF = 0;

  if (distSq > 1e-8) {
    const dist = Math.sqrt(distSq);
    nLocalR = diffR / dist;
    nLocalF = diffF / dist;
    newLocalR = clampedR + nLocalR * radius;
    newLocalF = clampedF + nLocalF * radius;
  } else {
    const penRight = halfWid - Math.abs(localRight);
    const penForward = halfLen - Math.abs(localForward);
    if (penRight < penForward) {
      const sign = localRight >= 0 ? 1 : -1;
      nLocalR = sign;
      newLocalR = sign * (halfWid + radius);
    } else {
      const sign = localForward >= 0 ? 1 : -1;
      nLocalF = sign;
      newLocalF = sign * (halfLen + radius);
    }
  }

  const normalX = rx * nLocalR + fx * nLocalF;
  const normalZ = rz * nLocalR + fz * nLocalF;
  return {
    x: car.x + rx * newLocalR + fx * newLocalF,
    z: car.z + rz * newLocalR + fz * newLocalF,
    hit: true,
    normalX,
    normalZ,
  };
}

export function computeGearAndRpm(speedMs: number, maxSpeedKmh: number, throttle: number): { gear: string; rpmRatio: number } {
  const speedKmh = Math.abs(speedMs) * 3.6;
  if (speedMs < -0.5) {
    return { gear: 'R', rpmRatio: Math.min(1, 0.25 + speedKmh / 60) };
  }
  if (speedKmh < 1.5 && Math.abs(throttle) < 0.05) {
    return { gear: 'N', rpmRatio: 0.16 };
  }
  const normalized = Math.min(1, speedKmh / maxSpeedKmh);
  const gearNum = Math.min(6, Math.max(1, Math.floor(normalized * 5.99) + 1));
  const gearSlice = 1 / 6;
  const gearProgress = (normalized - (gearNum - 1) * gearSlice) / gearSlice;
  const rpmRatio = Math.min(0.98, Math.max(0.24, 0.28 + gearProgress * 0.68 + (throttle > 0 ? 0.08 : 0)));
  return { gear: String(gearNum), rpmRatio };
}

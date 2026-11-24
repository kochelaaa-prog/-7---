import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyVehicleImpact,
  CAR_SPECS,
  computeGearAndRpm,
  createVehicleState,
  resolveCarToCarCollision,
  resolveCarToCarCollisionPair,
  resolveCircleVsOrientedCar,
  stepVehiclePhysics,
} from './physics';
import { computeSmartPursuitControl, type PursuitAiState } from './policeAi';
import {
  BRIDGES,
  CITY_BUILDINGS,
  CITY_CIRCLES,
  FOLIAGE_PLACEMENTS,
  HIGHWAY_X_COORDS,
  HIGHWAY_Z_COORDS,
  MALL_SPECS,
  PARK_CENTER,
  SHIP_SPECS,
  TRAFFIC_LIGHT_PLACEMENTS,
  WORLD_HALF_SIZE,
  getBridgeElevationAt,
  getDistrictAt,
  getGroundHeightAt,
  getMallAt,
  getRoadHalfWidthX,
  getRoadHalfWidthZ,
  getTrafficLightState,
  isHighwayX,
  isHighwayZ,
  isOnRoad,
  isOverWater,
  resolveShipCollisions,
  resolveStaticCollisions,
} from './worldLayout';
import {
  CHUNK_GRID_COUNT,
  getChunkBounds,
  getChunkKey,
  getStreamingChunkPlan,
  worldToChunkCoord,
} from './worldChunks';

test('bridge elevation smoothly rises inside [-62, 62] and stays clear of coastal avenues at z = +-72', () => {
  assert.equal(BRIDGES.length, 5);
  assert.equal(getBridgeElevationAt(-85, -72).onBridge, false, 'coastal North road must have zero bridge overlap');
  assert.equal(getBridgeElevationAt(-85, 72).onBridge, false, 'coastal South road must have zero bridge overlap');
  assert.equal(getBridgeElevationAt(-85, -64).onBridge, false);

  const start = getBridgeElevationAt(-85, -62);
  assert.equal(start.onBridge, true);
  assert.equal(start.height, 0);

  const midRamp = getBridgeElevationAt(-85, -42);
  assert.equal(midRamp.onBridge, true);
  assert.ok(midRamp.height > 2 && midRamp.height < 9.5);

  const center = getBridgeElevationAt(-85, 0);
  assert.equal(center.onBridge, true);
  assert.equal(center.height, 9.5);
  assert.equal(isOverWater(-85, 0), false);
  assert.equal(isOverWater(-255, 0), false);
  assert.equal(isOverWater(170, 0), false, 'East Express Highway bridge must cross water cleanly');
  assert.equal(isOverWater(340, 0), false);
});

test('zero trees or bushes spawn on any road or express highway and all props are physically solid', () => {
  for (const tl of TRAFFIC_LIGHT_PLACEMENTS) {
    assert.equal(
      getBridgeElevationAt(tl.x, tl.z).onBridge,
      false,
      `traffic light at (${tl.x}, ${tl.z}) must stay outside bridge deck`
    );
  }

  for (const [tx, , tz] of FOLIAGE_PLACEMENTS.trees) {
    assert.equal(isOnRoad(tx, tz), false, `tree at (${tx}, ${tz}) must NOT be on road asphalt`);
  }
  for (const [bx, , bz] of FOLIAGE_PLACEMENTS.bushes) {
    assert.equal(isOnRoad(bx, bz), false, `bush at (${bx}, ${bz}) must NOT be on road asphalt`);
  }

  const [tx, , tz] = FOLIAGE_PLACEMENTS.trees[0];
  const treeHit = resolveStaticCollisions(tx, tz, 0.2, 0.45);
  assert.equal(treeHit.hit, true, 'tree trunk must physically block movement');

  const [bx, , bz] = FOLIAGE_PLACEMENTS.bushes[0];
  const bushHit = resolveStaticCollisions(bx, bz, 0.2, 0.45);
  assert.equal(bushHit.hit, true, 'bush must physically block movement');

  const fountainHit = resolveStaticCollisions(PARK_CENTER.x, PARK_CENTER.z, 0.2, 0.5);
  assert.equal(fountainHit.hit, true, 'park fountain must physically block movement');

  const poleHit = resolveStaticCollisions(TRAFFIC_LIGHT_PLACEMENTS[0].x, TRAFFIC_LIGHT_PLACEMENTS[0].z, 0.2, 0.45);
  assert.equal(poleHit.hit, true, 'traffic light pole must physically block movement');

  const neoPlaza = MALL_SPECS.find((m) => m.id === 'neo-plaza')!;
  const mallAtriumFountain = resolveStaticCollisions(neoPlaza.cx, neoPlaza.cz, 0.2, 0.5);
  assert.equal(mallAtriumFountain.hit, true, 'mall atrium fountain must be solid');
});

test('expanded 1080x1080 world, 6-lane express highways, bay water, and district labels work', () => {
  assert.equal(WORLD_HALF_SIZE, 540);
  assert.ok(HIGHWAY_X_COORDS.includes(170));
  assert.ok(HIGHWAY_Z_COORDS.includes(-300));
  assert.ok(HIGHWAY_Z_COORDS.includes(230));
  assert.equal(isHighwayX(170), true);
  assert.equal(isHighwayZ(-300), true);
  assert.equal(getRoadHalfWidthX(170), 12);
  assert.equal(getRoadHalfWidthZ(-300), 12);

  assert.equal(isOverWater(20, 0), true);
  assert.ok(getGroundHeightAt(20, 0) < 0);
  assert.equal(isOnRoad(-85, -145), true);
  assert.equal(isOnRoad(425, 465), true);
  assert.equal(getDistrictAt(-85, 0), 'Мост Золотого Залива');
  assert.equal(getDistrictAt(170, -300), 'Северное Скоростное Шоссе М-7');
  assert.equal(getDistrictAt(42.5, -182.5), 'Центральный Парк');
  assert.equal(getDistrictAt(42.5, -108.5), 'АЗС «НЕО-ОЙЛ»');
});

test('physical floating ships resolve hull collisions solidly', () => {
  assert.ok(SHIP_SPECS.length >= 7);
  const ship = SHIP_SPECS[2]; // center cargo ship at zLane=14, xStart=0
  const hit = resolveShipCollisions(ship.xStart, ship.zLane + ship.width * 0.45, 0.5, 1.0, [
    { x: ship.xStart, z: ship.zLane, length: ship.length, width: ship.width, hullHeight: ship.hullHeight },
  ]);
  assert.equal(hit.hit, true, 'ship hull must physically push vehicle/player out');
  assert.ok(hit.z > ship.zLane + ship.width * 0.45);
});

test('traffic light schedule alternates NS and EW safely with yellow transitions', () => {
  assert.equal(getTrafficLightState(2, 'ns'), 'green');
  assert.equal(getTrafficLightState(2, 'ew'), 'red');
  assert.equal(getTrafficLightState(8, 'ns'), 'yellow');
  assert.equal(getTrafficLightState(8, 'ew'), 'red');
  assert.equal(getTrafficLightState(11, 'ns'), 'red');
  assert.equal(getTrafficLightState(11, 'ew'), 'green');
  assert.equal(getTrafficLightState(17, 'ns'), 'red');
  assert.equal(getTrafficLightState(17, 'ew'), 'yellow');
});

test('shopping mall perimeter walls block solid sections while leaving automatic doorways open', () => {
  const mall = MALL_SPECS.find((m) => m.id === 'neo-plaza')!;
  const westDoor = mall.doors[0];
  const throughDoor = resolveStaticCollisions(westDoor.x, westDoor.z, 0.2, 0.45);
  assert.equal(throughDoor.hit, false, 'player should pass smoothly through mall automatic doorway');

  const solidWall = resolveStaticCollisions(westDoor.x, westDoor.z - 6.0, 0.2, 0.45);
  assert.equal(solidWall.hit, true, 'solid mall wall away from doorway must block player');

  assert.equal(getMallAt(mall.cx, mall.cz)?.id, 'neo-plaza');
  assert.equal(getDistrictAt(mall.cx, mall.cz), 'ТРЦ «НЕО-ПЛАЗА»');
});

test('vehicle & heavy cargo truck accelerate cleanly along heading and steer', () => {
  const car = createVehicleState(CAR_SPECS.viper, -85, -145, Math.PI);
  for (let i = 0; i < 60; i++) {
    stepVehiclePhysics(car, { throttle: 1, steer: 0, handbrake: false, nitro: false }, 1 / 60);
  }
  assert.ok(car.vz > 10, `expected positive +Z velocity, got ${car.vz}`);
  assert.ok(car.z > -145, 'car should advance south along open avenue');
  assert.equal(car.integrity, 100);

  const truck = createVehicleState(CAR_SPECS.truck, 170, -250, Math.PI);
  assert.equal(CAR_SPECS.truck.isTruck, true);
  for (let i = 0; i < 60; i++) {
    stepVehiclePhysics(truck, { throttle: 1, steer: 0, handbrake: false, nitro: false }, 1 / 60);
  }
  assert.ok(truck.vz > 5, `expected truck to accelerate smoothly along highway, got ${truck.vz}`);
});

test('frontal crash deforms front zones, lowers integrity, and detaches front bumper', () => {
  const car = createVehicleState(CAR_SPECS.viper, 0, -100, 0);
  applyVehicleImpact(car, 0, 1, 22);
  const evt = applyVehicleImpact(car, 0, 1, 22);

  assert.ok(evt !== null);
  assert.ok(car.zones.frontLeft > 0.35);
  assert.ok(car.zones.frontRight > 0.35);
  assert.ok(car.integrity < 90);
  assert.equal(car.detachedParts.frontBumper, true);
  assert.equal(car.detachedParts.windshieldCracked, true);
});

test('car-to-car collision transfers momentum and damages both vehicles', () => {
  const carA = createVehicleState(CAR_SPECS.titan, 0, -125, Math.PI);
  carA.vz = 24;
  const carB = createVehicleState(CAR_SPECS.cruiser, 0, -122.5, Math.PI);
  carB.vz = 0;

  const evt = resolveCarToCarCollision(carA, carB);
  assert.ok(evt !== null);
  assert.ok(carB.vz > 5, 'lighter sedan should gain forward velocity from heavy SUV');
  assert.ok(carA.vz < 24, 'SUV should lose momentum on impact');
  assert.ok(carA.integrity < 100);
  assert.ok(carB.integrity < 100);
});

test('static collision pushes car out of building AABB and gear calculation works', () => {
  const res = resolveStaticCollisions(-40, -160, 0.5, 1.2, [
    { minX: -50, maxX: -30, minZ: -170, maxZ: -150, height: 30, kind: 'building' },
  ]);
  assert.equal(res.hit, true);
  assert.ok(res.x !== -40 || res.z !== -160);

  const gRev = computeGearAndRpm(-5, 220, -1);
  assert.equal(gRev.gear, 'R');
  const gNeutral = computeGearAndRpm(0, 220, 0);
  assert.equal(gNeutral.gear, 'N');
  const gHigh = computeGearAndRpm(55, 220, 1);
  assert.ok(Number(gHigh.gear) >= 4);
});

test('vehicle tilts along bridge slope when climbing ramp and does not hop on bridge deck', () => {
  const car = createVehicleState(CAR_SPECS.viper, -85, -52, Math.PI);
  car.vz = 14;
  for (let i = 0; i < 30; i++) {
    stepVehiclePhysics(car, { throttle: 1, steer: 0, handbrake: false, nitro: false }, 1 / 60);
  }
  assert.ok(car.terrainPitch > 0.08, `expected positive upward terrainPitch climbing bridge, got ${car.terrainPitch}`);
  assert.equal(car.grounded, true, 'car should remain planted on smooth bridge ramp');
});

test('hitting bridge embankment side wall does not launch vehicle upward', () => {
  const car = createVehicleState(CAR_SPECS.dominator, -74.5, -20, Math.PI / 2);
  car.y = 0.2;
  car.vx = -16;
  for (let i = 0; i < 10; i++) {
    stepVehiclePhysics(car, { throttle: 1, steer: 0, handbrake: false, nitro: false }, 1 / 60);
  }
  assert.ok(car.y < 1.0, `car must not launch over bridge side wall, got y=${car.y}`);
  assert.ok(car.vy <= 0.5, `vertical velocity must not spike upward, got vy=${car.vy}`);
});

test('water slows and sinks car without allowing driving across water or bouncing upward', () => {
  const car = createVehicleState(CAR_SPECS.viper, 20, 0, Math.PI);
  car.y = -1.7;
  car.vz = 15;
  for (let i = 0; i < 30; i++) {
    const res = stepVehiclePhysics(car, { throttle: 1, steer: 0, handbrake: false, nitro: false }, 1 / 60);
    assert.equal(res.submerged, true);
  }
  assert.ok(car.vz < 2.0, `water drag should stop forward drive, got vz=${car.vz}`);
  assert.ok(car.vy <= 0.6, `water must not bounce car into air, got vy=${car.vy}`);
  assert.ok(car.waterTimer > 0.4);
});

test('damage degrades top speed, suspension sag, ride height, and wheel camber', () => {
  const car = createVehicleState(CAR_SPECS.viper, 0, -145, Math.PI);
  applyVehicleImpact(car, 1, 0, 26);
  applyVehicleImpact(car, 0, 1, 24);
  stepVehiclePhysics(car, { throttle: 1, steer: 0, handbrake: false, nitro: false }, 1 / 60);

  assert.ok(car.rideHeightOffset < -0.01, 'damaged suspension should drop ride height');
  assert.ok(Math.abs(car.sagRoll) > 0.005 || Math.abs(car.sagPitch) > 0.005, 'asymmetric damage should sag chassis');
  assert.ok(car.wheelCamber.some((c) => Math.abs(c) > 0.04), 'damaged corners should bend wheel camber');
});

test('chunk streaming loads only local bubble upfront, prioritizes heading lookahead, and unloads far chunks', () => {
  assert.equal(CHUNK_GRID_COUNT, 8);
  const spawnCoord = worldToChunkCoord(-85, -145);
  assert.equal(spawnCoord.cx, 3);
  assert.equal(spawnCoord.cz, 2);

  const bounds = getChunkBounds(spawnCoord.cx, spawnCoord.cz);
  assert.ok(-85 >= bounds.minX && -85 <= bounds.maxX);
  assert.ok(-145 >= bounds.minZ && -145 <= bounds.maxZ);

  const loaded = new Set<string>();
  const initialPlan = getStreamingChunkPlan(-85, -145, Math.PI, loaded);
  // 8x8 = 64 total chunks; initial bubble must be much smaller (~13..24 chunks)
  assert.ok(initialPlan.toLoad.length >= 12 && initialPlan.toLoad.length <= 28, `got ${initialPlan.toLoad.length}`);
  assert.equal(initialPlan.toLoad[0].key, getChunkKey(spawnCoord.cx, spawnCoord.cz));

  for (const item of initialPlan.toLoad) {
    loaded.add(item.key);
  }
  const countAfterInit = loaded.size;

  // Drive far Southeast (+350, +380): new local chunks must stream in and distant northwest chunks unload
  const farPlan = getStreamingChunkPlan(350, 380, -Math.PI * 0.75, loaded);
  assert.ok(farPlan.toLoad.length >= 8, 'driving across city must stream in new destination chunks');
  assert.ok(farPlan.toUnload.length >= 8, 'distant origin chunks must unload cleanly');

  for (const k of farPlan.toUnload) loaded.delete(k);
  for (const item of farPlan.toLoad) loaded.add(item.key);
  assert.ok(loaded.has(getChunkKey(worldToChunkCoord(350, 380).cx, worldToChunkCoord(350, 380).cz)));
  assert.ok(loaded.size <= 32 && countAfterInit <= 28, 'active loaded chunk footprint stays bounded');
});

test('spatial collider index matches brute-force static collisions across buildings, trees, and malls', () => {
  const samplePoints: Array<[number, number, number]> = [
    [CITY_BUILDINGS[0].minX + 0.3, CITY_BUILDINGS[0].minZ + 0.3, 1.2],
    [FOLIAGE_PLACEMENTS.trees[3][0], FOLIAGE_PLACEMENTS.trees[3][2], 0.8],
    [FOLIAGE_PLACEMENTS.bushes[5][0], FOLIAGE_PLACEMENTS.bushes[5][2], 0.6],
    [TRAFFIC_LIGHT_PLACEMENTS[4].x, TRAFFIC_LIGHT_PLACEMENTS[4].z, 0.5],
    [PARK_CENTER.x, PARK_CENTER.z, 1.0],
    [-85, -145, 1.2], // clear open road
  ];

  for (const [x, z, r] of samplePoints) {
    const indexed = resolveStaticCollisions(x, z, 0.5, r);
    const brute = resolveStaticCollisions(x, z, 0.5, r, CITY_BUILDINGS, CITY_CIRCLES);
    assert.equal(indexed.hit, brute.hit, `hit mismatch at (${x}, ${z})`);
    assert.ok(Math.abs(indexed.x - brute.x) < 1e-6, `x mismatch at (${x}, ${z})`);
    assert.ok(Math.abs(indexed.z - brute.z) < 1e-6, `z mismatch at (${x}, ${z})`);
  }
});

test('high-speed & nitro vehicles cross all 5 bridges smoothly without teleporting into water', () => {
  for (const bridge of BRIDGES) {
    // Verify zero static colliders encroach onto any drivable bridge lane
    for (let z = bridge.zStart; z <= bridge.zEnd; z += 4) {
      const y = getGroundHeightAt(bridge.centerX, z);
      const col = resolveStaticCollisions(bridge.centerX - 2.35, z, y, 1.04);
      assert.equal(col.hit, false, `unexpected static collider on ${bridge.id} at z=${z}`);
    }

    // Drive a Nitro Viper GT-X across the bridge even at coarse 20fps dt=0.05s
    const car = createVehicleState(CAR_SPECS.viper, bridge.centerX - 2.35, -80, Math.PI);
    car.vz = 42;
    let maxY = 0;
    for (let step = 0; step < 120 && car.z < 85; step++) {
      const res = stepVehiclePhysics(car, { throttle: 1, steer: 0, handbrake: false, nitro: true }, 0.05);
      assert.equal(res.submerged, false, `car fell/teleported into water on ${bridge.id} at z=${car.z}`);
      assert.ok(
        Math.abs(car.x - bridge.centerX) < bridge.deckWidth * 0.5,
        `car teleported sideways to x=${car.x} on ${bridge.id} at z=${car.z}`
      );
      if (car.y > maxY) maxY = car.y;
    }
    assert.ok(car.z > 70, `car should finish crossing ${bridge.id}, got z=${car.z}`);
    assert.ok(maxY >= bridge.deckHeight - 0.5, `car should climb to deckHeight on ${bridge.id}, maxY=${maxY}`);
  }
});

test('on-foot player & pedestrian collisions against rotated vehicles push out cleanly without clipping', () => {
  const car = createVehicleState(CAR_SPECS.viper, -85, -145, Math.PI * 0.25);
  const clear = resolveCircleVsOrientedCar(-80, -145, car.y, 0.48, car);
  assert.equal(clear.hit, false, 'standing well clear of car must not trigger collision');

  // Standing inside side/front hull must push outward cleanly
  const insideSide = resolveCircleVsOrientedCar(-85.4, -145.3, car.y, 0.48, car);
  assert.equal(insideSide.hit, true, 'walking into car hull must collide solidly');
  const distAfter = Math.hypot(insideSide.x - car.x, insideSide.z - car.z);
  assert.ok(distAfter >= CAR_SPECS.viper.width * 0.5 + 0.4, `must push outside car width, dist=${distAfter}`);

  // Standing on roof (vertical clearance) does not trigger horizontal wall ejection
  const onRoof = resolveCircleVsOrientedCar(-85, -145, car.y + CAR_SPECS.viper.height + 0.1, 0.48, car);
  assert.equal(onRoof.hit, false);

  // Heavy 7.4m truck length must block near front/rear ends accurately
  const truck = createVehicleState(CAR_SPECS.truck, 0, -145, 0);
  const truckFrontHit = resolveCircleVsOrientedCar(0, -145 - 3.5, truck.y, 0.48, truck);
  assert.equal(truckFrontHit.hit, true, 'truck nose 3.5m ahead of center must block player solidly');
  assert.ok(truckFrontHit.z <= -145 - CAR_SPECS.truck.length * 0.5 - 0.45);
});

test('smart police AI steers around forward obstacles and reverses cleanly when nose-blocked or stuck', () => {
  const ai: PursuitAiState = { reverseTimer: 0, reverseSteer: 0, stuckTimer: 0 };

  // 1. Obstacle ahead at (0, -10) between cruiser at (0, 0) and target at (0, -40)
  const avoidCtrl = computeSmartPursuitControl({
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    vx: 0,
    vz: -10,
    halfWidth: 1.0,
    halfLength: 2.3,
    targetX: 0,
    targetZ: -40,
    desiredSpeed: 22,
    dt: 0.05,
    ai,
    isBlocked: (px, pz, r) => Math.hypot(px - 0, pz - -10) < 3.2 + r,
  });
  assert.ok(avoidCtrl.throttle > 0, 'cruiser should keep advancing around open detour');
  assert.ok(Math.abs(avoidCtrl.steer) > 0.25, `cruiser must steer laterally around obstacle, got steer=${avoidCtrl.steer}`);

  // 2. Nose-blocked against a wall right in front of the bumper at z = -3.0 -> immediate reverse escape
  const wallAi: PursuitAiState = { reverseTimer: 0, reverseSteer: 0, stuckTimer: 0 };
  const revCtrl = computeSmartPursuitControl({
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    vx: 0,
    vz: -0.5,
    halfWidth: 1.0,
    halfLength: 2.3,
    targetX: 0,
    targetZ: -35,
    desiredSpeed: 22,
    dt: 0.05,
    ai: wallAi,
    isBlocked: (_px, pz) => pz <= -3.0 && pz >= -12.0,
  });
  assert.ok(revCtrl.throttle < -0.5, `nose-blocked cruiser must reverse, got throttle=${revCtrl.throttle}`);
  assert.ok(wallAi.reverseTimer > 0.5, 'reverse maneuver timer must remain active to back clear of wall');

  // 3. Stuck low-speed condition without wall right at bumper triggers timed reverse escape, then stops if rear blocked
  const stuckAi: PursuitAiState = { reverseTimer: 0, reverseSteer: 0, stuckTimer: 0.6 };
  const stuckRev = computeSmartPursuitControl({
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    vx: 0,
    vz: 0,
    halfWidth: 1.0,
    halfLength: 2.3,
    targetX: 0,
    targetZ: -35,
    desiredSpeed: 22,
    dt: 0.05,
    ai: stuckAi,
    isBlocked: () => false,
  });
  assert.ok(stuckRev.throttle < -0.5, 'stuck cruiser must trigger reverse escape');

  // If rear gets blocked mid-reverse, reverse cancels safely instead of backing into a wall
  const rearCancel = computeSmartPursuitControl({
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    vx: 0,
    vz: 1.0,
    halfWidth: 1.0,
    halfLength: 2.3,
    targetX: 0,
    targetZ: -35,
    desiredSpeed: 22,
    dt: 0.05,
    ai: stuckAi,
    isBlocked: (_px, pz) => pz > 2.5,
  });
  assert.equal(stuckAi.reverseTimer, 0, 'reverse timer must stop when rear is blocked');
  assert.ok(rearCancel.throttle >= 0);
});

test('car-to-car collisions return symmetric ImpactEvents for both cars and capture paint scrapes', () => {
  const carA = createVehicleState(CAR_SPECS.cruiser, 0, -125, Math.PI);
  carA.vz = 18;
  const carB = createVehicleState(CAR_SPECS.cruiser, 0, -122.4, Math.PI);
  carB.vz = 0;

  const pair = resolveCarToCarCollisionPair(carA, carB);
  assert.ok(pair !== null && pair.evtA !== null && pair.evtB !== null, 'both cars must emit ImpactEvent visuals');
  assert.ok(carA.integrity < 100 && carB.integrity < 100, 'both cars must sustain structural damage');

  const scrapeCar = createVehicleState(CAR_SPECS.viper, 10, -125, 0);
  const scrapeEvt = applyVehicleImpact(scrapeCar, 1, 0, 1.6);
  assert.ok(scrapeEvt !== null, 'surface scrape at 1.6 impulse must trigger scratch/dent visual event');
  assert.ok(scrapeCar.zones.leftSide > 0, 'struck side zone must record scrape damage');
  applyVehicleImpact(scrapeCar, 1, 0, 2.0);
  assert.ok(scrapeCar.integrity < 100, 'repeated scrapes must reduce overall structural integrity');
});



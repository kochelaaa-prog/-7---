import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { SoundEngine } from './audio';
import { buildCarVisualRig, type CarVisualRig, type TurnSignalMode } from './carBuilder';
import { buildCityWorld, buildShipVisual, type CityWorldVisuals } from './cityBuilder';
import { buildHumanRig, type HumanVisualRig } from './pedestrianBuilder';
import {
  CAR_SPECS,
  computeGearAndRpm,
  createVehicleState,
  getCarBasis,
  resolveCarToCarCollisionPair,
  resolveCircleVsOrientedCar,
  stepVehiclePhysics,
  type ImpactEvent,
  type VehicleControlInput,
  type VehiclePhysicsState,
} from './physics';
import { computeSmartPursuitControl } from './policeAi';
import { createProceduralTextures, type ProceduralTextureSet } from './textures';
import type {
  CameraMode,
  CarModelId,
  ControlMode,
  GamePhase,
  HudSnapshot,
  ShipSpec,
  SpeechBubbleHud,
  TimeOfDay,
  TouchInputState,
} from './types';
import {
  BRIDGE_CENTER_XS,
  BRIDGES,
  LANDMARK_MINIMAP_DOTS,
  MALL_SPECS,
  NORTH_ROAD_Z_COORDS,
  PARK_CENTER,
  ROAD_X_COORDS,
  SHIP_SPECS,
  SOUTH_ROAD_Z_COORDS,
  WATER_LEVEL,
  WATER_Z_MAX,
  WATER_Z_MIN,
  WORLD_HALF_SIZE,
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

interface PendingTurnState {
  turnDir: 'left' | 'right';
  targetAxis: 'x' | 'z';
  targetRoadCenter: number;
  targetDir: 1 | -1;
  targetLaneIndex: number;
  targetLaneCoord: number;
  targetHeading: number;
}

interface SimVehicle {
  id: number;
  state: VehiclePhysicsState;
  rig: CarVisualRig;
  isTraffic: boolean;
  isPolice: boolean;
  aiSpeedTarget: number;
  aiLaneAxis: 'x' | 'z';
  aiRoadCenter: number;
  aiLaneIndex: number;
  aiLaneCoord: number;
  aiDir: 1 | -1;
  aiTurnCooldown: number;
  aiTurnState: PendingTurnState | null;
  blinkerMode: TurnSignalMode;
  blinkerTimer: number;
  yieldTimer: number;
  overtakeCooldown: number;
  panicTimer: number;
  roadRageState: 'none' | 'honk_chase' | 'box_in' | 'confronting' | 'cooldown';
  roadRageTimer: number;
  hornTimer: number;
  boxSide: -1 | 1;
  driverExited: boolean;
  policeCalled: boolean;
  crashFault: 'player' | 'npc';
  policeState: 'patrol' | 'responding' | 'investigating' | 'pursuing_player' | 'clearing';
  policeTimer: number;
  policeIncidentX: number;
  policeIncidentZ: number;
  policeTargetNpc: SimVehicle | null;
  sirenTimer: number;
  aiReverseTimer: number;
  aiReverseSteer: number;
  aiStuckTimer: number;
  leftDoorAngle: number;
  rightDoorAngle: number;
  leftDoorHoldTimer: number;
  rightDoorHoldTimer: number;
}

interface PlayerVehicleAction {
  mode: 'exiting' | 'entering' | 'hijack';
  car: SimVehicle;
  elapsed: number;
  duration: number;
  ejectedDriver: boolean;
  startX: number;
  startZ: number;
}

interface SimPedestrian {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  heading: number;
  speed: number;
  walkPhase: number;
  state: 'walk' | 'flee' | 'knocked' | 'hostile' | 'confront' | 'investigate';
  role: 'civilian' | 'driver' | 'police';
  stateTimer: number;
  confrontElapsed: number;
  callingPhone: boolean;
  ragdollPitch: number;
  angryAfterGetUp: boolean;
  bumpCount: number;
  bumpCooldown: number;
  kickCooldown: number;
  kickAnimTimer: number;
  exitSlideTimer?: number;
  exitSlideDuration?: number;
  exitStartX?: number;
  exitStartZ?: number;
  exitEndX?: number;
  exitEndZ?: number;
  ownerCar: SimVehicle | null;
  rig: HumanVisualRig;
}

interface SimShip {
  spec: ShipSpec;
  x: number;
  y: number;
  z: number;
  dir: 1 | -1;
  heading: number;
  bobPhase: number;
  wakeTimer: number;
  mesh: THREE.Group | null;
}

interface WorldSpeechBubble {
  id: number;
  speaker: string;
  text: string;
  worldX: number;
  worldY: number;
  worldZ: number;
  tone: 'npc' | 'angry' | 'police' | 'clear';
  ttl: number;
  followPed?: SimPedestrian;
  followCar?: SimVehicle;
}

interface DebrisPiece {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  life: number;
}

interface Particle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  life: number;
  maxLife: number;
  gravity: number;
  color: THREE.Color;
}

const PARTICLE_POOL_SIZE = 300;
const STD_LANE_OFFSETS = [2.35, 5.45] as const;
const HWY_LANE_OFFSETS = [2.35, 6.0, 9.55] as const;

// Reusable zero-GC math scratch objects
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();

function getMaxLaneIdx(axis: 'x' | 'z', roadCenter: number): number {
  const isHwy = axis === 'z' ? isHighwayX(roadCenter) : isHighwayZ(roadCenter);
  return isHwy ? HWY_LANE_OFFSETS.length - 1 : STD_LANE_OFFSETS.length - 1;
}

function getLaneCoord(axis: 'x' | 'z', roadCenter: number, dir: 1 | -1, laneIndex: number): number {
  const isHwy = axis === 'z' ? isHighwayX(roadCenter) : isHighwayZ(roadCenter);
  const offsets = isHwy ? HWY_LANE_OFFSETS : STD_LANE_OFFSETS;
  const clampedIdx = Math.max(0, Math.min(offsets.length - 1, laneIndex));
  const off = offsets[clampedIdx];
  // Right-hand driving:
  // North-South (axis='z'): +Z Southbound drives on -X side; -Z Northbound drives on +X side
  // East-West (axis='x'): +X Eastbound drives on +Z side; -X Westbound drives on -Z side
  if (axis === 'z') {
    return dir === 1 ? roadCenter - off : roadCenter + off;
  }
  return dir === 1 ? roadCenter + off : roadCenter - off;
}

function getTargetHeading(axis: 'x' | 'z', dir: 1 | -1): number {
  if (axis === 'z') return dir === 1 ? Math.PI : 0;
  return dir === 1 ? -Math.PI * 0.5 : Math.PI * 0.5;
}

function wrapAngle(a: number): number {
  let out = a;
  while (out > Math.PI) out -= Math.PI * 2;
  while (out < -Math.PI) out += Math.PI * 2;
  return out;
}

export class GameEngine {
  private container: HTMLElement;
  private onHudUpdate: (snapshot: HudSnapshot) => void;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private sky: Sky;
  private sunLight: THREE.DirectionalLight;
  private sunOffset = new THREE.Vector3(80, 130, 60);
  private headlightSpot: THREE.SpotLight;
  private hemiLight: THREE.HemisphereLight;
  private textures: ProceduralTextureSet;
  private city: CityWorldVisuals;
  private sound: SoundEngine;
  private isSoftwareGl: boolean;

  private phase: GamePhase = 'title';
  private cameraMode: CameraMode = 'third';
  private controlMode: ControlMode =
    typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches ? 'mobile' : 'pc';
  private timeOfDay: TimeOfDay = 'day';
  private trafficDensity = 1.0;

  private vehicles: SimVehicle[] = [];
  private playerVehicle: SimVehicle | null = null;
  private pedestrians: SimPedestrian[] = [];
  private ships: SimShip[] = [];
  private playerRig: HumanVisualRig;

  // On-foot player state
  private inVehicle = true;
  private playerVehicleAction: PlayerVehicleAction | null = null;
  private playerX = -85;
  private playerY = 0.02;
  private playerZ = -145;
  private playerVx = 0;
  private playerVy = 0;
  private playerVz = 0;
  private playerKnockVx = 0;
  private playerKnockVz = 0;
  private playerHeading = Math.PI;
  private playerWalkPhase = 0;
  private playerHp = 100;
  private stamina = 100;

  // Speech bubbles & Police dispatch banner
  private speechBubbles: WorldSpeechBubble[] = [];
  private policeBanner: string | null = null;
  private policeBannerTimer = 0;

  // Stats
  private maxSpeedKmh = 0;
  private crashes = 0;
  private distanceM = 0;
  private propsDestroyed = 0;
  private chaosPoints = 0;

  // Camera state
  private camPos = new THREE.Vector3(-85, 5, -155);
  private camLook = new THREE.Vector3(-85, 1.5, -135);
  private camYawOffset = 0;
  private camPitchOffset = 0.14;
  private isDraggingCam = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private trauma = 0;
  private hitstopTimer = 0;
  private titleOrbitTime = 0;
  private simTime = 0;
  private trafficStreamTimer = 0;
  private pedStreamTimer = 0;

  // Particle pool & flying car debris
  private particleMesh: THREE.InstancedMesh;
  private particles: Particle[] = [];
  private particleCursor = 0;
  private debrisPieces: DebrisPiece[] = [];
  private smokeTimer = 0;

  // Input state
  private keys = new Set<string>();
  private touchInput: TouchInputState = {
    throttle: 0,
    steer: 0,
    handbrake: false,
    nitro: false,
    jump: false,
  };
  private nextId = 1;
  private frameId = 0;
  private destroyed = false;
  private lastTime = performance.now();
  private hudTimer = 0;
  private resizeObserver: ResizeObserver;

  constructor(container: HTMLElement, onHudUpdate: (snapshot: HudSnapshot) => void, autostart: boolean) {
    this.container = container;
    this.onHudUpdate = onHudUpdate;
    this.sound = new SoundEngine();

    this.isSoftwareGl = (() => {
      const probe = document.createElement('canvas').getContext('webgl2');
      if (!probe) return true;
      const ext = probe.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
      const gpu = String(probe.getParameter(param));
      probe.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = this.isSoftwareGl ? THREE.BasicShadowMap : THREE.PCFSoftShadowMap;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x9bc4e2, 0.0021);

    this.camera = new THREE.PerspectiveCamera(64, width / height, 0.15, 780);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.sky = new Sky();
    this.sky.scale.setScalar(2400);
    this.scene.add(this.sky);

    this.hemiLight = new THREE.HemisphereLight(0xa5d8ff, 0x334155, 0.72);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff1d6, 2.2);
    this.sunLight.position.set(80, 130, 60);
    this.sunLight.castShadow = true;
    const shadowSize = this.isSoftwareGl ? 512 : 1024;
    this.sunLight.shadow.mapSize.set(shadowSize, shadowSize);
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 300;
    const d = this.isSoftwareGl ? 75 : 105;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0008;
    this.sunLight.shadow.normalBias = 0.03;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    this.headlightSpot = new THREE.SpotLight(0xfff3d6, 0, 62, Math.PI * 0.24, 0.55, 1.35);
    this.scene.add(this.headlightSpot);
    this.scene.add(this.headlightSpot.target);

    this.textures = createProceduralTextures(this.renderer.capabilities.getMaxAnisotropy());
    this.city = buildCityWorld(this.textures);
    this.scene.add(this.city.root);
    // Stream only initial spawn chunks (~20-25% of map); rest stream dynamically while driving
    this.city.updateStreaming(-85 - 2.35, -145, Math.PI, 1.0, 99);
    document.body.dataset.loadedChunks = String(this.city.getLoadedChunkCount());

    const partGeo = new THREE.IcosahedronGeometry(0.18, 0);
    const partMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.particleMesh = new THREE.InstancedMesh(partGeo, partMat, PARTICLE_POOL_SIZE);
    this.particleMesh.frustumCulled = false;
    this.scene.add(this.particleMesh);
    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      this.particles.push({
        active: false,
        x: 0,
        y: -50,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        size: 0,
        life: 0,
        maxLife: 1,
        gravity: 0,
        color: new THREE.Color(0xffffff),
      });
      _mat4.makeScale(0, 0, 0);
      this.particleMesh.setMatrixAt(i, _mat4);
      this.particleMesh.setColorAt(i, this.particles[i].color);
    }

    this.playerRig = buildHumanRig(this.textures, 1, true);
    this.playerRig.root.visible = false;
    this.scene.add(this.playerRig.root);

    this.applyTimeOfDay('day');
    this.populateWorld();

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleWindowBlur);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);

    if (autostart) {
      this.startGame();
    } else {
      document.body.dataset.state = 'title';
      this.pushHudSnapshot();
    }

    this.lastTime = performance.now();
    this.tick();
  }

  private findStreamRoadSpawn(
    px: number,
    pz: number,
    heading: number,
    minDist: number,
    maxDist: number,
    minCarSep: number
  ): {
    axis: 'x' | 'z';
    roadCenter: number;
    dir: 1 | -1;
    laneIndex: number;
    laneCoord: number;
    x: number;
    z: number;
    heading: number;
  } | null {
    const { fx, fz } = getCarBasis(heading);
    const allZRds = [...NORTH_ROAD_Z_COORDS, ...SOUTH_ROAD_Z_COORDS];
    const minSq = minDist * minDist;
    const maxSq = maxDist * maxDist;
    const sepSq = minCarSep * minCarSep;

    for (let attempt = 0; attempt < 24; attempt++) {
      const axis: 'x' | 'z' = Math.random() < 0.5 ? 'z' : 'x';
      const roadCenter =
        axis === 'z'
          ? ROAD_X_COORDS[Math.floor(Math.random() * ROAD_X_COORDS.length)]
          : allZRds[Math.floor(Math.random() * allZRds.length)];
      const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
      const maxL = getMaxLaneIdx(axis, roadCenter);
      const laneIndex = Math.floor(Math.random() * (maxL + 1));
      const laneCoord = getLaneCoord(axis, roadCenter, dir, laneIndex);

      const biasDist = minDist + Math.random() * (maxDist - minDist);
      const lateralJitter = (Math.random() - 0.5) * 180;
      const biasAhead = attempt < 18;

      let sx: number;
      let sz: number;
      if (axis === 'z') {
        sx = laneCoord;
        sz = biasAhead ? pz + fz * biasDist + lateralJitter : pz + (Math.random() - 0.5) * maxDist * 1.9;
      } else {
        sx = biasAhead ? px + fx * biasDist + lateralJitter : px + (Math.random() - 0.5) * maxDist * 1.9;
        sz = laneCoord;
      }

      if (Math.abs(sx) > WORLD_HALF_SIZE - 45 || Math.abs(sz) > WORLD_HALF_SIZE - 45) continue;
      if (isOverWater(sx, sz)) continue;
      if (axis === 'z' && !BRIDGE_CENTER_XS.has(roadCenter) && sz > WATER_Z_MIN - 26 && sz < WATER_Z_MAX + 26) {
        continue;
      }

      const dSq = (sx - px) * (sx - px) + (sz - pz) * (sz - pz);
      if (dSq < minSq || dSq > maxSq) continue;

      let clear = true;
      for (const other of this.vehicles) {
        const odx = other.state.x - sx;
        const odz = other.state.z - sz;
        if (odx * odx + odz * odz < sepSq) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;

      return {
        axis,
        roadCenter,
        dir,
        laneIndex,
        laneCoord,
        x: sx,
        z: sz,
        heading: getTargetHeading(axis, dir),
      };
    }
    return null;
  }

  private populateWorld(): void {
    const spawnX = -85 - 2.35;
    const spawnZ = -145;

    // 1. Player Hero Car on Downtown Avenue facing South toward Golden Bay Bridge & Neo-Plaza
    this.spawnHeroCar('viper', spawnX, spawnZ, Math.PI);

    // 2. Active Streaming Pool: ~46 civilian vehicles + 4 police cruisers within 38..260m bubble
    const trafficModels: CarModelId[] = [
      'cruiser',
      'dominator',
      'titan',
      'truck',
      'cruiser',
      'viper',
      'truck',
      'cruiser',
    ];
    const trafficColors = [0xfacc15, 0x3b82f6, 0x10b981, 0xe2e8f0, 0x64748b, 0xf97316, 0xef4444, 0x0284c7];
    const truckColors = [0x0284c7, 0xdc2626, 0x059669, 0xe2e8f0, 0xf59e0b, 0x334155];

    let spawnedTraffic = 0;
    for (let i = 0; i < 140 && spawnedTraffic < 46; i++) {
      const slot = this.findStreamRoadSpawn(spawnX, spawnZ, Math.PI, 36, 255, 16);
      if (!slot) continue;
      const isHwy = slot.axis === 'z' ? isHighwayX(slot.roadCenter) : isHighwayZ(slot.roadCenter);
      const model =
        isHwy && spawnedTraffic % 3 === 0 ? 'truck' : trafficModels[spawnedTraffic % trafficModels.length];
      const color =
        model === 'cruiser'
          ? 0xfacc15
          : model === 'truck'
          ? truckColors[spawnedTraffic % truckColors.length]
          : trafficColors[(spawnedTraffic * 3) % trafficColors.length];
      this.spawnTrafficVehicle(
        model,
        slot.x,
        slot.z,
        slot.heading,
        slot.axis,
        slot.roadCenter,
        slot.laneIndex,
        slot.laneCoord,
        slot.dir,
        color,
        false
      );
      spawnedTraffic++;
    }

    // 3. 4 Active Police Patrol Cruisers streamed inside the nearby city bubble
    let spawnedPolice = 0;
    for (let i = 0; i < 40 && spawnedPolice < 4; i++) {
      const slot = this.findStreamRoadSpawn(spawnX, spawnZ, Math.PI, 70, 260, 24);
      if (!slot) continue;
      this.spawnTrafficVehicle(
        'cruiser',
        slot.x,
        slot.z,
        slot.heading,
        slot.axis,
        slot.roadCenter,
        slot.laneIndex,
        slot.laneCoord,
        slot.dir,
        0xf8fafc,
        true
      );
      spawnedPolice++;
    }

    // 4. 7 Floating Ships in the Bay (simulation lightweight; 3D visual meshes stream by proximity < 420m)
    for (const spec of SHIP_SPECS) {
      const y = WATER_LEVEL + 0.12;
      const distToSpawn = Math.hypot(spec.xStart - spawnX, spec.zLane - spawnZ);
      let mesh: THREE.Group | null = null;
      if (distToSpawn < 420) {
        mesh = buildShipVisual(spec);
        mesh.position.set(spec.xStart, y, spec.zLane);
        mesh.rotation.y = spec.dir === 1 ? 0 : Math.PI;
        this.scene.add(mesh);
      }
      this.ships.push({
        spec,
        x: spec.xStart,
        y,
        z: spec.zLane,
        dir: spec.dir,
        heading: spec.dir === 1 ? 0 : Math.PI,
        bobPhase: Math.random() * Math.PI * 2,
        wakeTimer: 0,
        mesh,
      });
    }

    // 5. Active Streaming Pedestrian Pool (~54 civilians in nearby 225m bubble)
    const addPed = (px: number, pz: number, heading: number, seed: number) => {
      const rig = buildHumanRig(this.textures, seed, false, 'civilian');
      const py = getGroundHeightAt(px, pz);
      rig.root.position.set(px, py, pz);
      this.scene.add(rig.root);
      this.pedestrians.push({
        id: this.nextId++,
        x: px,
        y: py,
        z: pz,
        vx: 0,
        vz: 0,
        heading,
        speed: 1.35 + (seed % 4) * 0.2,
        walkPhase: Math.random() * Math.PI * 2,
        state: 'walk',
        role: 'civilian',
        stateTimer: 0,
        confrontElapsed: 0,
        callingPhone: false,
        ragdollPitch: 0,
        angryAfterGetUp: false,
        bumpCount: 0,
        bumpCooldown: 0,
        kickCooldown: 0,
        kickAnimTimer: 0,
        ownerCar: null,
        rig,
      });
    };

    let sideSeed = 5;
    let spawnedSidePeds = 0;
    const nearbyRoadXs = ROAD_X_COORDS.filter((rx) => Math.abs(rx - spawnX) < 230);
    for (let i = 0; i < 120 && spawnedSidePeds < 38; i++) {
      const rx = nearbyRoadXs[i % nearbyRoadXs.length];
      const hwX = getRoadHalfWidthX(rx);
      const side = i % 2 === 0 ? 1 : -1;
      const px = rx + side * (hwX + 2.2);
      let pz = spawnZ - 190 + ((i * 37) % 380);
      for (let tries = 0; tries < 4 && (isOnRoad(px, pz) || isOverWater(px, pz)); tries++) {
        pz += 16;
      }
      if (
        !isOnRoad(px, pz) &&
        !isOverWater(px, pz) &&
        Math.hypot(px - spawnX, pz - spawnZ) < 235 &&
        !resolveStaticCollisions(px, pz, getGroundHeightAt(px, pz), 0.45).hit
      ) {
        addPed(px, pz, i % 2 === 0 ? 0 : Math.PI, sideSeed++);
        spawnedSidePeds++;
      }
    }

    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      const dist = 8 + (i % 3) * 4.0;
      addPed(PARK_CENTER.x + Math.cos(ang) * dist, PARK_CENTER.z + Math.sin(ang) * dist, ang + 1.5, 200 + i);
    }

    const neoPlaza = MALL_SPECS.find((m) => m.id === 'neo-plaza') ?? MALL_SPECS[0];
    for (let k = 0; k < 8; k++) {
      const ox = ((k % 4) - 1.5) * 6.0;
      const oz = (Math.floor(k / 4) - 0.5) * 8.5;
      addPed(neoPlaza.cx + ox, neoPlaza.cz + oz, k * 0.9, 300 + k);
    }
  }

  private spawnHeroCar(modelId: CarModelId, x: number, z: number, heading: number, color?: number): void {
    const spec = CAR_SPECS[modelId];
    const state = createVehicleState(spec, x, z, heading);
    const rig = buildCarVisualRig(spec, this.textures, this.isSoftwareGl, color);
    rig.setDriverVisible(this.cameraMode === 'third');
    rig.root.position.set(state.x, state.y, state.z);
    rig.root.rotation.y = state.heading;
    this.scene.add(rig.root);

    const simCar: SimVehicle = {
      id: this.nextId++,
      state,
      rig,
      isTraffic: false,
      isPolice: false,
      aiSpeedTarget: 0,
      aiLaneAxis: 'z',
      aiRoadCenter: x,
      aiLaneIndex: 0,
      aiLaneCoord: x,
      aiDir: 1,
      aiTurnCooldown: 0,
      aiTurnState: null,
      blinkerMode: 'none',
      blinkerTimer: 0,
      yieldTimer: 0,
      overtakeCooldown: 0,
      panicTimer: 0,
      roadRageState: 'none',
      roadRageTimer: 0,
      hornTimer: 0,
      boxSide: 1,
      driverExited: false,
      policeCalled: false,
      crashFault: 'player',
      policeState: 'patrol',
      policeTimer: 0,
      policeIncidentX: 0,
      policeIncidentZ: 0,
      policeTargetNpc: null,
      sirenTimer: 0,
      aiReverseTimer: 0,
      aiReverseSteer: 0,
      aiStuckTimer: 0,
      leftDoorAngle: 0,
      rightDoorAngle: 0,
      leftDoorHoldTimer: 0,
      rightDoorHoldTimer: 0,
    };
    this.vehicles.push(simCar);
    this.playerVehicle = simCar;
    this.inVehicle = true;
    this.playerRig.root.visible = false;
  }

  private spawnTrafficVehicle(
    modelId: CarModelId,
    x: number,
    z: number,
    heading: number,
    axis: 'x' | 'z',
    roadCenter: number,
    laneIndex: number,
    laneCoord: number,
    dir: 1 | -1,
    color: number,
    isPolice = false
  ): void {
    const spec = CAR_SPECS[modelId];
    const state = createVehicleState(spec, x, z, heading);
    const rig = buildCarVisualRig(spec, this.textures, this.isSoftwareGl, color, isPolice);
    rig.setDriverVisible(true);
    rig.root.position.set(state.x, state.y, state.z);
    rig.root.rotation.y = state.heading;
    this.scene.add(rig.root);

    const isHwy = axis === 'z' ? isHighwayX(roadCenter) : isHighwayZ(roadCenter);
    const baseSpeed = isPolice ? 14.5 : spec.isTruck ? 10.5 + Math.random() * 3.0 : (isHwy ? 15.5 : 11.5) + Math.random() * 4.5;

    this.vehicles.push({
      id: this.nextId++,
      state,
      rig,
      isTraffic: true,
      isPolice,
      aiSpeedTarget: baseSpeed,
      aiLaneAxis: axis,
      aiRoadCenter: roadCenter,
      aiLaneIndex: laneIndex,
      aiLaneCoord: laneCoord,
      aiDir: dir,
      aiTurnCooldown: 2 + Math.random() * 6,
      aiTurnState: null,
      blinkerMode: 'none',
      blinkerTimer: 0,
      yieldTimer: 0,
      overtakeCooldown: 0,
      panicTimer: 0,
      roadRageState: 'none',
      roadRageTimer: 0,
      hornTimer: 0,
      boxSide: 1,
      driverExited: false,
      policeCalled: false,
      crashFault: 'player',
      policeState: 'patrol',
      policeTimer: 0,
      policeIncidentX: 0,
      policeIncidentZ: 0,
      policeTargetNpc: null,
      sirenTimer: 0,
      aiReverseTimer: 0,
      aiReverseSteer: 0,
      aiStuckTimer: 0,
      leftDoorAngle: 0,
      rightDoorAngle: 0,
      leftDoorHoldTimer: 0,
      rightDoorHoldTimer: 0,
    });
  }

  // --- Public Controls Wired to React HUD ---

  public startGame(): void {
    this.sound.init();
    this.sound.resume();
    this.phase = 'playing';
    document.body.dataset.state = 'playing';
    this.keys.clear();
    this.camYawOffset = 0;
    this.camPitchOffset = 0.14;
    if (this.playerVehicle) {
      const { fx, fz } = getCarBasis(this.playerVehicle.state.heading);
      this.camPos.set(
        this.playerVehicle.state.x - fx * 8.2,
        this.playerVehicle.state.y + 3.2,
        this.playerVehicle.state.z - fz * 8.2
      );
      this.camLook.set(
        this.playerVehicle.state.x + fx * 6,
        this.playerVehicle.state.y + 1.1,
        this.playerVehicle.state.z + fz * 6
      );
    }
    this.pushHudSnapshot();
  }

  public pauseGame(): void {
    if (this.phase !== 'playing') return;
    this.phase = 'paused';
    document.body.dataset.state = 'paused';
    this.keys.clear();
    this.sound.updateVehicleAudio(false, 0, 0, 0, true);
    this.pushHudSnapshot();
  }

  public resumeGame(): void {
    if (this.phase !== 'paused') return;
    this.sound.resume();
    this.phase = 'playing';
    document.body.dataset.state = 'playing';
    this.keys.clear();
    this.pushHudSnapshot();
  }

  public respawnPlayer(): void {
    this.playerHp = 100;
    this.stamina = 100;
    this.chaosPoints = 0;
    if (this.playerVehicle) {
      this.repairCurrentVehicle(true);
    } else {
      this.spawnHeroCar('viper', -85 - 2.35, -145, Math.PI);
    }
    this.phase = 'playing';
    document.body.dataset.state = 'playing';
    this.keys.clear();
    this.pushHudSnapshot();
  }

  public returnToTitle(): void {
    this.phase = 'title';
    document.body.dataset.state = 'title';
    this.keys.clear();
    this.sound.updateVehicleAudio(false, 0, 0, 0, true);
    this.pushHudSnapshot();
  }

  public toggleCameraMode(): void {
    this.cameraMode = this.cameraMode === 'third' ? 'first' : 'third';
    this.camYawOffset = 0;
    this.camPitchOffset = this.cameraMode === 'first' ? 0.02 : 0.14;
    if (this.playerVehicle && this.inVehicle) {
      this.playerVehicle.rig.setDriverVisible(this.cameraMode === 'third');
    }
    this.pushHudSnapshot();
  }

  public toggleMute(): void {
    this.sound.init();
    this.sound.setMuted(!this.sound.isMuted());
    this.pushHudSnapshot();
  }

  public setControlMode(mode: ControlMode): void {
    this.controlMode = mode;
    this.touchInput = { throttle: 0, steer: 0, handbrake: false, nitro: false, jump: false };
    this.pushHudSnapshot();
  }

  public setTouchInput(partial: Partial<TouchInputState>): void {
    this.touchInput = { ...this.touchInput, ...partial };
  }

  public triggerInteract(): void {
    if (this.phase === 'playing') {
      this.handleEnterExitVehicle();
    }
  }

  public triggerHorn(): void {
    if (this.phase === 'playing' && this.inVehicle && this.playerVehicle) {
      this.sound.init();
      this.sound.playHorn();
      const car = this.playerVehicle.state;
      this.scareNearbyPedestrians(car.x, car.z, 22);
      this.yieldTrafficToHorn(this.playerVehicle);
    }
  }

  private yieldTrafficToHorn(honker: SimVehicle): void {
    const hs = honker.state;
    const { fx, fz } = getCarBasis(hs.heading);
    for (const v of this.vehicles) {
      if (v === honker || !v.isTraffic || v.roadRageState !== 'none' || v.aiTurnState) continue;
      const dx = v.state.x - hs.x;
      const dz = v.state.z - hs.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 52 || dist < 1) continue;
      const { fx: vfx, fz: vfz } = getCarBasis(v.state.heading);
      const sameDir = fx * vfx + fz * vfz;
      const aheadDot = (dx * fx + dz * fz) / dist;
      if (sameDir > 0.4 && aheadDot > 0.25) {
        const maxL = getMaxLaneIdx(v.aiLaneAxis, v.aiRoadCenter);
        if (v.aiLaneIndex < maxL) {
          v.aiLaneIndex++;
          v.aiLaneCoord = getLaneCoord(v.aiLaneAxis, v.aiRoadCenter, v.aiDir, v.aiLaneIndex);
        }
        v.yieldTimer = 3.5;
        v.blinkerMode = 'right';
        v.blinkerTimer = 2.6;
      }
    }
  }

  public setTimeOfDay(tod: TimeOfDay): void {
    this.timeOfDay = tod;
    this.applyTimeOfDay(tod);
    this.pushHudSnapshot();
  }

  public repairCurrentVehicle(resetPosition = false): void {
    const target = this.playerVehicle;
    if (!target) return;
    target.state.integrity = 100;
    target.state.nitro = 100;
    target.state.terrainPitch = 0;
    target.state.terrainRoll = 0;
    target.state.sagPitch = 0;
    target.state.sagRoll = 0;
    target.state.rideHeightOffset = 0;
    target.state.wheelCamber = [0, 0, 0, 0];
    target.state.waterTimer = 0;
    target.state.zones = {
      frontLeft: 0,
      frontRight: 0,
      rearLeft: 0,
      rearRight: 0,
      leftSide: 0,
      rightSide: 0,
    };
    target.state.detachedParts = {
      frontBumper: false,
      rearBumper: false,
      hood: false,
      spoiler: false,
      leftDoor: false,
      rightDoor: false,
      leftHeadlightBroken: false,
      rightHeadlightBroken: false,
      windshieldCracked: false,
    };
    target.rig.resetDeformation();

    if (resetPosition || isOverWater(target.state.x, target.state.z)) {
      target.state.x = -85 - 2.35;
      target.state.z = -145;
      target.state.y = getGroundHeightAt(-85 - 2.35, -145);
      target.state.vx = 0;
      target.state.vy = 0;
      target.state.vz = 0;
      target.state.heading = Math.PI;
      this.city.updateStreaming(target.state.x, target.state.z, target.state.heading, 1.0, 99);
      document.body.dataset.loadedChunks = String(this.city.getLoadedChunkCount());
    }
    this.pushHudSnapshot();
  }

  public spawnSandboxCar(modelId: CarModelId, colorHex?: number): void {
    const spec = CAR_SPECS[modelId];
    const originX = this.inVehicle && this.playerVehicle ? this.playerVehicle.state.x : this.playerX;
    const originZ = this.inVehicle && this.playerVehicle ? this.playerVehicle.state.z : this.playerZ;
    const originH = this.inVehicle && this.playerVehicle ? this.playerVehicle.state.heading : this.playerHeading;

    if (this.playerVehicle && this.inVehicle) {
      const old = this.playerVehicle;
      const oldIdx = this.vehicles.indexOf(old);
      if (oldIdx !== -1) this.vehicles.splice(oldIdx, 1);
      this.scene.remove(old.rig.root);
      old.rig.dispose();

      this.spawnHeroCar(modelId, originX, originZ, originH, colorHex ?? spec.defaultColor);
    } else {
      const { fx, fz } = getCarBasis(originH);
      const sx = originX + fx * 4.5;
      const sz = originZ + fz * 4.5;
      const state = createVehicleState(spec, sx, sz, originH);
      const rig = buildCarVisualRig(spec, this.textures, this.isSoftwareGl, colorHex ?? spec.defaultColor);
      rig.setDriverVisible(false);
      rig.root.position.set(state.x, state.y, state.z);
      rig.root.rotation.y = state.heading;
      this.scene.add(rig.root);
      const sim: SimVehicle = {
        id: this.nextId++,
        state,
        rig,
        isTraffic: false,
        isPolice: false,
        aiSpeedTarget: 0,
        aiLaneAxis: 'z',
        aiRoadCenter: sx,
        aiLaneIndex: 0,
        aiLaneCoord: sx,
        aiDir: 1,
        aiTurnCooldown: 0,
        aiTurnState: null,
        blinkerMode: 'none',
        blinkerTimer: 0,
        yieldTimer: 0,
        overtakeCooldown: 0,
        panicTimer: 0,
        roadRageState: 'none',
        roadRageTimer: 0,
        hornTimer: 0,
        boxSide: 1,
        driverExited: false,
        policeCalled: false,
        crashFault: 'player',
        policeState: 'patrol',
        policeTimer: 0,
        policeIncidentX: 0,
        policeIncidentZ: 0,
        policeTargetNpc: null,
        sirenTimer: 0,
        aiReverseTimer: 0,
        aiReverseSteer: 0,
        aiStuckTimer: 0,
        leftDoorAngle: 0,
        rightDoorAngle: 0,
        leftDoorHoldTimer: 0,
        rightDoorHoldTimer: 0,
      };
      this.vehicles.push(sim);
      this.enterVehicle(sim);
    }
    this.pushHudSnapshot();
  }

  public setVehiclePaintColor(hex: number): void {
    if (this.playerVehicle) {
      this.playerVehicle.rig.setPaintColor(hex);
    }
  }

  private applyTimeOfDay(tod: TimeOfDay): void {
    const uniforms = this.sky.material.uniforms;
    const skySunPos = new THREE.Vector3();
    const lightDir = new THREE.Vector3();

    if (tod === 'day') {
      uniforms['turbidity'].value = 4.2;
      uniforms['rayleigh'].value = 1.4;
      uniforms['mieCoefficient'].value = 0.005;
      uniforms['mieDirectionalG'].value = 0.82;
      skySunPos.setFromSphericalCoords(1, THREE.MathUtils.degToRad(50), THREE.MathUtils.degToRad(140));
      lightDir.copy(skySunPos);
      this.sunLight.color.setHex(0xfff5e0);
      this.sunLight.intensity = 2.3;
      this.hemiLight.color.setHex(0xa5d8ff);
      this.hemiLight.groundColor.setHex(0x334155);
      this.hemiLight.intensity = 0.72;
      this.scene.environmentIntensity = 1.0;
      this.scene.fog = new THREE.FogExp2(0x9bc4e2, 0.0021);
      this.renderer.toneMappingExposure = 1.1;
      this.city.setNightModeFactor(0);
    } else if (tod === 'sunset') {
      uniforms['turbidity'].value = 10.0;
      uniforms['rayleigh'].value = 3.4;
      uniforms['mieCoefficient'].value = 0.014;
      uniforms['mieDirectionalG'].value = 0.86;
      skySunPos.setFromSphericalCoords(1, THREE.MathUtils.degToRad(84), THREE.MathUtils.degToRad(225));
      lightDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(76), THREE.MathUtils.degToRad(225));
      this.sunLight.color.setHex(0xff8a3d);
      this.sunLight.intensity = 1.7;
      this.hemiLight.color.setHex(0x7c3f6e);
      this.hemiLight.groundColor.setHex(0x0b1120);
      this.hemiLight.intensity = 0.24;
      this.scene.environmentIntensity = 0.28;
      this.scene.fog = new THREE.FogExp2(0x3b2336, 0.0026);
      this.renderer.toneMappingExposure = 0.9;
      this.city.setNightModeFactor(0.65);
    } else {
      uniforms['turbidity'].value = 1.5;
      uniforms['rayleigh'].value = 0.06;
      uniforms['mieCoefficient'].value = 0.001;
      uniforms['mieDirectionalG'].value = 0.65;
      skySunPos.setFromSphericalCoords(1, THREE.MathUtils.degToRad(108), THREE.MathUtils.degToRad(180));
      lightDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(48), THREE.MathUtils.degToRad(195));
      this.sunLight.color.setHex(0x7da6ff);
      this.sunLight.intensity = 0.62;
      this.hemiLight.color.setHex(0x162447);
      this.hemiLight.groundColor.setHex(0x03050a);
      this.hemiLight.intensity = 0.12;
      this.scene.environmentIntensity = 0.08;
      this.scene.fog = new THREE.FogExp2(0x050812, 0.003);
      this.renderer.toneMappingExposure = 0.85;
      this.city.setNightModeFactor(1.0);
    }

    uniforms['sunPosition'].value.copy(skySunPos);
    this.sunOffset.copy(lightDir).multiplyScalar(135);
    this.sunLight.position.copy(this.sunLight.target.position).add(this.sunOffset);
  }

  // --- Input Handlers ---

  private handleKeyDown = (e: KeyboardEvent) => {
    const code = e.code;
    if (this.phase === 'title') {
      if (code === 'Enter' || code === 'Space') {
        e.preventDefault();
        this.startGame();
      }
      return;
    }

    if (code === 'Escape' || code === 'KeyP') {
      e.preventDefault();
      if (this.phase === 'playing') this.pauseGame();
      else if (this.phase === 'paused') this.resumeGame();
      return;
    }

    if (this.phase !== 'playing') return;

    if (!this.keys.has(code)) {
      if (code === 'KeyV') {
        this.toggleCameraMode();
      } else if (code === 'KeyF') {
        this.handleEnterExitVehicle();
      } else if (code === 'KeyR') {
        this.repairCurrentVehicle(false);
      } else if (code === 'KeyM') {
        this.toggleMute();
      } else if (code === 'KeyG' && this.inVehicle) {
        this.triggerHorn();
      }
    }

    this.keys.add(code);
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private handleWindowBlur = () => {
    this.keys.clear();
    this.isDraggingCam = false;
  };

  private handleVisibilityChange = () => {
    if (document.hidden) {
      this.keys.clear();
      this.isDraggingCam = false;
    }
  };

  private handlePointerDown = (e: PointerEvent) => {
    if (this.phase !== 'playing') return;
    this.sound.init();
    this.sound.resume();
    this.isDraggingCam = true;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
  };

  private handlePointerMove = (e: PointerEvent) => {
    if (!this.isDraggingCam || this.phase !== 'playing') return;
    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;

    if (this.inVehicle) {
      this.camYawOffset -= dx * 0.0055;
      this.camPitchOffset = THREE.MathUtils.clamp(this.camPitchOffset + dy * 0.004, -0.25, 0.7);
    } else {
      this.playerHeading -= dx * 0.0055;
      this.camPitchOffset = THREE.MathUtils.clamp(this.camPitchOffset + dy * 0.004, -0.35, 0.75);
    }
  };

  private handlePointerUp = () => {
    this.isDraggingCam = false;
  };

  private handleResize = () => {
    if (this.destroyed) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  // --- Enter / Exit / Hijack Vehicle ---

  private findNearestVehicle(maxDist: number): SimVehicle | null {
    let best: SimVehicle | null = null;
    let bestD = maxDist * maxDist;
    for (const v of this.vehicles) {
      const dx = v.state.x - this.playerX;
      const dz = v.state.z - this.playerZ;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestD) {
        bestD = dSq;
        best = v;
      }
    }
    return best;
  }

  private enterVehicle(v: SimVehicle): void {
    if (this.playerVehicle && this.playerVehicle !== v) {
      this.playerVehicle.isTraffic = false;
      this.playerVehicle.rig.setDriverVisible(false);
    }
    v.isTraffic = false;
    v.driverExited = true;
    v.rig.setDriverVisible(this.cameraMode === 'third');
    this.playerVehicle = v;
    this.inVehicle = true;
    this.playerRig.root.visible = false;
    this.camYawOffset = 0;
  }

  private getDoorAnchors(car: VehiclePhysicsState): {
    seatX: number;
    seatZ: number;
    sillX: number;
    sillZ: number;
    outsideX: number;
    outsideZ: number;
  } {
    const { fx, fz, rx, rz } = getCarBasis(car.heading);
    const seatOffsetR = car.spec.isTruck ? -0.5 : -0.34;
    const sillOffsetR = -(car.spec.width * 0.5 + 0.25);
    const doorOutsideR = -(car.spec.width * 0.5 + 1.15);
    const doorForward = car.spec.isTruck ? 0.45 : 0.18;
    return {
      seatX: car.x + rx * seatOffsetR + fx * doorForward,
      seatZ: car.z + rz * seatOffsetR + fz * doorForward,
      sillX: car.x + rx * sillOffsetR + fx * doorForward,
      sillZ: car.z + rz * sillOffsetR + fz * doorForward,
      outsideX: car.x + rx * doorOutsideR + fx * doorForward,
      outsideZ: car.z + rz * doorOutsideR + fz * doorForward,
    };
  }

  private handleEnterExitVehicle(): void {
    if (this.playerVehicleAction) return;

    if (this.inVehicle && this.playerVehicle) {
      const car = this.playerVehicle;
      const { seatX, seatZ } = this.getDoorAnchors(car.state);
      car.rig.setDriverVisible(false);
      this.playerX = seatX;
      this.playerZ = seatZ;
      this.playerY = getGroundHeightAt(seatX, seatZ);
      this.playerHeading = car.state.heading;
      this.playerVx = 0;
      this.playerVy = 0;
      this.playerVz = 0;
      this.playerRig.root.position.set(this.playerX, this.playerY, this.playerZ);
      this.playerRig.root.rotation.set(0, this.playerHeading, 0);
      this.playerRig.root.visible = this.cameraMode === 'third';
      this.playerVehicleAction = {
        mode: 'exiting',
        car,
        elapsed: 0,
        duration: 0.66,
        ejectedDriver: false,
        startX: seatX,
        startZ: seatZ,
      };
      this.sound.updateVehicleAudio(false, 0, 0, 0, true);
    } else {
      const nearest = this.findNearestVehicle(5.6);
      if (nearest) {
        const occupiedNpc = nearest.isTraffic && !nearest.driverExited;
        if (occupiedNpc) {
          // Stop traffic car while yanking driver out
          nearest.isTraffic = false;
          nearest.state.vx *= 0.25;
          nearest.state.vz *= 0.25;
        }
        this.playerVehicleAction = {
          mode: occupiedNpc ? 'hijack' : 'entering',
          car: nearest,
          elapsed: 0,
          duration: occupiedNpc ? 1.05 : 0.64,
          ejectedDriver: false,
          startX: this.playerX,
          startZ: this.playerZ,
        };
      }
    }
    this.pushHudSnapshot();
  }

  private stepPlayerVehicleAction(dt: number): void {
    const act = this.playerVehicleAction;
    if (!act) return;
    act.elapsed += dt;
    const t = act.elapsed;
    const s = act.car.state;
    const { fx, fz, rx, rz } = getCarBasis(s.heading);
    const { seatX, seatZ, sillX, sillZ, outsideX, outsideZ } = this.getDoorAnchors(s);
    const groundAtDoor = getGroundHeightAt(outsideX, outsideZ);

    if (act.mode === 'exiting') {
      // 0..0.18 open door while seated, 0.16..0.46 duck & step out past door, 0.42..0.66 stand & close door
      const walkT = THREE.MathUtils.clamp((t - 0.16) / 0.32, 0, 1);
      const smooth = walkT * walkT * (3 - 2 * walkT);
      this.playerX = THREE.MathUtils.lerp(sillX, outsideX, smooth);
      this.playerZ = THREE.MathUtils.lerp(sillZ, outsideZ, smooth);
      this.playerY = groundAtDoor;
      this.playerHeading = s.heading + Math.sin(walkT * Math.PI) * 0.45;
      const swing = Math.sin(walkT * Math.PI * 2) * 0.55;
      // Crouch below roof height while emerging through the doorway, then stand tall outside
      const crouchScale = THREE.MathUtils.lerp(0.68, 1.0, smooth);
      this.playerRig.root.scale.set(1, crouchScale, 1);
      this.playerRig.leftLeg.rotation.x = swing;
      this.playerRig.rightLeg.rotation.x = -swing;
      this.playerRig.leftArm.rotation.x = 0.55 - swing * 0.5;
      this.playerRig.rightArm.rotation.x = 0.55 + swing * 0.5;
      this.playerRig.root.position.set(this.playerX, this.playerY, this.playerZ);
      this.playerRig.root.rotation.set(0, this.playerHeading, 0);
      this.playerRig.root.visible = this.cameraMode === 'third' && t >= 0.14;
      if (t < 0.14) act.car.rig.setDriverVisible(this.cameraMode === 'third');
      else act.car.rig.setDriverVisible(false);

      if (t >= act.duration) {
        this.inVehicle = false;
        this.playerX = outsideX;
        this.playerZ = outsideZ;
        this.playerY = groundAtDoor;
        this.playerVx = 0;
        this.playerVz = 0;
        this.playerVy = 0;
        this.playerHeading = s.heading;
        this.playerRig.root.scale.set(1, 1, 1);
        this.playerRig.leftArm.rotation.x = 0;
        this.playerRig.rightArm.rotation.x = 0;
        this.playerRig.leftLeg.rotation.x = 0;
        this.playerRig.rightLeg.rotation.x = 0;
        this.playerVehicleAction = null;
        this.pushHudSnapshot();
      }
      return;
    }

    if (act.mode === 'entering') {
      // 0..0.24 approach outside door & open, 0.24..0.48 duck & step into sill, 0.46..0.64 seat driver & close door
      if (t < 0.24) {
        const u = THREE.MathUtils.clamp(t / 0.24, 0, 1);
        let ax = THREE.MathUtils.lerp(act.startX, outsideX, u);
        let az = THREE.MathUtils.lerp(act.startZ, outsideZ, u);
        const slide = resolveCircleVsOrientedCar(ax, az, groundAtDoor, 0.44, s);
        if (slide.hit) {
          ax = slide.x;
          az = slide.z;
        }
        this.playerX = ax;
        this.playerZ = az;
        this.playerY = getGroundHeightAt(this.playerX, this.playerZ);
        this.playerHeading = Math.atan2(-(outsideX - act.startX), -(outsideZ - act.startZ));
        if (Math.hypot(outsideX - act.startX, outsideZ - act.startZ) < 0.15) {
          this.playerHeading = Math.atan2(-(seatX - outsideX), -(seatZ - outsideZ));
        }
        const swing = Math.sin(u * Math.PI * 2) * 0.5;
        this.playerRig.root.scale.set(1, 1, 1);
        this.playerRig.leftLeg.rotation.x = swing;
        this.playerRig.rightLeg.rotation.x = -swing;
        this.playerRig.leftArm.rotation.x = 0.35;
        this.playerRig.rightArm.rotation.x = 0.85;
        this.playerRig.root.visible = this.cameraMode === 'third';
      } else if (t < 0.48) {
        const u = THREE.MathUtils.clamp((t - 0.24) / 0.24, 0, 1);
        const smooth = u * u * (3 - 2 * u);
        this.playerX = THREE.MathUtils.lerp(outsideX, sillX, smooth);
        this.playerZ = THREE.MathUtils.lerp(outsideZ, sillZ, smooth);
        this.playerY = groundAtDoor;
        this.playerHeading = s.heading;
        const swing = Math.sin(u * Math.PI * 2) * 0.45;
        this.playerRig.root.scale.set(1, THREE.MathUtils.lerp(1.0, 0.68, smooth), 1);
        this.playerRig.leftLeg.rotation.x = swing;
        this.playerRig.rightLeg.rotation.x = -swing;
        this.playerRig.leftArm.rotation.x = 0.4;
        this.playerRig.rightArm.rotation.x = 0.4;
        this.playerRig.root.visible = this.cameraMode === 'third';
      } else {
        this.playerX = seatX;
        this.playerZ = seatZ;
        this.playerY = groundAtDoor;
        this.playerRig.root.scale.set(1, 1, 1);
        this.playerRig.root.visible = false;
        act.car.rig.setDriverVisible(this.cameraMode === 'third');
      }
      this.playerRig.root.position.set(this.playerX, this.playerY, this.playerZ);
      this.playerRig.root.rotation.set(0, this.playerHeading, 0);

      if (t >= act.duration) {
        this.enterVehicle(act.car);
        this.playerVehicleAction = null;
        this.pushHudSnapshot();
      }
      return;
    }

    // mode === 'hijack': 0..0.28 approach & rip door open, 0.28 eject driver onto street, 0.54..0.82 step in, 0.82..1.05 close door
    if (t < 0.28) {
      const u = THREE.MathUtils.clamp(t / 0.28, 0, 1);
      let ax = THREE.MathUtils.lerp(act.startX, outsideX, u);
      let az = THREE.MathUtils.lerp(act.startZ, outsideZ, u);
      const slide = resolveCircleVsOrientedCar(ax, az, groundAtDoor, 0.44, s);
      if (slide.hit) {
        ax = slide.x;
        az = slide.z;
      }
      this.playerX = ax;
      this.playerZ = az;
      this.playerY = getGroundHeightAt(this.playerX, this.playerZ);
      this.playerHeading = Math.atan2(-(seatX - this.playerX), -(seatZ - this.playerZ));
      this.playerRig.leftLeg.rotation.x = Math.sin(u * Math.PI * 2) * 0.45;
      this.playerRig.rightLeg.rotation.x = -Math.sin(u * Math.PI * 2) * 0.45;
      this.playerRig.leftArm.rotation.x = 1.1 * u;
      this.playerRig.rightArm.rotation.x = 1.35 * u;
      this.playerRig.root.visible = this.cameraMode === 'third';
    } else {
      if (!act.ejectedDriver) {
        act.ejectedDriver = true;
        act.car.driverExited = true;
        act.car.rig.setDriverVisible(false);
        this.sound.playPunchThud();
        this.trauma = Math.min(1, this.trauma + 0.16);
        this.chaosPoints += act.car.isPolice ? 55 : 30;
        const ejectedRole = act.car.isPolice ? 'police' : 'civilian';
        const pedRig = buildHumanRig(this.textures, act.car.id + 41, false, ejectedRole);
        const dropX = outsideX - rx * 0.35;
        const dropZ = outsideZ - rz * 0.35;
        const dropY = getGroundHeightAt(dropX, dropZ);
        pedRig.root.position.set(dropX, dropY, dropZ);
        this.scene.add(pedRig.root);
        const thrownPed: SimPedestrian = {
          id: this.nextId++,
          x: dropX,
          y: dropY,
          z: dropZ,
          vx: -rx * 5.8 - fx * 1.4,
          vz: -rz * 5.8 - fz * 1.4,
          heading: Math.atan2(rx, rz),
          speed: 2.3,
          walkPhase: 0,
          state: 'knocked',
          role: ejectedRole,
          stateTimer: 1.9,
          confrontElapsed: 0,
          callingPhone: false,
          ragdollPitch: 0,
          angryAfterGetUp: true,
          bumpCount: 0,
          bumpCooldown: 0,
          kickCooldown: 0,
          kickAnimTimer: 0,
          ownerCar: act.car,
          rig: pedRig,
        };
        this.pedestrians.push(thrownPed);
        this.addSpeechBubble(
          act.car.isPolice ? 'Офицер ДПС' : 'Водитель',
          act.car.isPolice ? 'Стоять! Угон патрульной машины!' : 'Эй!! Моя тачка!! Вылезай!',
          dropX,
          dropY + 2.0,
          dropZ,
          'angry',
          3.0,
          thrownPed
        );
        if (act.car.isPolice) {
          this.setPoliceBanner('ВЫ ВЫКИНУЛИ ОФИЦЕРА И УГНАЛИ ПАТРУЛЬНУЮ МАШИНУ!');
        }
      }

      if (t < 0.54) {
        // Yank & throw driver outward
        const u = (t - 0.28) / 0.26;
        this.playerX = outsideX;
        this.playerZ = outsideZ;
        this.playerY = groundAtDoor;
        this.playerHeading = Math.atan2(-(seatX - outsideX), -(seatZ - outsideZ));
        this.playerRig.leftArm.rotation.x = 1.35 * (1 - u * 0.4);
        this.playerRig.rightArm.rotation.x = 1.55 * (1 - u * 0.4);
        this.playerRig.leftLeg.rotation.x = 0.2;
        this.playerRig.rightLeg.rotation.x = -0.2;
        this.playerRig.root.visible = this.cameraMode === 'third';
      } else if (t < 0.82) {
        const u = THREE.MathUtils.clamp((t - 0.54) / 0.28, 0, 1);
        const smooth = u * u * (3 - 2 * u);
        this.playerX = THREE.MathUtils.lerp(outsideX, sillX, smooth);
        this.playerZ = THREE.MathUtils.lerp(outsideZ, sillZ, smooth);
        this.playerY = groundAtDoor;
        this.playerHeading = s.heading;
        const swing = Math.sin(u * Math.PI * 2) * 0.45;
        this.playerRig.root.scale.set(1, THREE.MathUtils.lerp(1.0, 0.68, smooth), 1);
        this.playerRig.leftLeg.rotation.x = swing;
        this.playerRig.rightLeg.rotation.x = -swing;
        this.playerRig.leftArm.rotation.x = 0.45;
        this.playerRig.rightArm.rotation.x = 0.45;
        this.playerRig.root.visible = this.cameraMode === 'third';
      } else {
        this.playerX = seatX;
        this.playerZ = seatZ;
        this.playerY = groundAtDoor;
        this.playerRig.root.scale.set(1, 1, 1);
        this.playerRig.root.visible = false;
        act.car.rig.setDriverVisible(this.cameraMode === 'third');
      }
    }

    this.playerRig.root.position.set(this.playerX, this.playerY, this.playerZ);
    this.playerRig.root.rotation.set(0, this.playerHeading, 0);

    if (t >= act.duration) {
      this.enterVehicle(act.car);
      this.playerVehicleAction = null;
      this.pushHudSnapshot();
    }
  }

  // --- Simulation Step ---

  private scheduleNextTick(): void {
    if (this.destroyed) return;
    if (this.isSoftwareGl) {
      this.afterDraw(() => {
        if (!this.destroyed) this.tick();
      });
    } else {
      this.frameId = requestAnimationFrame(() => this.tick());
    }
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.destroyed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const status = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
      if (status === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private tick(): void {
    if (this.destroyed) return;

    const now = performance.now();
    const rawDt = Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000));
    this.lastTime = now;

    if (this.phase === 'title') {
      this.simTime += rawDt;
      this.city.updateStreaming(-85, -115, Math.PI, rawDt, 1);
      document.body.dataset.loadedChunks = String(this.city.getLoadedChunkCount());
      this.stepAmbientWorld(rawDt);
      this.updateTitleCamera(rawDt);
      this.city.updateWater(rawDt);
      this.city.updateTrafficLights(this.simTime);
      this.city.updateDoors(-64.5, -108.5, rawDt);
      this.renderer.render(this.scene, this.camera);
      this.scheduleNextTick();
      return;
    }

    if (this.phase === 'paused' || this.phase === 'gameover') {
      this.renderer.render(this.scene, this.camera);
      this.scheduleNextTick();
      return;
    }

    this.simTime += rawDt;
    const prePx = this.inVehicle && this.playerVehicle ? this.playerVehicle.state.x : this.playerX;
    const prePz = this.inVehicle && this.playerVehicle ? this.playerVehicle.state.z : this.playerZ;
    const preHeading = this.inVehicle && this.playerVehicle ? this.playerVehicle.state.heading : this.playerHeading;
    // Budgeted chunk streaming: max 1 chunk or bridge built per frame while driving
    this.city.updateStreaming(prePx, prePz, preHeading, rawDt, 1);
    document.body.dataset.loadedChunks = String(this.city.getLoadedChunkCount());

    this.city.updateWater(rawDt);
    this.city.updateTrafficLights(this.simTime);

    if (this.hitstopTimer > 0) {
      this.hitstopTimer = Math.max(0, this.hitstopTimer - rawDt);
    } else {
      this.stepGameplay(rawDt);
    }

    const activePx = this.inVehicle && this.playerVehicle ? this.playerVehicle.state.x : this.playerX;
    const activePz = this.inVehicle && this.playerVehicle ? this.playerVehicle.state.z : this.playerZ;
    const activeHeading = this.inVehicle && this.playerVehicle ? this.playerVehicle.state.heading : this.playerHeading;
    this.stepTrafficStreaming(activePx, activePz, activeHeading, rawDt);
    this.stepPedestrianStreaming(activePx, activePz, activeHeading, rawDt);
    this.city.updateDoors(activePx, activePz, rawDt);

    this.stepParticlesAndDebris(rawDt);
    this.updateActiveCamera(rawDt);
    this.sunLight.target.position.set(activePx, 0, activePz);
    this.sunLight.position.copy(this.sunLight.target.position).add(this.sunOffset);

    if (this.inVehicle && this.playerVehicle && this.timeOfDay !== 'day') {
      const car = this.playerVehicle.state;
      const d = car.detachedParts;
      const workingLights = (d.leftHeadlightBroken ? 0 : 0.5) + (d.rightHeadlightBroken ? 0 : 0.5);
      const { fx, fz } = getCarBasis(car.heading);
      this.headlightSpot.position.set(
        car.x + fx * (car.spec.length * 0.48),
        car.y + 0.85,
        car.z + fz * (car.spec.length * 0.48)
      );
      this.headlightSpot.target.position.set(car.x + fx * 26, car.y - 0.5, car.z + fz * 26);
      this.headlightSpot.intensity = (this.timeOfDay === 'night' ? 38 : 13) * workingLights;
    } else {
      this.headlightSpot.intensity = 0;
    }

    this.renderer.render(this.scene, this.camera);

    this.hudTimer += rawDt;
    if (this.hudTimer >= 0.1) {
      this.hudTimer = 0;
      this.pushHudSnapshot();
    }

    this.scheduleNextTick();
  }

  private disposeShipMesh(mesh: THREE.Group): void {
    this.scene.remove(mesh);
    mesh.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const m = obj as THREE.Mesh;
        m.geometry?.dispose();
        if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
        else m.material?.dispose();
      }
    });
  }

  private stepShips(dt: number): void {
    const px = this.phase === 'title' ? -85 : this.inVehicle && this.playerVehicle ? this.playerVehicle.state.x : this.playerX;
    const pz = this.phase === 'title' ? -115 : this.inVehicle && this.playerVehicle ? this.playerVehicle.state.z : this.playerZ;

    for (const ship of this.ships) {
      ship.x += ship.dir * ship.spec.speed * dt;
      if (ship.dir === 1 && ship.x >= ship.spec.xMax) {
        ship.x = ship.spec.xMax;
        ship.dir = -1;
      } else if (ship.dir === -1 && ship.x <= ship.spec.xMin) {
        ship.x = ship.spec.xMin;
        ship.dir = 1;
      }
      ship.heading = ship.dir === 1 ? 0 : Math.PI;
      ship.bobPhase += dt * 1.9;
      ship.y = WATER_LEVEL + 0.12 + Math.sin(ship.bobPhase) * 0.14;

      const distToPlayer = Math.hypot(ship.x - px, ship.z - pz);
      if (distToPlayer < 420 && !ship.mesh) {
        ship.mesh = buildShipVisual(ship.spec);
        this.scene.add(ship.mesh);
      } else if (distToPlayer > 480 && ship.mesh) {
        this.disposeShipMesh(ship.mesh);
        ship.mesh = null;
      }

      if (ship.mesh) {
        ship.mesh.position.set(ship.x, ship.y, ship.z);
        ship.mesh.rotation.y = ship.heading;
        ship.mesh.rotation.z = Math.cos(ship.bobPhase * 0.85) * 0.032;
      }

      ship.wakeTimer -= dt;
      if (ship.wakeTimer <= 0 && distToPlayer < 260) {
        ship.wakeTimer = 0.24;
        const sternX = ship.x - ship.dir * (ship.spec.length * 0.46);
        this.spawnParticle(
          sternX,
          WATER_LEVEL + 0.14,
          ship.z + (Math.random() - 0.5) * (ship.spec.width * 0.5),
          -ship.dir * 2.2,
          0.5,
          (Math.random() - 0.5) * 1.4,
          0.42,
          0.75,
          0.6,
          0xe0f2fe
        );
      }
    }
  }

  private stepTrafficStreaming(px: number, pz: number, heading: number, dt: number): void {
    this.trafficStreamTimer += dt;
    if (this.trafficStreamTimer < 0.35) return;
    this.trafficStreamTimer = 0;

    const unloadDistSq = 295 * 295;
    let recycled = 0;

    for (const v of this.vehicles) {
      if (!v.isTraffic || recycled >= 3) continue;
      if (!v.isPolice && v.roadRageState !== 'none' && v.roadRageState !== 'cooldown') continue;
      if (v.isPolice && v.policeState !== 'patrol') continue;
      if (v.aiTurnState || v.driverExited) continue;

      const dx = v.state.x - px;
      const dz = v.state.z - pz;
      if (dx * dx + dz * dz <= unloadDistSq) continue;

      const slot = this.findStreamRoadSpawn(px, pz, heading, 155, 275, 18);
      if (!slot) continue;

      v.state.x = slot.x;
      v.state.z = slot.z;
      v.state.y = getGroundHeightAt(slot.x, slot.z);
      v.state.heading = slot.heading;
      const { fx, fz } = getCarBasis(slot.heading);
      const cruise = v.aiSpeedTarget * 0.65;
      v.state.vx = fx * cruise;
      v.state.vz = fz * cruise;
      v.state.vy = 0;
      v.state.waterTimer = 0;
      if (v.state.integrity < 99) {
        v.state.integrity = 100;
        v.rig.resetDeformation();
      }
      v.aiLaneAxis = slot.axis;
      v.aiRoadCenter = slot.roadCenter;
      v.aiLaneIndex = slot.laneIndex;
      v.aiLaneCoord = slot.laneCoord;
      v.aiDir = slot.dir;
      v.aiTurnState = null;
      v.blinkerMode = 'none';
      v.roadRageState = 'none';
      v.aiReverseTimer = 0;
      v.aiReverseSteer = 0;
      v.aiStuckTimer = 0;
      v.leftDoorAngle = 0;
      v.rightDoorAngle = 0;
      v.leftDoorHoldTimer = 0;
      v.rightDoorHoldTimer = 0;
      v.rig.setDriverVisible(true);
      recycled++;
    }
  }

  private stepPedestrianStreaming(px: number, pz: number, heading: number, dt: number): void {
    this.pedStreamTimer += dt;
    if (this.pedStreamTimer < 0.4) return;
    this.pedStreamTimer = 0;

    const unloadDistSq = 230 * 230;
    const { fx, fz } = getCarBasis(heading);
    const maxBound = WORLD_HALF_SIZE - 26;
    let recycled = 0;

    for (const p of this.pedestrians) {
      if (p.role !== 'civilian' || p.state !== 'walk' || recycled >= 4) continue;
      const dx = p.x - px;
      const dz = p.z - pz;
      if (dx * dx + dz * dz <= unloadDistSq) continue;

      for (let attempt = 0; attempt < 12; attempt++) {
        const dist = 75 + Math.random() * 120;
        const lat = (Math.random() - 0.5) * 165;
        const tx = px + fx * dist - fz * lat;
        const tz = pz + fz * dist + fx * lat;
        if (Math.abs(tx) > maxBound || Math.abs(tz) > maxBound) continue;
        if (isOnRoad(tx, tz) || isOverWater(tx, tz)) continue;
        const ty = getGroundHeightAt(tx, tz);
        if (resolveStaticCollisions(tx, tz, ty, 0.45).hit) continue;

        p.x = tx;
        p.z = tz;
        p.y = ty;
        p.vx = 0;
        p.vz = 0;
        p.heading = Math.random() * Math.PI * 2;
        p.rig.root.position.set(p.x, p.y, p.z);
        p.rig.root.rotation.set(0, p.heading, 0);
        recycled++;
        break;
      }
    }
  }

  private stepAmbientWorld(dt: number): void {
    this.stepShips(dt);
    for (const v of this.vehicles) {
      if (!v.isTraffic) continue;
      const aiInput = this.computeTrafficInput(v, dt);
      stepVehiclePhysics(v.state, aiInput, dt);
      this.syncCarRig(v, aiInput.throttle);
    }
    this.stepPedestrians(dt);
  }

  private stepGameplay(dt: number): void {
    this.stepShips(dt);

    let playerThrottle = 0;
    let playerSteer = 0;
    let playerHandbrake = false;
    let playerNitro = false;

    if (this.playerVehicleAction) {
      this.stepPlayerVehicleAction(dt);
    } else if (this.inVehicle && this.playerVehicle) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) playerThrottle += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) playerThrottle -= 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) playerSteer += 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) playerSteer -= 1;

      playerThrottle = THREE.MathUtils.clamp(playerThrottle + this.touchInput.throttle, -1, 1);
      playerSteer = THREE.MathUtils.clamp(playerSteer + this.touchInput.steer, -1, 1);
      playerHandbrake = this.keys.has('Space') || this.touchInput.handbrake;
      playerNitro = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchInput.nitro;
    } else {
      this.stepOnFootPlayer(dt);
    }

    // Build lightweight ship collider snapshot for this frame
    const shipColliders = this.ships.map((sh) => ({
      x: sh.x,
      z: sh.z,
      length: sh.spec.length,
      width: sh.spec.width,
      hullHeight: sh.spec.hullHeight,
    }));

    for (const v of this.vehicles) {
      // Smoothly animate car doors (open during enter/exit/hijack or NPC/police exit)
      let leftDoorTarget = 0;
      let rightDoorTarget = 0;
      if (this.playerVehicleAction && this.playerVehicleAction.car === v) {
        const act = this.playerVehicleAction;
        if (act.mode === 'exiting') {
          leftDoorTarget = act.elapsed < 0.44 ? 1 : 0;
        } else if (act.mode === 'entering') {
          leftDoorTarget = act.elapsed < 0.48 ? 1 : 0;
        } else {
          leftDoorTarget = act.elapsed < 0.82 ? 1 : 0;
        }
      } else {
        if (v.leftDoorHoldTimer > 0) {
          v.leftDoorHoldTimer = Math.max(0, v.leftDoorHoldTimer - dt);
          leftDoorTarget = 1;
        }
        if (v.rightDoorHoldTimer > 0) {
          v.rightDoorHoldTimer = Math.max(0, v.rightDoorHoldTimer - dt);
          rightDoorTarget = 1;
        }
      }
      v.leftDoorAngle = THREE.MathUtils.damp(v.leftDoorAngle, leftDoorTarget, 12, dt);
      v.rightDoorAngle = THREE.MathUtils.damp(v.rightDoorAngle, rightDoorTarget, 12, dt);

      let input: VehicleControlInput;
      if (this.playerVehicleAction && this.playerVehicleAction.car === v) {
        input = { throttle: 0, steer: 0, handbrake: true, nitro: false };
      } else if (!v.isTraffic && this.inVehicle && v === this.playerVehicle) {
        input = {
          throttle: playerThrottle,
          steer: playerSteer,
          handbrake: playerHandbrake,
          nitro: playerNitro,
        };
      } else if (v.isTraffic) {
        input = this.computeTrafficInput(v, dt);
      } else {
        input = { throttle: 0, steer: 0, handbrake: true, nitro: false };
      }

      const prevX = v.state.x;
      const prevZ = v.state.z;
      const res = stepVehiclePhysics(v.state, input, dt);

      // Physical Ship Hull Collisions for vehicles in or near the bay
      if (v.state.z > WATER_Z_MIN - 6 && v.state.z < WATER_Z_MAX + 6) {
        const radius = v.state.spec.width * 0.55;
        const shipHit = resolveShipCollisions(v.state.x, v.state.z, v.state.y, radius, shipColliders);
        if (shipHit.hit) {
          v.state.x = shipHit.x;
          v.state.z = shipHit.z;
          const vn = v.state.vx * shipHit.normalX + v.state.vz * shipHit.normalZ;
          if (vn < 0) {
            v.state.vx -= 1.3 * vn * shipHit.normalX;
            v.state.vz -= 1.3 * vn * shipHit.normalZ;
            if (v === this.playerVehicle && Math.abs(vn) > 3) {
              this.sound.playCrash(Math.abs(vn));
              this.trauma = Math.min(1, this.trauma + 0.2);
            }
          }
        }
      }

      if (v === this.playerVehicle && this.inVehicle) {
        const speedKmh = Math.hypot(v.state.vx, v.state.vz) * 3.6;
        if (speedKmh > this.maxSpeedKmh) this.maxSpeedKmh = speedKmh;
        this.distanceM += Math.hypot(v.state.x - prevX, v.state.z - prevZ);

        const { fx, fz } = getCarBasis(v.state.heading);
        const fSpeed = v.state.vx * fx + v.state.vz * fz;
        const { rpmRatio } = computeGearAndRpm(fSpeed, v.state.spec.maxSpeedKmh, input.throttle);
        this.sound.updateVehicleAudio(true, rpmRatio, input.throttle, res.lateralSlip, v.state.grounded);

        if (v.state.grounded && res.lateralSlip > 4.6) {
          this.spawnParticle(
            v.state.x + (Math.random() - 0.5) * 1.2,
            v.state.y + 0.18,
            v.state.z + (Math.random() - 0.5) * 1.2,
            (Math.random() - 0.5) * 1.5,
            1.4,
            (Math.random() - 0.5) * 1.5,
            0.42,
            0.55,
            -0.5,
            0xcbd5e1
          );
        }

        if (res.submerged) {
          if (Math.random() < 0.65) {
            this.spawnParticle(
              v.state.x + (Math.random() - 0.5) * 1.8,
              WATER_LEVEL + 0.15,
              v.state.z + (Math.random() - 0.5) * 1.8,
              (Math.random() - 0.5) * 3.2,
              2.2 + Math.random() * 2.5,
              (Math.random() - 0.5) * 3.2,
              0.38,
              0.55,
              12,
              0xe0f2fe
            );
          }
          v.state.integrity = Math.max(0, v.state.integrity - 48 * dt);
          this.playerHp = Math.max(0, this.playerHp - 52 * dt);
          if (this.playerHp <= 0 || v.state.waterTimer > 2.0) {
            this.playerHp = 0;
            this.triggerGameOver();
          }
        }
      }

      for (const imp of res.impacts) {
        this.handleImpactVisuals(v, imp);
      }

      if (v.state.integrity < 45) {
        this.smokeTimer += dt;
        if (this.smokeTimer > 0.08) {
          this.smokeTimer = 0;
          const { fx, fz } = getCarBasis(v.state.heading);
          const hoodX = v.state.x + fx * (v.state.spec.length * 0.32);
          const hoodZ = v.state.z + fz * (v.state.spec.length * 0.32);
          const isFire = v.state.integrity < 16;
          this.spawnParticle(
            hoodX + (Math.random() - 0.5) * 0.4,
            v.state.y + 1.15,
            hoodZ + (Math.random() - 0.5) * 0.4,
            (Math.random() - 0.5) * 1.2,
            2.6 + Math.random() * 1.2,
            (Math.random() - 0.5) * 1.2,
            isFire ? 0.48 : 0.65,
            0.7,
            -1.0,
            isFire ? (Math.random() < 0.5 ? 0xf97316 : 0xfacc15) : 0x334155
          );
        }
      }

      this.syncCarRig(v, input.throttle);
    }

    for (let i = this.speechBubbles.length - 1; i >= 0; i--) {
      const b = this.speechBubbles[i];
      b.ttl -= dt;
      if (b.ttl <= 0) {
        this.speechBubbles.splice(i, 1);
      } else if (b.followPed) {
        b.worldX = b.followPed.x;
        b.worldY = b.followPed.y + 2.05;
        b.worldZ = b.followPed.z;
      } else if (b.followCar) {
        b.worldX = b.followCar.state.x;
        b.worldY = b.followCar.state.y + 2.2;
        b.worldZ = b.followCar.state.z;
      }
    }
    if (this.policeBannerTimer > 0) {
      this.policeBannerTimer -= dt;
      if (this.policeBannerTimer <= 0) {
        this.policeBanner = null;
      }
    }

    // Vehicle-to-Vehicle Collisions (spatial broadphase)
    for (let i = 0; i < this.vehicles.length; i++) {
      const va = this.vehicles[i];
      for (let j = i + 1; j < this.vehicles.length; j++) {
        const vb = this.vehicles[j];
        if (Math.abs(va.state.x - vb.state.x) > 10 || Math.abs(va.state.z - vb.state.z) > 10) continue;
        const speedA = Math.hypot(va.state.vx, va.state.vz);
        const speedB = Math.hypot(vb.state.vx, vb.state.vz);
        const pair = resolveCarToCarCollisionPair(va.state, vb.state);
        if (pair) {
          if (pair.evtA) this.handleImpactVisuals(va, pair.evtA);
          if (pair.evtB) this.handleImpactVisuals(vb, pair.evtB);

          const playerInvolved =
            this.inVehicle && (va === this.playerVehicle || vb === this.playerVehicle);
          if (playerInvolved) {
            const npc = va === this.playerVehicle ? vb : va;
            const pSpeed = va === this.playerVehicle ? speedA : speedB;
            const nSpeed = va === this.playerVehicle ? speedB : speedA;
            if (npc.isTraffic && !npc.isPolice && (npc.roadRageState === 'none' || npc.roadRageState === 'cooldown')) {
              const fault: 'player' | 'npc' = pSpeed < 2.2 && nSpeed > 3.0 ? 'npc' : 'player';
              npc.roadRageState = 'honk_chase';
              npc.roadRageTimer = 15;
              npc.hornTimer = 0.05;
              npc.boxSide = Math.random() < 0.5 ? -1 : 1;
              npc.driverExited = false;
              npc.policeCalled = false;
              npc.crashFault = fault;
              this.addSpeechBubble(
                'Водитель',
                fault === 'player' ? 'Эй! Ты чё творишь?! Стой!' : 'Ай! Куда встал на дороге?!',
                npc.state.x,
                npc.state.y + 2.2,
                npc.state.z,
                'angry',
                2.8,
                undefined,
                npc
              );
            } else if (npc.isPolice && npc.policeState === 'patrol') {
              npc.policeState = 'pursuing_player';
              npc.policeTimer = 10;
              this.chaosPoints += 40;
              this.setPoliceBanner('ВЫ ПРОТАРАНИЛИ ПАТРУЛЬНУЮ МАШИНУ! ПОЛИЦИЯ НАЧАЛА ПОГОНЮ!');
            }
          } else if (vb.isTraffic) {
            vb.panicTimer = 3.0;
          }
        }
      }
    }

    this.stepDestructibles(dt);
    this.stepPedestrians(dt);
  }

  private stepOnFootPlayer(dt: number): void {
    let moveF = 0;
    let moveR = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) moveF += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) moveF -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) moveR -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) moveR += 1;

    moveF = THREE.MathUtils.clamp(moveF + this.touchInput.throttle, -1, 1);
    moveR = THREE.MathUtils.clamp(moveR - this.touchInput.steer, -1, 1);

    const sprinting =
      (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchInput.nitro) && this.stamina > 2;
    const baseSpeed = sprinting ? 9.4 : 5.2;

    const { fx, fz, rx, rz } = getCarBasis(this.playerHeading);
    let dirX = fx * moveF + rx * moveR;
    let dirZ = fz * moveF + rz * moveR;
    const len = Math.hypot(dirX, dirZ);
    if (len > 0.001) {
      dirX /= len;
      dirZ /= len;
      if (sprinting) this.stamina = Math.max(0, this.stamina - 22 * dt);
    } else {
      this.stamina = Math.min(100, this.stamina + 18 * dt);
    }

    this.playerVx = dirX * baseSpeed + this.playerKnockVx;
    this.playerVz = dirZ * baseSpeed + this.playerKnockVz;
    this.playerKnockVx *= Math.exp(-9.0 * dt);
    this.playerKnockVz *= Math.exp(-9.0 * dt);

    const prevX = this.playerX;
    const prevZ = this.playerZ;
    this.playerX += this.playerVx * dt;
    this.playerZ += this.playerVz * dt;

    const groundY = getGroundHeightAt(this.playerX, this.playerZ);
    if ((this.keys.has('Space') || this.touchInput.jump) && this.playerY <= groundY + 0.06) {
      this.playerVy = 7.2;
    }
    this.playerVy -= 20 * dt;
    this.playerY += this.playerVy * dt;
    if (this.playerY <= groundY) {
      this.playerY = groundY;
      this.playerVy = 0;
    }

    const col = resolveStaticCollisions(this.playerX, this.playerZ, this.playerY, 0.45);
    if (col.hit) {
      this.playerX = col.x;
      this.playerZ = col.z;
    }

    if (this.playerZ > WATER_Z_MIN - 4 && this.playerZ < WATER_Z_MAX + 4) {
      const shipHit = resolveShipCollisions(
        this.playerX,
        this.playerZ,
        this.playerY,
        0.5,
        this.ships.map((sh) => ({
          x: sh.x,
          z: sh.z,
          length: sh.spec.length,
          width: sh.spec.width,
          hullHeight: sh.spec.hullHeight,
        }))
      );
      if (shipHit.hit) {
        this.playerX = shipHit.x;
        this.playerZ = shipHit.z;
      }
    }

    // Solid OBB collisions against all vehicles so player on foot never walks through cars
    for (const v of this.vehicles) {
      const carHit = resolveCircleVsOrientedCar(this.playerX, this.playerZ, this.playerY, 0.48, v.state);
      if (carHit.hit) {
        this.playerX = carHit.x;
        this.playerZ = carHit.z;
        const carSpeed = Math.hypot(v.state.vx, v.state.vz);
        const approach = v.state.vx * carHit.normalX + v.state.vz * carHit.normalZ;
        if (carSpeed > 4.5 && approach > 2.0) {
          this.playerKnockVx += carHit.normalX * (carSpeed * 0.72 + 2.4);
          this.playerKnockVz += carHit.normalZ * (carSpeed * 0.72 + 2.4);
          this.playerHp = Math.max(0, this.playerHp - Math.min(20, carSpeed * 0.75));
          this.trauma = Math.min(1, this.trauma + 0.24);
          this.sound.playCrash(carSpeed * 0.4);
          if (this.playerHp <= 0) this.triggerGameOver();
        }
      }
    }

    const rSum = 0.85;
    for (const p of this.pedestrians) {
      if (p.state === 'knocked' || Math.abs(p.y - this.playerY) > 1.6) continue;
      const dx = p.x - this.playerX;
      const dz = p.z - this.playerZ;
      const distSq = dx * dx + dz * dz;
      if (distSq < rSum * rSum && distSq > 1e-6) {
        const dist = Math.sqrt(distSq);
        const nx = dx / dist;
        const nz = dz / dist;
        const overlap = rSum - dist;
        this.playerX -= nx * overlap * 0.55;
        this.playerZ -= nz * overlap * 0.55;
        p.x += nx * overlap * 0.45;
        p.z += nz * overlap * 0.45;

        const pushSpeed = this.playerVx * nx + this.playerVz * nz;
        if (pushSpeed > 1.8) {
          p.vx += nx * (pushSpeed * 0.9 + 2.2);
          p.vz += nz * (pushSpeed * 0.9 + 2.2);
          if (sprinting || pushSpeed > 5.8) {
            p.state = 'knocked';
            p.stateTimer = 1.65;
            p.angryAfterGetUp = true;
            this.sound.playPunchThud();
            this.chaosPoints += 6;
            this.addSpeechBubble(
              p.role === 'police' ? 'Офицер' : 'Прохожий',
              p.role === 'police' ? 'Нападение на полицию! Стой!' : 'Ай! Ты чё толкаешься, козёл?!',
              p.x,
              p.y + 1.9,
              p.z,
              'angry',
              2.4,
              p
            );
          } else if (p.bumpCooldown <= 0) {
            p.bumpCooldown = 0.75;
            p.bumpCount++;
            this.sound.playPunchThud();
            if (p.bumpCount >= 2 || p.role === 'police') {
              p.state = 'hostile';
              p.stateTimer = 12;
              this.addSpeechBubble(
                p.role === 'police' ? 'Офицер' : 'Прохожий',
                'Руки убери! Ща получишь!',
                p.x,
                p.y + 2.0,
                p.z,
                'angry',
                2.5,
                p
              );
            } else {
              this.addSpeechBubble('Прохожий', 'Эй, аккуратнее иди!', p.x, p.y + 2.0, p.z, 'npc', 1.8, p);
            }
          }
        }
      }
    }

    const maxP = WORLD_HALF_SIZE - 8;
    this.playerX = Math.max(-maxP, Math.min(maxP, this.playerX));
    this.playerZ = Math.max(-maxP, Math.min(maxP, this.playerZ));

    const moved = Math.hypot(this.playerX - prevX, this.playerZ - prevZ);
    this.distanceM += moved;
    if (moved > 0.002) {
      this.playerWalkPhase += moved * 2.4;
    }

    if (isOverWater(this.playerX, this.playerZ) && this.playerY < -0.5) {
      this.playerHp = Math.max(0, this.playerHp - 18 * dt);
      if (this.playerHp <= 0) this.triggerGameOver();
    }

    this.playerRig.root.position.set(this.playerX, this.playerY, this.playerZ);
    this.playerRig.root.rotation.y = this.playerHeading;
    const swing = moved > 0.002 ? Math.sin(this.playerWalkPhase) * 0.65 : 0;
    this.playerRig.leftLeg.rotation.x = swing;
    this.playerRig.rightLeg.rotation.x = -swing;
    this.playerRig.leftArm.rotation.x = -swing * 0.8;
    this.playerRig.rightArm.rotation.x = swing * 0.8;
    this.playerRig.root.visible = this.cameraMode === 'third';
  }

  private addSpeechBubble(
    speaker: string,
    text: string,
    worldX: number,
    worldY: number,
    worldZ: number,
    tone: WorldSpeechBubble['tone'],
    ttl: number,
    followPed?: SimPedestrian,
    followCar?: SimVehicle
  ): void {
    if (followPed) {
      this.speechBubbles = this.speechBubbles.filter((b) => b.followPed !== followPed);
    } else if (followCar) {
      this.speechBubbles = this.speechBubbles.filter((b) => b.followCar !== followCar);
    }
    if (this.speechBubbles.length >= 5) {
      this.speechBubbles.shift();
    }
    this.speechBubbles.push({
      id: this.nextId++,
      speaker,
      text,
      worldX,
      worldY,
      worldZ,
      tone,
      ttl,
      followPed,
      followCar,
    });
  }

  private setPoliceBanner(msg: string, duration = 4.8): void {
    this.policeBanner = msg;
    this.policeBannerTimer = duration;
  }

  private spawnDriverConfrontationPed(car: SimVehicle): void {
    car.rig.setDriverVisible(false);
    car.leftDoorHoldTimer = 0.8;
    car.leftDoorAngle = Math.max(car.leftDoorAngle, 0.3);
    const { seatX, seatZ, outsideX, outsideZ } = this.getDoorAnchors(car.state);
    const py = getGroundHeightAt(seatX, seatZ);
    const rig = buildHumanRig(this.textures, car.id + 17, false, 'civilian');
    rig.root.position.set(seatX, py, seatZ);
    this.scene.add(rig.root);

    const ped: SimPedestrian = {
      id: this.nextId++,
      x: seatX,
      y: py,
      z: seatZ,
      vx: 0,
      vz: 0,
      heading: car.state.heading,
      speed: 2.35,
      walkPhase: 0,
      state: 'confront',
      role: 'driver',
      stateTimer: 11.5,
      confrontElapsed: 0,
      callingPhone: false,
      ragdollPitch: 0,
      angryAfterGetUp: true,
      bumpCount: 0,
      bumpCooldown: 0,
      kickCooldown: 0,
      kickAnimTimer: 0,
      exitSlideTimer: 0.45,
      exitSlideDuration: 0.45,
      exitStartX: seatX,
      exitStartZ: seatZ,
      exitEndX: outsideX,
      exitEndZ: outsideZ,
      ownerCar: car,
      rig,
    };
    this.pedestrians.push(ped);
    this.addSpeechBubble(
      'Водитель',
      'Хватит такое делать, чувак! Выходи поговорим!',
      outsideX,
      py + 2.05,
      outsideZ,
      'angry',
      2.6,
      ped
    );
  }

  private dispatchPoliceToIncident(npcCar: SimVehicle): void {
    const policeCars = this.vehicles.filter((v) => v.isPolice && v.isTraffic);
    if (policeCars.length === 0) return;

    let best = policeCars[0];
    let bestD = Infinity;
    for (const pc of policeCars) {
      const d = Math.hypot(pc.state.x - npcCar.state.x, pc.state.z - npcCar.state.z);
      if (pc.policeState === 'patrol' && d < bestD) {
        bestD = d;
        best = pc;
      }
    }
    if (bestD > 140) {
      const offsetZ = npcCar.state.z < 0 ? Math.max(-470, npcCar.state.z - 55) : Math.min(470, npcCar.state.z + 55);
      const safeX = ROAD_X_COORDS.reduce((prev, curr) =>
        Math.abs(curr - npcCar.state.x) < Math.abs(prev - npcCar.state.x) ? curr : prev
      );
      if (!isOverWater(safeX, offsetZ)) {
        best.state.x = safeX;
        best.state.z = offsetZ;
        best.state.y = getGroundHeightAt(safeX, offsetZ);
        best.state.vx = 0;
        best.state.vz = 0;
        best.state.heading = Math.atan2(-(npcCar.state.x - safeX), -(npcCar.state.z - offsetZ));
      }
    }

    best.policeState = 'responding';
    best.policeTargetNpc = npcCar;
    best.policeIncidentX = npcCar.state.x;
    best.policeIncidentZ = npcCar.state.z;
    best.policeTimer = 14;
    best.sirenTimer = 0.05;
    best.aiReverseTimer = 0;
    best.aiReverseSteer = 0;
    best.aiStuckTimer = 0;
    this.sound.playPoliceSirenBurst();
    this.setPoliceBanner('ПАТРУЛЬ ПОЛИЦИИ ВЫЕХАЛ НА МЕСТО ДТП!');
  }

  private spawnPoliceInvestigators(policeCar: SimVehicle): void {
    policeCar.rig.setDriverVisible(false);
    policeCar.leftDoorHoldTimer = 0.85;
    policeCar.rightDoorHoldTimer = 0.85;
    policeCar.leftDoorAngle = Math.max(policeCar.leftDoorAngle, 0.3);
    policeCar.rightDoorAngle = Math.max(policeCar.rightDoorAngle, 0.3);
    const { fx, fz, rx, rz } = getCarBasis(policeCar.state.heading);
    const lines = [
      'Полиция! Оставайтесь на месте, разбираемся в ДТП...',
      'Проверяем камеры и повреждения машин!',
    ];
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? -1 : 1;
      const sx = policeCar.state.x + rx * side * 0.36 - fx * 0.05;
      const sz = policeCar.state.z + rz * side * 0.36 - fz * 0.05;
      const px = policeCar.state.x + rx * side * (policeCar.state.spec.width * 0.5 + 0.95);
      const pz = policeCar.state.z + rz * side * (policeCar.state.spec.width * 0.5 + 0.95);
      const py = getGroundHeightAt(sx, sz);
      const rig = buildHumanRig(this.textures, policeCar.id + k * 9, false, 'police');
      rig.root.position.set(sx, py, sz);
      this.scene.add(rig.root);

      const officer: SimPedestrian = {
        id: this.nextId++,
        x: sx,
        y: py,
        z: sz,
        vx: 0,
        vz: 0,
        heading: policeCar.state.heading,
        speed: 2.5,
        walkPhase: 0,
        state: 'investigate',
        role: 'police',
        stateTimer: 8.5,
        confrontElapsed: 0,
        callingPhone: false,
        ragdollPitch: 0,
        angryAfterGetUp: true,
        bumpCount: 0,
        bumpCooldown: 0,
        kickCooldown: 0,
        kickAnimTimer: 0,
        exitSlideTimer: 0.46,
        exitSlideDuration: 0.46,
        exitStartX: sx,
        exitStartZ: sz,
        exitEndX: px,
        exitEndZ: pz,
        ownerCar: policeCar,
        rig,
      };
      this.pedestrians.push(officer);
      this.addSpeechBubble('Офицер ДПС', lines[k], px, py + 2.05, pz, 'police', 3.0, officer);
    }
  }

  private isAiProbeBlocked(
    self: SimVehicle,
    px: number,
    pz: number,
    y: number,
    radius: number,
    targetX: number,
    targetZ: number,
    ignoreTargetCar?: SimVehicle | null
  ): boolean {
    if (isOverWater(px, pz)) return true;
    if (resolveStaticCollisions(px, pz, y, radius).hit) return true;

    for (const other of this.vehicles) {
      if (other === self) continue;
      if (ignoreTargetCar && other === ignoreTargetCar) {
        const dGoal = Math.hypot(px - targetX, pz - targetZ);
        if (dGoal < 4.5) continue;
      }
      if (Math.abs(other.state.x - px) > 9 || Math.abs(other.state.z - pz) > 9) continue;
      if (resolveCircleVsOrientedCar(px, pz, y, radius, other.state).hit) {
        return true;
      }
    }
    return false;
  }

  private computeSteerToPoint(
    v: SimVehicle,
    tx: number,
    tz: number,
    desiredSpeed: number,
    dt: number,
    ignoreTargetCar?: SimVehicle | null
  ): VehicleControlInput {
    const s = v.state;
    const aiState = {
      reverseTimer: v.aiReverseTimer,
      reverseSteer: v.aiReverseSteer,
      stuckTimer: v.aiStuckTimer,
    };
    const ctrl = computeSmartPursuitControl({
      x: s.x,
      y: s.y,
      z: s.z,
      heading: s.heading,
      vx: s.vx,
      vz: s.vz,
      halfWidth: s.spec.width * 0.5,
      halfLength: s.spec.length * 0.5,
      targetX: tx,
      targetZ: tz,
      desiredSpeed,
      dt,
      ai: aiState,
      isBlocked: (px, pz, r) => this.isAiProbeBlocked(v, px, pz, s.y, r, tx, tz, ignoreTargetCar),
    });
    v.aiReverseTimer = aiState.reverseTimer;
    v.aiReverseSteer = aiState.reverseSteer;
    v.aiStuckTimer = aiState.stuckTimer;
    return ctrl;
  }

  private isLaneClearAhead(v: SimVehicle, axis: 'x' | 'z', laneCoord: number, dir: 1 | -1, minClear: number): boolean {
    const s = v.state;
    for (const other of this.vehicles) {
      if (other === v) continue;
      if (axis === 'z') {
        if (Math.abs(other.state.x - laneCoord) > 2.4) continue;
        const along = (other.state.z - s.z) * dir;
        if (along > -3.5 && along < minClear) return false;
      } else {
        if (Math.abs(other.state.z - laneCoord) > 2.4) continue;
        const along = (other.state.x - s.x) * dir;
        if (along > -3.5 && along < minClear) return false;
      }
    }
    return true;
  }

  private pickIntersectionTurn(v: SimVehicle, crossRoad: number, forceTurn: boolean): PendingTurnState | null {
    const s = v.state;
    const isNS = v.aiLaneAxis === 'z';
    const newAxis: 'x' | 'z' = isNS ? 'x' : 'z';

    // Candidate directions onto the cross street (avoid water or world edge!)
    const validDirs: Array<1 | -1> = [];
    for (const candDir of [-1, 1] as const) {
      if (newAxis === 'z') {
        // Check if turning onto this N-S street heads toward water without a bridge
        const nextZ = crossRoad + candDir * 24;
        if (nextZ > WATER_Z_MIN && nextZ < WATER_Z_MAX && !BRIDGE_CENTER_XS.has(crossRoad)) continue;
        if (Math.abs(crossRoad + candDir * 45) > WORLD_HALF_SIZE - 25) continue;
      } else {
        if (Math.abs(s.x + candDir * 45) > WORLD_HALF_SIZE - 25) continue;
      }
      validDirs.push(candDir);
    }
    if (validDirs.length === 0) return null;

    const chosenDir = validDirs[Math.floor(Math.random() * validDirs.length)];
    const maxL = getMaxLaneIdx(newAxis, crossRoad);
    const chosenLane = Math.min(maxL, v.aiLaneIndex);
    const targetLaneCoord = getLaneCoord(newAxis, crossRoad, chosenDir, chosenLane);
    const targetHeading = getTargetHeading(newAxis, chosenDir);

    // Determine whether turn is Left or Right relative to current heading
    const angDiff = wrapAngle(targetHeading - getTargetHeading(v.aiLaneAxis, v.aiDir));
    const turnDir: 'left' | 'right' = angDiff > 0 ? 'left' : 'right';

    if (!forceTurn && Math.abs(angDiff) < 0.1) return null;

    return {
      turnDir,
      targetAxis: newAxis,
      targetRoadCenter: crossRoad,
      targetDir: chosenDir,
      targetLaneIndex: chosenLane,
      targetLaneCoord,
      targetHeading,
    };
  }

  private computeTrafficInput(v: SimVehicle, dt: number): VehicleControlInput {
    const s = v.state;
    const activePx = this.inVehicle && this.playerVehicle ? this.playerVehicle.state.x : this.playerX;
    const activePz = this.inVehicle && this.playerVehicle ? this.playerVehicle.state.z : this.playerZ;
    const playerSpeed =
      this.inVehicle && this.playerVehicle
        ? Math.hypot(this.playerVehicle.state.vx, this.playerVehicle.state.vz)
        : Math.hypot(this.playerVx, this.playerVz);

    if (v.blinkerTimer > 0) {
      v.blinkerTimer -= dt;
      if (v.blinkerTimer <= 0 && !v.aiTurnState) {
        v.blinkerMode = 'none';
      }
    }
    if (v.yieldTimer > 0) v.yieldTimer = Math.max(0, v.yieldTimer - dt);
    if (v.overtakeCooldown > 0) v.overtakeCooldown = Math.max(0, v.overtakeCooldown - dt);

    // 1. Police Cruiser AI State Machine
    if (v.isPolice) {
      if (v.policeState === 'responding') {
        v.policeTimer -= dt;
        v.sirenTimer -= dt;
        if (v.sirenTimer <= 0) {
          v.sirenTimer = 1.6;
          this.sound.playPoliceSirenBurst();
        }
        const tx = v.policeTargetNpc ? v.policeTargetNpc.state.x : v.policeIncidentX;
        const tz = v.policeTargetNpc ? v.policeTargetNpc.state.z : v.policeIncidentZ;
        const dist = Math.hypot(tx - s.x, tz - s.z);
        if (dist < 10.5 || v.policeTimer <= 0) {
          v.policeState = 'investigating';
          v.policeTimer = 3.2;
          v.blinkerMode = 'hazard';
          this.setPoliceBanner('ПОЛИЦИЯ ПРИБЫЛА: ОФИЦЕРЫ ВЫЯСНЯЮТ ВИНОВНИКА ДТП...');
          this.spawnPoliceInvestigators(v);
          return { throttle: 0, steer: 0, handbrake: true, nitro: false };
        }
        return this.computeSteerToPoint(v, tx, tz, 23, dt, v.policeTargetNpc);
      }

      if (v.policeState === 'investigating') {
        v.policeTimer -= dt;
        v.blinkerMode = 'hazard';
        if (v.policeTimer <= 0) {
          const fault = v.policeTargetNpc?.crashFault ?? 'player';
          const officers = this.pedestrians.filter((p) => p.role === 'police' && p.ownerCar === v);
          if (fault === 'player') {
            this.chaosPoints += 55;
            this.setPoliceBanner('ПОЛИЦИЯ: ВИНОВАТ ТЫ! ВЫПИСАН ШТРАФ И НАЧАТА ПОГОНЯ!', 5.5);
            if (officers[0]) {
              this.addSpeechBubble(
                'Офицер ДПС',
                'Камеры подтвердили: виноват ты! Немедленно остановись!',
                officers[0].x,
                officers[0].y + 2.05,
                officers[0].z,
                'angry',
                4.0,
                officers[0]
              );
            }
            for (const off of officers) {
              off.state = 'hostile';
              off.stateTimer = 14;
            }
            v.policeState = 'pursuing_player';
            v.policeTimer = 12;
            v.blinkerMode = 'none';
          } else {
            this.setPoliceBanner('ПОЛИЦИЯ: ТЫ НЕ ВИНОВЕН! ВТОРОЙ ВОДИТЕЛЬ ОШТРАФОВАН.', 5.5);
            if (officers[0]) {
              this.addSpeechBubble(
                'Офицер ДПС',
                'Ты стоял на месте — виноват второй водитель! Можешь ехать.',
                officers[0].x,
                officers[0].y + 2.05,
                officers[0].z,
                'clear',
                4.2,
                officers[0]
              );
            }
            if (v.policeTargetNpc) {
              this.addSpeechBubble(
                'Офицер ДПС',
                'А вам — штраф за опасный таран!',
                v.policeTargetNpc.state.x,
                v.policeTargetNpc.state.y + 2.2,
                v.policeTargetNpc.state.z,
                'police',
                3.5,
                undefined,
                v.policeTargetNpc
              );
            }
            v.policeState = 'clearing';
            v.policeTimer = 4.5;
          }
        }
        return { throttle: 0, steer: 0, handbrake: true, nitro: false };
      }

      if (v.policeState === 'pursuing_player') {
        v.policeTimer -= dt;
        v.sirenTimer -= dt;
        if (v.sirenTimer <= 0) {
          v.sirenTimer = 1.6;
          this.sound.playPoliceSirenBurst();
        }
        if (v.policeTimer <= 0) {
          v.policeState = 'patrol';
          v.rig.setDriverVisible(true);
        }
        const dist = Math.hypot(activePx - s.x, activePz - s.z);
        if (dist < 6.5) {
          return { throttle: 0, steer: 0, handbrake: true, nitro: false };
        }
        return this.computeSteerToPoint(
          v,
          activePx,
          activePz,
          24,
          dt,
          this.inVehicle ? this.playerVehicle : null
        );
      }

      if (v.policeState === 'clearing') {
        v.policeTimer -= dt;
        if (v.policeTimer <= 0) {
          v.policeState = 'patrol';
          v.policeTargetNpc = null;
          v.blinkerMode = 'none';
          v.rig.setDriverVisible(true);
        }
        return { throttle: 0, steer: 0, handbrake: true, nitro: false };
      }
    }

    // 2. Civilian Road-Rage State Machine (Chase -> Honk -> Box-In Left/Right -> Exit & Phone Call Police)
    if (v.roadRageState === 'cooldown') {
      v.roadRageTimer -= dt;
      if (v.roadRageTimer <= 0) {
        v.roadRageState = 'none';
        v.blinkerMode = 'none';
        v.rig.setDriverVisible(true);
      }
    } else if (v.roadRageState === 'honk_chase') {
      v.roadRageTimer -= dt;
      v.hornTimer -= dt;
      const dist = Math.hypot(activePx - s.x, activePz - s.z);
      if (v.hornTimer <= 0) {
        v.hornTimer = 1.15;
        if (dist < 70) this.sound.playHorn();
        this.addSpeechBubble(
          'Водитель',
          'БИ-БИП! Остановись сейчас же!',
          s.x,
          s.y + 2.2,
          s.z,
          'angry',
          1.4,
          undefined,
          v
        );
      }
      if (dist < 22 && playerSpeed < 6.2) {
        v.roadRageState = 'box_in';
        v.roadRageTimer = 6.0;
      } else if (v.roadRageTimer <= 0) {
        v.roadRageState = 'cooldown';
        v.roadRageTimer = 8;
      } else {
        return this.computeSteerToPoint(
          v,
          activePx,
          activePz,
          21,
          dt,
          this.inVehicle ? this.playerVehicle : null
        );
      }
    } else if (v.roadRageState === 'box_in') {
      v.roadRageTimer -= dt;
      v.hornTimer -= dt;
      v.blinkerMode = v.boxSide < 0 ? 'left' : 'right';
      if (v.hornTimer <= 0) {
        v.hornTimer = 1.1;
        this.sound.playHorn();
      }
      const pHeading = this.inVehicle && this.playerVehicle ? this.playerVehicle.state.heading : this.playerHeading;
      const { fx: pFx, fz: pFz, rx: pRx, rz: pRz } = getCarBasis(pHeading);
      const blockX = activePx + pRx * v.boxSide * 4.0 + pFx * 5.6;
      const blockZ = activePz + pRz * v.boxSide * 4.0 + pFz * 5.6;
      const distToBlock = Math.hypot(blockX - s.x, blockZ - s.z);
      const distToPlayer = Math.hypot(activePx - s.x, activePz - s.z);

      if (playerSpeed > 12 && distToPlayer > 26) {
        v.roadRageState = 'honk_chase';
        v.roadRageTimer = 12;
      } else if (
        distToBlock < 4.8 ||
        (distToPlayer < 9.5 && playerSpeed < 4.5 && v.roadRageTimer < 4.2) ||
        v.roadRageTimer <= 0
      ) {
        v.roadRageState = 'confronting';
        v.roadRageTimer = 11.5;
        v.blinkerMode = 'hazard';
      } else {
        return this.computeSteerToPoint(v, blockX, blockZ, 19, dt);
      }
    } else if (v.roadRageState === 'confronting') {
      v.roadRageTimer -= dt;
      v.blinkerMode = 'hazard';
      if (!v.driverExited) {
        v.driverExited = true;
        this.spawnDriverConfrontationPed(v);
      }
      if (v.roadRageTimer <= 9.2 && !v.policeCalled) {
        v.policeCalled = true;
        const driverPed = this.pedestrians.find((p) => p.role === 'driver' && p.ownerCar === v);
        if (driverPed) {
          driverPed.callingPhone = true;
        }
        this.addSpeechBubble(
          'Водитель',
          'Алло, полиция! Этот псих меня таранит, срочно приезжайте!',
          driverPed ? driverPed.x : s.x,
          (driverPed ? driverPed.y : s.y) + 2.1,
          driverPed ? driverPed.z : s.z,
          'angry',
          3.4,
          driverPed,
          driverPed ? undefined : v
        );
        this.dispatchPoliceToIncident(v);
      }
      if (v.roadRageTimer <= 0) {
        v.roadRageState = 'cooldown';
        v.roadRageTimer = 10;
        v.blinkerMode = 'none';
      }
      return { throttle: 0, steer: 0, handbrake: true, nitro: false };
    }

    // 3. Smart Road-Aligned Turning, Overtaking, Horn-Yielding & Traffic Lights
    const currentSpeed = Math.hypot(s.vx, s.vz);
    v.aiTurnCooldown -= dt;

    // 3a. Active 90-degree curved turn inside an intersection
    if (v.aiTurnState) {
      const ts = v.aiTurnState;
      v.blinkerMode = ts.turnDir;
      const aimAhead = 9.0;
      const aimX =
        ts.targetAxis === 'z'
          ? ts.targetLaneCoord
          : s.x + ts.targetDir * aimAhead;
      const aimZ =
        ts.targetAxis === 'x'
          ? ts.targetLaneCoord
          : s.z + ts.targetDir * aimAhead;

      const targetH = Math.atan2(-(aimX - s.x), -(aimZ - s.z));
      const diff = wrapAngle(targetH - s.heading);
      const headingErr = Math.abs(wrapAngle(ts.targetHeading - s.heading));
      const laneErr = ts.targetAxis === 'z' ? Math.abs(s.x - ts.targetLaneCoord) : Math.abs(s.z - ts.targetLaneCoord);

      if (headingErr < 0.22 && laneErr < 2.2) {
        v.aiLaneAxis = ts.targetAxis;
        v.aiRoadCenter = ts.targetRoadCenter;
        v.aiDir = ts.targetDir;
        v.aiLaneIndex = ts.targetLaneIndex;
        v.aiLaneCoord = ts.targetLaneCoord;
        v.aiTurnState = null;
        v.aiTurnCooldown = 5.5 + Math.random() * 8.0;
        v.blinkerMode = 'none';
      }

      const turnSpeed = 9.2;
      return {
        throttle: currentSpeed < turnSpeed ? 0.52 : 0.05,
        steer: THREE.MathUtils.clamp(diff * 2.35, -1, 1),
        handbrake: false,
        nitro: false,
      };
    }

    const { fx, fz } = getCarBasis(s.heading);

    // 3b. Check intersection approach for mandatory coastal/edge turn or voluntary turn
    const crossList = v.aiLaneAxis === 'z' ? [...NORTH_ROAD_Z_COORDS, ...SOUTH_ROAD_Z_COORDS] : ROAD_X_COORDS;
    for (const cross of crossList) {
      const distToCross = (cross - (v.aiLaneAxis === 'z' ? s.z : s.x)) * v.aiDir;
      if (distToCross > 3.5 && distToCross < 13.5) {
        const approachingCoastWithoutBridge =
          v.aiLaneAxis === 'z' &&
          !BRIDGE_CENTER_XS.has(v.aiRoadCenter) &&
          ((cross === -72 && v.aiDir === 1) || (cross === 72 && v.aiDir === -1));
        const approachingWorldEdge =
          (v.aiLaneAxis === 'z' && ((cross === -460 && v.aiDir === -1) || (cross === 465 && v.aiDir === 1))) ||
          (v.aiLaneAxis === 'x' && ((cross === -425 && v.aiDir === -1) || (cross === 425 && v.aiDir === 1)));

        const wantsVoluntaryTurn = v.aiTurnCooldown <= 0 && Math.random() < 0.38;
        if (approachingCoastWithoutBridge || approachingWorldEdge || wantsVoluntaryTurn) {
          const turn = this.pickIntersectionTurn(v, cross, approachingCoastWithoutBridge || approachingWorldEdge);
          if (turn) {
            v.aiTurnState = turn;
            v.blinkerMode = turn.turnDir;
            v.blinkerTimer = 3.0;
            break;
          }
        }
      }
    }

    // 3c. Forward sensor for obstacles & Overtaking slower cars
    let obstacleAhead = false;
    let blockingCar: SimVehicle | null = null;
    let blockingDist = Infinity;

    for (const other of this.vehicles) {
      if (other === v) continue;
      const dx = other.state.x - s.x;
      const dz = other.state.z - s.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 18) {
        const dot = (dx * fx + dz * fz) / Math.max(0.01, dist);
        if (dot > 0.88 && dist < blockingDist) {
          blockingDist = dist;
          blockingCar = other;
          if (dist < 11.5) {
            obstacleAhead = true;
          }
        }
      }
    }

    // Overtake onto adjacent lane if catching a slower car ahead
    if (
      blockingCar &&
      blockingDist < 17 &&
      blockingDist > 5.5 &&
      v.overtakeCooldown <= 0 &&
      v.yieldTimer <= 0 &&
      Math.abs(s.z) > WATER_Z_MAX + 8
    ) {
      const otherSpeed = Math.hypot(blockingCar.state.vx, blockingCar.state.vz);
      if (otherSpeed < v.aiSpeedTarget * 0.72) {
        const maxL = getMaxLaneIdx(v.aiLaneAxis, v.aiRoadCenter);
        const candidates = [v.aiLaneIndex - 1, v.aiLaneIndex + 1].filter((l) => l >= 0 && l <= maxL);
        for (const cand of candidates) {
          const candCoord = getLaneCoord(v.aiLaneAxis, v.aiRoadCenter, v.aiDir, cand);
          if (this.isLaneClearAhead(v, v.aiLaneAxis, candCoord, v.aiDir, 22)) {
            v.blinkerMode = cand < v.aiLaneIndex ? 'left' : 'right';
            v.blinkerTimer = 2.0;
            v.aiLaneIndex = cand;
            v.aiLaneCoord = candCoord;
            v.overtakeCooldown = 4.0;
            obstacleAhead = false;
            break;
          }
        }
      }
    }

    // 3d. Obey 3D intersection traffic lights (stop cleanly behind crosswalk)
    let redLightAhead = false;
    if (v.aiLaneAxis === 'z') {
      if (getTrafficLightState(this.simTime, 'ns') !== 'green') {
        for (const rz of [...NORTH_ROAD_Z_COORDS, ...SOUTH_ROAD_Z_COORDS]) {
          const stopPad = getRoadHalfWidthZ(rz) + 3.2;
          const distToStop = (rz - s.z) * v.aiDir - stopPad;
          if (distToStop > -1.0 && distToStop < 16) {
            redLightAhead = true;
            break;
          }
        }
      }
    } else {
      if (getTrafficLightState(this.simTime, 'ew') !== 'green') {
        for (const rx of ROAD_X_COORDS) {
          const stopPad = getRoadHalfWidthX(rx) + 3.2;
          const distToStop = (rx - s.x) * v.aiDir - stopPad;
          if (distToStop > -1.0 && distToStop < 16) {
            redLightAhead = true;
            break;
          }
        }
      }
    }

    // 3e. Smooth Lane-Keeping Steering + Fallback Perimeter Turnaround
    let desiredHeading = getTargetHeading(v.aiLaneAxis, v.aiDir);
    if (v.aiLaneAxis === 'z') {
      if (s.z > WORLD_HALF_SIZE - 45 && v.aiDir === 1) {
        v.aiDir = -1;
        v.aiLaneCoord = getLaneCoord('z', v.aiRoadCenter, v.aiDir, v.aiLaneIndex);
      } else if (s.z < -(WORLD_HALF_SIZE - 45) && v.aiDir === -1) {
        v.aiDir = 1;
        v.aiLaneCoord = getLaneCoord('z', v.aiRoadCenter, v.aiDir, v.aiLaneIndex);
      }
      desiredHeading = getTargetHeading('z', v.aiDir);
      const crossErr = v.aiLaneCoord - s.x;
      desiredHeading += THREE.MathUtils.clamp(crossErr * 0.095 * v.aiDir, -0.4, 0.4);
    } else {
      if (s.x > WORLD_HALF_SIZE - 45 && v.aiDir === 1) {
        v.aiDir = -1;
        v.aiLaneCoord = getLaneCoord('x', v.aiRoadCenter, v.aiDir, v.aiLaneIndex);
      } else if (s.x < -(WORLD_HALF_SIZE - 45) && v.aiDir === -1) {
        v.aiDir = 1;
        v.aiLaneCoord = getLaneCoord('x', v.aiRoadCenter, v.aiDir, v.aiLaneIndex);
      }
      desiredHeading = getTargetHeading('x', v.aiDir);
      const crossErr = v.aiLaneCoord - s.z;
      desiredHeading += THREE.MathUtils.clamp(-crossErr * 0.095 * v.aiDir, -0.4, 0.4);
    }

    const diff = wrapAngle(desiredHeading - s.heading);
    const targetSpeed =
      v.panicTimer > 0
        ? v.aiSpeedTarget * 1.45
        : v.yieldTimer > 0
        ? v.aiSpeedTarget * 1.12
        : v.aiSpeedTarget * this.trafficDensity;
    if (v.panicTimer > 0) v.panicTimer = Math.max(0, v.panicTimer - dt);

    // Police patrol obstacle avoidance & automatic reverse recovery if wedged off-road after a chase
    if (v.isPolice) {
      if (v.aiReverseTimer > 0) {
        v.aiReverseTimer = Math.max(0, v.aiReverseTimer - dt);
        const rearX = s.x - fx * (s.spec.length * 0.5 + 1.4);
        const rearZ = s.z - fz * (s.spec.length * 0.5 + 1.4);
        if (!this.isAiProbeBlocked(v, rearX, rearZ, s.y, s.spec.width * 0.45, rearX, rearZ)) {
          return { throttle: -0.82, steer: v.aiReverseSteer, handbrake: false, nitro: false };
        }
        v.aiReverseTimer = 0;
      }
      const noseX = s.x + fx * (s.spec.length * 0.5 + 1.25);
      const noseZ = s.z + fz * (s.spec.length * 0.5 + 1.25);
      const noseWall = resolveStaticCollisions(noseX, noseZ, s.y, s.spec.width * 0.46).hit || isOverWater(noseX, noseZ);
      if (noseWall || (!redLightAhead && !obstacleAhead && currentSpeed < 1.1)) {
        v.aiStuckTimer += dt;
        if (noseWall || v.aiStuckTimer > 0.65) {
          v.aiReverseTimer = 1.05;
          v.aiReverseSteer = diff >= 0 ? -0.9 : 0.9;
          v.aiStuckTimer = 0;
          return { throttle: -0.82, steer: v.aiReverseSteer, handbrake: false, nitro: false };
        }
      } else {
        v.aiStuckTimer = Math.max(0, v.aiStuckTimer - dt * 2);
      }
    }

    const shouldStop = obstacleAhead || redLightAhead;
    const throttle = shouldStop ? (currentSpeed > 1.5 ? -0.78 : 0) : currentSpeed < targetSpeed ? 0.58 : 0.05;
    return {
      throttle,
      steer: THREE.MathUtils.clamp(diff * 1.9, -1, 1),
      handbrake: shouldStop && currentSpeed < 2.2,
      nitro: false,
    };
  }

  private stepPedestrians(dt: number): void {
    const px = this.inVehicle && this.playerVehicle ? this.playerVehicle.state.x : this.playerX;
    const pz = this.inVehicle && this.playerVehicle ? this.playerVehicle.state.z : this.playerZ;

    // Ped-vs-Ped solid separation
    for (let i = 0; i < this.pedestrians.length; i++) {
      const a = this.pedestrians[i];
      if (a.state === 'knocked') continue;
      for (let j = i + 1; j < this.pedestrians.length; j++) {
        const b = this.pedestrians[j];
        if (b.state === 'knocked' || Math.abs(a.x - b.x) > 1 || Math.abs(a.z - b.z) > 1 || Math.abs(a.y - b.y) > 1.5) {
          continue;
        }
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < 0.52 && dSq > 1e-6) {
          const d = Math.sqrt(dSq);
          const nx = dx / d;
          const nz = dz / d;
          const push = (0.72 - d) * 0.5;
          a.x -= nx * push;
          a.z -= nz * push;
          b.x += nx * push;
          b.z += nz * push;
        }
      }
    }

    for (let i = this.pedestrians.length - 1; i >= 0; i--) {
      const p = this.pedestrians[i];
      if (p.bumpCooldown > 0) p.bumpCooldown -= dt;
      if (p.kickCooldown > 0) p.kickCooldown -= dt;
      if (p.kickAnimTimer > 0) p.kickAnimTimer -= dt;

      if (p.state === 'knocked') {
        p.stateTimer -= dt;
        p.x += p.vx * dt;
        p.z += p.vz * dt;
        p.vx *= Math.exp(-3.5 * dt);
        p.vz *= Math.exp(-3.5 * dt);
        p.ragdollPitch = THREE.MathUtils.damp(p.ragdollPitch, Math.PI * 0.48, 8, dt);
        p.y = getGroundHeightAt(p.x, p.z);
        p.rig.phoneMesh.visible = false;
        p.rig.root.position.set(p.x, p.y, p.z);
        p.rig.root.rotation.set(p.ragdollPitch, p.heading, 0);
        if (p.stateTimer <= 0) {
          p.ragdollPitch = 0;
          p.rig.root.rotation.set(0, p.heading, 0);
          if (p.angryAfterGetUp && !this.inVehicle) {
            p.state = 'hostile';
            p.stateTimer = 11.0;
            this.addSpeechBubble(
              p.role === 'police' ? 'Офицер' : 'Прохожий',
              'Ах ты гад! Ну держись!',
              p.x,
              p.y + 2.0,
              p.z,
              'angry',
              2.5,
              p
            );
          } else {
            p.state = 'flee';
            p.stateTimer = 4;
          }
        }
        continue;
      }

      if (p.exitSlideTimer && p.exitSlideTimer > 0 && p.exitSlideDuration && p.exitStartX !== undefined && p.exitEndX !== undefined) {
        p.exitSlideTimer = Math.max(0, p.exitSlideTimer - dt);
        const u = 1 - p.exitSlideTimer / p.exitSlideDuration;
        const smooth = u * u * (3 - 2 * u);
        p.x = THREE.MathUtils.lerp(p.exitStartX, p.exitEndX, smooth);
        p.z = THREE.MathUtils.lerp(p.exitStartZ!, p.exitEndZ!, smooth);
        p.y = getGroundHeightAt(p.x, p.z);
        p.heading = Math.atan2(-(p.exitEndX - p.exitStartX), -(p.exitEndZ! - p.exitStartZ!));
        const swing = Math.sin(u * Math.PI * 2) * 0.5;
        p.rig.leftLeg.rotation.x = swing;
        p.rig.rightLeg.rotation.x = -swing;
        p.rig.leftArm.rotation.x = 0.4;
        p.rig.rightArm.rotation.x = 0.4;
        p.rig.torsoGroup.rotation.y = 0;
        p.rig.root.position.set(p.x, p.y, p.z);
        p.rig.root.rotation.set(0, p.heading, 0);
        continue;
      }

      for (const v of this.vehicles) {
        if (Math.abs(p.x - v.state.x) > 10 || Math.abs(p.z - v.state.z) > 10) continue;
        const speed = Math.hypot(v.state.vx, v.state.vz);
        const pedCarHit = resolveCircleVsOrientedCar(p.x, p.z, p.y, 0.45, v.state);
        if (pedCarHit.hit) {
          p.x = pedCarHit.x;
          p.z = pedCarHit.z;
          if (speed > 3.0) {
            p.state = 'knocked';
            p.stateTimer = 2.8;
            p.angryAfterGetUp = false;
            p.vx = pedCarHit.normalX * speed * 0.85 + v.state.vx * 0.4;
            p.vz = pedCarHit.normalZ * speed * 0.85 + v.state.vz * 0.4;
            this.chaosPoints += 25;
            this.sound.playCrash(7);
            break;
          }
        } else {
          const dx = p.x - v.state.x;
          const dz = p.z - v.state.z;
          const dSq = dx * dx + dz * dz;
          if (dSq < 100 && speed > 11 && p.role === 'civilian' && p.state !== 'hostile') {
            p.state = 'flee';
            p.stateTimer = 3.5;
            p.heading = Math.atan2(-dx, -dz);
          }
        }
      }

      if (p.state === 'confront' || p.state === 'investigate') {
        p.stateTimer -= dt;
        p.confrontElapsed += dt;
        if (p.stateTimer <= 0) {
          this.scene.remove(p.rig.root);
          p.rig.dispose();
          this.pedestrians.splice(i, 1);
          continue;
        }
        const dx = px - p.x;
        const dz = pz - p.z;
        const dist = Math.hypot(dx, dz);
        p.heading = Math.atan2(-dx, -dz);
        const moveSpd = dist > 2.6 ? p.speed : 0;
        const { fx, fz } = getCarBasis(p.heading);
        p.x += fx * moveSpd * dt;
        p.z += fz * moveSpd * dt;
        p.y = getGroundHeightAt(p.x, p.z);
        p.walkPhase += (moveSpd > 0.1 ? moveSpd : 1.6) * dt * 2.5;
        const armWave = Math.sin(p.walkPhase * 2.0) * 0.65;
        p.rig.leftLeg.rotation.x = moveSpd > 0.1 ? Math.sin(p.walkPhase) * 0.5 : 0;
        p.rig.rightLeg.rotation.x = moveSpd > 0.1 ? -Math.sin(p.walkPhase) * 0.5 : 0;
        p.rig.torsoGroup.rotation.y = 0;

        // Hold glowing smartphone up in front toward ear while calling police (+X = forward!)
        const holdingPhone = p.callingPhone && p.confrontElapsed < 6.4;
        p.rig.phoneMesh.visible = holdingPhone;
        if (holdingPhone) {
          p.rig.leftArm.rotation.x = moveSpd > 0.1 ? armWave * 0.6 : 0.95 + armWave * 0.35;
          p.rig.rightArm.rotation.x = 2.38;
          p.rig.rightArm.rotation.z = -0.26;
        } else {
          p.rig.leftArm.rotation.x = moveSpd > 0.1 ? armWave : 1.05 + armWave * 0.4;
          p.rig.rightArm.rotation.x = moveSpd > 0.1 ? -armWave : 1.05 - armWave * 0.4;
          p.rig.rightArm.rotation.z = 0;
        }
        p.rig.root.position.set(p.x, p.y, p.z);
        p.rig.root.rotation.set(0, p.heading, 0);
        continue;
      }

      if (p.state === 'hostile') {
        p.stateTimer -= dt;
        const dx = px - p.x;
        const dz = pz - p.z;
        const dist = Math.hypot(dx, dz);
        if (p.stateTimer <= 0 || dist > 32) {
          if (p.role === 'police') {
            this.scene.remove(p.rig.root);
            p.rig.dispose();
            this.pedestrians.splice(i, 1);
            continue;
          }
          p.state = 'walk';
          p.angryAfterGetUp = false;
        } else {
          p.heading = Math.atan2(-dx, -dz);
          const chaseSpeed = p.speed * 2.15;
          if (dist > 1.05) {
            const { fx, fz } = getCarBasis(p.heading);
            p.x += fx * chaseSpeed * dt;
            p.z += fz * chaseSpeed * dt;
          }
          if (!this.inVehicle && dist < 1.38 && p.kickCooldown <= 0) {
            p.kickCooldown = 1.25;
            p.kickAnimTimer = 0.36;
            const nx = dx / Math.max(0.05, dist);
            const nz = dz / Math.max(0.05, dist);
            this.playerKnockVx += nx * 7.8;
            this.playerKnockVz += nz * 7.8;
            this.playerHp = Math.max(0, this.playerHp - 6);
            this.trauma = Math.min(1, this.trauma + 0.14);
            this.sound.playPunchThud();
            this.addSpeechBubble(
              p.role === 'police' ? 'Офицер' : 'Прохожий',
              p.role === 'police' ? 'К ноге! Сопротивление аресту!' : 'Получай! Не толкайся!',
              p.x,
              p.y + 2.0,
              p.z,
              'angry',
              2.0,
              p
            );
            if (this.playerHp <= 0) this.triggerGameOver();
          }
        }
      }

      if (p.state === 'flee') {
        p.stateTimer -= dt;
        if (p.stateTimer <= 0) p.state = 'walk';
      }

      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.vx *= Math.exp(-7.0 * dt);
      p.vz *= Math.exp(-7.0 * dt);

      const activeSpeed = p.state === 'flee' ? p.speed * 2.5 : p.state === 'hostile' ? p.speed * 2.0 : p.speed;
      const { fx, fz } = getCarBasis(p.heading);
      const nextX = p.x + fx * activeSpeed * dt;
      const nextZ = p.z + fz * activeSpeed * dt;

      if (p.state === 'walk' && isOnRoad(nextX, nextZ)) {
        p.heading += Math.PI * 0.78;
      } else if (p.state !== 'hostile') {
        p.x = nextX;
        p.z = nextZ;
      }

      const maxPedBound = WORLD_HALF_SIZE - 18;
      if (isOverWater(p.x, p.z) || Math.abs(p.x) > maxPedBound || Math.abs(p.z) > maxPedBound) {
        p.heading += Math.PI * 0.85;
        p.x -= fx * activeSpeed * dt * 2;
        p.z -= fz * activeSpeed * dt * 2;
      }

      const col = resolveStaticCollisions(p.x, p.z, p.y, 0.4);
      if (col.hit) {
        p.x = col.x;
        p.z = col.z;
        if (p.state !== 'hostile') {
          p.heading += Math.PI * 0.65;
        }
      }

      p.y = getGroundHeightAt(p.x, p.z);
      const pedDistSq = (p.x - px) * (p.x - px) + (p.z - pz) * (p.z - pz);
      if (pedDistSq > 185 * 185) {
        p.rig.root.visible = false;
        continue;
      }
      p.rig.root.visible = true;
      p.walkPhase += activeSpeed * dt * 2.5;
      const swing = Math.sin(p.walkPhase) * (p.state === 'flee' || p.state === 'hostile' ? 0.85 : 0.55);
      p.rig.phoneMesh.visible = false;
      p.rig.rightArm.rotation.z = 0;
      if (p.kickAnimTimer > 0) {
        // Forward strike (+X rotation swings limbs forward toward -Z facing direction!)
        const thrust = Math.sin((1 - Math.min(1, p.kickAnimTimer / 0.36)) * Math.PI);
        p.rig.torsoGroup.rotation.y = -0.35 * thrust;
        p.rig.rightArm.rotation.x = 1.48 * (0.45 + 0.55 * thrust);
        p.rig.leftArm.rotation.x = 1.05 * (0.45 + 0.55 * thrust);
        p.rig.rightLeg.rotation.x = 1.25 * thrust;
        p.rig.leftLeg.rotation.x = -0.22 * thrust;
      } else if (p.state === 'hostile') {
        p.rig.torsoGroup.rotation.y = 0;
        p.rig.leftLeg.rotation.x = swing;
        p.rig.rightLeg.rotation.x = -swing;
        p.rig.leftArm.rotation.x = 0.85 + swing * 0.35;
        p.rig.rightArm.rotation.x = 0.95 - swing * 0.35;
      } else {
        p.rig.torsoGroup.rotation.y = 0;
        p.rig.leftLeg.rotation.x = swing;
        p.rig.rightLeg.rotation.x = -swing;
        p.rig.leftArm.rotation.x = -swing * 0.75;
        p.rig.rightArm.rotation.x = swing * 0.75;
      }
      p.rig.root.position.set(p.x, p.y, p.z);
      p.rig.root.rotation.set(0, p.heading, 0);
    }
  }

  private scareNearbyPedestrians(x: number, z: number, radius: number): void {
    const rSq = radius * radius;
    for (const p of this.pedestrians) {
      if (p.state === 'knocked' || p.role === 'police') continue;
      const dx = p.x - x;
      const dz = p.z - z;
      if (dx * dx + dz * dz < rSq) {
        p.state = 'flee';
        p.stateTimer = 4.0;
        p.heading = Math.atan2(-dx, -dz);
      }
    }
  }

  private stepDestructibles(dt: number): void {
    for (const prop of this.city.destructibles) {
      if (!prop.broken) {
        for (const v of this.vehicles) {
          if (Math.abs(v.state.x - prop.x) > 5 || Math.abs(v.state.z - prop.z) > 5 || Math.abs(v.state.y - prop.y) > 2) {
            continue;
          }
          const dx = prop.x - v.state.x;
          const dz = prop.z - v.state.z;
          const r = v.state.spec.width * 0.55 + 0.4;
          if (dx * dx + dz * dz < r * r) {
            const speed = Math.hypot(v.state.vx, v.state.vz);
            if (speed > 2.0) {
              prop.broken = true;
              prop.hitTime = 4.5;
              prop.vx = v.state.vx * 1.15 + (Math.random() - 0.5) * 4;
              prop.vy = 4.5 + Math.min(8, speed * 0.35);
              prop.vz = v.state.vz * 1.15 + (Math.random() - 0.5) * 4;
              prop.rotVx = (Math.random() - 0.5) * 10;
              prop.rotVz = (Math.random() - 0.5) * 10;
              if (v === this.playerVehicle) {
                this.propsDestroyed++;
                this.chaosPoints += 12;
                this.sound.playCrash(speed * 0.45);
              }
              break;
            }
          }
        }
      } else if (prop.hitTime > 0) {
        prop.hitTime -= dt;
        prop.vy -= 18 * dt;
        prop.x += prop.vx * dt;
        prop.y += prop.vy * dt;
        prop.z += prop.vz * dt;
        const g = getGroundHeightAt(prop.x, prop.z);
        if (prop.y < g) {
          prop.y = g;
          prop.vy *= -0.35;
          prop.vx *= 0.65;
          prop.vz *= 0.65;
        }
        prop.mesh.position.set(prop.x, prop.y, prop.z);
        prop.mesh.rotation.x += prop.rotVx * dt;
        prop.mesh.rotation.z += prop.rotVz * dt;

        if (prop.kind === 'hydrant' && prop.hitTime > 1.0) {
          this.spawnParticle(
            prop.x,
            prop.y + 0.4,
            prop.z,
            (Math.random() - 0.5) * 2.5,
            8 + Math.random() * 4,
            (Math.random() - 0.5) * 2.5,
            0.32,
            0.7,
            14,
            0x7dd3fc
          );
        }
      }
    }
  }

  private handleImpactVisuals(v: SimVehicle, imp: ImpactEvent): void {
    const strength = Math.max(0.06, Math.min(0.42, imp.impulseSpeed * 0.02));
    const { fx, fz, rx, rz } = getCarBasis(v.state.heading);
    const localNx = imp.normalX * rx + imp.normalZ * rz;
    const localNz = -(imp.normalX * fx + imp.normalZ * fz);
    v.rig.deformAtLocalPoint(imp.localX, 0.58, imp.localZ, localNx, localNz, 1.48, strength);
    this.syncDetachedParts(v, imp);

    const isPlayerHit = v === this.playerVehicle && this.inVehicle;
    if (isPlayerHit) {
      this.crashes++;
      this.trauma = Math.min(1, this.trauma + Math.min(0.85, imp.impulseSpeed * 0.04));
      if (imp.impulseSpeed > 14) {
        this.hitstopTimer = 0.04;
      }
      this.chaosPoints += Math.round(imp.impulseSpeed * 1.4);
      this.sound.playCrash(imp.impulseSpeed);
      this.scareNearbyPedestrians(v.state.x, v.state.z, 20);
      if (v.state.integrity <= 0) {
        this.playerHp = 0;
        this.triggerGameOver();
      }
    }

    const count = Math.min(18, Math.max(4, Math.floor(imp.impulseSpeed * 0.9)));
    for (let i = 0; i < count; i++) {
      const isGlass = imp.impulseSpeed > 12 && i % 4 === 0;
      this.spawnParticle(
        imp.worldX,
        imp.worldY,
        imp.worldZ,
        imp.normalX * (3 + Math.random() * 6) + (Math.random() - 0.5) * 6,
        2 + Math.random() * 5,
        imp.normalZ * (3 + Math.random() * 6) + (Math.random() - 0.5) * 6,
        isGlass ? 0.14 : 0.1,
        0.45 + Math.random() * 0.35,
        16,
        isGlass ? 0xbae6fd : 0xfbbf24
      );
    }
  }

  private syncDetachedParts(v: SimVehicle, imp?: ImpactEvent): void {
    const d = v.state.detachedParts;
    const rig = v.rig;

    if (d.windshieldCracked && rig.windshieldMesh.material !== rig.crackedGlassMat) {
      rig.windshieldMesh.material = rig.crackedGlassMat;
    }
    if (d.leftHeadlightBroken) rig.leftHeadlightMat.emissiveIntensity = 0;
    if (d.rightHeadlightBroken) rig.rightHeadlightMat.emissiveIntensity = 0;

    const frontAvg = (v.state.zones.frontLeft + v.state.zones.frontRight) * 0.5;
    if (!d.hood && frontAvg > 0.22) {
      rig.hoodGroup.rotation.x = Math.min(0.45, (frontAvg - 0.22) * 1.1);
    } else if (!d.hood) {
      rig.hoodGroup.rotation.x = 0;
    }

    if (imp && imp.newlyDetached.length > 0) {
      for (const part of imp.newlyDetached) {
        if (part === 'frontBumper' && rig.frontBumperGroup.visible) {
          rig.frontBumperGroup.visible = false;
          this.spawnDebris(v.state, rig.paintMat.color.getHex(), 1.7, 0.25, 0.25, imp);
        } else if (part === 'rearBumper' && rig.rearBumperGroup.visible) {
          rig.rearBumperGroup.visible = false;
          this.spawnDebris(v.state, rig.paintMat.color.getHex(), 1.7, 0.25, 0.25, imp);
        } else if (part === 'hood' && rig.hoodGroup.visible) {
          rig.hoodGroup.visible = false;
          this.spawnDebris(v.state, rig.paintMat.color.getHex(), 1.4, 0.08, 1.2, imp);
        } else if (part === 'spoiler' && rig.spoilerGroup?.visible) {
          rig.spoilerGroup.visible = false;
          this.spawnDebris(v.state, 0x181b20, 1.5, 0.12, 0.28, imp);
        } else if (part === 'leftDoor' && rig.leftDoorGroup.visible) {
          rig.leftDoorGroup.visible = false;
          this.spawnDebris(v.state, rig.paintMat.color.getHex(), 0.1, 0.65, 1.15, imp);
        } else if (part === 'rightDoor' && rig.rightDoorGroup.visible) {
          rig.rightDoorGroup.visible = false;
          this.spawnDebris(v.state, rig.paintMat.color.getHex(), 0.1, 0.65, 1.15, imp);
        }
      }
    }
  }

  private spawnDebris(
    car: VehiclePhysicsState,
    colorHex: number,
    w: number,
    h: number,
    d: number,
    imp: ImpactEvent
  ): void {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.35, metalness: 0.55 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(imp.worldX, imp.worldY + 0.3, imp.worldZ);
    mesh.rotation.y = car.heading;
    this.scene.add(mesh);

    this.debrisPieces.push({
      mesh,
      vx: car.vx * 0.8 + imp.normalX * 5 + (Math.random() - 0.5) * 4,
      vy: 4.2 + Math.random() * 3.5,
      vz: car.vz * 0.8 + imp.normalZ * 5 + (Math.random() - 0.5) * 4,
      rx: (Math.random() - 0.5) * 9,
      ry: (Math.random() - 0.5) * 9,
      rz: (Math.random() - 0.5) * 9,
      life: 10,
    });

    if (this.debrisPieces.length > 26) {
      const old = this.debrisPieces.shift()!;
      this.scene.remove(old.mesh);
      old.mesh.geometry.dispose();
      (old.mesh.material as THREE.Material).dispose();
    }
  }

  private spawnParticle(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    size: number,
    maxLife: number,
    gravity: number,
    colorHex: number
  ): void {
    const p = this.particles[this.particleCursor];
    this.particleCursor = (this.particleCursor + 1) % PARTICLE_POOL_SIZE;
    p.active = true;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.size = size;
    p.life = maxLife;
    p.maxLife = maxLife;
    p.gravity = gravity;
    p.color.setHex(colorHex);
    this.particleMesh.setColorAt(
      this.particleCursor === 0 ? PARTICLE_POOL_SIZE - 1 : this.particleCursor - 1,
      p.color
    );
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
  }

  private stepParticlesAndDebris(dt: number): void {
    let anyParticle = false;
    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      anyParticle = true;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        _mat4.makeScale(0, 0, 0);
        this.particleMesh.setMatrixAt(i, _mat4);
        continue;
      }
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const t = p.life / p.maxLife;
      const s = p.size * (0.4 + 0.6 * t);
      _v1.set(p.x, p.y, p.z);
      _scale.set(s, s, s);
      _mat4.compose(_v1, _quat.identity(), _scale);
      this.particleMesh.setMatrixAt(i, _mat4);
    }
    if (anyParticle) {
      this.particleMesh.instanceMatrix.needsUpdate = true;
    }

    for (let i = this.debrisPieces.length - 1; i >= 0; i--) {
      const d = this.debrisPieces[i];
      d.life -= dt;
      if (d.life <= 0) {
        this.scene.remove(d.mesh);
        d.mesh.geometry.dispose();
        (d.mesh.material as THREE.Material).dispose();
        this.debrisPieces.splice(i, 1);
        continue;
      }
      d.vy -= 20 * dt;
      d.mesh.position.x += d.vx * dt;
      d.mesh.position.y += d.vy * dt;
      d.mesh.position.z += d.vz * dt;
      const g = getGroundHeightAt(d.mesh.position.x, d.mesh.position.z) + 0.08;
      if (d.mesh.position.y < g) {
        d.mesh.position.y = g;
        d.vy *= -0.32;
        d.vx *= 0.72;
        d.vz *= 0.72;
        d.rx *= 0.65;
        d.ry *= 0.65;
        d.rz *= 0.65;
      }
      d.mesh.rotation.x += d.rx * dt;
      d.mesh.rotation.y += d.ry * dt;
      d.mesh.rotation.z += d.rz * dt;
    }
  }

  private syncCarRig(v: SimVehicle, throttleInput: number): void {
    const s = v.state;
    if (v.isTraffic && this.playerVehicle && v !== this.playerVehicle) {
      const px = this.inVehicle ? this.playerVehicle.state.x : this.playerX;
      const pz = this.inVehicle ? this.playerVehicle.state.z : this.playerZ;
      const dSq = (s.x - px) * (s.x - px) + (s.z - pz) * (s.z - pz);
      if (dSq > 275 * 275) {
        v.rig.root.visible = false;
        return;
      }
      v.rig.root.visible = true;
      v.rig.root.position.set(s.x, s.y, s.z);
      v.rig.root.rotation.set(s.terrainPitch, s.heading, s.terrainRoll);
      if (dSq > 140 * 140) {
        return;
      }
    } else {
      v.rig.root.visible = true;
      v.rig.root.position.set(s.x, s.y, s.z);
      v.rig.root.rotation.set(s.terrainPitch, s.heading, s.terrainRoll);
    }

    const isPlayerFirst = this.cameraMode === 'first' && this.inVehicle && v === this.playerVehicle;
    v.rig.roofMesh.visible = !isPlayerFirst;
    v.rig.contactShadow.visible = s.grounded;

    // Show driver inside NPC cars unless exited; show player driver in 3rd-person only
    if (this.playerVehicleAction && this.playerVehicleAction.car === v) {
      // Driver visibility during enter/exit/hijack is explicitly controlled by stepPlayerVehicleAction
    } else if (v === this.playerVehicle) {
      v.rig.setDriverVisible(this.inVehicle && this.cameraMode === 'third');
    } else if (v.isTraffic) {
      v.rig.setDriverVisible(!v.driverExited);
    }

    v.rig.setDoorOpen('left', v.leftDoorAngle);
    v.rig.setDoorOpen('right', v.rightDoorAngle);

    v.rig.bodyGroup.position.y = s.rideHeightOffset;
    v.rig.bodyGroup.rotation.x = s.pitch + s.sagPitch;
    v.rig.bodyGroup.rotation.z = s.roll + s.sagRoll;

    for (const pivot of v.rig.frontSteerPivots) {
      pivot.rotation.y = s.steerAngle;
    }
    for (let i = 0; i < v.rig.wheelCamberPivots.length; i++) {
      v.rig.wheelCamberPivots[i].rotation.z = s.wheelCamber[i];
    }
    for (const wm of v.rig.wheelSpinMeshes) {
      wm.rotation.x = -s.wheelSpin;
    }

    v.rig.steeringWheel.rotation.z = s.steerAngle * 1.85;
    v.rig.brakeLightMat.emissiveIntensity = throttleInput < -0.1 ? 2.4 : 0.75;

    // Blinkers for turning, lane changing, yielding, and player steering
    let blinker: TurnSignalMode = v.blinkerMode;
    if (v === this.playerVehicle && this.inVehicle) {
      if (s.steerAngle > 0.17) blinker = 'left';
      else if (s.steerAngle < -0.17) blinker = 'right';
      else blinker = 'none';
    }
    v.rig.updateTurnSignals(this.simTime, blinker);

    if (v.isPolice) {
      v.rig.updateLightbar(
        this.simTime,
        v.policeState === 'responding' || v.policeState === 'investigating' || v.policeState === 'pursuing_player'
      );
    }
  }

  private updateTitleCamera(dt: number): void {
    this.titleOrbitTime += dt * 0.22;
    const cx = -85 + Math.sin(this.titleOrbitTime) * 42;
    const cz = -115 + Math.cos(this.titleOrbitTime) * 48;
    const cy = 20 + Math.sin(this.titleOrbitTime * 0.7) * 5;
    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(-65, 7, -55);
  }

  private updateActiveCamera(dt: number): void {
    this.trauma = Math.max(0, this.trauma - 1.65 * dt);
    const shake = this.trauma * this.trauma;
    const shakeX = (Math.random() - 0.5) * shake * 0.6;
    const shakeY = (Math.random() - 0.5) * shake * 0.6;

    if (this.playerVehicleAction) {
      const s = this.playerVehicleAction.car.state;
      if (this.cameraMode === 'first') {
        const { fx, fz } = getCarBasis(this.playerHeading);
        this.camera.position.set(this.playerX, this.playerY + 1.55, this.playerZ);
        this.camera.lookAt(this.playerX + fx * 14, this.playerY + 1.45, this.playerZ + fz * 14);
        this.camera.fov = THREE.MathUtils.damp(this.camera.fov, 70, 8, dt);
        this.camera.updateProjectionMatrix();
      } else {
        const { fx, fz, rx, rz } = getCarBasis(s.heading);
        const focusX = (s.x + this.playerX) * 0.5;
        const focusZ = (s.z + this.playerZ) * 0.5;
        const desiredX = focusX - fx * 3.8 - rx * 3.4;
        const desiredZ = focusZ - fz * 3.8 - rz * 3.4;
        const desiredY = Math.max(getGroundHeightAt(desiredX, desiredZ) + 1.2, this.playerY + 2.35);
        const dampFactor = 1 - Math.exp(-9 * dt);
        this.camPos.lerp(_v1.set(desiredX, desiredY, desiredZ), dampFactor);
        this.camLook.lerp(_v2.set(focusX, this.playerY + 1.15, focusZ), dampFactor);
        this.camera.position.copy(this.camPos);
        this.camera.lookAt(this.camLook);
        this.camera.fov = THREE.MathUtils.damp(this.camera.fov, 64, 8, dt);
        this.camera.updateProjectionMatrix();
      }
    } else if (this.inVehicle && this.playerVehicle) {
      const car = this.playerVehicle.state;
      const rig = this.playerVehicle.rig;
      const speed = Math.hypot(car.vx, car.vz);

      if (this.cameraMode === 'first') {
        rig.root.updateMatrixWorld(true);
        _v1.copy(rig.driverEyeLocal).applyMatrix4(rig.bodyGroup.matrixWorld);

        const totalYaw = car.heading + this.camYawOffset;
        const { fx, fz } = getCarBasis(totalYaw);
        _v2.set(
          _v1.x + fx * 22,
          _v1.y - Math.sin(this.camPitchOffset) * 10 + car.pitch * 8,
          _v1.z + fz * 22
        );

        this.camera.position.set(_v1.x + shakeX * 0.3, _v1.y + shakeY * 0.3, _v1.z);
        this.camera.lookAt(_v2);
        const targetFov = 70 + Math.min(14, speed * 0.22);
        this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 7, dt);
        this.camera.updateProjectionMatrix();
      } else {
        if (!this.isDraggingCam && speed > 4) {
          this.camYawOffset = THREE.MathUtils.damp(this.camYawOffset, 0, 2.5, dt);
        }
        const chaseYaw = car.heading + this.camYawOffset;
        const { fx, fz } = getCarBasis(chaseYaw);
        const dist = (car.spec.isTruck ? 10.2 : 7.8) + Math.min(2.6, speed * 0.05);
        const height = (car.spec.isTruck ? 3.8 : 2.6) + Math.sin(this.camPitchOffset) * 4.5;

        let desiredX = car.x - fx * dist;
        let desiredZ = car.z - fz * dist;
        let desiredY = car.y + height;

        const col = resolveStaticCollisions(desiredX, desiredZ, desiredY, 1.0);
        if (col.hit) {
          desiredX = col.x;
          desiredZ = col.z;
        }
        desiredY = Math.max(getGroundHeightAt(desiredX, desiredZ) + 1.1, desiredY);

        const dampFactor = 1 - Math.exp(-9.5 * dt);
        this.camPos.x += (desiredX - this.camPos.x) * dampFactor;
        this.camPos.y += (desiredY - this.camPos.y) * dampFactor;
        this.camPos.z += (desiredZ - this.camPos.z) * dampFactor;

        const lookTargetX = car.x + fx * 4.5;
        const lookTargetY = car.y + (car.spec.isTruck ? 1.8 : 1.15);
        const lookTargetZ = car.z + fz * 4.5;
        this.camLook.x += (lookTargetX - this.camLook.x) * dampFactor;
        this.camLook.y += (lookTargetY - this.camLook.y) * dampFactor;
        this.camLook.z += (lookTargetZ - this.camLook.z) * dampFactor;

        this.camera.position.set(this.camPos.x + shakeX, this.camPos.y + shakeY, this.camPos.z);
        this.camera.lookAt(this.camLook);

        const targetFov = 62 + Math.min(15, speed * 0.24);
        this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 6, dt);
        this.camera.updateProjectionMatrix();
      }
    } else {
      const { fx, fz } = getCarBasis(this.playerHeading);
      if (this.cameraMode === 'first') {
        const bob = Math.sin(this.playerWalkPhase * 2) * 0.045;
        this.camera.position.set(this.playerX, this.playerY + this.playerRig.eyeOffsetY + bob, this.playerZ);
        this.camera.lookAt(
          this.playerX + fx * 15,
          this.playerY + this.playerRig.eyeOffsetY - Math.sin(this.camPitchOffset) * 12,
          this.playerZ + fz * 15
        );
        this.camera.fov = THREE.MathUtils.damp(this.camera.fov, 72, 8, dt);
        this.camera.updateProjectionMatrix();
      } else {
        const insideMall = Boolean(getMallAt(this.playerX, this.playerZ));
        const dist = insideMall ? 2.8 : 4.6;
        let desiredX = this.playerX - fx * dist;
        let desiredZ = this.playerZ - fz * dist;
        const desiredY = Math.max(
          getGroundHeightAt(desiredX, desiredZ) + 1.0,
          this.playerY + (insideMall ? 1.85 : 2.2) + this.camPitchOffset * 2.2
        );
        const col = resolveStaticCollisions(desiredX, desiredZ, desiredY, 0.7);
        if (col.hit) {
          desiredX = col.x;
          desiredZ = col.z;
        }
        const dampFactor = 1 - Math.exp(-11 * dt);
        this.camPos.lerp(_v1.set(desiredX, desiredY, desiredZ), dampFactor);
        this.camLook.lerp(_v2.set(this.playerX + fx * 2, this.playerY + 1.35, this.playerZ + fz * 2), dampFactor);
        this.camera.position.copy(this.camPos);
        this.camera.lookAt(this.camLook);
        this.camera.fov = THREE.MathUtils.damp(this.camera.fov, 64, 8, dt);
        this.camera.updateProjectionMatrix();
      }
    }
  }

  private triggerGameOver(): void {
    if (this.phase === 'gameover') return;
    this.phase = 'gameover';
    document.body.dataset.state = 'gameover';
    this.sound.updateVehicleAudio(false, 0, 0, 0, true);
    this.pushHudSnapshot();
  }

  private pushHudSnapshot(): void {
    document.body.dataset.inVehicle = this.inVehicle ? 'true' : 'false';
    document.body.dataset.playerAction = this.playerVehicleAction ? this.playerVehicleAction.mode : 'idle';
    const px = this.inVehicle && !this.playerVehicleAction && this.playerVehicle ? this.playerVehicle.state.x : this.playerX;
    const pz = this.inVehicle && !this.playerVehicleAction && this.playerVehicle ? this.playerVehicle.state.z : this.playerZ;
    const pHeading = this.inVehicle && !this.playerVehicleAction && this.playerVehicle ? this.playerVehicle.state.heading : this.playerHeading;

    const nearCar = !this.inVehicle && !this.playerVehicleAction ? this.findNearestVehicle(5.6) : null;
    const activeCar = this.inVehicle ? this.playerVehicle : null;

    let vehicleTelemetry: HudSnapshot['vehicle'] = null;
    if (activeCar) {
      const s = activeCar.state;
      const { fx, fz } = getCarBasis(s.heading);
      const forwardSpeed = s.vx * fx + s.vz * fz;
      const throttle = this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0;
      const { gear, rpmRatio } = computeGearAndRpm(forwardSpeed, s.spec.maxSpeedKmh, throttle);
      vehicleTelemetry = {
        speedKmh: Math.round(Math.hypot(s.vx, s.vz) * 3.6),
        rpmRatio,
        gear,
        nitro: Math.round(s.nitro),
        integrity: Math.round(s.integrity),
        zones: { ...s.zones },
        modelId: s.spec.id,
        modelName: s.spec.name,
        headlightsOn: !s.detachedParts.leftHeadlightBroken || !s.detachedParts.rightHeadlightBroken,
      };
    }

    const chaosLevel = Math.min(5, Math.floor(this.chaosPoints / 45));

    const projectedBubbles: SpeechBubbleHud[] = [];
    for (const b of this.speechBubbles) {
      _v1.set(b.worldX, b.worldY, b.worldZ).project(this.camera);
      if (_v1.z > 1) continue;
      const sx = (_v1.x + 1) * 0.5;
      const sy = (1 - _v1.y) * 0.5;
      if (sx < 0.05 || sx > 0.95 || sy < 0.08 || sy > 0.88) continue;
      projectedBubbles.push({
        id: b.id,
        speaker: b.speaker,
        text: b.text,
        screenX: sx,
        screenY: sy,
        tone: b.tone,
      });
    }

    this.onHudUpdate({
      phase: this.phase,
      cameraMode: this.cameraMode,
      controlMode: this.controlMode,
      inVehicle: this.inVehicle,
      playerHp: Math.round(this.playerHp),
      stamina: Math.round(this.stamina),
      district: getDistrictAt(px, pz),
      chaosLevel,
      timeOfDay: this.timeOfDay,
      muted: this.sound.isMuted(),
      canEnterVehicle: Boolean(nearCar),
      nearbyVehicleName: nearCar ? nearCar.state.spec.name : null,
      vehicle: vehicleTelemetry,
      stats: {
        maxSpeedKmh: Math.round(this.maxSpeedKmh),
        crashes: this.crashes,
        distanceKm: Number((this.distanceM / 1000).toFixed(2)),
        propsDestroyed: this.propsDestroyed,
      },
      playerPos: { x: px, z: pz, heading: pHeading },
      trafficDots: this.vehicles
        .filter((v) => v !== activeCar)
        .map((v) => ({ x: v.state.x, z: v.state.z, isPolice: v.isPolice })),
      shipDots: this.ships.map((sh) => ({
        x: sh.x,
        z: sh.z,
        length: sh.spec.length,
        width: sh.spec.width,
        heading: sh.heading,
      })),
      bridgeRects: BRIDGES.map((b) => ({
        x: b.centerX,
        z: (b.zStart + b.zEnd) * 0.5,
        w: b.deckWidth,
        d: b.zEnd - b.zStart,
      })),
      waterBand: { zMin: WATER_Z_MIN, zMax: WATER_Z_MAX },
      landmarkDots: LANDMARK_MINIMAP_DOTS,
      speechBubbles: projectedBubbles,
      policeBanner: this.policeBanner,
    });
  }

  public dispose(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.resizeObserver.disconnect();
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleWindowBlur);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);

    this.sound.dispose();
    this.city.dispose();
    this.playerRig.dispose();
    for (const v of this.vehicles) v.rig.dispose();
    for (const p of this.pedestrians) p.rig.dispose();
    for (const sh of this.ships) {
      if (sh.mesh) {
        this.disposeShipMesh(sh.mesh);
      }
    }
    this.textures.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}

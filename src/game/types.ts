export type GamePhase = 'title' | 'playing' | 'paused' | 'gameover';

export type CameraMode = 'third' | 'first';

export type ControlMode = 'pc' | 'mobile';

export type TimeOfDay = 'day' | 'sunset' | 'night';

export type CarModelId = 'viper' | 'dominator' | 'titan' | 'cruiser' | 'truck';

export interface TouchInputState {
  throttle: number; // -1..1
  steer: number;    // -1..1
  handbrake: boolean;
  nitro: boolean;
  jump: boolean;
}

export interface CarSpec {
  id: CarModelId;
  name: string;
  category: string;
  length: number;
  width: number;
  height: number;
  wheelBase: number;
  trackWidth: number;
  wheelRadius: number;
  mass: number;
  maxEngineForce: number;
  maxSpeedKmh: number;
  grip: number;
  driftFactor: number;
  suspensionStiffness: number;
  defaultColor: number;
  isTaxi?: boolean;
  isTruck?: boolean;
}

export interface DamageZones {
  frontLeft: number; // 0..1
  frontRight: number;
  rearLeft: number;
  rearRight: number;
  leftSide: number;
  rightSide: number;
}

export interface VehicleTelemetry {
  speedKmh: number;
  rpmRatio: number; // 0..1
  gear: string; // 'R' | 'N' | '1'..'6'
  nitro: number; // 0..100
  integrity: number; // 0..100
  zones: DamageZones;
  modelId: CarModelId;
  modelName: string;
  headlightsOn: boolean;
}

export interface SpeechBubbleHud {
  id: number;
  speaker: string;
  text: string;
  screenX: number; // 0..1 viewport fraction
  screenY: number; // 0..1 viewport fraction
  tone: 'npc' | 'angry' | 'police' | 'clear';
}

export interface HudSnapshot {
  phase: GamePhase;
  cameraMode: CameraMode;
  controlMode: ControlMode;
  inVehicle: boolean;
  playerHp: number; // 0..100
  stamina: number; // 0..100
  district: string;
  chaosLevel: number; // 0..5 stars
  timeOfDay: TimeOfDay;
  muted: boolean;
  canEnterVehicle: boolean;
  nearbyVehicleName: string | null;
  vehicle: VehicleTelemetry | null;
  stats: {
    maxSpeedKmh: number;
    crashes: number;
    distanceKm: number;
    propsDestroyed: number;
  };
  playerPos: { x: number; z: number; heading: number };
  trafficDots: Array<{ x: number; z: number; isPolice?: boolean }>;
  shipDots?: Array<{ x: number; z: number; length: number; width: number; heading: number }>;
  bridgeRects: Array<{ x: number; z: number; w: number; d: number }>;
  waterBand: { zMin: number; zMax: number };
  landmarkDots: Array<{ x: number; z: number; label: string; color: string }>;
  speechBubbles: SpeechBubbleHud[];
  policeBanner: string | null;
}

export interface StaticAABB {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
  kind: 'building' | 'pylon' | 'container' | 'wall';
  color?: number;
}

export interface StaticCircle {
  x: number;
  z: number;
  radius: number;
  height: number;
  kind: 'tree' | 'bush' | 'pole' | 'fountain' | 'furniture' | 'pump';
}

export interface BridgeSpec {
  id: string;
  name: string;
  centerX: number;
  zStart: number; // north abutment
  zEnd: number; // south abutment
  deckWidth: number;
  deckHeight: number;
  rampLength: number;
  style: 'suspension' | 'arch';
}

export interface ShipSpec {
  id: string;
  name: string;
  kind: 'cargo' | 'tug' | 'yacht';
  length: number;
  width: number;
  hullHeight: number;
  zLane: number;
  xStart: number;
  xMin: number;
  xMax: number;
  dir: 1 | -1;
  speed: number;
  color: number;
}

export interface MallSpec {
  id: string;
  name: string;
  cx: number;
  cz: number;
  w: number;
  d: number;
  h: number;
  kind: 'mall' | 'showroom' | 'supermarket';
  doors: Array<{
    x: number;
    z: number;
    axis: 'x' | 'z';
    width: number;
  }>;
}

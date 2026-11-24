import { useEffect, useRef, useState } from 'react';
import { GameHUD } from './components/GameHUD';
import { MobileControls } from './components/MobileControls';
import { GameOverModal, PauseModal } from './components/Modals';
import { TitleScreen } from './components/TitleScreen';
import { GameEngine } from './game/GameEngine';
import type { CarModelId, ControlMode, HudSnapshot, TimeOfDay, TouchInputState } from './game/types';
import { LANDMARK_MINIMAP_DOTS, WATER_Z_MAX, WATER_Z_MIN } from './game/worldLayout';

const INITIAL_HUD: HudSnapshot = {
  phase: 'title',
  cameraMode: 'third',
  controlMode:
    typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches ? 'mobile' : 'pc',
  inVehicle: true,
  playerHp: 100,
  stamina: 100,
  district: 'Торговый Центр (Даунтаун)',
  chaosLevel: 0,
  timeOfDay: 'day',
  muted: false,
  canEnterVehicle: false,
  nearbyVehicleName: null,
  vehicle: null,
  stats: {
    maxSpeedKmh: 0,
    crashes: 0,
    distanceKm: 0,
    propsDestroyed: 0,
  },
  playerPos: { x: -85, z: -145, heading: Math.PI },
  trafficDots: [],
  shipDots: [],
  bridgeRects: [],
  waterBand: { zMin: WATER_Z_MIN, zMax: WATER_Z_MAX },
  landmarkDots: LANDMARK_MINIMAP_DOTS,
  speechBubbles: [],
  policeBanner: null,
};

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [hud, setHud] = useState<HudSnapshot>(INITIAL_HUD);
  const [sandboxOpen, setSandboxOpen] = useState(false);

  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    const params = new URLSearchParams(window.location.search);
    const autostart = params.get('autostart') === '1';

    const engine = new GameEngine(
      container,
      (snapshot) => {
        setHud(snapshot);
      },
      autostart
    );
    engineRef.current = engine;

    const handleTab = (e: KeyboardEvent) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        if (document.body.dataset.state === 'playing') {
          setSandboxOpen((prev) => !prev);
        }
      }
    };
    window.addEventListener('keydown', handleTab);

    return () => {
      window.removeEventListener('keydown', handleTab);
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const handleStart = () => {
    setSandboxOpen(false);
    engineRef.current?.startGame();
  };

  const handleSelectControlMode = (mode: ControlMode) => {
    engineRef.current?.setControlMode(mode);
  };

  const handleTouchInput = (partial: Partial<TouchInputState>) => {
    engineRef.current?.setTouchInput(partial);
  };

  const handleTimeOfDay = (tod: TimeOfDay) => {
    engineRef.current?.setTimeOfDay(tod);
  };

  const handleToggleCamera = () => {
    engineRef.current?.toggleCameraMode();
  };

  const handleToggleMute = () => {
    engineRef.current?.toggleMute();
  };

  const handlePause = () => {
    setSandboxOpen(false);
    engineRef.current?.pauseGame();
  };

  const handleResume = () => {
    engineRef.current?.resumeGame();
  };

  const handleRepair = () => {
    engineRef.current?.repairCurrentVehicle(false);
  };

  const handleSpawnCar = (model: CarModelId, color?: number) => {
    engineRef.current?.spawnSandboxCar(model, color);
  };

  const handlePaintColor = (hex: number) => {
    engineRef.current?.setVehiclePaintColor(hex);
  };

  const handleRespawn = () => {
    setSandboxOpen(false);
    engineRef.current?.respawnPlayer();
  };

  const handleExitTitle = () => {
    setSandboxOpen(false);
    engineRef.current?.returnToTitle();
  };

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#090b10]">
      {/* Isolated WebGL canvas container */}
      <div
        ref={canvasMountRef}
        data-testid="game-viewport"
        className="fixed inset-0 w-full h-full"
      />

      {hud.phase === 'title' && (
        <TitleScreen
          controlMode={hud.controlMode}
          timeOfDay={hud.timeOfDay}
          onSelectControlMode={handleSelectControlMode}
          onSelectTimeOfDay={handleTimeOfDay}
          onStart={handleStart}
        />
      )}

      {hud.phase === 'playing' && (
        <>
          <GameHUD
            snapshot={hud}
            sandboxOpen={sandboxOpen}
            onToggleSandbox={() => setSandboxOpen((prev) => !prev)}
            onToggleCamera={handleToggleCamera}
            onToggleMute={handleToggleMute}
            onPause={handlePause}
            onRepair={handleRepair}
            onSpawnCar={handleSpawnCar}
            onPaintColor={handlePaintColor}
            onTimeOfDay={handleTimeOfDay}
            onSelectControlMode={handleSelectControlMode}
          />
          {hud.controlMode === 'mobile' && (
            <MobileControls
              inVehicle={hud.inVehicle}
              canEnterVehicle={hud.canEnterVehicle}
              nearbyVehicleName={hud.nearbyVehicleName}
              onTouchInput={handleTouchInput}
              onInteract={() => engineRef.current?.triggerInteract()}
              onHorn={() => engineRef.current?.triggerHorn()}
            />
          )}
        </>
      )}

      {hud.phase === 'paused' && (
        <PauseModal
          onResume={handleResume}
          onRepair={() => engineRef.current?.repairCurrentVehicle(true)}
          onExitTitle={handleExitTitle}
        />
      )}

      {hud.phase === 'gameover' && (
        <GameOverModal
          snapshot={hud}
          onRespawn={handleRespawn}
          onExitTitle={handleExitTitle}
        />
      )}
    </main>
  );
}

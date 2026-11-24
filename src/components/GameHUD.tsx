import React from 'react';
import { Camera, Car, Monitor, Pause, RotateCcw, Smartphone, Volume2, VolumeX } from 'lucide-react';
import { CAR_SPECS } from '../game/physics';
import type { CarModelId, ControlMode, DamageZones, HudSnapshot, TimeOfDay } from '../game/types';
import { Minimap } from './Minimap';

interface GameHUDProps {
  snapshot: HudSnapshot;
  sandboxOpen: boolean;
  onToggleSandbox: () => void;
  onToggleCamera: () => void;
  onToggleMute: () => void;
  onPause: () => void;
  onRepair: () => void;
  onSpawnCar: (model: CarModelId, color?: number) => void;
  onPaintColor: (hex: number) => void;
  onTimeOfDay: (tod: TimeOfDay) => void;
  onSelectControlMode: (mode: ControlMode) => void;
}

const PAINT_SWATCHES = [
  { hex: 0xe11d48, label: 'Красный' },
  { hex: 0xf59e0b, label: 'Янтарный' },
  { hex: 0x2563eb, label: 'Синий' },
  { hex: 0x10b981, label: 'Изумрудный' },
  { hex: 0xe2e8f0, label: 'Жемчужный' },
  { hex: 0x18181b, label: 'Матовый чёрный' },
];

function zoneFill(dmg: number): string {
  if (dmg < 0.2) return '#334155';
  if (dmg < 0.5) return '#f59e0b';
  return '#ef4444';
}

const DamageSilhouette: React.FC<{ zones: DamageZones }> = ({ zones }) => (
  <svg viewBox="0 0 64 96" className="w-10 h-14 shrink-0" aria-label="Схема повреждений авто">
    <rect x="10" y="6" width="21" height="24" rx="4" fill={zoneFill(zones.frontLeft)} stroke="#94a3b8" strokeWidth="1.5" />
    <rect x="33" y="6" width="21" height="24" rx="4" fill={zoneFill(zones.frontRight)} stroke="#94a3b8" strokeWidth="1.5" />
    <rect x="10" y="33" width="16" height="30" rx="2" fill={zoneFill(zones.leftSide)} stroke="#94a3b8" strokeWidth="1.5" />
    <rect x="38" y="33" width="16" height="30" rx="2" fill={zoneFill(zones.rightSide)} stroke="#94a3b8" strokeWidth="1.5" />
    <rect x="27" y="35" width="10" height="26" rx="2" fill="#1e293b" />
    <rect x="10" y="66" width="21" height="24" rx="4" fill={zoneFill(zones.rearLeft)} stroke="#94a3b8" strokeWidth="1.5" />
    <rect x="33" y="66" width="21" height="24" rx="4" fill={zoneFill(zones.rearRight)} stroke="#94a3b8" strokeWidth="1.5" />
  </svg>
);

export const GameHUD: React.FC<GameHUDProps> = ({
  snapshot,
  sandboxOpen,
  onToggleSandbox,
  onToggleCamera,
  onToggleMute,
  onPause,
  onRepair,
  onSpawnCar,
  onPaintColor,
  onTimeOfDay,
  onSelectControlMode,
}) => {
  const { vehicle, cameraMode, controlMode, inVehicle, district, chaosLevel, playerHp, stamina } = snapshot;
  const isMobile = controlMode === 'mobile';

  return (
    <div className="fixed inset-0 z-10 pointer-events-none p-2.5 sm:p-3 md:p-5 flex flex-col justify-between">
      {/* 3D-Projected NPC / Police Speech Bubbles */}
      {snapshot.speechBubbles.map((b) => {
        const borderColor =
          b.tone === 'angry'
            ? 'border-rose-400'
            : b.tone === 'police'
            ? 'border-sky-400'
            : b.tone === 'clear'
            ? 'border-emerald-400'
            : 'border-white/25';
        const speakerColor =
          b.tone === 'angry'
            ? 'text-rose-300'
            : b.tone === 'police'
            ? 'text-sky-300'
            : b.tone === 'clear'
            ? 'text-emerald-300'
            : 'text-amber-300';
        return (
          <div
            key={b.id}
            className={`fixed z-10 pointer-events-none px-2.5 py-1.5 rounded-lg border ${borderColor} shadow-lg max-w-[230px] text-center`}
            style={{
              left: `${b.screenX * 100}%`,
              top: `${b.screenY * 100}%`,
              transform: 'translate(-50%, -115%)',
              backgroundColor: 'rgba(9, 11, 16, 0.92)',
            }}
          >
            <div className={`text-[10px] font-bold uppercase tracking-wider ${speakerColor}`}>{b.speaker}</div>
            <div className="text-xs font-medium text-white leading-snug">{b.text}</div>
          </div>
        );
      })}

      {/* Police Dispatch / Investigation Verdict Banner */}
      {snapshot.policeBanner && (
        <div className="fixed top-14 sm:top-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none px-3.5 py-2 rounded-lg border border-sky-400/70 shadow-xl max-w-[92vw] sm:max-w-lg text-center" style={{ backgroundColor: 'rgba(9, 14, 26, 0.94)' }}>
          <div className="flex items-center justify-center gap-2 text-[11px] sm:text-xs font-bold tracking-wide text-white">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0" />
            <span>{snapshot.policeBanner}</span>
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-sky-500 shrink-0" />
          </div>
        </div>
      )}

      {/* TOP ROW */}
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        {/* Top-Left: Minimap + District + HP + Chaos Stars (+ compact Mobile Speedometer) */}
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="hidden sm:block">
            <Minimap snapshot={snapshot} />
          </div>

          <div
            className="px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-lg border border-white/15 flex flex-col gap-1 sm:gap-1.5 min-w-[138px] max-w-[162px] sm:max-w-none sm:min-w-[155px]"
            style={{ backgroundColor: 'rgba(9, 11, 16, 0.84)' }}
          >
            <div className="text-[11px] sm:text-xs font-semibold text-amber-400 tracking-wide truncate max-w-[150px] sm:max-w-[190px]">
              {district}
            </div>

            <div>
              <div className="flex items-center justify-between text-[10px] sm:text-[11px] text-slate-300 mb-0.5">
                <span>Здоровье</span>
                <span className="font-mono-num font-bold">{playerHp}%</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full transition-all duration-150"
                  style={{
                    width: `${playerHp}%`,
                    backgroundColor: playerHp > 40 ? '#10b981' : '#ef4444',
                  }}
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-1.5 pt-0.5 flex-wrap">
              <div className="flex items-center gap-0.5 sm:gap-1" aria-label={`Уровень хаоса: ${chaosLevel} из 5`}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <svg
                    key={star}
                    viewBox="0 0 20 20"
                    className="w-3 h-3 sm:w-3.5 sm:h-3.5"
                    fill={star <= chaosLevel ? '#f59e0b' : '#334155'}
                  >
                    <path d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L10 14.9l-5.3 2.7 1-5.8-4.2-4.1 5.9-.9L10 1.5z" />
                  </svg>
                ))}
              </div>

              {isMobile && inVehicle && vehicle && (
                <div className="flex md:hidden items-baseline gap-1 text-xs font-mono-num whitespace-nowrap">
                  <span className="font-display font-extrabold text-sm sm:text-base text-white">{vehicle.speedKmh}</span>
                  <span className="text-[9px] sm:text-[10px] text-slate-400">КМ/Ч</span>
                  <span className="px-1 rounded bg-amber-500 text-slate-950 font-bold text-[9px] sm:text-[10px]">{vehicle.gear}</span>
                  <span className="text-[9px] sm:text-[10px] text-emerald-400">{vehicle.integrity}%</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Top-Right: Camera Mode + Sandbox Garage + Mute + Pause */}
        <div className="flex items-center gap-1 sm:gap-1.5 md:gap-2 pointer-events-auto shrink-0">
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleCamera();
            }}
            aria-label="Переключить камеру 1-е и 3-е лицо"
            className="flex items-center gap-1 sm:gap-1.5 px-2 py-1.5 sm:px-2.5 md:px-3 sm:py-2 rounded-lg border border-white/15 text-[11px] sm:text-xs font-semibold text-slate-100 hover:border-amber-400 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            style={{ backgroundColor: 'rgba(9, 11, 16, 0.86)' }}
          >
            <Camera className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-400" />
            <span className="sm:hidden">{cameraMode === 'first' ? '1-е' : '3-е'}</span>
            <span className="hidden sm:inline">{cameraMode === 'first' ? '1-е лицо' : '3-е лицо'}{!isMobile ? ' [V]' : ''}</span>
          </button>

          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleSandbox();
            }}
            aria-label="Открыть гараж песочницы"
            aria-expanded={sandboxOpen}
            className={`flex items-center gap-1 sm:gap-1.5 px-2 py-1.5 sm:px-2.5 md:px-3 sm:py-2 rounded-lg border text-[11px] sm:text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              sandboxOpen
                ? 'border-amber-400 text-slate-950 bg-amber-400'
                : 'border-white/15 text-slate-100 hover:border-amber-400'
            }`}
            style={sandboxOpen ? undefined : { backgroundColor: 'rgba(9, 11, 16, 0.86)' }}
          >
            <Car className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span>Гараж{!isMobile ? ' [Tab]' : ''}</span>
          </button>

          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleMute();
            }}
            aria-label={snapshot.muted ? 'Включить звук' : 'Выключить звук'}
            className="p-1.5 sm:p-2 rounded-lg border border-white/15 text-slate-200 hover:border-amber-400 transition-colors cursor-pointer shrink-0"
            style={{ backgroundColor: 'rgba(9, 11, 16, 0.86)' }}
          >
            {snapshot.muted ? <VolumeX className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-rose-400" /> : <Volume2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
          </button>

          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onPause();
            }}
            aria-label="Пауза"
            className="p-1.5 sm:p-2 rounded-lg border border-white/15 text-slate-200 hover:border-amber-400 transition-colors cursor-pointer shrink-0"
            style={{ backgroundColor: 'rgba(9, 11, 16, 0.86)' }}
          >
            <Pause className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>
        </div>
      </div>

      {/* SANDBOX GARAGE DRAWER */}
      {sandboxOpen && (
        <div className="flex justify-end my-auto pointer-events-none z-20">
          <div
            className="pointer-events-auto w-72 p-4 rounded-xl border border-white/15 shadow-2xl flex flex-col gap-3.5"
            style={{ backgroundColor: 'rgba(9, 11, 16, 0.94)' }}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold text-sm text-white tracking-wide">
                Гараж и мир
              </h2>
              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.currentTarget.blur();
                  onRepair();
                }}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-xs font-semibold hover:bg-emerald-500/30 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Починить
              </button>
            </div>

            <div>
              <div className="text-[11px] font-semibold text-slate-400 mb-1.5">
                Вызвать автомобиль
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {(Object.keys(CAR_SPECS) as CarModelId[]).map((id) => {
                  const spec = CAR_SPECS[id];
                  const active = vehicle?.modelId === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      tabIndex={-1}
                      onClick={(e) => {
                        e.currentTarget.blur();
                        onSpawnCar(id);
                      }}
                      className={`px-2.5 py-2 rounded-lg text-left border text-xs transition-colors cursor-pointer ${
                        id === 'truck' ? 'col-span-2 ' : ''
                      }${
                        active
                          ? 'border-amber-400 bg-amber-500/20 text-white'
                          : 'border-white/10 bg-slate-900/80 text-slate-300 hover:border-white/30'
                      }`}
                    >
                      <div className="font-semibold truncate">{spec.name}</div>
                      <div className="text-[10px] text-slate-400">{spec.category}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-semibold text-slate-400 mb-1.5">
                Цвет кузова
              </div>
              <div className="flex items-center gap-2">
                {PAINT_SWATCHES.map((sw) => (
                  <button
                    key={sw.hex}
                    type="button"
                    tabIndex={-1}
                    aria-label={sw.label}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onPaintColor(sw.hex);
                    }}
                    className="w-7 h-7 rounded-full border-2 border-white/25 hover:scale-110 transition-transform cursor-pointer"
                    style={{ backgroundColor: `#${sw.hex.toString(16).padStart(6, '0')}` }}
                  />
                ))}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-semibold text-slate-400 mb-1.5">
                Управление
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onSelectControlMode('pc');
                  }}
                  className={`flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-semibold border cursor-pointer ${
                    controlMode === 'pc'
                      ? 'bg-slate-100 text-slate-950 border-slate-100'
                      : 'bg-slate-900 text-slate-300 border-white/10 hover:border-white/30'
                  }`}
                >
                  <Monitor className="w-3.5 h-3.5" />
                  ПК
                </button>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onSelectControlMode('mobile');
                  }}
                  className={`flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-semibold border cursor-pointer ${
                    controlMode === 'mobile'
                      ? 'bg-slate-100 text-slate-950 border-slate-100'
                      : 'bg-slate-900 text-slate-300 border-white/10 hover:border-white/30'
                  }`}
                >
                  <Smartphone className="w-3.5 h-3.5" />
                  Мобильное
                </button>
              </div>
            </div>

            <div>
              <div className="text-[11px] font-semibold text-slate-400 mb-1.5">
                Время суток
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    { id: 'day', label: 'День' },
                    { id: 'sunset', label: 'Закат' },
                    { id: 'night', label: 'Ночь' },
                  ] as const
                ).map((tod) => (
                  <button
                    key={tod.id}
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onTimeOfDay(tod.id);
                    }}
                    className={`py-1.5 rounded text-xs font-semibold border cursor-pointer ${
                      snapshot.timeOfDay === tod.id
                        ? 'bg-slate-100 text-slate-950 border-slate-100'
                        : 'bg-slate-900 text-slate-300 border-white/10 hover:border-white/30'
                    }`}
                  >
                    {tod.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* BOTTOM ROW (Desktop PC Mode only — Mobile uses MobileControls + top telemetry) */}
      {!isMobile ? (
        <div className="flex items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            {!inVehicle && snapshot.canEnterVehicle && snapshot.nearbyVehicleName && (
              <div
                className="px-4 py-2 rounded-lg border border-amber-400/60 text-amber-300 text-xs font-bold tracking-wide"
                style={{ backgroundColor: 'rgba(9, 11, 16, 0.9)' }}
              >
                [F] Сесть в {snapshot.nearbyVehicleName}
              </div>
            )}
            <div
              className="hidden sm:block px-3 py-1.5 rounded-lg text-[11px] text-slate-300 hud-stroke"
              style={{ backgroundColor: 'rgba(9, 11, 16, 0.72)' }}
            >
              {inVehicle
                ? 'WASD — Газ/Руль · Space — Ручник · Shift — Нитро · G — Гудок · F — Выйти · R — Починить'
                : 'WASD — Идти · Shift — Бег · Space — Прыжок · F — Сесть в авто · Мышь — Обзор'}
            </div>
          </div>

          {inVehicle && vehicle ? (
            <div
              className="px-4 py-3 rounded-xl border border-white/15 flex items-center gap-4"
              style={{ backgroundColor: 'rgba(9, 11, 16, 0.88)' }}
            >
              <DamageSilhouette zones={vehicle.zones} />

              <div className="flex flex-col min-w-[148px]">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-display font-extrabold text-4xl leading-none text-white font-mono-num">
                    {vehicle.speedKmh}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-400 font-semibold">КМ/Ч</span>
                    <span className="px-1.5 py-0.5 rounded bg-amber-500 text-slate-950 font-display font-extrabold text-xs">
                      {vehicle.gear}
                    </span>
                  </div>
                </div>

                <div className="mt-2 h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full transition-all duration-75"
                    style={{
                      width: `${Math.round(vehicle.rpmRatio * 100)}%`,
                      backgroundColor: vehicle.rpmRatio > 0.82 ? '#ef4444' : '#38bdf8',
                    }}
                  />
                </div>

                <div className="mt-2 flex items-center justify-between text-[11px] text-slate-300 gap-3">
                  <span>
                    Кузов:{' '}
                    <strong
                      className={`font-mono-num ${
                        vehicle.integrity > 60
                          ? 'text-emerald-400'
                          : vehicle.integrity > 30
                          ? 'text-amber-400'
                          : 'text-rose-400'
                      }`}
                    >
                      {vehicle.integrity}%
                    </strong>
                  </span>
                  <span>
                    Нитро: <strong className="font-mono-num text-cyan-300">{vehicle.nitro}%</strong>
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div
              className="px-4 py-3 rounded-xl border border-white/15 min-w-[175px]"
              style={{ backgroundColor: 'rgba(9, 11, 16, 0.88)' }}
            >
              <div className="text-xs font-semibold text-slate-200 mb-1.5">Пешком</div>
              <div className="flex items-center justify-between text-[11px] text-slate-300 mb-1">
                <span>Выносливость</span>
                <span className="font-mono-num font-bold">{stamina}%</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-amber-400 transition-all duration-100"
                  style={{ width: `${stamina}%` }}
                />
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="hidden md:flex justify-center">
          {inVehicle && vehicle && (
            <div
              className="px-4 py-2 rounded-xl border border-white/15 flex items-center gap-4"
              style={{ backgroundColor: 'rgba(9, 11, 16, 0.88)' }}
            >
              <DamageSilhouette zones={vehicle.zones} />
              <div className="flex items-baseline gap-2">
                <span className="font-display font-extrabold text-3xl text-white font-mono-num">{vehicle.speedKmh}</span>
                <span className="text-[11px] text-slate-400">КМ/Ч</span>
                <span className="px-1.5 py-0.5 rounded bg-amber-500 text-slate-950 font-display font-bold text-xs">{vehicle.gear}</span>
              </div>
              <div className="text-xs text-slate-300 font-mono-num">
                Кузов: <strong className="text-emerald-400">{vehicle.integrity}%</strong> · Нитро: <strong className="text-cyan-300">{vehicle.nitro}%</strong>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

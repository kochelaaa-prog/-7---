import React from 'react';
import { Monitor, Smartphone } from 'lucide-react';
import type { ControlMode, TimeOfDay } from '../game/types';

interface TitleScreenProps {
  controlMode: ControlMode;
  timeOfDay: TimeOfDay;
  onSelectControlMode: (mode: ControlMode) => void;
  onSelectTimeOfDay: (tod: TimeOfDay) => void;
  onStart: () => void;
}

export const TitleScreen: React.FC<TitleScreenProps> = ({
  controlMode,
  timeOfDay,
  onSelectControlMode,
  onSelectTimeOfDay,
  onStart,
}) => {
  return (
    <div className="fixed inset-0 z-20 flex flex-col justify-between p-4 sm:p-6 md:p-12 pointer-events-none">
      {/* Upper-left negative space composition */}
      <div className="max-w-xl pointer-events-auto">
        <div
          className="p-5 sm:p-6 md:p-7 rounded-xl border border-white/15"
          style={{ backgroundColor: 'rgba(9, 11, 16, 0.86)' }}
        >
          {/* Custom inline SVG Title Emblem */}
          <svg
            viewBox="0 0 420 92"
            className="w-full max-w-[340px] sm:max-w-[380px] h-auto mb-2.5 sm:mb-3"
            role="img"
            aria-label="GTA VII: Нео-Мегаполис"
          >
            <defs>
              <linearGradient id="gtaAccent" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#f59e0b" />
                <stop offset="100%" stopColor="#ef4444" />
              </linearGradient>
            </defs>
            <rect x="2" y="8" width="6" height="72" fill="url(#gtaAccent)" rx="2" />
            <text
              x="22"
              y="54"
              fill="#f8fafc"
              fontFamily="Oxanium, sans-serif"
              fontWeight="800"
              fontSize="46"
              letterSpacing="2"
            >
              GTA VII
            </text>
            <rect x="232" y="16" width="124" height="38" rx="4" fill="url(#gtaAccent)" />
            <text
              x="294"
              y="43"
              textAnchor="middle"
              fill="#090b10"
              fontFamily="Oxanium, sans-serif"
              fontWeight="800"
              fontSize="24"
              letterSpacing="1"
            >
              SANDBOX
            </text>
            <text
              x="24"
              y="80"
              fill="#cbd5e1"
              fontFamily="Plus Jakarta Sans, sans-serif"
              fontWeight="600"
              fontSize="13.5"
              letterSpacing="2"
            >
              НЕО-МЕГАПОЛИС · ОТКРЫТЫЙ ГОРОД
            </text>
          </svg>

          {/* Control Mode Selection (PC vs Mobile) */}
          <div className="mb-4 sm:mb-5">
            <div className="text-xs font-semibold text-slate-400 mb-2">
              Выберите управление
            </div>
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Выбор управления">
              <button
                type="button"
                onClick={() => onSelectControlMode('pc')}
                className={`flex items-center justify-center gap-2 py-2.5 px-2.5 sm:px-3 rounded-lg border text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  controlMode === 'pc'
                    ? 'bg-slate-100 text-slate-950 border-slate-100'
                    : 'bg-slate-900/80 text-slate-300 border-white/15 hover:border-white/35'
                }`}
              >
                <Monitor className="w-4 h-4 shrink-0" />
                <span>ПК (Клавиатура)</span>
              </button>

              <button
                type="button"
                onClick={() => onSelectControlMode('mobile')}
                className={`flex items-center justify-center gap-2 py-2.5 px-2.5 sm:px-3 rounded-lg border text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  controlMode === 'mobile'
                    ? 'bg-slate-100 text-slate-950 border-slate-100'
                    : 'bg-slate-900/80 text-slate-300 border-white/15 hover:border-white/35'
                }`}
              >
                <Smartphone className="w-4 h-4 shrink-0" />
                <span>Мобильное</span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
            <button
              type="button"
              data-start="true"
              onClick={(e) => {
                e.currentTarget.blur();
                onStart();
              }}
              className="px-6 sm:px-7 py-3 sm:py-3.5 rounded-lg bg-amber-500 hover:bg-amber-400 active:scale-[0.98] text-slate-950 font-display font-bold text-sm sm:text-base tracking-wide transition-all cursor-pointer shadow-lg whitespace-nowrap"
            >
              Начать игру
            </button>

            <div
              className="flex items-center p-1 rounded-lg border border-white/10"
              style={{ backgroundColor: 'rgba(15, 23, 42, 0.9)' }}
              role="group"
              aria-label="Время суток"
            >
              {(
                [
                  { id: 'day', label: 'День' },
                  { id: 'sunset', label: 'Закат' },
                  { id: 'night', label: 'Ночь' },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onSelectTimeOfDay(t.id)}
                  className={`px-2.5 sm:px-3 py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                    timeOfDay === t.id
                      ? 'bg-slate-100 text-slate-950'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom flat control hint line */}
      <div className="flex justify-center">
        <p
          className="px-4 sm:px-5 py-2 rounded-lg text-[11px] sm:text-xs text-slate-200 tracking-wide hud-stroke text-center"
          style={{ backgroundColor: 'rgba(9, 11, 16, 0.72)' }}
        >
          {controlMode === 'pc'
            ? 'WASD / Стрелки — Движение · Space — Ручник · Shift — Нитро · V — 1-е / 3-е лицо · F — Выйти / Сесть в авто · R — Починить · Tab — Гараж'
            : 'Сенсорное управление на экране · Свайп по экрану — обзор · Камера и Гараж — вверху справа'}
        </p>
      </div>
    </div>
  );
};

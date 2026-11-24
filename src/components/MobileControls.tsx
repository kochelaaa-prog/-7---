import React from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CarFront,
  LogOut,
  Zap,
} from 'lucide-react';
import type { TouchInputState } from '../game/types';

interface MobileControlsProps {
  inVehicle: boolean;
  canEnterVehicle: boolean;
  nearbyVehicleName: string | null;
  onTouchInput: (partial: Partial<TouchInputState>) => void;
  onInteract: () => void;
  onHorn: () => void;
}

export const MobileControls: React.FC<MobileControlsProps> = ({
  inVehicle,
  canEnterVehicle,
  nearbyVehicleName,
  onTouchInput,
  onInteract,
  onHorn,
}) => {
  const bindHold = (onDown: () => void, onUp: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onDown();
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onUp();
    },
    onPointerLeave: () => onUp(),
    onPointerCancel: () => onUp(),
  });

  return (
    <div className="fixed inset-x-0 bottom-0 z-10 pointer-events-none px-3 sm:px-5 pb-4 flex items-end justify-between gap-2">
      {/* Left Cluster: Steering or On-Foot D-Pad */}
      <div className="pointer-events-auto flex flex-col items-center gap-2 touch-none select-none">
        {!inVehicle && (
          <button
            type="button"
            tabIndex={-1}
            aria-label="Идти вперёд"
            {...bindHold(
              () => onTouchInput({ throttle: 1 }),
              () => onTouchInput({ throttle: 0 })
            )}
            className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl border border-white/20 flex items-center justify-center text-white active:bg-amber-500 active:text-slate-950 transition-colors cursor-pointer"
            style={{ backgroundColor: 'rgba(9, 11, 16, 0.85)' }}
          >
            <ArrowUp className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            tabIndex={-1}
            aria-label="Поворот налево"
            {...bindHold(
              () => onTouchInput({ steer: 1 }),
              () => onTouchInput({ steer: 0 })
            )}
            className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl border border-white/20 flex items-center justify-center text-white active:bg-amber-500 active:text-slate-950 transition-colors cursor-pointer"
            style={{ backgroundColor: 'rgba(9, 11, 16, 0.85)' }}
          >
            <ArrowLeft className="w-6 h-6 sm:w-7 sm:h-7" />
          </button>

          {!inVehicle && (
            <button
              type="button"
              tabIndex={-1}
              aria-label="Идти назад"
              {...bindHold(
                () => onTouchInput({ throttle: -1 }),
                () => onTouchInput({ throttle: 0 })
              )}
              className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl border border-white/20 flex items-center justify-center text-white active:bg-amber-500 active:text-slate-950 transition-colors cursor-pointer"
              style={{ backgroundColor: 'rgba(9, 11, 16, 0.85)' }}
            >
              <ArrowDown className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
          )}

          <button
            type="button"
            tabIndex={-1}
            aria-label="Поворот направо"
            {...bindHold(
              () => onTouchInput({ steer: -1 }),
              () => onTouchInput({ steer: 0 })
            )}
            className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl border border-white/20 flex items-center justify-center text-white active:bg-amber-500 active:text-slate-950 transition-colors cursor-pointer"
            style={{ backgroundColor: 'rgba(9, 11, 16, 0.85)' }}
          >
            <ArrowRight className="w-6 h-6 sm:w-7 sm:h-7" />
          </button>
        </div>
      </div>

      {/* Right Cluster: Action buttons + Pedals */}
      <div className="pointer-events-auto flex flex-col items-end gap-2 touch-none select-none">
        <div className="flex items-center gap-1.5 sm:gap-2">
          {(inVehicle || canEnterVehicle) && (
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onInteract();
              }}
              aria-label={inVehicle ? 'Выйти из авто' : `Сесть в ${nearbyVehicleName ?? 'авто'}`}
              className="h-11 sm:h-12 px-3 rounded-xl border border-amber-400/50 text-amber-300 text-xs font-bold flex items-center gap-1.5 active:bg-amber-500 active:text-slate-950 cursor-pointer"
              style={{ backgroundColor: 'rgba(9, 11, 16, 0.88)' }}
            >
              {inVehicle ? <LogOut className="w-4 h-4" /> : <CarFront className="w-4 h-4" />}
              <span>{inVehicle ? 'Выйти' : 'Сесть'}</span>
            </button>
          )}

          {inVehicle && (
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onHorn();
              }}
              aria-label="Гудок"
              className="h-11 sm:h-12 px-2.5 sm:px-3.5 rounded-xl border border-white/20 text-slate-200 text-xs font-semibold active:bg-slate-700 cursor-pointer"
              style={{ backgroundColor: 'rgba(9, 11, 16, 0.88)' }}
            >
              Гудок
            </button>
          )}

          <button
            type="button"
            tabIndex={-1}
            aria-label={inVehicle ? 'Нитро' : 'Бег'}
            {...bindHold(
              () => onTouchInput({ nitro: true }),
              () => onTouchInput({ nitro: false })
            )}
            className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl border border-cyan-400/50 text-cyan-300 flex items-center justify-center active:bg-cyan-500 active:text-slate-950 cursor-pointer"
            style={{ backgroundColor: 'rgba(9, 11, 16, 0.88)' }}
          >
            <Zap className="w-5 h-5" />
          </button>
        </div>

        {inVehicle ? (
          <div className="flex items-end gap-1.5 sm:gap-2.5">
            <button
              type="button"
              tabIndex={-1}
              aria-label="Ручник"
              {...bindHold(
                () => onTouchInput({ handbrake: true }),
                () => onTouchInput({ handbrake: false })
              )}
              className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl border border-white/20 text-[11px] sm:text-xs font-bold text-amber-300 active:bg-amber-500 active:text-slate-950 cursor-pointer"
              style={{ backgroundColor: 'rgba(9, 11, 16, 0.88)' }}
            >
              Дрифт
            </button>

            <button
              type="button"
              tabIndex={-1}
              aria-label="Тормоз и задний ход"
              {...bindHold(
                () => onTouchInput({ throttle: -1 }),
                () => onTouchInput({ throttle: 0 })
              )}
              className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl border border-rose-500/50 text-[11px] sm:text-xs font-bold text-rose-300 active:bg-rose-500 active:text-white cursor-pointer"
              style={{ backgroundColor: 'rgba(9, 11, 16, 0.88)' }}
            >
              Тормоз
            </button>

            <button
              type="button"
              tabIndex={-1}
              aria-label="Газ"
              {...bindHold(
                () => onTouchInput({ throttle: 1 }),
                () => onTouchInput({ throttle: 0 })
              )}
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl border border-emerald-400/60 text-xs sm:text-sm font-display font-bold text-emerald-300 active:bg-emerald-500 active:text-slate-950 cursor-pointer"
              style={{ backgroundColor: 'rgba(9, 11, 16, 0.9)' }}
            >
              ГАЗ
            </button>
          </div>
        ) : (
          <button
            type="button"
            tabIndex={-1}
            aria-label="Прыжок"
            {...bindHold(
              () => onTouchInput({ jump: true }),
              () => onTouchInput({ jump: false })
            )}
            className="w-20 h-14 sm:h-16 rounded-xl border border-amber-400/50 text-xs font-bold text-amber-300 active:bg-amber-500 active:text-slate-950 cursor-pointer"
            style={{ backgroundColor: 'rgba(9, 11, 16, 0.88)' }}
          >
            Прыжок
          </button>
        )}
      </div>
    </div>
  );
};

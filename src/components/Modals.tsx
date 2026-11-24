import React from 'react';
import type { HudSnapshot } from '../game/types';

interface PauseModalProps {
  onResume: () => void;
  onRepair: () => void;
  onExitTitle: () => void;
}

export const PauseModal: React.FC<PauseModalProps> = ({
  onResume,
  onRepair,
  onExitTitle,
}) => (
  <div
    className="fixed inset-0 z-30 flex items-center justify-center p-6"
    style={{ backgroundColor: 'rgba(6, 8, 12, 0.72)' }}
  >
    <div
      className="w-full max-w-sm p-7 rounded-xl border border-white/15 shadow-2xl"
      style={{ backgroundColor: 'rgba(13, 17, 23, 0.96)' }}
    >
      <h2 className="font-display font-extrabold text-2xl text-white tracking-wide mb-1">
        Пауза
      </h2>
      <p className="text-xs text-slate-400 mb-6">
        Нео-Мегаполис · Свободная песочница
      </p>

      <div className="flex flex-col gap-2.5">
        <button
          type="button"
          onClick={onResume}
          className="w-full py-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-bold text-sm tracking-wide cursor-pointer transition-colors"
        >
          Продолжить
        </button>
        <button
          type="button"
          onClick={() => {
            onRepair();
            onResume();
          }}
          className="w-full py-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold text-sm cursor-pointer transition-colors"
        >
          Починить и вернуть на дорогу
        </button>
        <button
          type="button"
          onClick={onExitTitle}
          className="w-full py-3 rounded-lg border border-white/15 hover:bg-white/5 text-slate-300 font-semibold text-sm cursor-pointer transition-colors"
        >
          В главное меню
        </button>
      </div>
    </div>
  </div>
);

interface GameOverModalProps {
  snapshot: HudSnapshot;
  onRespawn: () => void;
  onExitTitle: () => void;
}

export const GameOverModal: React.FC<GameOverModalProps> = ({
  snapshot,
  onRespawn,
  onExitTitle,
}) => (
  <div
    className="fixed inset-0 z-30 flex items-center justify-center p-6"
    style={{ backgroundColor: 'rgba(20, 6, 8, 0.78)' }}
  >
    <div
      className="w-full max-w-md p-7 rounded-xl border border-rose-500/35 shadow-2xl"
      style={{ backgroundColor: 'rgba(13, 17, 23, 0.96)' }}
    >
      <h2 className="font-display font-extrabold text-3xl text-rose-500 tracking-wider mb-1">
        ПОТРАЧЕНО
      </h2>
      <p className="text-xs text-slate-400 mb-5">
        Транспорт уничтожен или персонаж выведен из строя
      </p>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="p-3 rounded-lg bg-slate-900 border border-white/10">
          <div className="text-[11px] text-slate-400">Макс. скорость</div>
          <div className="font-display font-bold text-lg text-white font-mono-num">
            {snapshot.stats.maxSpeedKmh} км/ч
          </div>
        </div>
        <div className="p-3 rounded-lg bg-slate-900 border border-white/10">
          <div className="text-[11px] text-slate-400">Дистанция</div>
          <div className="font-display font-bold text-lg text-white font-mono-num">
            {snapshot.stats.distanceKm} км
          </div>
        </div>
        <div className="p-3 rounded-lg bg-slate-900 border border-white/10">
          <div className="text-[11px] text-slate-400">Столкновения</div>
          <div className="font-display font-bold text-lg text-white font-mono-num">
            {snapshot.stats.crashes}
          </div>
        </div>
        <div className="p-3 rounded-lg bg-slate-900 border border-white/10">
          <div className="text-[11px] text-slate-400">Снесено объектов</div>
          <div className="font-display font-bold text-lg text-white font-mono-num">
            {snapshot.stats.propsDestroyed}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <button
          type="button"
          data-start="true"
          onClick={onRespawn}
          className="w-full py-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-bold text-sm tracking-wide cursor-pointer transition-colors"
        >
          Возродиться
        </button>
        <button
          type="button"
          onClick={onExitTitle}
          className="w-full py-3 rounded-lg border border-white/15 hover:bg-white/5 text-slate-300 font-semibold text-sm cursor-pointer transition-colors"
        >
          В главное меню
        </button>
      </div>
    </div>
  </div>
);

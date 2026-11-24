import React, { useEffect, useRef } from 'react';
import {
  HIGHWAY_WIDTH,
  NORTH_ROAD_Z_COORDS,
  ROAD_WIDTH,
  ROAD_X_COORDS,
  SOUTH_ROAD_Z_COORDS,
  WORLD_HALF_SIZE,
  isHighwayX,
  isHighwayZ,
} from '../game/worldLayout';
import type { HudSnapshot } from '../game/types';

interface MinimapProps {
  snapshot: HudSnapshot;
}

export const Minimap: React.FC<MinimapProps> = ({ snapshot }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = 152;
    const half = size * 0.5;
    const scale = 0.34; // wider radar view for 1080x1080 city & highways

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, size, size);

    const { x: px, z: pz, heading } = snapshot.playerPos;

    const toMini = (wx: number, wz: number) => ({
      mx: half + (wx - px) * scale,
      my: half + (wz - pz) * scale,
    });

    // Water channel band
    const topW = toMini(0, snapshot.waterBand.zMin);
    const botW = toMini(0, snapshot.waterBand.zMax);
    ctx.fillStyle = '#0c4a6e';
    ctx.fillRect(0, topW.my, size, botW.my - topW.my);

    // Road & Express Highway grid lines
    const edge = WORLD_HALF_SIZE - 15;
    for (const rx of ROAD_X_COORDS) {
      const hwy = isHighwayX(rx);
      ctx.strokeStyle = hwy ? '#64748b' : '#475569';
      ctx.lineWidth = (hwy ? HIGHWAY_WIDTH : ROAD_WIDTH) * scale;
      const p1 = toMini(rx, -edge);
      const p2 = toMini(rx, edge);
      ctx.beginPath();
      ctx.moveTo(p1.mx, p1.my);
      ctx.lineTo(p2.mx, p2.my);
      ctx.stroke();
    }
    for (const rz of [...NORTH_ROAD_Z_COORDS, ...SOUTH_ROAD_Z_COORDS]) {
      const hwy = isHighwayZ(rz);
      ctx.strokeStyle = hwy ? '#64748b' : '#475569';
      ctx.lineWidth = (hwy ? HIGHWAY_WIDTH : ROAD_WIDTH) * scale;
      const p1 = toMini(-edge, rz);
      const p2 = toMini(edge, rz);
      ctx.beginPath();
      ctx.moveTo(p1.mx, p1.my);
      ctx.lineTo(p2.mx, p2.my);
      ctx.stroke();
    }

    // Bridges highlighted in amber
    ctx.fillStyle = '#d97706';
    for (const br of snapshot.bridgeRects) {
      const tl = toMini(br.x - br.w * 0.5, br.z - br.d * 0.5);
      ctx.fillRect(tl.mx, tl.my, br.w * scale, br.d * scale);
    }

    // Floating Ships in Bay
    if (snapshot.shipDots) {
      for (const sh of snapshot.shipDots) {
        const pt = toMini(sh.x, sh.z);
        if (pt.mx < -14 || pt.mx > size + 14 || pt.my < -14 || pt.my > size + 14) continue;
        ctx.save();
        ctx.translate(pt.mx, pt.my);
        ctx.rotate(-sh.heading);
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(-(sh.length * scale) * 0.5, -(sh.width * scale) * 0.5, sh.length * scale, sh.width * scale);
        ctx.restore();
      }
    }

    // City landmarks (Malls, Showroom, Park, Gas Station, Port, Highway)
    ctx.font = 'bold 7px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const lm of snapshot.landmarkDots) {
      const pt = toMini(lm.x, lm.z);
      if (pt.mx < -10 || pt.mx > size + 10 || pt.my < -10 || pt.my > size + 10) continue;
      ctx.fillStyle = lm.color;
      ctx.fillRect(pt.mx - 12, pt.my - 5.5, 24, 11);
      ctx.fillStyle = '#090b10';
      ctx.fillText(lm.label, pt.mx, pt.my + 0.5);
    }

    // Traffic & police vehicle dots
    for (const t of snapshot.trafficDots) {
      const pt = toMini(t.x, t.z);
      if (pt.mx < 0 || pt.mx > size || pt.my < 0 || pt.my > size) continue;
      if (t.isPolice) {
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(pt.mx - 1, pt.my, 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#3b82f6';
        ctx.beginPath();
        ctx.arc(pt.mx + 1.2, pt.my, 2.2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(pt.mx, pt.my, 1.9, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Player directional triangle at center
    ctx.save();
    ctx.translate(half, half);
    ctx.rotate(-heading);
    ctx.fillStyle = '#f59e0b';
    ctx.strokeStyle = '#090b10';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(6, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }, [snapshot]);

  return (
    <div
      className="relative rounded-lg overflow-hidden border border-white/20 shadow-lg"
      style={{ width: 152, height: 152, backgroundColor: '#0f172a' }}
    >
      <canvas ref={canvasRef} width={152} height={152} className="block" />
      <div
        className="absolute bottom-0 inset-x-0 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-slate-300 text-center"
        style={{ backgroundColor: 'rgba(9, 11, 16, 0.85)' }}
      >
        N ↑ КАРТА
      </div>
    </div>
  );
};

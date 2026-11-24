import * as THREE from 'three';

export interface ProceduralTextureSet {
  asphaltMap: THREE.CanvasTexture;
  asphaltBump: THREE.CanvasTexture;
  sidewalkMap: THREE.CanvasTexture;
  buildingFacadeMap: THREE.CanvasTexture;
  buildingFacadeEmissive: THREE.CanvasTexture;
  industrialFacadeMap: THREE.CanvasTexture;
  crackedGlassMap: THREE.CanvasTexture;
  waterBumpMap: THREE.CanvasTexture;
  contactShadowMap: THREE.CanvasTexture;
  helipadMap: THREE.CanvasTexture;
  mallFloorMap: THREE.CanvasTexture;
  grassMap: THREE.CanvasTexture;
  scratchDecalMap: THREE.CanvasTexture;
  createSignTexture: (
    title: string,
    subtitle: string,
    bgColor: string,
    textColor: string,
    accentColor: string
  ) => THREE.CanvasTexture;
  dispose: () => void;
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  return [canvas, ctx];
}

export function createProceduralTextures(maxAnisotropy: number): ProceduralTextureSet {
  const aniso = Math.min(8, Math.max(1, maxAnisotropy));
  const extraTextures: THREE.CanvasTexture[] = [];
  const signTextureCache = new Map<string, THREE.CanvasTexture>();

  // 1. Asphalt texture
  const [asphC, asphCtx] = makeCanvas(512, 512);
  asphCtx.fillStyle = '#252932';
  asphCtx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 6500; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const v = 28 + Math.floor(Math.random() * 28);
    asphCtx.fillStyle = `rgb(${v},${v + 2},${v + 6})`;
    asphCtx.fillRect(x, y, 2, 2);
  }
  const asphaltMap = new THREE.CanvasTexture(asphC);
  asphaltMap.colorSpace = THREE.SRGBColorSpace;
  asphaltMap.wrapS = asphaltMap.wrapT = THREE.RepeatWrapping;
  asphaltMap.repeat.set(48, 48);
  asphaltMap.anisotropy = aniso;

  // 2. Asphalt micro-bump
  const [bumpC, bumpCtx] = makeCanvas(256, 256);
  bumpCtx.fillStyle = '#808080';
  bumpCtx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 4000; i++) {
    const g = 95 + Math.floor(Math.random() * 65);
    bumpCtx.fillStyle = `rgb(${g},${g},${g})`;
    bumpCtx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const asphaltBump = new THREE.CanvasTexture(bumpC);
  asphaltBump.wrapS = asphaltBump.wrapT = THREE.RepeatWrapping;
  asphaltBump.repeat.set(48, 48);

  // 3. Sidewalk concrete paver tiles
  const [sideC, sideCtx] = makeCanvas(256, 256);
  sideCtx.fillStyle = '#737982';
  sideCtx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1800; i++) {
    const v = 102 + Math.floor(Math.random() * 26);
    sideCtx.fillStyle = `rgb(${v},${v + 2},${v + 4})`;
    sideCtx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  sideCtx.strokeStyle = '#525862';
  sideCtx.lineWidth = 3;
  for (let p = 0; p <= 256; p += 64) {
    sideCtx.beginPath();
    sideCtx.moveTo(p, 0);
    sideCtx.lineTo(p, 256);
    sideCtx.stroke();
    sideCtx.beginPath();
    sideCtx.moveTo(0, p);
    sideCtx.lineTo(256, p);
    sideCtx.stroke();
  }
  const sidewalkMap = new THREE.CanvasTexture(sideC);
  sidewalkMap.colorSpace = THREE.SRGBColorSpace;
  sidewalkMap.wrapS = sidewalkMap.wrapT = THREE.RepeatWrapping;
  sidewalkMap.repeat.set(4, 4);
  sidewalkMap.anisotropy = aniso;

  // 4. Skyscraper architectural window grid (albedo + night emissive)
  const [bldC, bldCtx] = makeCanvas(512, 512);
  const [emC, emCtx] = makeCanvas(512, 512);
  bldCtx.fillStyle = '#334155';
  bldCtx.fillRect(0, 0, 512, 512);
  emCtx.fillStyle = '#000000';
  emCtx.fillRect(0, 0, 512, 512);

  const cols = 8;
  const rows = 16;
  const cellW = 512 / cols;
  const cellH = 512 / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const wx = c * cellW + 7;
      const wy = r * cellH + 5;
      const ww = cellW - 14;
      const wh = cellH - 10;
      const lit = ((r * 13 + c * 7) % 5) !== 0;
      const warm = ((r + c * 3) % 4) === 0;
      bldCtx.fillStyle = lit ? (warm ? '#93c5fd' : '#64748b') : '#1e293b';
      bldCtx.fillRect(wx, wy, ww, wh);
      bldCtx.fillStyle = 'rgba(255,255,255,0.14)';
      bldCtx.fillRect(wx, wy, ww, 3);

      if (lit && ((r * 11 + c * 5) % 3 !== 0)) {
        emCtx.fillStyle = warm ? '#fbbf24' : '#7dd3fc';
        emCtx.fillRect(wx + 2, wy + 2, ww - 4, wh - 4);
      }
    }
  }
  const buildingFacadeMap = new THREE.CanvasTexture(bldC);
  buildingFacadeMap.colorSpace = THREE.SRGBColorSpace;
  buildingFacadeMap.wrapS = buildingFacadeMap.wrapT = THREE.RepeatWrapping;
  buildingFacadeMap.anisotropy = aniso;

  const buildingFacadeEmissive = new THREE.CanvasTexture(emC);
  buildingFacadeEmissive.colorSpace = THREE.SRGBColorSpace;
  buildingFacadeEmissive.wrapS = buildingFacadeEmissive.wrapT = THREE.RepeatWrapping;
  buildingFacadeEmissive.anisotropy = aniso;

  // 5. Industrial corrugated warehouse facade
  const [indC, indCtx] = makeCanvas(256, 256);
  indCtx.fillStyle = '#4b5563';
  indCtx.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 8) {
    indCtx.fillStyle = x % 16 === 0 ? '#5c6675' : '#3d4552';
    indCtx.fillRect(x, 0, 4, 256);
  }
  indCtx.fillStyle = '#1f2937';
  indCtx.fillRect(16, 170, 88, 86);
  indCtx.fillRect(148, 170, 88, 86);
  const industrialFacadeMap = new THREE.CanvasTexture(indC);
  industrialFacadeMap.colorSpace = THREE.SRGBColorSpace;
  industrialFacadeMap.wrapS = industrialFacadeMap.wrapT = THREE.RepeatWrapping;
  industrialFacadeMap.anisotropy = aniso;

  // 6. Cracked windshield pattern
  const [glassC, glassCtx] = makeCanvas(256, 256);
  glassCtx.fillStyle = 'rgba(180, 220, 255, 0.25)';
  glassCtx.fillRect(0, 0, 256, 256);
  glassCtx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
  glassCtx.lineWidth = 2;
  const cx = 128;
  const cy = 128;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.12;
    glassCtx.beginPath();
    glassCtx.moveTo(cx, cy);
    glassCtx.lineTo(cx + Math.cos(a) * 120, cy + Math.sin(a) * 120);
    glassCtx.stroke();
  }
  for (const rad of [24, 52, 85]) {
    glassCtx.beginPath();
    glassCtx.arc(cx, cy, rad, 0, Math.PI * 2);
    glassCtx.stroke();
  }
  const crackedGlassMap = new THREE.CanvasTexture(glassC);
  crackedGlassMap.colorSpace = THREE.SRGBColorSpace;

  // 7. Water ripple bump map
  const [watC, watCtx] = makeCanvas(256, 256);
  watCtx.fillStyle = '#808080';
  watCtx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 450; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const r = 6 + Math.random() * 14;
    const grad = watCtx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(215,215,215,0.45)');
    grad.addColorStop(1, 'rgba(128,128,128,0)');
    watCtx.fillStyle = grad;
    watCtx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const waterBumpMap = new THREE.CanvasTexture(watC);
  waterBumpMap.wrapS = waterBumpMap.wrapT = THREE.RepeatWrapping;
  waterBumpMap.repeat.set(32, 16);

  // 8. Soft contact shadow disc
  const [shC, shCtx] = makeCanvas(128, 128);
  const shGrad = shCtx.createRadialGradient(64, 64, 10, 64, 64, 62);
  shGrad.addColorStop(0, 'rgba(0,0,0,0.68)');
  shGrad.addColorStop(0.6, 'rgba(0,0,0,0.32)');
  shGrad.addColorStop(1, 'rgba(0,0,0,0)');
  shCtx.fillStyle = shGrad;
  shCtx.fillRect(0, 0, 128, 128);
  const contactShadowMap = new THREE.CanvasTexture(shC);

  // 9. Helipad H texture
  const [hpC, hpCtx] = makeCanvas(256, 256);
  hpCtx.fillStyle = '#334155';
  hpCtx.fillRect(0, 0, 256, 256);
  hpCtx.strokeStyle = '#f59e0b';
  hpCtx.lineWidth = 12;
  hpCtx.beginPath();
  hpCtx.arc(128, 128, 96, 0, Math.PI * 2);
  hpCtx.stroke();
  hpCtx.fillStyle = '#f8fafc';
  hpCtx.fillRect(80, 68, 22, 120);
  hpCtx.fillRect(154, 68, 22, 120);
  hpCtx.fillRect(80, 118, 96, 20);
  const helipadMap = new THREE.CanvasTexture(hpC);
  helipadMap.colorSpace = THREE.SRGBColorSpace;

  // 10. Polished Mall Marble Floor Tiles
  const [mfC, mfCtx] = makeCanvas(256, 256);
  mfCtx.fillStyle = '#e2e8f0';
  mfCtx.fillRect(0, 0, 256, 256);
  const tile = 64;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      mfCtx.fillStyle = (r + c) % 2 === 0 ? '#f1f5f9' : '#cbd5e1';
      mfCtx.fillRect(c * tile + 2, r * tile + 2, tile - 4, tile - 4);
    }
  }
  const mallFloorMap = new THREE.CanvasTexture(mfC);
  mallFloorMap.colorSpace = THREE.SRGBColorSpace;
  mallFloorMap.wrapS = mallFloorMap.wrapT = THREE.RepeatWrapping;
  mallFloorMap.repeat.set(8, 6);
  mallFloorMap.anisotropy = aniso;

  // 11. Park Grass Texture
  const [grC, grCtx] = makeCanvas(256, 256);
  grCtx.fillStyle = '#15803d';
  grCtx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 3200; i++) {
    const g = 90 + Math.floor(Math.random() * 55);
    grCtx.fillStyle = `rgb(22, ${g}, 42)`;
    grCtx.fillRect(Math.random() * 256, Math.random() * 256, 2, 3);
  }
  const grassMap = new THREE.CanvasTexture(grC);
  grassMap.colorSpace = THREE.SRGBColorSpace;
  grassMap.wrapS = grassMap.wrapT = THREE.RepeatWrapping;
  grassMap.repeat.set(6, 6);
  grassMap.anisotropy = aniso;

  // 11b. Procedural Jagged Metallic Paint Scratches & Scuffs Decal
  const [scC, scCtx] = makeCanvas(128, 128);
  scCtx.clearRect(0, 0, 128, 128);
  // Subtle dark scuff smudge backing
  const scuffGrad = scCtx.createRadialGradient(64, 64, 6, 64, 64, 56);
  scuffGrad.addColorStop(0, 'rgba(15, 23, 42, 0.42)');
  scuffGrad.addColorStop(0.7, 'rgba(30, 41, 59, 0.16)');
  scuffGrad.addColorStop(1, 'rgba(15, 23, 42, 0)');
  scCtx.fillStyle = scuffGrad;
  scCtx.fillRect(0, 0, 128, 128);

  const scratchStrokes = [
    { y0: 28, y1: 36, w: 2.2, color: 'rgba(226, 232, 240, 0.92)' },
    { y0: 38, y1: 42, w: 3.2, color: 'rgba(15, 23, 42, 0.88)' },
    { y0: 47, y1: 54, w: 2.6, color: 'rgba(248, 250, 252, 0.96)' },
    { y0: 58, y1: 63, w: 2.0, color: 'rgba(148, 163, 184, 0.9)' },
    { y0: 66, y1: 74, w: 3.4, color: 'rgba(15, 23, 42, 0.85)' },
    { y0: 76, y1: 81, w: 2.2, color: 'rgba(241, 245, 249, 0.94)' },
    { y0: 88, y1: 96, w: 1.8, color: 'rgba(203, 213, 225, 0.85)' },
  ];
  for (let sIdx = 0; sIdx < scratchStrokes.length; sIdx++) {
    const st = scratchStrokes[sIdx];
    scCtx.strokeStyle = st.color;
    scCtx.lineWidth = st.w;
    scCtx.lineCap = 'round';
    scCtx.beginPath();
    const xStart = 12 + (sIdx % 3) * 8;
    const xEnd = 114 - ((sIdx + 1) % 3) * 7;
    scCtx.moveTo(xStart, st.y0);
    for (let t = 1; t <= 5; t++) {
      const f = t / 5;
      const jx = xStart + (xEnd - xStart) * f;
      const jy = st.y0 + (st.y1 - st.y0) * f + Math.sin(sIdx * 3.1 + t * 2.4) * 3.2;
      scCtx.lineTo(jx, jy);
    }
    scCtx.stroke();
  }
  const scratchDecalMap = new THREE.CanvasTexture(scC);
  scratchDecalMap.colorSpace = THREE.SRGBColorSpace;
  scratchDecalMap.anisotropy = aniso;

  // 12. High-contrast Readable Russian Sign CanvasTexture Factory
  const createSignTexture = (
    title: string,
    subtitle: string,
    bgColor: string,
    textColor: string,
    accentColor: string
  ): THREE.CanvasTexture => {
    const cacheKey = `${title}|${subtitle}|${bgColor}|${textColor}|${accentColor}`;
    const cached = signTextureCache.get(cacheKey);
    if (cached) return cached;

    const [sc, sctx] = makeCanvas(512, 128);
    sctx.fillStyle = bgColor;
    sctx.fillRect(0, 0, 512, 128);

    // Neon / glowing border trim
    sctx.strokeStyle = accentColor;
    sctx.lineWidth = 6;
    sctx.strokeRect(5, 5, 502, 118);

    sctx.textAlign = 'center';
    sctx.textBaseline = 'middle';
    sctx.fillStyle = textColor;
    sctx.font = 'bold 42px system-ui, -apple-system, Segoe UI, sans-serif';
    sctx.fillText(title, 256, subtitle ? 48 : 64, 480);

    if (subtitle) {
      sctx.fillStyle = accentColor;
      sctx.font = 'bold 22px system-ui, -apple-system, Segoe UI, sans-serif';
      sctx.fillText(subtitle, 256, 94, 470);
    }

    const tex = new THREE.CanvasTexture(sc);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = aniso;
    extraTextures.push(tex);
    signTextureCache.set(cacheKey, tex);
    return tex;
  };

  return {
    asphaltMap,
    asphaltBump,
    sidewalkMap,
    buildingFacadeMap,
    buildingFacadeEmissive,
    industrialFacadeMap,
    crackedGlassMap,
    waterBumpMap,
    contactShadowMap,
    helipadMap,
    mallFloorMap,
    grassMap,
    scratchDecalMap,
    createSignTexture,
    dispose: () => {
      asphaltMap.dispose();
      asphaltBump.dispose();
      sidewalkMap.dispose();
      buildingFacadeMap.dispose();
      buildingFacadeEmissive.dispose();
      industrialFacadeMap.dispose();
      crackedGlassMap.dispose();
      waterBumpMap.dispose();
      contactShadowMap.dispose();
      helipadMap.dispose();
      mallFloorMap.dispose();
      grassMap.dispose();
      scratchDecalMap.dispose();
      for (const tex of extraTextures) tex.dispose();
    },
  };
}

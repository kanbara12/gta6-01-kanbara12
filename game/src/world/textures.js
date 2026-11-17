// Procedural canvas textures for SUNCOAST: HEATLINE — World Environment.
// Every texture is generated at runtime from a <canvas>; no image files are
// loaded and no network request is ever made. Textures live only in memory;
// game/assets/world/ documents the set (see its README.md).
//
// Facade textures are deliberately subtle (panel lines + speckle, NO baked
// windows): the windows are a real InstancedMesh in world.js, which gives
// depth at sunset and lets setTimeOfDay() drive their night glow.

import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(c, rx = 1, ry = 1) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function speckle(ctx, w, h, n, alpha, dark = true) {
  for (let i = 0; i < n; i += 1) {
    const v = Math.random();
    ctx.fillStyle = dark
      ? `rgba(0,0,0,${alpha * v})`
      : `rgba(255,255,255,${alpha * v})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

/** Flat facade with faint horizontal floor lines + vertical panel joints. */
export function facadeTexture(base) {
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(0, 0, 128, 10);
  ctx.fillStyle = 'rgba(0,0,0,0.10)';
  for (let y = 32; y < 128; y += 32) ctx.fillRect(0, y, 128, 2);
  for (let x = 32; x < 128; x += 32) ctx.fillRect(x, 0, 2, 128);
  speckle(ctx, 128, 128, 260, 0.12);
  return toTexture(c);
}

/** Glass tower skin: vertical gradient + faint floor lines + mullions. */
export function glassTexture(top, bottom) {
  const [c, ctx] = canvas(128, 256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 256);
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  for (let y = 0; y < 256; y += 16) ctx.fillRect(0, y, 128, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  for (let x = 0; x < 128; x += 16) ctx.fillRect(x, 0, 2, 256);
  speckle(ctx, 128, 256, 180, 0.08);
  return toTexture(c);
}

/** Asphalt with edge lines and a dashed centre line (repeat along length). */
export function asphaltTexture() {
  const [c, ctx] = canvas(128, 512);
  ctx.fillStyle = '#3a3238';
  ctx.fillRect(0, 0, 128, 512);
  speckle(ctx, 128, 512, 1400, 0.16);
  speckle(ctx, 128, 512, 500, 0.10, false);
  // Edge lines.
  ctx.fillStyle = 'rgba(232,232,220,0.85)';
  ctx.fillRect(5, 0, 3, 512);
  ctx.fillRect(120, 0, 3, 512);
  // Dashed centre line (two-way street).
  ctx.fillStyle = 'rgba(232,215,120,0.9)';
  for (let y = 0; y < 512; y += 64) ctx.fillRect(62, y, 4, 34);
  return toTexture(c, 1, 10);
}

/** Sidewalk slabs with expansion joints. */
export function sidewalkTexture() {
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = '#a8907c';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let y = 0; y < 128; y += 32) ctx.fillRect(0, y, 128, 2);
  for (let x = 0; x < 128; x += 64) ctx.fillRect(x, 0, 2, 128);
  speckle(ctx, 128, 128, 300, 0.10);
  return toTexture(c, 1, 8);
}

/** Beach sand with speckles and a few shells/pebbles. */
export function sandTexture() {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#f0c98f';
  ctx.fillRect(0, 0, 256, 256);
  speckle(ctx, 256, 256, 2200, 0.14);
  speckle(ctx, 256, 256, 500, 0.12, false);
  for (let i = 0; i < 26; i += 1) {
    ctx.fillStyle = `rgba(255,240,220,${0.5 + Math.random() * 0.4})`;
    ctx.beginPath();
    ctx.arc(Math.random() * 256, Math.random() * 256, 1.5 + Math.random() * 2, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(c, 2, 12);
}

/** Boardwalk planks. */
export function boardwalkTexture() {
  const [c, ctx] = canvas(128, 256);
  ctx.fillStyle = '#9a6f4a';
  ctx.fillRect(0, 0, 128, 256);
  for (let y = 0; y < 256; y += 16) {
    ctx.fillStyle = y % 32 === 0 ? '#8a5f3e' : '#a87a52';
    ctx.fillRect(0, y, 128, 14);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, y + 14, 128, 2);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  for (const x of [42, 84]) ctx.fillRect(x, 0, 2, 256);
  speckle(ctx, 128, 256, 200, 0.10);
  return toTexture(c, 1, 10);
}

/** Brick courses for warehouses / low commercial. */
export function brickTexture(base) {
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  for (let y = 0; y < 128; y += 16) ctx.fillRect(0, y, 128, 2);
  for (let row = 0; row < 8; row += 1) {
    const off = row % 2 === 0 ? 0 : 16;
    for (let x = off; x < 128; x += 32) ctx.fillRect(x, row * 16, 2, 16);
  }
  speckle(ctx, 128, 128, 240, 0.10);
  return toTexture(c, 2, 2);
}

/** Corrugated container ribs, tinted. */
export function containerTexture(base) {
  const [c, ctx] = canvas(128, 64);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 128, 64);
  for (let x = 0; x < 128; x += 8) {
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(x, 0, 3, 64);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x + 3, 0, 2, 64);
  }
  speckle(ctx, 128, 64, 120, 0.14);
  return toTexture(c);
}

/** Awning stripes. */
export function awningTexture(c1, c2) {
  const [c, ctx] = canvas(128, 32);
  for (let x = 0; x < 128; x += 16) {
    ctx.fillStyle = (x / 16) % 2 === 0 ? c1 : c2;
    ctx.fillRect(x, 0, 16, 32);
  }
  return toTexture(c, 3, 1);
}

/** Glowing neon sign: dark plate, bright text with halo, thin border. */
export function neonSignTexture(text, fg, bg) {
  const [c, ctx] = canvas(512, 128);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = fg;
  ctx.lineWidth = 4;
  ctx.globalAlpha = 0.85;
  ctx.strokeRect(8, 8, 496, 112);
  ctx.globalAlpha = 1;
  ctx.font = '900 52px ui-sans-serif, system-ui, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = fg;
  ctx.shadowBlur = 26;
  ctx.fillStyle = fg;
  ctx.fillText(text, 256, 66);
  ctx.shadowBlur = 8;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 256, 66);
  return toTexture(c);
}

/** Rooftop / roadside billboard. `lines` is 1-3 short strings. */
export function billboardTexture(lines, bg, fg) {
  const [c, ctx] = canvas(512, 256);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = fg;
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, 492, 236);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = fg;
  const sizes = [84, 56, 44];
  lines.forEach((line, i) => {
    ctx.font = `900 ${sizes[Math.min(i, 2)]}px ui-sans-serif, system-ui, Arial, sans-serif`;
    ctx.fillText(line, 256, 70 + i * 62);
  });
  return toTexture(c);
}

/** Crosswalk zebra + stop line, laid flat on one intersection. */
export function zebraTexture() {
  const [c, ctx] = canvas(256, 256);
  ctx.clearRect(0, 0, 256, 256);
  ctx.fillStyle = 'rgba(240,240,230,0.92)';
  for (let i = 0; i < 8; i += 1) ctx.fillRect(14 + i * 30, 20, 16, 216);
  // Stop line across the approach (bottom edge).
  ctx.fillRect(14, 232, 228, 10);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Lighthouse bands (red/white). */
export function lighthouseTexture() {
  const [c, ctx] = canvas(64, 256);
  for (let y = 0; y < 256; y += 64) {
    ctx.fillStyle = (y / 64) % 2 === 0 ? '#e8e4da' : '#c65a3a';
    ctx.fillRect(0, y, 64, 64);
  }
  return toTexture(c);
}

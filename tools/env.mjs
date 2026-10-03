#!/usr/bin/env node
// The viewer's lighting: a studio for glossy black vinyl, written as an equirectangular Radiance HDR.
//
//   node tools/env.mjs                 → viewer/studio.hdr
//
// A dark room with big soft strip lights (warm key left-front, cool fill right-front, a top softbox, a rim bar behind,
// a dim floor bounce) — the long highlights the vinyl and the visor reflect. Generated here, so the viewer ships no
// third-party image.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'viewer/studio.hdr');
const W = 2048, H = 1024, SS = 3;   // size, supersampling per axis (soft, clean card edges)

const lin = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const BACK = lin(0x050506);
// cards: colour × intensity, centre, size (w, h), rotation (rx, ry) — a plane facing +Z before rotation (XYZ order)
const CARDS = [
  { c: lin(0xfff2e6), k: 6, p: [-3, 1.5, 2], s: [1.2, 5], r: [0, Math.PI / 3] },        // key strip, left front
  { c: lin(0xdfe8ff), k: 6, p: [3.2, 1.2, 1.5], s: [1.0, 5], r: [0, -Math.PI / 3] },    // fill strip, right front
  { c: lin(0xffffff), k: 6, p: [0, 4, 0], s: [6, 1.4], r: [Math.PI / 2, 0] },           // top softbox
  { c: lin(0xdfe8ff), k: 6, p: [0, 0.8, -4], s: [6, 0.6], r: [0, 0] },                  // rim bar behind
  { c: lin(0x222226), k: 6, p: [0, -3, 0], s: [20, 20], r: [Math.PI / 2, 0] },          // dim floor bounce
];
// world → card: inverse of R = Rx(rx) · Ry(ry) (three.js Euler XYZ: the matrix is Rx·Ry·Rz)
for (const card of CARDS) {
  const [rx, ry] = card.r, cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry);
  const R = [[cy, 0, sy], [sx * sy, cx, -sx * cy], [-cx * sy, sx, cx * cy]];   // rows of Rx·Ry
  card.toLocal = (v) => [0, 1, 2].map((j) => R[0][j] * v[0] + R[1][j] * v[1] + R[2][j] * v[2]);   // Rᵀ·v
}

function radiance(d) {
  let best = Infinity, col = BACK;
  for (const card of CARDS) {
    const o = card.toLocal(card.p.map((v) => -v)), dl = card.toLocal(d);
    if (Math.abs(dl[2]) < 1e-9) continue;
    const t = -o[2] / dl[2];
    if (t <= 0 || t >= best) continue;
    const x = o[0] + t * dl[0], y = o[1] + t * dl[1];
    if (Math.abs(x) <= card.s[0] / 2 && Math.abs(y) <= card.s[1] / 2) { best = t; col = card.c.map((v) => v * card.k); }
  }
  return col;
}

// RGBE + the standard run-length scanline encoding
function rgbe([r, g, b]) {
  const m = Math.max(r, g, b);
  if (m < 1e-32) return [0, 0, 0, 0];
  const e = Math.ceil(Math.log2(m) + 1e-9), f = 256 / 2 ** e;
  return [Math.min(255, Math.floor(r * f)), Math.min(255, Math.floor(g * f)), Math.min(255, Math.floor(b * f)), e + 128];
}
function rle(data, out) {
  const n = data.length;
  let cur = 0;
  while (cur < n) {
    let beg = cur, run = 0, oldRun = 0;
    while (run < 4 && beg < n) {
      beg += run; oldRun = run; run = 1;
      while (beg + run < n && run < 127 && data[beg] === data[beg + run]) run++;
    }
    if (oldRun > 1 && oldRun === beg - cur) { out.push(128 + oldRun, data[cur]); cur = beg; }
    while (cur < beg) { const k = Math.min(128, beg - cur); out.push(k); for (let i = 0; i < k; i++) out.push(data[cur + i]); cur += k; }
    if (run >= 4) { out.push(128 + run, data[beg]); cur += run; }
  }
}

const header = Buffer.from(`#?RADIANCE\n# Funkun viewer studio (tools/env.mjs)\nFORMAT=32-bit_rle_rgbe\n\n-Y ${H} +X ${W}\n`, 'ascii');
const body = [];
const ch = [new Uint8Array(W), new Uint8Array(W), new Uint8Array(W), new Uint8Array(W)];
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const acc = [0, 0, 0];
    for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) {
      // equirect as three.js samples it: u = 0.5 + atan2(dir.z, dir.x) / 2π, v = acos(dir.y) / π from the top
      const u = (x + (i + 0.5) / SS) / W, v = (y + (j + 0.5) / SS) / H;
      const phi = (u - 0.5) * 2 * Math.PI, theta = v * Math.PI;
      const d = [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)];
      const c = radiance(d);
      acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
    }
    const e = rgbe(acc.map((v) => v / (SS * SS)));
    for (let k = 0; k < 4; k++) ch[k][x] = e[k];
  }
  body.push(2, 2, W >> 8, W & 255);
  for (let k = 0; k < 4; k++) rle(ch[k], body);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.concat([header, Buffer.from(body)]));
console.log(`${path.relative(ROOT, OUT)}  ${W}×${H}  ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);

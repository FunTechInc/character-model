// Lighter versions of Funkun: the same scene (every node, name, material, animation) with fewer triangles.
//
//  · meshoptimizer's attribute-aware simplifier (position + normal + UV error), error-bounded in world units: one error
//    for the whole character, binary-searched to the triangle budget, × a per-part importance (the LED screen ×0.15 —
//    its UVs carry the LED grid; the screen's rim and glass ×0.5)
//  · UV seams and hard edges are kept; normals are the source's smooth normals (the result is a subset of the original
//    vertices, nothing is re-averaged)
//  · layered parts: Funkun is built of shells a fraction of a millimetre apart (outsole over sole, glass over screen, the
//    visor stack …). Simplified on its own, an outer shell's larger triangles cut inward by up to its error and the part
//    beneath shows through. So a vertex that lies BEHIND another part (that part's nearest vertex in front of it along a
//    parallel normal, ≤ 12 mm) is pushed back along its own normal until it clears that part's error (×1.2 + 0.3 mm) —
//    hidden geometry only, two passes for stacks (glass › screen › body), tapered one ring into the visible surface;
//    shared boundaries (gap < 0.1 mm) are left alone
import { PropertyType } from '@gltf-transform/core';
import { prune } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

// per-part importance: × the character's error (smaller → keeps more of the part). Node names; first match wins.
const IMPORTANCE = [
  [/^Screen$/, 0.15],
  [/^(ScreenGlass|ScreenRim)$/, 0.5],
];
const LAYER = { gapMax: 0.012, lateral: 0.005, shared: 0.0001, parallel: 0.5, factor: 1.2, margin: 0.0003, pushMax: 0.012 };
const NORMAL_WEIGHT = 0.5;
const uvWeight = (name) => (/^Screen$/.test(name) ? 8 : 1);

const floats = (acc) => {
  const a = acc.getArray();
  if (a instanceof Float32Array && !acc.getNormalized()) return a;
  const n = acc.getCount(), k = acc.getElementSize(), out = new Float32Array(n * k), el = new Array(k);
  for (let i = 0; i < n; i++) { acc.getElement(i, el); for (let c = 0; c < k; c++) out[i * k + c] = el[c]; }
  return out;
};

function invert3(m) {
  const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C || 1;
  return [A / det, (c * h - b * i) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, (c * d - a * f) / det, C / det, (b * g - a * h) / det, (a * e - b * d) / det];
}

// every triangle primitive with what the simplifier needs
function partsOf(doc) {
  const parts = [], seen = new Set();
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    const scale = Math.max(Math.hypot(m[0], m[1], m[2]), Math.hypot(m[4], m[5], m[6]), Math.hypot(m[8], m[9], m[10]));
    const name = node.getName();
    const imp = (IMPORTANCE.find(([re]) => re.test(name)) ?? [null, 1])[1];
    for (const prim of mesh.listPrimitives()) {
      if (seen.has(prim) || prim.getMode() !== 4 || prim.listTargets().length) continue;
      seen.add(prim);
      const pos = prim.getAttribute('POSITION'), nrm = prim.getAttribute('NORMAL'), uv = prim.getAttribute('TEXCOORD_0');
      const n = pos.getCount();
      const idx = prim.getIndices();
      const indices = idx ? Uint32Array.from(idx.getArray()) : Uint32Array.from({ length: n }, (_, i) => i);
      const P = floats(pos), N = nrm ? floats(nrm) : null, T = uv ? floats(uv) : null;
      const stride = (N ? 3 : 0) + (T ? 2 : 0);
      const attrs = new Float32Array(n * Math.max(stride, 1));
      const weights = [];
      if (N) weights.push(NORMAL_WEIGHT, NORMAL_WEIGHT, NORMAL_WEIGHT);
      if (T) weights.push(uvWeight(name), uvWeight(name));
      for (let v = 0; v < n; v++) {
        let o = v * stride;
        if (N) { attrs[o++] = N[v * 3]; attrs[o++] = N[v * 3 + 1]; attrs[o++] = N[v * 3 + 2]; }
        if (T) { attrs[o++] = T[v * 2]; attrs[o++] = T[v * 2 + 1]; }
      }
      const wP = new Float32Array(n * 3), wN = new Float32Array(n * 3);
      for (let v = 0; v < n; v++) {
        const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
        wP[v * 3] = m[0] * x + m[4] * y + m[8] * z + m[12]; wP[v * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]; wP[v * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        if (N) {
          const a = N[v * 3], b = N[v * 3 + 1], c = N[v * 3 + 2];
          const X = m[0] * a + m[4] * b + m[8] * c, Y = m[1] * a + m[5] * b + m[9] * c, Z = m[2] * a + m[6] * b + m[10] * c, L = Math.hypot(X, Y, Z) || 1;
          wN[v * 3] = X / L; wN[v * 3 + 1] = Y / L; wN[v * 3 + 2] = Z / L;
        }
      }
      parts.push({ name, prim, material: prim.getMaterial()?.getName() ?? '-', scale, imp, indices, positions: P, attrs, stride, weights, tris: indices.length / 3,
        n, wP, wN: N ? wN : null, inv: invert3(m) });
    }
  }
  return parts;
}

// which vertices lie behind another part → per vertex [{ part, vertex, gap }]. Level-independent.
function coverOf(parts) {
  const { gapMax, lateral, shared, parallel } = LAYER;
  const cell = gapMax, key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  const grids = parts.map((p) => {
    const g = new Map();
    for (let v = 0; v < p.n; v++) { const k = key(p.wP[v * 3], p.wP[v * 3 + 1], p.wP[v * 3 + 2]); let a = g.get(k); if (!a) g.set(k, (a = [])); a.push(v); }
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < p.n; v++) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], p.wP[v * 3 + c]); hi[c] = Math.max(hi[c], p.wP[v * 3 + c]); }
    return { g, lo: lo.map((x) => x - gapMax), hi: hi.map((x) => x + gapMax) };
  });
  return parts.map((B) => {
    const out = new Array(B.n).fill(null);
    if (!B.wN) return out;
    for (let ai = 0; ai < parts.length; ai++) {
      const A = parts[ai], GA = grids[ai];
      if (A === B || !A.wN) continue;
      for (let v = 0; v < B.n; v++) {
        const x = B.wP[v * 3], y = B.wP[v * 3 + 1], z = B.wP[v * 3 + 2];
        if (x < GA.lo[0] || y < GA.lo[1] || z < GA.lo[2] || x > GA.hi[0] || y > GA.hi[1] || z > GA.hi[2]) continue;
        const nx = B.wN[v * 3], ny = B.wN[v * 3 + 1], nz = B.wN[v * 3 + 2];
        const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
        let best = null, touching = false;
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          const list = GA.g.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!list) continue;
          for (const a of list) {
            const ex = A.wP[a * 3] - x, ey = A.wP[a * 3 + 1] - y, ez = A.wP[a * 3 + 2] - z;
            const d2 = ex * ex + ey * ey + ez * ez;
            if (d2 < shared * shared) { touching = true; continue; }       // a shared boundary, not a layer
            const ax = A.wN[a * 3], ay = A.wN[a * 3 + 1], az = A.wN[a * 3 + 2];
            if (ax * nx + ay * ny + az * nz < parallel) continue;
            const gap = ex * ax + ey * ay + ez * az;                          // > 0: A's surface is in front of v
            if (gap <= shared || gap > gapMax || d2 - gap * gap > lateral * lateral) continue;
            if (!best || gap < best.gap) best = { part: ai, vertex: a, gap };
          }
        }
        if (best && !touching) (out[v] ??= []).push(best);
      }
    }
    return out;
  });
}

// how far each vertex must move back so no covering part's simplified surface (within its error) cuts below it
function pushesFor(parts, covers, errWorld) {
  const { factor, margin, pushMax } = LAYER;
  let push = parts.map((p) => new Float32Array(p.n));
  for (let pass = 0; pass < 2; pass++) {                                     // pass 2: the cover may itself have moved
    const next = parts.map((p) => new Float32Array(p.n));
    parts.forEach((B, bi) => covers[bi].forEach((list, v) => {
      if (!list) return;
      let need = 0;
      for (const c of list) need = Math.max(need, factor * errWorld[c.part] + margin - (c.gap - push[c.part][c.vertex]));
      next[bi][v] = Math.min(pushMax, need);
    }));
    push = next;
  }
  return push;
}

function simplify(part, eWorld) {
  const err = (eWorld * part.imp) / part.scale;
  const [out] = part.stride
    ? MeshoptSimplifier.simplifyWithAttributes(part.indices, part.positions, 3, part.attrs, part.stride, part.weights, null, 0, err, ['ErrorAbsolute'])
    : MeshoptSimplifier.simplify(part.indices, part.positions, 3, 0, err, ['ErrorAbsolute']);
  return out;
}

// the one error that lands the whole character on the budget (log-space bisection)
function solve(parts, budget) {
  let lo = 1e-7, hi = 1;
  for (let k = 0; k < 28; k++) {
    const mid = Math.sqrt(lo * hi);
    const tris = parts.reduce((s, p) => s + simplify(p, mid).length / 3, 0);
    if (tris > budget) lo = mid; else hi = mid;
  }
  return hi;
}

function pushBack(part, indices, push) {
  if (!part.wN) return 0;
  const p = Float32Array.from(push);
  for (let t = 0; t < indices.length; t += 3) for (let k = 0; k < 3; k++) {    // taper: half of the strongest neighbour
    const v = indices[t + k];
    for (let j = 1; j < 3; j++) { const u = indices[t + (k + j) % 3]; if (push[u] * 0.5 > p[v]) p[v] = push[u] * 0.5; }
  }
  const P = part.prim.getAttribute('POSITION').getArray(), M = part.inv, done = new Uint8Array(part.n);
  let moved = 0;
  for (const v of indices) {
    if (done[v] || !(p[v] > 0)) continue;
    done[v] = 1; moved++;
    const wx = -part.wN[v * 3] * p[v], wy = -part.wN[v * 3 + 1] * p[v], wz = -part.wN[v * 3 + 2] * p[v];
    P[v * 3] += M[0] * wx + M[1] * wy + M[2] * wz; P[v * 3 + 1] += M[3] * wx + M[4] * wy + M[5] * wz; P[v * 3 + 2] += M[6] * wx + M[7] * wy + M[8] * wz;
  }
  return moved;
}

// replace the primitive's buffers with the simplified, compacted ones
function apply(doc, part, indices) {
  const [remap, unique] = MeshoptSimplifier.compactMesh(indices);   // rewrites `indices` to the new vertex order
  const prim = part.prim;
  const buffer = doc.getRoot().listBuffers()[0];
  for (const sem of prim.listSemantics()) {
    const acc = prim.getAttribute(sem);
    const k = acc.getElementSize(), src = acc.getArray(), n = acc.getCount();
    const dst = new src.constructor(unique * k);
    for (let v = 0; v < n; v++) { const r = remap[v]; if (r !== 0xffffffff) for (let c = 0; c < k; c++) dst[r * k + c] = src[v * k + c]; }
    prim.setAttribute(sem, doc.createAccessor(acc.getName()).setType(acc.getType()).setArray(dst).setNormalized(acc.getNormalized()).setBuffer(buffer));
  }
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(unique <= 65535 ? Uint16Array.from(indices) : indices).setBuffer(buffer));
}

let covers = null, coverKey = null;
/** simplifies the document in place to about `tris` triangles; returns { tris, error, moved } */
export async function simplifyDocument(doc, { tris: budget, cacheKey = null }) {
  await MeshoptSimplifier.ready;
  const parts = partsOf(doc);
  if (!covers || coverKey !== cacheKey || !cacheKey) { covers = coverOf(parts); coverKey = cacheKey; }   // same geometry for every level
  const e = solve(parts, budget);
  const outs = parts.map((part) => simplify(part, e));
  const push = pushesFor(parts, covers, parts.map((p) => e * p.imp));
  let moved = 0, tris = 0;
  parts.forEach((part, i) => {
    moved += pushBack(part, outs[i], push[i]);
    tris += outs[i].length / 3;
    apply(doc, part, outs[i]);
  });
  await doc.transform(prune({ propertyTypes: [PropertyType.ACCESSOR], keepAttributes: true, keepIndices: true, keepLeaves: true, keepSolidTextures: true, keepExtras: true }));
  return { tris, error: e, moved };
}

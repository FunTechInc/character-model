// Funkun's face: LED-matrix eyes baked into emissive textures, one per expression, switchable as material variants
// (KHR_materials_variants: model-viewer, Blender, three.js and Babylon can switch them).
//
// The LEDs sit on a square grid in a plane in front of the face (11.5 mm pitch, tilted up 12° like the screen), not in
// the screen's UVs, so the matrix reads as square from the front. For every texel of the screen we find the point on the
// face it covers, project it onto that plane and draw the LED there: a rounded-square diffuser with a bright die, dark
// gaps, a little per-LED variance; unlit LEDs are faint dark lenses. 4×4 samples per texel.
import sharp from 'sharp';
import { KHRMaterialsVariants } from '@gltf-transform/extensions';

export const PITCH = 0.0115;                 // metres per LED
const GREEN = [0.16, 1.0, 0.28];             // lit LED (linear)
const GAIN = 2;                              // the film's LED gain (lit LEDs only; the unlit lenses are not amplified)
const NORM = 4;                              // texture = radiance / NORM (the brightest die stays below 1)
export const EMISSIVE_STRENGTH = NORM;

// rows top → bottom, '#' = lit. The right eye uses the mirror image (angry / sad slope towards the middle).
export const EXPRESSIONS = {
  happy: ['....#....', '...#.#...', '..#...#..', '.#.....#.', '#.......#'],
  open: ['..#####..', '.#######.', '#########', '#########', '#########', '.#######.', '..#####..'],
  blink: ['#########'],
  heart: ['.##...##.', '####.####', '#########', '.#######.', '..#####..', '...###...', '....#....'],
  star: ['....#....', '....#....', '..#####..', '#########', '..#####..', '....#....', '....#....'],
  dot: ['.###.', '#####', '#####', '.###.'],
  angry: ['#........', '.##......', '...##....', '.....##..', '.......##'],
  sad: ['.......##', '.....##..', '...##....', '.##......', '#........'],
  dead: ['#.......#', '.#.....#.', '..#...#..', '...#.#...', '....#....', '...#.#...', '..#...#..', '.#.....#.', '#.......#'],
};
const EYES = [-10, 10];                      // eye centres, LED columns from the face centre
const EYE_ROW = 1;                           // … and rows up
const DROP = { blink: -2 };                  // a closed eye sits lower

// the LED plane in the character frame: origin on the face, X right, Y up the screen, N out of it (12° up)
export function ledPlane(floorShift) {
  const s = Math.sin(12 * Math.PI / 180), c = Math.cos(12 * Math.PI / 180);
  return { O: [0, 0.628 + floorShift, 0.226], X: [1, 0, 0], Y: [0, c, -s], N: [0, s, c] };
}

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const fract = (x) => x - Math.floor(x);

/** the lit LEDs of an expression: a GRID × GRID table around the face centre → intensity */
const GRID = 128, HALF = GRID / 2;
const ledAt = (lit, i, j) => (i < -HALF || j < -HALF || i >= HALF || j >= HALF ? 0 : lit[(j + HALF) * GRID + i + HALF]);
function litLeds(name) {
  const rows = EXPRESSIONS[name], out = new Float32Array(GRID * GRID);
  const h = rows.length, w = rows[0].length;
  EYES.forEach((cx, e) => {
    for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) {
      const ch = e === 1 ? rows[r][w - 1 - q] : rows[r][q];
      if (ch !== '#') continue;
      const i = Math.round(cx + q - (w - 1) / 2), j = Math.round(EYE_ROW + (DROP[name] ?? 0) + (h - 1) / 2 - r);
      out[(j + HALF) * GRID + i + HALF] = 1;
    }
  });
  return out;
}

/**
 * Where every texel of the screen lies on the LED grid: per covered texel the LED coordinates of its centre and how
 * they change per texel (the triangle's Jacobian). Computed once, shared by all expressions.
 */
function texelMap(screen, size, plane) {
  const prim = screen.getMesh().listPrimitives()[0];
  const W = screen.getWorldMatrix();
  const pos = prim.getAttribute('POSITION'), uv = prim.getAttribute('TEXCOORD_0'), idx = prim.getIndices().getArray();
  const n = pos.getCount(), el = [0, 0, 0], t2 = [0, 0];
  const L = new Float32Array(n * 2), X = new Float32Array(n * 2);
  for (let v = 0; v < n; v++) {
    pos.getElement(v, el);
    const p = [0, 1, 2].map((i) => W[i] * el[0] + W[4 + i] * el[1] + W[8 + i] * el[2] + W[12 + i] - plane.O[i]);
    L[v * 2] = (p[0] * plane.X[0] + p[1] * plane.X[1] + p[2] * plane.X[2]) / PITCH;
    L[v * 2 + 1] = (p[0] * plane.Y[0] + p[1] * plane.Y[1] + p[2] * plane.Y[2]) / PITCH;
    uv.getElement(v, t2);
    X[v * 2] = t2[0] * size - 0.5; X[v * 2 + 1] = t2[1] * size - 0.5;   // texel centres on integers (glTF: v down)
  }
  const N = size * size;
  const gx = new Float32Array(N), gy = new Float32Array(N), jac = new Float32Array(N * 4), covered = new Uint8Array(N);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const x0 = X[a * 2], y0 = X[a * 2 + 1], x1 = X[b * 2], y1 = X[b * 2 + 1], x2 = X[c * 2], y2 = X[c * 2 + 1];
    const D = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(D) < 1e-9) continue;
    // LED coordinates are affine over the triangle: g = g0 + A·(x − x0) + B·(y − y0)
    const J = [];
    for (const k of [0, 1]) {
      const g0 = L[a * 2 + k], g1 = L[b * 2 + k], g2 = L[c * 2 + k];
      J.push(((g1 - g0) * (y2 - y0) - (g2 - g0) * (y1 - y0)) / D, ((x1 - x0) * (g2 - g0) - (x2 - x0) * (g1 - g0)) / D);
    }
    const minX = Math.max(0, Math.ceil(Math.min(x0, x1, x2) - 1e-6)), maxX = Math.min(size - 1, Math.floor(Math.max(x0, x1, x2) + 1e-6));
    const minY = Math.max(0, Math.ceil(Math.min(y0, y1, y2) - 1e-6)), maxY = Math.min(size - 1, Math.floor(Math.max(y0, y1, y2) + 1e-6));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const w1 = ((x - x0) * (y2 - y0) - (x2 - x0) * (y - y0)) / D, w2 = ((x1 - x0) * (y - y0) - (x - x0) * (y1 - y0)) / D, w0 = 1 - w1 - w2;
      if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
      const i = y * size + x;
      if (covered[i]) continue;
      covered[i] = 1;
      gx[i] = L[a * 2] + J[0] * (x - x0) + J[1] * (y - y0);
      gy[i] = L[a * 2 + 1] + J[2] * (x - x0) + J[3] * (y - y0);
      jac.set(J, i * 4);
    }
  }
  return { size, gx, gy, jac, covered };
}

// one LED-grid sample → linear RGB (the film's LED shader, without its camera-dependent parts)
function shade(lx, ly, fw, lit, out) {   // → radiance at the film's gain
  const i = Math.floor(lx + 0.5), j = Math.floor(ly + 0.5), fx = lx - i, fy = ly - j;
  const qx = Math.abs(fx) - 0.27, qy = Math.abs(fy) - 0.27;
  const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - 0.12;   // rounded square
  const cov = 1 - smoothstep(-fw * 0.7, fw * 0.7, d);
  if (cov <= 0) { out[0] = out[1] = out[2] = 0; return; }
  let k = ledAt(lit, i, j);
  if (k > 0) {
    const hv = fract(Math.sin(i * 12.9898 + j * 78.233) * 43758.5453);     // per-LED variance, and the odd tired LED
    k *= (0.9 + 0.16 * hv) * (hv > 0.985 ? 0.25 : 1);
  }
  const die = Math.exp(-(fx * fx + fy * fy) / 0.018), edge = smoothstep(-0.12, 0, d);
  const lum = k;                                                               // GREEN's brightest channel is 1
  for (let c = 0; c < 3; c++) {
    const led = GREEN[c] * k, hot = led * 0.65 + lum * 0.35;
    const glow = (led * (0.8 + 0.25 * edge) + hot * 0.9 * die) * GAIN * cov;
    const off = [0.010, 0.012, 0.011][c] * cov * (1 - Math.min(1, lum));      // unlit LED lens
    out[c] = glow + off;
  }
}

const encode = (v) => { const x = Math.min(1, Math.max(0, v)); return Math.round((x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055) * 255); };

/** one expression → PNG (sRGB, emissive) */
async function bake(map, name) {
  const { size, gx, gy, jac, covered } = map;
  const lit = litLeds(name);
  const img = Buffer.alloc(size * size * 3), px = [0, 0, 0], sum = [0, 0, 0];
  const S = [-0.375, -0.125, 0.125, 0.375];
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    const fv = smoothstep(0.56, 0.59, v);                // the face area of the screen (outside it: black glass)
    if (fv <= 0) continue;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (!covered[i]) continue;
      const u = (x + 0.5) / size;
      const face = fv * smoothstep(0.035, 0.06, u) * smoothstep(0.965, 0.94, u);
      if (face <= 0) continue;
      const a = jac[i * 4], b = jac[i * 4 + 1], c = jac[i * 4 + 2], d = jac[i * 4 + 3];
      const fw = Math.max(Math.abs(a) + Math.abs(b), Math.abs(c) + Math.abs(d)) * 0.25;
      sum[0] = sum[1] = sum[2] = 0;
      for (const oy of S) for (const ox of S) {
        shade(gx[i] + a * ox + b * oy, gy[i] + c * ox + d * oy, fw, lit, px);
        sum[0] += px[0]; sum[1] += px[1]; sum[2] += px[2];
      }
      for (let k = 0; k < 3; k++) img[i * 3 + k] = encode(sum[k] / 16 * face / NORM);
    }
  }
  // grow the face a few texels past the UV island edges (no dark seams in the mipmaps)
  const filled = Uint8Array.from(covered);
  for (let pass = 0; pass < 4; pass++) {
    const next = Uint8Array.from(filled);
    for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
      const i = y * size + x;
      if (filled[i]) continue;
      let n = 0; const s = [0, 0, 0];
      for (const o of [-1, 1, -size, size]) if (filled[i + o]) { n++; for (let k = 0; k < 3; k++) s[k] += img[(i + o) * 3 + k]; }
      if (n) { for (let k = 0; k < 3; k++) img[i * 3 + k] = Math.round(s[k] / n); next[i] = 1; }
    }
    filled.set(next);
  }
  return sharp(img, { raw: { width: size, height: size, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer();
}

/**
 * Bakes every expression for the Screen node, creates one material per expression and the variants.
 * Returns { names, materials } (the first expression is the default material).
 */
export async function buildFaces(doc, { screen, floorShift, size = 2048, strength, specular, log = () => {} }) {
  const map = texelMap(screen, size, ledPlane(floorShift));
  const variants = doc.createExtension(KHRMaterialsVariants);
  const list = variants.createMappingList();
  const names = Object.keys(EXPRESSIONS), materials = [];
  for (const name of names) {
    const t0 = Date.now();
    const png = await bake(map, name);
    const title = name[0].toUpperCase() + name.slice(1);
    const tex = doc.createTexture(`Face_${title}`).setImage(png).setMimeType('image/png').setURI(`face_${name}.png`);
    // pure emission like the film's LED: black, no specular reflection (the screen glass in front does the reflecting)
    const mat = doc.createMaterial(`Face_${title}`)
      .setBaseColorFactor([0, 0, 0, 1])
      .setMetallicFactor(0).setRoughnessFactor(1)
      .setEmissiveTexture(tex).setEmissiveFactor([1, 1, 1])
      .setExtension('KHR_materials_emissive_strength', strength.createEmissiveStrength().setEmissiveStrength(EMISSIVE_STRENGTH))
      .setExtension('KHR_materials_specular', specular.createSpecular().setSpecularFactor(0));
    list.addMapping(variants.createMapping().setMaterial(mat).addVariant(variants.createVariant(name)));
    materials.push(mat);
    log(`face ${name.padEnd(6)} ${(png.length / 1024).toFixed(0)} KB · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  const prim = screen.getMesh().listPrimitives()[0];
  prim.setMaterial(materials[0]).setExtension('KHR_materials_variants', list);
  return { names, materials };
}

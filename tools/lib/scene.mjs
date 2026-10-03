// The public scene graph: clean names, useful pivots, metres and Y-up everywhere.
//
// The master model keeps its authoring hierarchy: centimetres under a root rotated 90° and scaled 0.01, parts scaled ×3,
// the shoes tilted 25°, the origin at the centre of the head. Here every node becomes a plain translation (no rotation,
// scale 1), each part's rotation and scale are baked into its vertices, and the soles' lowest point lands on y = 0.
// Parts that move are empty nodes (pivots) with their meshes as children, so any tool can animate them as they are.
import { getBounds } from '@gltf-transform/core';

// lab frame of the master: the head centre sits 0.633 m above the scene origin (the in-house rig's rest placement)
const HEAD_Y = 0.633;

const SHOE_PARTS = ['Sole', 'Outsole', 'BodyOutside', 'BodyInside', 'Tongue', 'Laces', 'LaceHolder', 'FrontPiece', 'BackPiece', 'LeftPiece', 'RightPiece', 'Heel'];
const mesh = (name, src) => ({ name, mesh: src });

// pivot: 'origin' (floor centre) · { node } a master node's origin · { parentOf } the origin of a master node's parent ·
//        'master' the master's root (the head centre) · { base } bottom centre of a mesh (antennas) ·
//        { sole } bottom centre of a part's bounds (shoes: the sole)
// motion: where the in-house rig turned the part (rig.mjs reproduces its clips about that point)
export const SCENE = {
  name: 'Funkun', pivot: 'origin', children: [
    { name: 'Root', pivot: 'origin', motion: 'master', animated: true, children: [
      { name: 'UpperBody', pivot: { parentOf: 'BODY' }, animated: true, children: [
        mesh('Body', 'Body_Mesh01'),
        mesh('Screen', 'Screen_Mesh01'),
        mesh('ScreenRim', 'RimScreen_Mesh01'),
        mesh('ScreenGlass', 'GlassScreen_Mesh01'),
        { name: 'Helmet', pivot: { node: 'HELMET' }, children: [
          mesh('HelmetTop', 'HelmTop_Mesh01'),
          mesh('HelmetMid', 'HelmMid_Mesh01'),
          mesh('HelmetBase', 'HelmBase_Mesh01'),
          mesh('HelmetCap', 'HelmAttached_Mesh01'),
          mesh('EarMuffs', 'EarMuffs_Mesh01'),
          { name: 'AntennaL', pivot: { base: 'AntennaLeft_Mesh01' }, animated: true, children: [mesh('AntennaL_Mesh', 'AntennaLeft_Mesh01')] },
          { name: 'AntennaR', pivot: { base: 'AntennaRight_Mesh01' }, animated: true, children: [mesh('AntennaR_Mesh', 'AntennaRight_Mesh01')] },
        ] },
        { name: 'Visor', pivot: { node: 'VisorSpinner_Mesh01' }, animated: true, children: [
          mesh('VisorArms', 'VisorSpinner_Mesh01'),
          mesh('VisorHolder', 'VisorHolder_Mesh01'),
          mesh('VisorFrame', 'MetalVisor_Mesh01'),
          mesh('VisorGlass', 'GlassVisor_Mesh01'),
          mesh('VisorLights', 'LightsVisor_Mesh01'),
          mesh('VisorLightsHolder', 'LightsVisorHolder_Mesh01'),
        ] },
      ] },
      // the character's left shoe is on +X (it faces +Z)
      { name: 'ShoeL', pivot: { sole: 'LEFT_SHOE' }, motion: { node: 'LEFT_SHOE' }, animated: true, children: SHOE_PARTS.map((p) => mesh(`ShoeL_${p}`, `${p}_Mesh02`)) },
      { name: 'ShoeR', pivot: { sole: 'RIGHT_SHOE' }, motion: { node: 'RIGHT_SHOE' }, animated: true, children: SHOE_PARTS.map((p) => mesh(`ShoeR_${p}`, `${p}_Mesh01`)) },
    ] },
  ],
};

// ---------------------------------------------------------------- small mat4 / vec3 helpers (column-major, glTF)
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const translation = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const point = (m, v) => [0, 1, 2].map((i) => m[i] * v[0] + m[4 + i] * v[1] + m[8 + i] * v[2] + m[12 + i]);
const linear = (m, v) => [0, 1, 2].map((i) => m[i] * v[0] + m[4 + i] * v[1] + m[8 + i] * v[2]);
const det3 = (m) => m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
// normals: inverse-transpose of the 3×3 part
function normalMatrix(m) {
  const [a, b, c, d, e, f, g, h, i] = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g), G = b * f - c * e, H = -(a * f - c * d), I = a * e - b * d;
  // cofactor matrix = det · inverse-transpose; the scale does not matter (normals are renormalised)
  return [A, B, C, 0, D, E, F, 0, G, H, I, 0, 0, 0, 0, 1];
}
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

/**
 * Rebuilds the document's scene as SCENE. Returns { root, nodes, parts, frame } where
 *   nodes  name → new Node
 *   parts  name → { pivot, motion, parentPivot } of the animated nodes (rig.mjs)
 *   frame  { floorShift, headY } — how the master's lab frame maps to the new one (y_new = y_lab + floorShift)
 */
export function rebuildScene(doc) {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const src = new Map(root.listNodes().map((n) => [n.getName(), n]));
  const need = (name) => { const n = src.get(name); if (!n) throw new Error(`master model: node ${name} not found`); return n; };

  // world matrices in the lab frame, then the floor: the lowest vertex of the whole character → y = 0
  const lab = (n) => mul(translation(0, HEAD_Y, 0), n.getWorldMatrix());
  let minY = Infinity;
  for (const n of root.listNodes()) {
    const m = n.getMesh();
    if (!m) continue;
    const W = lab(n);
    for (const prim of m.listPrimitives()) {
      const pos = prim.getAttribute('POSITION'), el = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) minY = Math.min(minY, point(W, pos.getElement(i, el))[1]);
    }
  }
  const floorShift = -minY;
  const world = (n) => mul(translation(0, floorShift, 0), lab(n));
  const origin = (n) => point(world(n), [0, 0, 0]);

  // bake every mesh into its node's frame now (rotation + scale into the vertices, the node keeps only its origin)
  const baked = new Map();   // master node name → { mesh, origin }
  for (const n of root.listNodes()) {
    const m = n.getMesh();
    if (!m) continue;
    if (m.listParents().filter((p) => p.propertyType === 'Node').length > 1) throw new Error(`mesh ${m.getName()} is instanced; not supported`);
    const W = world(n), o = origin(n), N = normalMatrix(W), flip = det3(W) < 0;
    const done = new Set();
    for (const prim of m.listPrimitives()) {
      const pos = prim.getAttribute('POSITION'), nrm = prim.getAttribute('NORMAL');
      for (const acc of [pos, nrm]) {   // vertex data shared with another mesh would be transformed twice
        const owners = new Set(acc?.listParents().filter((p) => p.propertyType === 'Primitive').flatMap((p) => p.listParents().filter((q) => q.propertyType === 'Mesh')) ?? []);
        if (owners.size > 1) throw new Error(`vertex data of ${m.getName()} is shared with another mesh; not supported`);
      }
      if (!done.has(pos)) {
        done.add(pos);
        const a = pos.getArray(), el = [0, 0, 0];
        for (let i = 0; i < pos.getCount(); i++) { const p = point(W, pos.getElement(i, el)); a[i * 3] = p[0] - o[0]; a[i * 3 + 1] = p[1] - o[1]; a[i * 3 + 2] = p[2] - o[2]; }
        pos.setArray(a);
      }
      if (nrm && !done.has(nrm)) {
        done.add(nrm);
        const a = nrm.getArray(), el = [0, 0, 0];
        for (let i = 0; i < nrm.getCount(); i++) { const v = norm(linear(N, nrm.getElement(i, el))); a[i * 3] = v[0]; a[i * 3 + 1] = v[1]; a[i * 3 + 2] = v[2]; }
        nrm.setArray(a);
      }
      if (flip && prim.getIndices()) {   // a mirroring transform would turn the triangles inside out
        const idx = prim.getIndices().getArray();
        for (let t = 0; t < idx.length; t += 3) { const k = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = k; }
      }
    }
    baked.set(n.getName(), { mesh: m, origin: o, positions: () => m.listPrimitives().flatMap((p) => { const a = p.getAttribute('POSITION').getArray(), out = []; for (let i = 0; i < a.length; i += 3) out.push([a[i] + o[0], a[i + 1] + o[1], a[i + 2] + o[2]]); return out; }) });
  }

  // pivots in the new frame
  const meshesUnder = (n) => { const out = []; n.traverse((c) => { if (c.getMesh()) out.push(c.getName()); }); return out; };
  const boundsOf = (names) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const name of names) for (const p of baked.get(name).positions()) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
    return { lo, hi };
  };
  const resolve = (spec) => {
    if (spec === 'origin') return [0, 0, 0];
    if (spec === 'master') { const roots = scene.listChildren(); if (roots.length !== 1) throw new Error('master model: expected one root node'); return origin(roots[0]); }
    if (spec.node) return origin(need(spec.node));
    if (spec.parentOf) return origin(need(spec.parentOf).getParentNode());
    if (spec.sole) { const { lo, hi } = boundsOf(meshesUnder(need(spec.sole))); return [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2]; }
    if (spec.base) {   // centre of the lowest 3 % of the vertices = where the antenna sits on the helmet
      const ps = baked.get(spec.base).positions().sort((a, b) => a[1] - b[1]);
      const k = Math.max(8, Math.floor(ps.length * 0.03)), c = [0, 0, 0];
      for (let i = 0; i < k; i++) for (let j = 0; j < 3; j++) c[j] += ps[i][j] / k;
      return c;
    }
    throw new Error(`bad pivot ${JSON.stringify(spec)}`);
  };

  // build the new tree
  const nodes = {}, parts = {};
  const build = (spec, parentPivot) => {
    const node = doc.createNode(spec.name);
    if (spec.mesh) {
      const b = baked.get(spec.mesh);
      if (!b) throw new Error(`master model: mesh node ${spec.mesh} not found`);
      node.setTranslation(b.origin.map((v, i) => v - parentPivot[i])).setMesh(b.mesh);
      b.mesh.setName(spec.name);
      baked.delete(spec.mesh);
    } else {
      const pivot = resolve(spec.pivot);
      node.setTranslation(pivot.map((v, i) => v - parentPivot[i]));
      if (spec.animated) parts[spec.name] = { pivot, motion: spec.motion ? resolve(spec.motion) : pivot, parentPivot };
      for (const c of spec.children ?? []) node.addChild(build(c, pivot));
    }
    nodes[spec.name] = node;
    return node;
  };
  const top = build(SCENE, [0, 0, 0]);
  if (baked.size) throw new Error(`master meshes not placed in SCENE: ${[...baked.keys()].join(', ')}`);

  // swap the scene's contents; the master's nodes go
  for (const c of scene.listChildren()) scene.removeChild(c);
  scene.addChild(top);
  for (const n of src.values()) n.dispose();
  scene.setName('Funkun');

  const b = getBounds(scene);
  return { root: top, nodes, parts, frame: { floorShift, headY: HEAD_Y + floorShift }, bounds: { min: b.min, max: b.max } };
}

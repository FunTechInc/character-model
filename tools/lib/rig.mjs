// Funkun's procedural rig and the four clips baked into the GLB (Idle / Dance / Run / Jump).
//
// Funkun has no skeleton: it is a set of parts that move as rigid pieces (see SCENE in scene.mjs). A pose is a set of
// offsets from the rest pose, in CHARACTER space (metres, +Y up, facing +Z):
//   root    the whole character (jump height …)
//   upper   the head-body sphere with helmet and visor (bob, lean, squash > 0 flattens / < 0 stretches)
//   shoeL / shoeR
//   visor   the visor's flip angle (rad): 0 = rest (down), about -2.2 = flipped up over the helmet
//   antenna wobble (rad)
// These are the motions the character was animated with in-house, rewritten so every clip loops without a seam.

const TAU = Math.PI * 2;
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function emptyPose() {
  return {
    root: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, scale: 1 },
    upper: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0, squash: 0 },
    shoeL: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 },
    shoeR: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 },
    visor: 0,
    antenna: 0,
  };
}

// Breathing + slow sway. The frequencies are whole multiples of 1/6 s so the clip loops (breath 3 s, sway 6 s).
const IDLE_T = 6;
function idle(t) {
  const p = emptyPose(), w = TAU / IDLE_T;
  p.upper.y = Math.sin(t * 2 * w) * 0.012;
  p.upper.squash = Math.sin(t * 2 * w) * 0.015;
  p.upper.roll = Math.sin(t * w) * 0.03;
  p.antenna = Math.sin(t * 5 * w) * 0.08;
  return p;
}

// Bounce to the beat: squash on the beat, stretch + hop between, the shoes take turns tapping. 4 beats = one loop.
const BPM = 144;
function dance(t) {
  const p = emptyPose();
  const b = t * BPM / 60, ph = b % 1;
  const hop = Math.sin(ph * Math.PI);                        // 0 on the beat, 1 between
  const hit = Math.exp(-ph / 0.12);                          // 1 on the beat
  p.upper.y = hop * 0.05 - hit * 0.02;
  p.upper.squash = hit * 0.12 - hop * 0.05;
  p.upper.roll = Math.sin(b * Math.PI) * 0.12;
  p.upper.yaw = Math.sin(b * Math.PI * 0.5) * 0.25;
  const side = Math.floor(b) % 2 ? 1 : -1;
  const tap = hop * 0.05;
  (side > 0 ? p.shoeL : p.shoeR).y = tap;
  (side > 0 ? p.shoeL : p.shoeR).pitch = -tap * 4;
  p.antenna = Math.sin(b * TAU) * 0.3;
  return p;
}

// Rayman-style run cycle on the spot: the shoes arc, the body leans and double-bobs. One stride = one loop.
const CADENCE = 2.6;   // strides per second
function run(t, { stride = 0.34, lift = 0.16, lean = 0.28 } = {}) {
  const p = emptyPose();
  const ph = t * CADENCE * TAU;
  const foot = (o, a) => {
    o.z = Math.cos(a) * stride * 0.5;                 // forward / back along +Z (facing)
    o.y = Math.max(0, Math.sin(a)) * lift;            // lift during the forward swing
    // toe up on the way forward, toe down on the way back (blended over the top of the swing so the shoe never snaps)
    const tilt = -0.2 + 0.5 * smoothstep(-0.3, 0.3, -Math.cos(a));
    o.pitch = -Math.sin(a) * 0.6 + tilt * Math.max(0, Math.sin(a));
  };
  foot(p.shoeL, ph); foot(p.shoeR, ph + Math.PI);
  p.upper.y = 0.05 + Math.abs(Math.sin(ph)) * 0.06;
  p.upper.squash = -Math.abs(Math.cos(ph)) * 0.06 + 0.02;
  p.upper.pitch = lean + Math.sin(ph * 2) * 0.04;
  p.upper.z = 0.06;
  p.upper.roll = Math.sin(ph) * 0.07;
  p.antenna = -0.35 + Math.sin(ph * 2) * 0.12;
  return p;
}

// One jump over progress k ∈ [0, 1]: anticipate (0–.2) → launch (.2–.35) → air → land (.8–1). Then a short rest so
// the clip can loop.
const JUMP_T = 1.1, JUMP_REST = 0.5;
function jump(t, { height = 0.6 } = {}) {
  const p = emptyPose();
  const k = Math.min(1, t / JUMP_T);
  const pre = Math.min(1, k / 0.2), air = Math.min(1, Math.max(0, (k - 0.2) / 0.6)), land = Math.max(0, (k - 0.8) / 0.2);
  const arc = Math.sin(air * Math.PI);
  p.root.y = arc * height;
  p.upper.squash = k < 0.2 ? pre * 0.18 : k < 0.8 ? -0.12 * Math.sin(air * Math.PI * 0.5 + 0.3) : 0.2 * Math.sin(land * Math.PI);
  p.upper.y = k < 0.2 ? -pre * 0.04 : k < 0.8 ? 0.02 : 0.02 * (1 - land);
  p.shoeL.y = p.shoeR.y = k > 0.2 && k < 0.8 ? arc * 0.05 : 0;
  p.shoeL.pitch = p.shoeR.pitch = k > 0.2 && k < 0.8 ? 0.5 * arc : 0;
  p.upper.pitch = k > 0.2 && k < 0.8 ? -0.2 * arc : 0;
  p.antenna = k > 0.2 && k < 0.8 ? -0.5 * arc : 0.3 * Math.sin(land * Math.PI * 3);
  return p;
}

// fps: sampling rate of the baked keys (60 where a motion has sharp hits, the rest is dropped again by resample())
export const CLIPS = [
  { name: 'Idle', duration: IDLE_T, fps: 30, pose: idle },
  { name: 'Dance', duration: 4 * 60 / BPM, fps: 60, pose: dance },
  { name: 'Run', duration: 1 / CADENCE, fps: 60, pose: run },
  { name: 'Jump', duration: JUMP_T + JUMP_REST, fps: 60, pose: jump },
];

// ---------------------------------------------------------------- pose → node transforms
// Each animated part has
//   pivot  its rest position in the new scene (where its node sits; scene.mjs)
//   motion the point the in-house rig turned it about (the old node origin). The rig's motion is reproduced exactly
//          about that point, whatever the node's own pivot: t = motion − parentPivot + offset + Q·S·(pivot − motion)
// so the clips look the same while the nodes get pivots that make sense to animate by hand.
const quatFromEuler = (x, y, z) => {   // Euler order YXZ (pitch about X, yaw about Y, roll about Z), as three.js
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2), s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3];
};
const rotate = (q, v) => {   // v rotated by unit quaternion q
  const [x, y, z, w] = q, [a, b, c] = v;
  const ix = w * a + y * c - z * b, iy = w * b + z * a - x * c, iz = w * c + x * b - y * a, iw = -x * a - y * b - z * c;
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
};

/** the local TRS of one part for an offset { x, y, z, pitch, yaw, roll } and a scale [sx, sy, sz] */
export function partTRS(part, off, scale = [1, 1, 1]) {
  const q = quatFromEuler(off.pitch || 0, off.yaw || 0, off.roll || 0);
  const d = part.pivot.map((v, i) => (v - part.motion[i]) * scale[i]);
  const qd = rotate(q, d);
  const t = part.motion.map((v, i) => v - part.parentPivot[i] + ([off.x, off.y, off.z][i] || 0) + qd[i]);
  return { t, r: q, s: scale };
}

/** pose → { nodeName: { t, r, s } } for the animated parts (parts: scene.mjs › ANIMATED, resolved) */
export function poseToTRS(p, parts) {
  const out = {};
  const sy = 1 - p.upper.squash, sxz = 1 / Math.sqrt(Math.max(0.2, sy));
  out.Root = partTRS(parts.Root, p.root, [p.root.scale, p.root.scale, p.root.scale]);
  out.UpperBody = partTRS(parts.UpperBody, p.upper, [sxz, sy, sxz]);
  out.ShoeL = partTRS(parts.ShoeL, p.shoeL);
  out.ShoeR = partTRS(parts.ShoeR, p.shoeR);
  out.Visor = partTRS(parts.Visor, { pitch: p.visor });
  out.AntennaL = partTRS(parts.AntennaL, { roll: p.antenna, pitch: p.antenna * 0.5 });
  out.AntennaR = partTRS(parts.AntennaR, { roll: -p.antenna, pitch: p.antenna * 0.5 });
  return out;
}

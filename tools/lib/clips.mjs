// The rig's clips (rig.mjs) sampled into glTF animations on the part nodes.
// Every clip keys every animated part (translation, rotation, scale), so switching clips in any tool never leaves a
// part where the previous clip put it; resample() drops the keys a straight line between neighbours reproduces.
import { CLIPS, poseToTRS } from './rig.mjs';

export function bakeClips(doc, { nodes, parts }) {
  const buffer = doc.getRoot().listBuffers()[0];
  const names = Object.keys(parts);
  const out = [];
  for (const clip of CLIPS) {
    const N = Math.max(2, Math.round(clip.duration * clip.fps));
    const times = new Float32Array(N + 1);
    const tracks = Object.fromEntries(names.map((n) => [n, { translation: [], rotation: [], scale: [] }]));
    for (let k = 0; k <= N; k++) {
      const t = (k * clip.duration) / N;
      times[k] = t;
      const trs = poseToTRS(clip.pose(k === N ? 0 : t), parts);   // the last key repeats the first: a seamless loop
      for (const n of names) {
        const tr = tracks[n], { t: tt, r, s } = trs[n];
        const prev = tr.rotation.length ? tr.rotation.slice(-4) : null;
        const q = prev && prev[0] * r[0] + prev[1] * r[1] + prev[2] * r[2] + prev[3] * r[3] < 0 ? r.map((v) => -v) : r;   // shortest arc
        tr.translation.push(...tt); tr.rotation.push(...q); tr.scale.push(...s);
      }
    }
    const anim = doc.createAnimation(clip.name);
    const input = doc.createAccessor(`${clip.name}_time`).setType('SCALAR').setArray(times).setBuffer(buffer);
    for (const n of names) {
      for (const path of ['translation', 'rotation', 'scale']) {
        const output = doc.createAccessor(`${clip.name}_${n}_${path}`).setType(path === 'rotation' ? 'VEC4' : 'VEC3')
          .setArray(new Float32Array(tracks[n][path])).setBuffer(buffer);
        const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
        anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(nodes[n]).setTargetPath(path).setSampler(sampler));
      }
    }
    out.push({ name: clip.name, duration: clip.duration });
  }
  return out;
}

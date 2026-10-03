#!/usr/bin/env node
// Funkun — the public build.
//
//   npm run build                     source/funkun_source.glb → models/funkun.glb, models/funkun_web.glb, dist/funkun_hd.glb
//
// in   source/funkun_source.glb   FunTech's in-house master model (not distributed — the build needs a copy of it)
// out  dist/funkun_hd.glb         full resolution, no compression — attached to the GitHub Release
//      models/funkun.glb          ~70k triangles, no compression, PNG/JPEG — opens in any glTF tool
//      models/funkun_web.glb      ~30k triangles, meshopt + WebP — for the web
//
// What the build does (tools/lib):
//   scene.mjs      rebuild the scene: clean names, useful pivots, metres / Y-up, the soles on y = 0
//   materials.mjs  the BEAUTY materials as standard glTF properties (+ a smudged-roughness detail map)
//   face.mjs       the LED face: 9 expressions baked to emissive textures, switchable as material variants
//   rig.mjs        the 4 clips (Idle / Dance / Run / Jump) → clips.mjs bakes them into glTF animations
//   lods.mjs       the lighter versions (meshoptimizer, layered parts pushed back so nothing shows through)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP, KHRXMP } from '@gltf-transform/extensions';
import { cloneDocument, meshopt, prune, resample } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { rebuildScene } from './lib/scene.mjs';
import { buildMaterials, FACE_SOURCE, sourceName } from './lib/materials.mjs';
import { buildFaces } from './lib/face.mjs';
import { bakeClips } from './lib/clips.mjs';
import { simplifyDocument } from './lib/lods.mjs';
import { validateFile } from './validate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'source/funkun_source.glb');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const REPO = 'https://github.com/FunTechInc/character-model';
const LICENSE = { name: 'CC BY-NC 4.0', url: 'https://creativecommons.org/licenses/by-nc/4.0/' };
const OUT = {
  hd: { file: path.join(ROOT, 'dist/funkun_hd.glb'), tris: null, face: 2048, mouth: 2048, format: 'png' },
  standard: { file: path.join(ROOT, 'models/funkun.glb'), tris: 70000, face: 1024, mouth: 1024, format: 'png' },
  web: { file: path.join(ROOT, 'models/funkun_web.glb'), tris: 30000, face: 1024, mouth: 1024, format: 'webp' },
};

const log = (...a) => console.log(...a);
if (!fs.existsSync(SRC)) {
  console.error(`missing ${path.relative(ROOT, SRC)} — the build reads FunTech's in-house master model, which is not distributed.`);
  process.exit(1);
}
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

// ---------------------------------------------------------------- the common document
const t0 = Date.now();
const doc = await io.read(SRC);
const root = doc.getRoot();

// the mouth decal is the one image of the master the look uses
const mouthSrc = root.listMaterials().find((m) => sourceName(m.getName()) === 'MOUTH_PLASTIC')?.getBaseColorTexture();
if (!mouthSrc) throw new Error('master model: MOUTH_PLASTIC has no base colour texture');
const mouth = await sharp(Buffer.from(mouthSrc.getImage())).jpeg({ quality: 92, mozjpeg: true }).toBuffer();

const { nodes, parts, frame, bounds } = rebuildScene(doc);
log(`scene     ${Object.keys(nodes).length} nodes · soles on y = 0 (shift ${(frame.floorShift * 1000).toFixed(1)} mm) · head centre y = ${frame.headY.toFixed(4)} m`);

// materials: the master's 17 (with Blender duplicates) → 11 named ones + the face set
const oldMaterials = root.listMaterials(), oldTextures = root.listTextures();
const { bySource, strength, specular } = await buildMaterials(doc, { mouth });
for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
  const from = sourceName(prim.getMaterial()?.getName() ?? '');
  if (from === FACE_SOURCE) continue;                       // the screen: buildFaces()
  const m = bySource.get(from);
  if (!m) throw new Error(`no public material for ${from} (${mesh.getName()})`);
  prim.setMaterial(m);
}
const faces = await buildFaces(doc, { screen: nodes.Screen, floorShift: frame.floorShift, strength, specular, log });
for (const p of [...oldMaterials, ...oldTextures]) p.dispose();

// animations
const clips = bakeClips(doc, { nodes, parts });
await doc.transform(resample());   // drop keys a straight line reproduces (1e-4)

// who made it and how it may be used: asset.copyright + an XMP packet (KHR_xmp_json_ld)
const asset = root.getAsset();
asset.generator = `FunTech character-model build ${VERSION} (glTF Transform)`;
asset.copyright = `© FunTech Inc. ${LICENSE.name} — ${LICENSE.url}`;
const xmp = doc.createExtension(KHRXMP);
const alt = (value) => ({ '@type': 'rdf:Alt', 'rdf:_1': { '@language': 'x-default', '@value': value } });
root.setExtension('KHR_xmp_json_ld', xmp.createPacket()
  .setContext({ dc: 'http://purl.org/dc/elements/1.1/', xmpRights: 'http://ns.adobe.com/xap/1.0/rights/', rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#' })
  .setProperty('dc:title', alt('Funkun'))
  .setProperty('dc:creator', { '@list': ['FunTech Inc.'] })
  .setProperty('dc:description', alt('Funkun, the FunTech character. 9 faces as material variants, 4 animations.'))
  .setProperty('dc:rights', alt(`© FunTech Inc. Licensed under ${LICENSE.name}.`))
  .setProperty('dc:source', REPO)
  .setProperty('xmpRights:Marked', true)
  .setProperty('xmpRights:WebStatement', LICENSE.url)
  .setProperty('xmpRights:UsageTerms', alt(`${LICENSE.name} (${LICENSE.url}). Commercial use: contact FunTech Inc., info@funtech.inc`)));
await doc.transform(prune({ propertyTypes: [PropertyType.MATERIAL, PropertyType.TEXTURE, PropertyType.ACCESSOR], keepAttributes: true, keepExtras: true }));
log(`common    ${root.listMaterials().length} materials · ${root.listTextures().length} textures · ${clips.map((c) => `${c.name} ${c.duration.toFixed(2)} s`).join(' · ')} · ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// ---------------------------------------------------------------- outputs
async function reencode(d, { face, mouth: mouthSize, format }) {
  for (const tex of d.getRoot().listTextures()) {
    const name = tex.getName();
    const size = /^Face_/.test(name) ? face : name === 'Mouth' ? mouthSize : null;
    let img = sharp(Buffer.from(tex.getImage()));
    if (size) img = img.resize(size, size, { kernel: 'lanczos3' });
    const base = tex.getURI().replace(/\.\w+$/, '');
    if (format === 'webp') {
      tex.setImage(await img.webp({ quality: 90, smartSubsample: true }).toBuffer()).setMimeType('image/webp').setURI(`${base}.webp`);
    } else if (name === 'Mouth') {
      tex.setImage(await img.jpeg({ quality: 92, mozjpeg: true }).toBuffer()).setMimeType('image/jpeg').setURI(`${base}.jpg`);
    } else {
      tex.setImage(await img.png({ compressionLevel: 9 }).toBuffer()).setMimeType('image/png').setURI(`${base}.png`);
    }
  }
  // the master's EXT_texture_webp stays on the document after its images are gone: declare it only where it is used
  for (const ext of d.getRoot().listExtensionsUsed()) if (ext.extensionName === 'EXT_texture_webp') ext.dispose();
  if (format === 'webp') d.createExtension(EXTTextureWebP).setRequired(true);
}

function stats(d) {
  let tris = 0, verts = 0;
  for (const m of d.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
    verts += p.getAttribute('POSITION').getCount();
    tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  }
  return { tris, verts };
}

const report = {};
for (const [key, o] of Object.entries(OUT)) {
  const t1 = Date.now();
  const d = cloneDocument(doc);
  let lod = null;
  if (o.tris) lod = await simplifyDocument(d, { tris: o.tris, cacheKey: 'funkun' });
  await reencode(d, o);
  if (key === 'web') await d.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  fs.mkdirSync(path.dirname(o.file), { recursive: true });
  await io.write(o.file, d);
  const bytes = fs.statSync(o.file).size;
  const s = stats(d);
  const v = await validateFile(o.file);
  report[key] = { file: path.relative(ROOT, o.file), bytes, ...s, errors: v.errors, warnings: v.warnings };
  log(`${key.padEnd(9)} ${path.relative(ROOT, o.file).padEnd(22)} ${String(s.tris).padStart(7)} tris ${String(s.verts).padStart(7)} verts · ${(bytes / 1e6).toFixed(2)} MB`
    + (lod ? ` · error ${(lod.error * 1000).toFixed(2)} mm, ${lod.moved} covered vertices moved back` : '')
    + ` · validator ${v.errors} errors / ${v.warnings} warnings · ${((Date.now() - t1) / 1000).toFixed(1)} s`);
  for (const m of v.messages) log(`          ${m}`);
}
fs.writeFileSync(path.join(ROOT, 'tools/build-report.json'), JSON.stringify({ version: VERSION, bounds, frame, clips, faces: faces.names, files: report }, null, 2) + '\n');
log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

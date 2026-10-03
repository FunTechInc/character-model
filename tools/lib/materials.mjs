// Funkun's materials, written into the GLB with standard glTF properties so every viewer shows the same character.
//
// The values are the film's BEAUTY look: glossy black vinyl with a strong clear coat, orange accents and sneakers,
// clear glass. The glossy parts carry a small tiling roughness map (smudges), so the highlights are not perfectly even
// — the imperfection that makes a CG toy read as a real one. (The film also had an orange-peel bump; seen still and up
// close in a viewer it reads as crumpled plastic, so it is left out.)
import sharp from 'sharp';
import { KHRMaterialsClearcoat, KHRMaterialsEmissiveStrength, KHRMaterialsSpecular, KHRMaterialsTransmission, KHRTextureTransform } from '@gltf-transform/extensions';

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const linear = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => srgbToLinear(v / 255));

// from: the master model's material (its name without Blender's .001 suffixes)
// detail: smudged roughness (2 repeats)
export const MATERIALS = [
  { name: 'Vinyl_Black', from: 'DARK_PLASTIC', color: 0x050506, roughness: 0.3, specular: 0.6, clearcoat: [1, 0.035], detail: true },
  { name: 'Vinyl_GlossBlack', from: 'GLOSSY_PLASTIC', color: 0x040405, roughness: 0.22, specular: 0.7, clearcoat: [1, 0.03], detail: true },
  { name: 'Vinyl_Orange', from: 'PLASTIC_GLOSSY', color: 0xff4a14, roughness: 0.24, clearcoat: [1, 0.06], emissive: [0xff2a08, 0.12], detail: true },
  { name: 'Mouth', from: 'MOUTH_PLASTIC', color: 0xffffff, map: 'mouth', roughness: 0.3, clearcoat: [1, 0.05], detail: true },
  { name: 'Plastic_Black', from: 'PLASTIC_NORMAL', color: 0x0a0a0b, roughness: 0.34, specular: 0.6, clearcoat: [0.8, 0.06], detail: true },
  { name: 'Plastic_Matte', from: 'ROUGH_PLASTIC', color: 0x101012, roughness: 0.6, specular: 0.5 },
  { name: 'Rubber', from: 'GLOSSY_RUBBER', color: 0x0c0c0d, roughness: 0.45 },
  { name: 'Metal_Gunmetal', from: 'METALLIC_PLASTIC', color: 0x1a1a1e, metalness: 0.6, roughness: 0.3, clearcoat: [0.6, 0.1] },
  { name: 'Sneaker_Orange', from: 'Fiberglass Orange', color: 0xe2461a, roughness: 0.3, clearcoat: [0.9, 0.08], detail: true },
  // clear glass: thin-walled transmission + a clear coat for the second reflection the film's glass has
  { name: 'Glass', from: 'GLASS', color: 0xffffff, roughness: 0.02, transmission: 1, clearcoat: [1, 0.02] },
  { name: 'Glass_Screen', from: 'GLASS_ROUGH', color: 0xffffff, roughness: 0.05, transmission: 1, clearcoat: [1, 0.02] },
];
export const FACE_SOURCE = 'SCREEN_EYES_V06';
export const sourceName = (name) => name.replace(/\.\d+$/, '');

// ---------------------------------------------------------------- detail maps (tileable value noise)
function hash(x, y, s) { const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return v - Math.floor(v); }
// value noise whose lattice wraps every `period` cells → the map tiles without a seam
function vnoise(x, y, s, period) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const w = (i) => ((i % period) + period) % period;
  const a = hash(w(xi), w(yi), s), b = hash(w(xi + 1), w(yi), s), c = hash(w(xi), w(yi + 1), s), d = hash(w(xi + 1), w(yi + 1), s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export async function smudgeMap(S = 256) {
  const rough = Buffer.alloc(S * S * 3);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 3;
    const n = vnoise(x / S * 6, y / S * 6, 9, 6) * 0.7 + vnoise(x / S * 23, y / S * 23, 4, 23) * 0.3;
    rough[i] = rough[i + 1] = rough[i + 2] = Math.round(150 + (n - 0.5) * 120);   // G = roughness ×, B = metalness × (unused)
  }
  return sharp(rough, { raw: { width: S, height: S, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer();
}

// ---------------------------------------------------------------- materials
/** creates the materials; returns name → Material and source name → Material */
export async function buildMaterials(doc, { mouth }) {
  const clearcoat = doc.createExtension(KHRMaterialsClearcoat);
  const specular = doc.createExtension(KHRMaterialsSpecular);
  const transmission = doc.createExtension(KHRMaterialsTransmission);
  const strength = doc.createExtension(KHRMaterialsEmissiveStrength);
  const transform = doc.createExtension(KHRTextureTransform);
  const tiled = (info, repeat) => info.setExtension('KHR_texture_transform', transform.createTransform().setScale([repeat, repeat]));

  const smudge = doc.createTexture('Detail_Smudge').setImage(await smudgeMap()).setMimeType('image/png').setURI('detail_smudge.png');
  const mouthTex = doc.createTexture('Mouth').setImage(mouth).setMimeType('image/jpeg').setURI('mouth.jpg');

  const byName = new Map(), bySource = new Map();
  for (const d of MATERIALS) {
    const m = doc.createMaterial(d.name)
      .setBaseColorFactor([...linear(d.color), 1])
      .setMetallicFactor(d.metalness ?? 0)
      .setRoughnessFactor(d.roughness)
      .setAlphaMode('OPAQUE')
      .setDoubleSided(false);
    if (d.map === 'mouth') m.setBaseColorTexture(mouthTex);
    if (d.emissive) {
      const [hex, k] = d.emissive;
      m.setEmissiveFactor(linear(hex).map((v) => v * k));
    }
    if (d.specular !== undefined) m.setExtension('KHR_materials_specular', specular.createSpecular().setSpecularFactor(d.specular));
    if (d.transmission) m.setExtension('KHR_materials_transmission', transmission.createTransmission().setTransmissionFactor(d.transmission));
    if (d.clearcoat) m.setExtension('KHR_materials_clearcoat', clearcoat.createClearcoat().setClearcoatFactor(d.clearcoat[0]).setClearcoatRoughnessFactor(d.clearcoat[1]));
    if (d.detail) {
      m.setMetallicRoughnessTexture(smudge);
      tiled(m.getMetallicRoughnessTextureInfo(), 2);
    }
    byName.set(d.name, m);
    bySource.set(d.from, m);
  }
  return { byName, bySource, strength, specular };
}

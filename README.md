# Funkun — 3D model

[日本語](README.ja.md)

<p align="center">
  <img src="media/hero.webp" width="960" alt="Funkun dancing: a glossy black sphere with an LED screen for a face, headphones and a visor, bouncing on two orange sneakers while its eyes change from happy to star, heart and open">
</p>

<p align="center">
  <a href="https://funtechinc.github.io/character-model/"><b>Live preview</b></a> ·
  <a href="https://github.com/FunTechInc/character-model/raw/main/models/funkun.glb">Download funkun.glb</a> ·
  <a href="#license">License: CC BY-NC 4.0</a>
</p>

Funkun is FunTech's character: a glossy black sphere whose face is an LED screen, with headphones, a visor and a pair of
sneakers. This is the 3D model, made in-house at FunTech, as glTF 2.0: one file with **9 faces** and **4 animations**,
ready for three.js, `<model-viewer>`, Blender, Unity and Unreal.

- [Preview](#preview)
- [Files](#files)
- [Faces](#faces) · [Animations](#animations)
- [Usage](#usage): three.js · model-viewer · Blender · Unity / Unreal · CDN
- [Specs](#specs): size, axes, parts, materials
- [License](#license)

## Preview

**In the browser: https://funtechinc.github.io/character-model/**. Turn the character around, play the animations,
switch the face, download the files. On a phone, *View in your space* puts Funkun in the room (AR).

The page takes URL parameters, so a link can open a given state (and `ui=0` makes it embeddable):

| Parameter | Values | |
|---|---|---|
| `anim` | `Idle` · `Dance` · `Run` · `Jump` | Animation (default `Idle`) |
| `face` | `happy` · `open` · `blink` · `heart` · `star` · `dot` · `angry` · `sad` · `dead` | Face (default `happy`) |
| `bg` | `dark` · `light` | Background |
| `model` | `standard` | Show `funkun.glb` instead of `funkun_web.glb` |
| `ui` | `0` | The model only (no buttons) |

For example, [`?anim=Dance&face=heart`](https://funtechinc.github.io/character-model/?anim=Dance&face=heart).

The viewer shows each file as it is: no material, light or face is added in code, so what you see is what you download.

To preview locally:

```bash
npm install
npm run dev        # http://localhost:5210/
```

## Files

| File | Triangles | Size | For |
|---|---:|---:|---|
| [`models/funkun.glb`](models/funkun.glb) | 70,000 | 3.0 MB | Most uses. No compression: opens in any glTF tool |
| [`models/funkun_web.glb`](models/funkun_web.glb) | 30,000 | 0.7 MB | The web. Meshopt-compressed geometry and WebP textures |
| `funkun_hd.glb` ([Releases](https://github.com/FunTechInc/character-model/releases/latest)) | 955,900 | 25 MB | Stills and close-ups. Full resolution, no compression |

The three files are the same scene: the same parts, names, pivots, materials, faces and animations. Only the triangle
count and the compression differ. All three pass the Khronos [glTF Validator](https://github.khronos.org/glTF-Validator/)
with 0 errors and 0 warnings.

## Faces

<p align="center"><img src="media/faces.jpg" width="900" alt="The nine faces on Funkun's LED screen: happy, open, blink, heart, star, dot, angry, sad, dead"></p>

| | | |
|---|---|---|
| `happy` (default) | `open` | `blink` |
| `heart` | `star` | `dot` |
| `angry` | `sad` | `dead` |

The faces are **material variants** of the screen ([`KHR_materials_variants`](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_variants)):
each one is an emissive LED-matrix texture. Switch them with `variant-name` in model-viewer, the *glTF Variants*
panel in Blender, or a few lines in three.js ([below](#threejs)).

## Animations

<p align="center"><img src="media/animations.jpg" width="900" alt="One pose from each animation: Idle, Dance, Run and Jump"></p>

| Name | Length | |
|---|---:|---|
| `Idle` | 6.0 s | Breathing and a slow sway |
| `Dance` | 1.67 s | 4 beats at 144 BPM: bounce on the beat, the shoes take turns tapping |
| `Run` | 0.38 s | One stride, on the spot |
| `Jump` | 1.6 s | Crouch, jump, land, then a short rest |

Every animation loops without a seam. Funkun has no skeleton: the animations move the parts (see [Parts](#parts)),
and every animation keys every moving part, so switching animations never leaves a part behind.

## Usage

### three.js

```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const gltf = await new GLTFLoader().loadAsync('funkun.glb');
scene.add(gltf.scene);

// animations
const mixer = new THREE.AnimationMixer(gltf.scene);
mixer.clipAction(THREE.AnimationClip.findByName(gltf.animations, 'Dance')).play();
// every frame: mixer.update(deltaSeconds)

// faces (KHR_materials_variants)
const faces = gltf.userData.gltfExtensions.KHR_materials_variants.variants.map((v) => v.name);
const screen = gltf.scene.getObjectByName('Screen');
async function setFace(name) {
  const { mappings } = screen.userData.gltfExtensions.KHR_materials_variants;
  const mapping = mappings.find((m) => m.variants.includes(faces.indexOf(name)));
  screen.material = await gltf.parser.getDependency('material', mapping.material);
}
await setFace('heart');
```

`funkun_web.glb` needs the meshopt decoder:

```js
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
```

Glossy black vinyl shows only what it reflects, so give the scene an environment, for example:

```js
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment()).texture;
```

### model-viewer

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@google/model-viewer@4.3.1/dist/model-viewer.min.js"></script>

<model-viewer src="funkun.glb" camera-controls autoplay animation-name="Dance" variant-name="heart"
  tone-mapping="neutral" shadow-intensity="1"></model-viewer>
```

For `funkun_web.glb`, tell model-viewer where the meshopt decoder is, before its script:

```html
<script>
  self.ModelViewerElement = { meshoptDecoderLocation: 'https://cdn.jsdelivr.net/npm/meshoptimizer@0.25.0/meshopt_decoder.js' };
</script>
```

### Blender

*File › Import › glTF 2.0*. The animations come in as actions. To switch faces, turn on
*Material Variants* in the glTF add-on's preferences: the *glTF Variants* tab then appears in the 3D Viewport's
sidebar. The HD file (`funkun_hd.glb`) is the one for renders.

### Unity / Unreal

Import `funkun.glb` with [glTFast](https://docs.unity3d.com/Packages/com.unity.cloud.gltfast@latest) (Unity) or the
glTF importer (Unreal). Whether the faces (material variants) can be switched depends on the importer.

### CDN

Each release is on jsDelivr, so a demo can load the model directly:

```
https://cdn.jsdelivr.net/gh/FunTechInc/character-model@v1.0.0/models/funkun_web.glb
```

## Specs

| | |
|---|---|
| Size | 0.88 m tall (soles to antenna tips) · 0.73 m wide · 0.62 m deep |
| Axes | 1 unit = 1 m · +Y up · faces +Z · the lowest point of the soles at y = 0, centred between the feet |
| Nodes | Every node at rest is a plain translation: no rotation, scale 1 |
| Triangles | 70,000 (`funkun.glb`) · 30,000 (`funkun_web.glb`) · 955,900 (`funkun_hd.glb`) |
| Textures | The mouth decal, the 9 faces, and one small tiling roughness map. Every other surface is a flat material |
| Extensions | `KHR_materials_clearcoat`, `KHR_materials_specular`, `KHR_materials_transmission`, `KHR_materials_emissive_strength`, `KHR_materials_variants`, `KHR_texture_transform`, `KHR_xmp_json_ld` (license metadata) · `funkun_web.glb` also: `EXT_meshopt_compression`, `KHR_mesh_quantization`, `EXT_texture_webp` |

### Parts

Funkun has no skeleton. Its moving parts are empty nodes whose origin is the point they turn about (★), with the meshes
as their children, so you can animate it in any tool by moving those nodes:

```
Funkun
└─ Root               ★ on the floor between the feet: the whole character (jumping)
   ├─ UpperBody       ★ head centre: bob, lean, twist, squash (scale Y below 1)
   │  ├─ Body · Screen · ScreenRim · ScreenGlass
   │  ├─ Helmet
   │  │  ├─ HelmetTop · HelmetMid · HelmetBase · HelmetCap · EarMuffs
   │  │  ├─ AntennaL  ★ the antenna's base: wobble
   │  │  └─ AntennaR  ★
   │  └─ Visor        ★ the hinge at the ear muffs: rotate about X to flip it up (about −2.2 rad)
   ├─ ShoeL           ★ centre of the sole (the character's left, +X)
   └─ ShoeR           ★
```

### Materials

| Material | Parts | |
|---|---|---|
| `Vinyl_Black` · `Vinyl_GlossBlack` | Body, helmet, visor frame | Glossy black vinyl with a clear coat |
| `Vinyl_Orange` | Trims, screen rim, visor lights | Orange vinyl with a clear coat |
| `Sneaker_Orange` | Sneakers | Orange, glossy |
| `Mouth` | The mouth decal | |
| `Plastic_Black` · `Plastic_Matte` · `Rubber` · `Metal_Gunmetal` | Ear muffs, details, sneaker parts | |
| `Glass` · `Glass_Screen` | Visor, screen cover | Clear glass (transmission) |
| `Face_Happy` … `Face_Dead` | The LED screen | Emissive; switched by the face variants |

## How the files are made

The models are built from FunTech's in-house master model, which is not distributed, by the scripts in `tools/`
(Node.js, [glTF Transform](https://gltf-transform.dev/), [meshoptimizer](https://github.com/zeux/meshoptimizer)):

```bash
npm run build      # source/funkun_source.glb → models/, dist/funkun_hd.glb (needs the master model)
npm run validate   # glTF Validator over every model
npm run media      # the images in media/ (headless Chrome)
```

`tools/lib/` holds the steps: the scene (names, pivots, metres, Y-up), the materials, the LED faces, the animations
and the lighter versions.

## License

- **The model and the images of Funkun** (`models/`, the release files, `media/`): [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/), © FunTech Inc.
- **The code** (`tools/`, `viewer/`): MIT.

Details in [LICENSE.md](LICENSE.md). When you use Funkun, credit it like this:

> Funkun © FunTech Inc. — CC BY-NC 4.0

Usage guidelines. These are requests on top of the license, not extra legal terms:

- Welcome: personal and non-commercial work, fan art, study, demos and experiments, posts on social media (with the credit).
- Please don't present your work as made or endorsed by FunTech, or use Funkun as your own logo or mark.
- Please don't use Funkun in content that is hateful, violent or sexual, or in political or religious campaigns.
- Commercial use (goods, advertising, paid products, selling the model or things made from it) needs FunTech's permission: contact us at [info@funtech.inc](mailto:info@funtech.inc).

---

© FunTech Inc. · [funtech.inc](https://funtech.inc/)

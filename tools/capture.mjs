#!/usr/bin/env node
// Deterministic captures of the viewer in headless Chrome (the local server runs inside this process).
//
//   node tools/capture.mjs shot --q "anim=Dance&face=heart" --t 0.4 --vp 1440x900 --out shot.png
//          [--orbit "30deg 75deg 1.2m"] [--target "0m 0.6m 0m"] [--dpr 2] [--eval "js"]
//   npm run media                       → media/hero.webp (Dance loop), media/poster.jpg, media/faces.jpg, media/social.png
//
// Chrome: $CHROME or /Applications/Google Chrome.app (GPU through ANGLE/Metal, like the film's capture).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { createServer } from './serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const cmd = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'media';

const server = createServer().listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://localhost:${server.address().port}/`;
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--force-color-profile=srgb', '--hide-scrollbars'],
});

/** opens the viewer and waits until the model, its environment and the first frame are there */
async function open({ q = '', vp = '1440x900', dpr = 1 } = {}) {
  const [w, h] = vp.split('x').map(Number);
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()); });
  await page.setViewport({ width: w, height: h, deviceScaleFactor: +dpr });
  await page.goto(base + (q ? `?${q}` : ''), { waitUntil: 'networkidle0', timeout: 120000 });
  await page.waitForFunction(() => window.__viewer, { timeout: 60000 });
  await page.evaluate(() => window.__viewer.ready);
  return page;
}

/** camera + time, then two frames */
async function frame(page, { t = 0, orbit = null, target = null, fov = null } = {}) {
  await page.evaluate(async ({ t, orbit, target, fov }) => {
    const mv = document.getElementById('mv');
    if (orbit) mv.cameraOrbit = orbit;
    if (target) mv.cameraTarget = target;
    if (fov) mv.fieldOfView = fov;
    mv.jumpCameraToGoal();
    await window.__viewer.hold(t);
  }, { t, orbit, target, fov });
  await new Promise((r) => setTimeout(r, 150));
}

async function shot() {
  const page = await open({ q: opt('q', ''), vp: opt('vp', '1440x900'), dpr: opt('dpr', 1) });
  await new Promise((r) => setTimeout(r, 400));   // variant textures
  if (opt('eval', null)) await page.evaluate(opt('eval'));   // debugging: e.g. strip a texture through model-viewer's scene API
  await frame(page, { t: +opt('t', 0), orbit: opt('orbit', null), target: opt('target', null), fov: opt('fov', null) });
  const out = path.resolve(opt('out', path.join(os.tmpdir(), 'funkun-shot.png')));
  await page.screenshot({ path: out });
  console.log(out);
}

// frames of one page at several times, side by side
//   node tools/capture.mjs sheet --q "anim=Run" --times 0,0.1,0.2,0.3 --vp 500x600 --out run.png [--orbit …] [--target …]
async function sheet() {
  const page = await open({ q: opt('q', 'ui=0'), vp: opt('vp', '500x600'), dpr: opt('dpr', 1) });
  await new Promise((r) => setTimeout(r, 400));
  if (opt('eval', null)) await page.evaluate(opt('eval'));
  const times = opt('times', '0').split(',').map(Number);
  const tiles = [];
  for (const t of times) {
    await frame(page, { t, orbit: opt('orbit', null), target: opt('target', null), fov: opt('fov', null) });
    tiles.push(await page.screenshot());
  }
  const [w, h] = opt('vp', '500x600').split('x').map(Number), k = +opt('dpr', 1);
  const cols = +opt('cols', times.length), rows = Math.ceil(times.length / cols);
  const out = path.resolve(opt('out', path.join(os.tmpdir(), 'funkun-sheet.png')));
  await sharp({ create: { width: cols * w * k, height: rows * h * k, channels: 3, background: '#000' } })
    .composite(tiles.map((input, i) => ({ input, left: (i % cols) * w * k, top: Math.floor(i / cols) * h * k }))).png().toFile(out);
  console.log(out);
}

// every face (material variant) of the model, side by side
async function faces({ vp = '360x300', orbit = '0deg 82deg 1.05m', target = '0m 0.6m 0m', cols = 9, out, dpr = +opt('dpr', 1) } = {}) {
  const page = await open({ q: 'ui=0', vp, dpr });
  const names = await page.evaluate(() => document.getElementById('mv').availableVariants);
  const tiles = [];
  for (const name of names) {
    await page.evaluate(async (n) => { const mv = document.getElementById('mv'); mv.variantName = n; await new Promise((r) => setTimeout(r, 300)); }, name);
    await frame(page, { t: 0, orbit, target });
    tiles.push(await page.screenshot());
  }
  const [w, h] = vp.split('x').map(Number), rows = Math.ceil(names.length / cols);
  const small = await Promise.all(tiles.map((t) => sharp(t).resize(w, h, { kernel: 'lanczos3' }).toBuffer()));
  await sharp({ create: { width: cols * w, height: rows * h, channels: 3, background: '#0b0b0d' } })
    .composite(small.map((input, i) => ({ input, left: (i % cols) * w, top: Math.floor(i / cols) * h }))).png().toFile(out);
  console.log(out, names.join(' '));
}

// ---------------------------------------------------------------- npm run media
const MEDIA = path.join(ROOT, 'media');
const DARK = '#0b0b0d';

// the README's first image: Dance, the face changing every 2 beats (happy → star → heart → open), 2 loops = 100 frames
async function hero() {
  const W = 960, H = 540, FPS = 30, FRAMES = 100, BEAT = 60 / 144, FACES = ['happy', 'star', 'heart', 'open'];
  const page = await open({ q: 'ui=0&anim=Dance', vp: `${W}x${H}`, dpr: 2 });
  for (const f of FACES) await page.evaluate(async (n) => { document.getElementById('mv').variantName = n; await new Promise((r) => setTimeout(r, 400)); }, f);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'funkun-hero-'));
  let face = null;
  for (let i = 0; i < FRAMES; i++) {
    const t = i / FPS, f = FACES[Math.floor(t / BEAT / 2 + 1e-6) % FACES.length];
    if (f !== face) { face = f; await page.evaluate((n) => { document.getElementById('mv').variantName = n; }, f); }
    await frame(page, { t, orbit: '20deg 80deg 2.4m', target: '0m 0.47m 0m' });
    const png = await page.screenshot();
    await sharp(png).resize(W, H, { kernel: 'lanczos3' }).png().toFile(path.join(dir, `f${String(i).padStart(3, '0')}.png`));
  }
  const files = fs.readdirSync(dir).sort().map((f) => path.join(dir, f));
  const out = path.join(MEDIA, 'hero.webp');
  execFileSync('img2webp', ['-loop', '0', '-lossy', '-q', '78', '-m', '6', '-d', String(Math.round(1000 / FPS)), ...files, '-o', out]);
  fs.rmSync(dir, { recursive: true });
  console.log(`${path.relative(ROOT, out)}  ${W}×${H} · ${FRAMES} frames · ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}

// one pose of each animation, side by side
async function poses() {
  const W = 360, H = 440, CLIPS = [['Idle', 0], ['Dance', 0.2], ['Run', 0.128], ['Jump', 0.66]];
  const tiles = [];
  for (const [anim, t] of CLIPS) {
    const page = await open({ q: `ui=0&anim=${anim}`, vp: `${W}x${H}`, dpr: 2 });
    await frame(page, { t, orbit: '28deg 82deg 3.5m', target: '0m 0.62m 0m' });
    tiles.push(await sharp(await page.screenshot()).resize(W, H, { kernel: 'lanczos3' }).toBuffer());
    await page.close();
  }
  const out = path.join(MEDIA, 'animations.jpg');
  await sharp({ create: { width: W * CLIPS.length, height: H, channels: 3, background: DARK } })
    .composite(tiles.map((input, i) => ({ input, left: i * W, top: 0 }))).jpeg({ quality: 86, mozjpeg: true }).toFile(out);
  console.log(`${path.relative(ROOT, out)}  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}

// the model alone on a transparent background (poster, social card)
async function cutout({ vp, orbit, target, q = 'ui=0' }) {
  const page = await open({ q, vp, dpr: 2 });
  await page.evaluate(() => { document.body.style.background = 'transparent'; });
  await frame(page, { t: 0, orbit, target });
  const png = await page.screenshot({ omitBackground: true });
  await page.close();
  return png;
}

async function poster() {
  // shown while the model loads: the viewer's opening view, centred, transparent around the character
  const png = await cutout({ vp: '1200x900', orbit: '24deg 78deg 3.4m', target: '0m 0.44m 0m' });
  const out = path.join(MEDIA, 'poster.webp');
  await sharp(png).resize(1200, 900).webp({ quality: 82, alphaQuality: 90 }).toFile(out);
  console.log(`${path.relative(ROOT, out)}  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}

async function social() {
  // 1280×640 (GitHub's social preview size; also the viewer's og:image): the character right, the name left
  const model = await cutout({ vp: '640x640', orbit: '22deg 80deg 2.55m', target: '0m 0.45m 0m' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 640, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><style>
    html,body{margin:0;width:1280px;height:640px;background:${DARK};color:#fff;font-family:ui-sans-serif,system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif;letter-spacing:0;-webkit-font-smoothing:antialiased}
    .t{position:absolute;left:96px;top:208px}
    h1{margin:0;font-size:96px;line-height:104px;font-weight:600}
    p{margin:16px 0 0;font-size:28px;line-height:40px;color:rgba(255,255,255,.62)}
    .m{position:absolute;left:96px;bottom:88px;font-size:20px;line-height:24px;color:rgba(255,255,255,.62)}
    .m b{display:inline-block;width:12px;height:12px;background:#ff481b;margin-right:12px;vertical-align:1px}
    img{position:absolute;right:56px;top:0;width:640px;height:640px}
  </style></head><body>
    <img src="data:image/png;base64,${model.toString('base64')}">
    <div class="t"><h1>Funkun</h1><p>3D model by FunTech</p></div>
    <div class="m"><b></b>glTF 2.0 · 9 faces · 4 animations · CC BY-NC 4.0</div>
  </body></html>`);
  const out = path.join(MEDIA, 'social.png');
  await page.screenshot({ path: out });
  await page.close();
  console.log(`${path.relative(ROOT, out)}  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}

async function media() {
  fs.mkdirSync(MEDIA, { recursive: true });
  const only = opt('only', null);
  if (!only || only === 'hero') await hero();
  if (!only || only === 'faces') {
    const out = path.join(MEDIA, 'faces.jpg'), tmp = out + '.png';
    await faces({ vp: '300x240', orbit: '10deg 76deg 1.4m', target: '0m 0.63m 0m', cols: 3, out: tmp, dpr: 2 });
    await sharp(tmp).jpeg({ quality: 88, mozjpeg: true }).toFile(out);
    fs.rmSync(tmp);
  }
  if (!only || only === 'animations') await poses();
  if (!only || only === 'poster') await poster();
  if (!only || only === 'social') await social();
}

try {
  if (cmd === 'media') await media();
  else if (cmd === 'shot') await shot();
  else if (cmd === 'faces') await faces({ vp: opt('vp', '360x300'), cols: +opt('cols', 9), out: path.resolve(opt('out', path.join(os.tmpdir(), 'funkun-faces.png'))) });
  else if (cmd === 'sheet') await sheet();
  else throw new Error(`unknown command ${cmd}`);
} finally {
  await browser.close();
  server.close();
}

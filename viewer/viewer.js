// Funkun viewer: the animations and faces come from the file itself (glTF animations, KHR_materials_variants).
//
//   ?anim=Dance   ?face=heart   ?bg=light   ?model=standard (funkun.glb instead of funkun_web.glb)   ?ui=0 (the model only)
const mv = document.getElementById('mv');
const params = new URLSearchParams(location.search);
if (params.get('model') === 'standard') mv.src = 'models/funkun.glb';
const state = { anim: params.get('anim') ?? 'Idle', face: params.get('face') ?? 'happy', bg: params.get('bg') === 'light' ? 'light' : 'dark' };
if (params.get('ui') === '0') document.body.classList.add('bare');

// pixel eyes for the face buttons — the same glyphs the build bakes into the LED screen (tools/lib/face.mjs)
const GLYPHS = {
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
const NS = 'http://www.w3.org/2000/svg';
function glyphIcon(name) {
  const rows = GLYPHS[name] ?? ['#'];
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-0.5 -0.5 10 10');
  svg.setAttribute('aria-hidden', 'true');
  const ox = (9 - rows[0].length) / 2, oy = (9 - rows.length) / 2;
  rows.forEach((row, r) => [...row].forEach((ch, c) => {
    if (ch !== '#') return;
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', ox + c + 0.08); rect.setAttribute('y', oy + r + 0.08);
    rect.setAttribute('width', 0.84); rect.setAttribute('height', 0.84);
    svg.append(rect);
  }));
  return svg;
}
const title = (s) => s[0].toUpperCase() + s.slice(1);

function radioGroup(el, items, current, onPick, render) {
  el.replaceChildren(...items.map((name) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn';
    b.setAttribute('role', 'radio');
    b.dataset.value = name;
    render(b, name);
    b.addEventListener('click', () => onPick(name));
    return b;
  }));
  mark(el, current);
}
function mark(el, value) {
  for (const b of el.querySelectorAll('[role="radio"]')) {
    const on = (b.dataset.value ?? b.dataset.bg) === value;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  }
}
// arrow keys move within a radio group
for (const g of document.querySelectorAll('[role="radiogroup"]')) {
  g.addEventListener('keydown', (e) => {
    const k = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!k) return;
    const all = [...g.querySelectorAll('[role="radio"]')], i = all.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const next = all[(i + k + all.length) % all.length];
    next.focus(); next.click();
  });
}

function sync() {
  const p = new URLSearchParams();
  if (state.anim !== 'Idle') p.set('anim', state.anim);
  if (state.face !== 'happy') p.set('face', state.face);
  if (state.bg !== 'dark') p.set('bg', state.bg);
  if (params.get('model') === 'standard') p.set('model', 'standard');
  if (params.get('ui') === '0') p.set('ui', '0');
  const q = p.toString();
  history.replaceState(null, '', q ? `?${q}` : location.pathname);
}

function setAnim(name) {
  if (!mv.availableAnimations.includes(name)) name = mv.availableAnimations.includes('Idle') ? 'Idle' : mv.availableAnimations[0];
  state.anim = name;
  mv.animationName = name;
  mv.play();
  mark(document.getElementById('anims'), name);
  sync();
}
function setFace(name) {
  if (!mv.availableVariants.includes(name)) name = mv.availableVariants[0];
  state.face = name;
  mv.variantName = name;
  mark(document.getElementById('faces'), name);
  sync();
}
function setBg(bg) {
  state.bg = bg;
  document.body.dataset.bg = bg;
  document.querySelector('meta[name="theme-color"]').content = bg === 'light' ? '#e9e8e6' : '#0b0b0d';
  mark(document.getElementById('bgs'), bg);
  sync();
}
for (const b of document.querySelectorAll('#bgs [data-bg]')) b.addEventListener('click', () => setBg(b.dataset.bg));
setBg(state.bg);

mv.addEventListener('progress', (e) => {
  const bar = mv.querySelector('.progress');
  bar.firstElementChild.style.width = `${Math.round(e.detail.totalProgress * 100)}%`;
  bar.classList.toggle('done', e.detail.totalProgress >= 1);
});

// frame the whole character with air around it, for any window shape — until the visitor moves the camera
const ORBIT = ['24deg', '78deg'], FOV = 26;
const air = () => (mv.clientWidth < 768 ? 1.18 : 1.55);   // phones: the character fills more of the small view
let touched = false;
mv.addEventListener('camera-change', (e) => { if (e.detail.source === 'user-interaction') touched = true; });
function frameCamera() {
  if (touched || !mv.loaded || !mv.clientHeight) return;
  const d = mv.getDimensions(), tv = Math.tan((FOV * Math.PI) / 360), th = tv * (mv.clientWidth / mv.clientHeight);
  const r = Math.max((d.y * air()) / 2 / tv, (Math.max(d.x, d.z) * air()) / 2 / th) + d.z / 2;
  mv.cameraOrbit = `${ORBIT[0]} ${ORBIT[1]} ${r.toFixed(3)}m`;
  mv.jumpCameraToGoal();
}
new ResizeObserver(frameCamera).observe(mv);

let resolveReady;
const ready = new Promise((r) => { resolveReady = r; });
const environment = new Promise((r) => mv.addEventListener('environment-change', r, { once: true }));
mv.addEventListener('load', async () => {
  radioGroup(document.getElementById('anims'), mv.availableAnimations, state.anim, setAnim, (b, n) => { b.textContent = n; });
  radioGroup(document.getElementById('faces'), mv.availableVariants, state.face, setFace, (b, n) => {
    b.append(glyphIcon(n));
    b.title = title(n);
    b.setAttribute('aria-label', title(n));
  });
  setAnim(state.anim);
  setFace(state.face);
  frameCamera();
  await environment;
  resolveReady();
});

// download menu
const toggle = document.getElementById('dl-toggle'), menu = document.getElementById('dl');
const openMenu = (open) => { menu.hidden = !open; toggle.setAttribute('aria-expanded', String(open)); };
toggle.addEventListener('click', (e) => { e.stopPropagation(); openMenu(menu.hidden); });
document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) openMenu(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { openMenu(false); toggle.focus(); } });

// for tools/capture.mjs: hold the animation at a time, wait for that frame
window.__viewer = {
  ready,
  async hold(t) {
    mv.pause();
    mv.currentTime = t;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  },
};

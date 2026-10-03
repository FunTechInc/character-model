#!/usr/bin/env node
// Local preview of the viewer, laid out like the GitHub Pages site (.github/workflows/pages.yml):
//   /            viewer/   (index.html, viewer.js, viewer.css, studio.hdr)
//   /models/     models/
//   /media/      media/
//
//   npm run dev              http://localhost:5210/
//   node tools/serve.mjs --port 8000
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOUNTS = [['/models/', 'models'], ['/media/', 'media'], ['/', 'viewer']];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.hdr': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp4': 'video/mp4',
};

export function createServer() {
  return http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const [prefix, dir] = MOUNTS.find(([p]) => url.startsWith(p));
    let file = path.join(ROOT, dir, url.slice(prefix.length));
    if (!file.startsWith(path.join(ROOT, dir))) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf('--port');
  const port = i > 0 ? +process.argv[i + 1] : 5210;
  createServer().listen(port, () => console.log(`http://localhost:${port}/`));
}

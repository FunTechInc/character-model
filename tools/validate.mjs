#!/usr/bin/env node
// Khronos glTF-Validator over the models.
//
//   npm run validate                  models/*.glb (+ dist/*.glb when present)
//   node tools/validate.mjs file.glb  one file
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateBytes, version } from 'gltf-validator';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** → { errors, warnings, infos, messages: ['SEVERITY CODE pointer message', …] } */
export async function validateFile(file) {
  const r = await validateBytes(new Uint8Array(fs.readFileSync(file)), { maxIssues: 200 });
  const sev = ['ERROR', 'WARNING', 'INFO', 'HINT'];
  const messages = r.issues.messages.filter((m) => m.severity <= 1).map((m) => `${sev[m.severity]} ${m.code} ${m.pointer ?? ''} ${m.message}`);
  return { errors: r.issues.numErrors, warnings: r.issues.numWarnings, infos: r.issues.numInfos, messages, extensions: r.info?.extensionsUsed ?? [] };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = process.argv.length > 2 ? process.argv.slice(2)
    : ['models', 'dist'].flatMap((d) => (fs.existsSync(path.join(ROOT, d)) ? fs.readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith('.glb')).map((f) => path.join(ROOT, d, f)) : []));
  console.log(`glTF-Validator ${version()}`);
  let failed = false;
  for (const f of files) {
    const v = await validateFile(f);
    failed ||= v.errors > 0;
    console.log(`${path.relative(ROOT, f).padEnd(24)} ${v.errors} errors · ${v.warnings} warnings · ${v.infos} infos · ${v.extensions.join(', ')}`);
    for (const m of v.messages) console.log(`  ${m}`);
  }
  process.exit(failed ? 1 : 0);
}

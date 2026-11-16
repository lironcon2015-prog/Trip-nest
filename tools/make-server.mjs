// js/merge.js → server/merge.js: the same merge rules on both sides of the sync.
// The app loads js/merge.js as a classic script (a global); the Worker imports an
// ES module. Run after every change to js/merge.js — tests/server.mjs fails on a
// stale copy. Usage: node tools/make-server.mjs [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const HEADER = '// GENERATED from js/merge.js by tools/make-server.mjs — do not edit.\n';

export function build() {
  const src = readFileSync(join(root, 'js/merge.js'), 'utf-8');
  return HEADER + src + '\nexport default Merge;\n';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = build();
  const path = join(root, 'server/merge.js');
  if (process.argv.includes('--check')) {
    let cur = '';
    try { cur = readFileSync(path, 'utf-8'); } catch { }
    if (cur !== out) { console.error('server/merge.js is stale — run: node tools/make-server.mjs'); process.exit(1); }
    console.log('server/merge.js is up to date');
  } else {
    writeFileSync(path, out);
    console.log('wrote server/merge.js');
  }
}

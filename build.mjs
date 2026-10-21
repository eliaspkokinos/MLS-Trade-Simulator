// build.mjs — generates public/index.html from canonical sources.
// Single source of truth: the compliance/trade engine lives ONLY in engine/engine.mjs
// and the dataset ONLY in data/current-state.json. This injects both into the UI shell
// (src/index.template.html) so the deployed site runs the exact engine the tests do.
import { readFileSync, writeFileSync } from 'fs';
const ROOT = new URL('.', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

const template = read('src/index.template.html');
let engine = read('engine/engine.mjs').replace(/^export\s+/gm, ''); // strip module syntax for inline use
const data = read('data/current-state.json').trim();

if (!template.includes('/*__ENGINE__') || !template.includes('/*__DATA__*/null'))
  throw new Error('template markers missing');

const out = template
  .replace(/\/\*__ENGINE__[^*]*\*\//, () => engine)
  .replace('/*__DATA__*/null', () => data);

writeFileSync(new URL('public/index.html', ROOT), out);
console.log(`built public/index.html (${out.length} bytes) from engine.mjs + current-state.json`);

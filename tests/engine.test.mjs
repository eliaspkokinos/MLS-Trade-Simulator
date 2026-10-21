// Regression test: proves the extracted engine + reconcile modules reproduce the app's
// known results on the canonical dataset. Run: node tests/engine.test.mjs
import { readFileSync } from 'fs';
import { validateRoster } from '../engine/engine.mjs';
import { reconcile } from '../engine/reconcile.mjs';

const data = JSON.parse(readFileSync(new URL('../data/current-state.json', import.meta.url)));

let illegal = [];
for (const team of Object.keys(data.clubs)) {
  const v = validateRoster(team, data);
  if (!v.ok) illegal.push(`${team}: ${v.violations.join(', ')}`);
}

const r = reconcile(data);
const flagTeams = r.flags.map(f => f.team).sort();
const phillyFlagged = r.flags.some(f => f.team === 'Philadelphia Union');

console.log('Clubs:', Object.keys(data.clubs).length);
console.log('Illegal clubs:', illegal.length, illegal.length ? illegal : '');
console.log('Reconciliation flags:', r.flags.length);
for (const f of r.flags) console.log(`  [${f.sev}] ${f.team} — ${f.kind}`);
console.log('Philadelphia flagged (should be false, McKenzie is pending):', phillyFlagged);

const pass =
  illegal.length === 0 &&
  r.flags.length === 6 &&
  !phillyFlagged &&
  r.flags.filter(f => f.sev === 'breach').length === 0;

console.log(pass ? '\nPASS — extracted engine matches app results' : '\nFAIL');
process.exit(pass ? 0 : 1);

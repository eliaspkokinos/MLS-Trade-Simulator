// Regression test: proves the canonical engine + reconcile modules reproduce the app's
// known results on the dataset. Run: node tests/engine.test.mjs
//
// Roster model is "mirror": current-state.json reflects the live MLS rosters, so a club can
// legitimately sit over an in-season limit (e.g. a player returns from the IL with no offsetting
// move yet). Those real overages are documented in meta.roster_exceptions {team, dimensions[]}
// and are allowed here. Any OTHER illegal roster, or any undocumented overage, still fails the
// test, so this keeps catching accidental data bugs.
import { readFileSync } from 'fs';
import { validateRoster } from '../engine/engine.mjs';
import { reconcile } from '../engine/reconcile.mjs';

const data = JSON.parse(readFileSync(new URL('../data/current-state.json', import.meta.url)));

const exceptions = data.meta.roster_exceptions || [];
const excepted = (team, dim) => exceptions.some(e => e.team === team && (e.dimensions || []).includes(dim));
const flagKindToDim = { 'Senior roster': 'Senior', 'Intl capacity': 'Intl', 'DP designation': 'DP', 'U22 designation': 'U22' };

// Illegal rosters, minus documented mirror overages.
const unexpectedIllegal = [];
const documentedIllegal = [];
for (const team of Object.keys(data.clubs)) {
  const v = validateRoster(team, data);
  if (v.ok) continue;
  const uncovered = v.violations.filter((vi) => !excepted(team, vi.split(' ')[0]));
  (uncovered.length ? unexpectedIllegal : documentedIllegal).push(`${team}: ${v.violations.join(', ')}`);
}

// Reconcile flags: a breach that matches a documented exception is expected; everything else is not.
const r = reconcile(data);
const unexpectedFlags = r.flags.filter((f) => !(f.sev === 'breach' && excepted(f.team, flagKindToDim[f.kind])));
const phillyFlagged = r.flags.some((f) => f.team === 'Philadelphia Union');

console.log('Clubs:', Object.keys(data.clubs).length);
console.log('Documented mirror overages (allowed):', documentedIllegal.length, documentedIllegal.length ? documentedIllegal : '');
console.log('Unexpected illegal clubs:', unexpectedIllegal.length, unexpectedIllegal.length ? unexpectedIllegal : '');
console.log('Unexpected reconciliation flags:', unexpectedFlags.length);
for (const f of unexpectedFlags) console.log(`  [${f.sev}] ${f.team} — ${f.kind}`);
console.log('Philadelphia flagged (should be false, McKenzie is pending):', phillyFlagged);

const pass = unexpectedIllegal.length === 0 && unexpectedFlags.length === 0 && !phillyFlagged;
console.log(pass ? '\nPASS — engine matches app; only documented mirror overages, zero unexpected flags' : '\nFAIL');
process.exit(pass ? 0 : 1);

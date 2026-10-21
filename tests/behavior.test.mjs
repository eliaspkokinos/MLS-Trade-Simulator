// Behavioral regression tests — lock the corrected Layer 1 rules against silent drift.
// Runs on the canonical engine (engine.mjs); the deployed site is built from the same module.
// Run: node tests/behavior.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import {
  rosterState, availability, newScenario, evaluateInScenario, applyTrade,
} from '../engine/engine.mjs';

const base = JSON.parse(readFileSync(new URL('../data/current-state.json', import.meta.url)));

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + ' — ' + e.message); fail++; }
};

// Build a single-club dataset (real meta/constants, real club config) with synthetic players.
function oneClub(team, players, clubOverrides = {}) {
  const d = JSON.parse(JSON.stringify(base));
  d.clubs = { [team]: { ...d.clubs[team], ...clubOverrides } };
  d.players = players.map((p, i) => ({
    name: 'P' + i, team, roster_category: 'Senior',
    is_intl: false, is_dp: false, is_u22: false, is_tam: false, status: 'Active', ...p,
  }));
  return d;
}
const ATL = 'Atlanta United';          // Designated Player model, non-Canadian
const TOR = 'Toronto FC';              // Canadian

// ---- Relief model: the rules Miami/Cincinnati forced out ----
check('Loaned-in international does NOT charge an international slot', () => {
  const s = rosterState(ATL, oneClub(ATL, [{ is_intl: true, status: 'Loaned In' }], { intl_owned: 8 }));
  assert.equal(s.intlCharged, 0);
  assert.equal(s.intlEffective, 0);
});
check('Loaned-in player DOES occupy a senior slot and keeps its designation', () => {
  const s = rosterState(ATL, oneClub(ATL, [{ status: 'Loaned In', is_dp: true }]));
  assert.equal(s.seniorCount, 1, 'senior');
  assert.equal(s.dpCount, 1, 'dp designation retained');
});
check('Loaned-out / SEI / injured / off-roster fully relieve every resource', () => {
  for (const [status, roster_category] of [
    ['Loaned Out', 'Senior'], ['Season Ending Injury', 'Senior'],
    ['Injured List', 'Senior'], ['Active', 'Off-Roster (Unavailable)'],
  ]) {
    const s = rosterState(ATL, oneClub(ATL, [{ is_intl: true, is_dp: true, status, roster_category }], { intl_owned: 8 }));
    assert.equal(s.intlEffective, 0, status + ' intl');
    assert.equal(s.seniorCount, 0, status + ' senior');
    assert.equal(s.dpCount, 0, status + ' dp');
  }
});

// ---- Canadian international exemption is PER PLAYER, not a blanket minus-three ----
check('Canadian exemption charges only non-exempt internationals (per-player flag)', () => {
  const s = rosterState(TOR, oneClub(TOR, [
    { is_intl: true, intl_exempt: true }, { is_intl: true, intl_exempt: true },
    { is_intl: true },                                  // this one charges
  ], { intl_owned: 8 }));
  assert.equal(s.intlEffective, 1);
});
check('intl_exempt is honored per-player and never a blanket club subtraction', () => {
  // Three plain internationals, none flagged exempt → all three charge (no auto -3).
  const s = rosterState(TOR, oneClub(TOR, [
    { is_intl: true }, { is_intl: true }, { is_intl: true },
  ], { intl_owned: 8 }));
  assert.equal(s.intlEffective, 3);
});

// ---- Preview and commit cannot diverge (same transform underneath) ----
check('Preview after-state === committed state (no divergent path)', () => {
  const teamA = 'San Jose Earthquakes', teamB = ATL;
  const mover = base.players.find(p => p.team === teamA && availability(p) === 'active' && !p.is_dp && !p.is_u22);
  assert.ok(mover, 'found a movable player');
  const deal = { teamA, teamB, aSends: { players: [mover.name] }, bSends: {} };
  const scen = newScenario(base);
  const preview = evaluateInScenario(scen, deal);
  const res = applyTrade(scen, deal, { force: true });
  assert.ok(res.ok, 'commit succeeded');
  assert.deepEqual(rosterState(teamA, res.scenario), preview.after[teamA], 'teamA state');
  assert.deepEqual(rosterState(teamB, res.scenario), preview.after[teamB], 'teamB state');
});

// ---- Same-club guard ----
check('A club cannot trade with itself', () => {
  const scen = newScenario(base);
  const r = evaluateInScenario(scen, { teamA: ATL, teamB: ATL, aSends: {}, bSends: {} });
  assert.equal(r.status, 'blocked');
});

console.log(`\n${fail ? 'FAIL' : 'PASS'} — behavior: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

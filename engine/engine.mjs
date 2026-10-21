// MLS Trade Simulator — canonical compliance + trade engine.
// This module is the SINGLE source of truth. The website is built from it (see build.mjs)
// and the tests import it directly, so preview, commit, and CI all run the exact same code.
//
// Relief model (per-resource, not one boolean):
//   Each player has an availability class derived from status + roster_category. A per-resource
//   table says whether that class consumes Senior / DP / U22 / International. A player may carry
//   an explicit `consumes` override for a resource. Key corrections over the old single
//   isUnavailable() boolean:
//     - Loaned In players occupy a senior/supplemental slot and keep any DP/U22 designation
//       (they are active, not relieved), BUT do not charge an international slot: the inbound
//       loan's international designation stays with the parent club. The Sept 2026 profiles
//       force this — Inter Miami lists 13 available internationals against 12 owned slots and is
//       only legal because its 3 "Loan Player" internationals (Galarza, Micael, Caicedo) do not
//       charge; FC Cincinnati (Malatini, Mrozek) is the same. So intl=0 for loaned_in.
//     - Off-roster players never consume, regardless of loan status.
//     - loaned_out / sei / injured relieve every resource (senior + international + designation),
//       which the official September profiles confirm (clubs carry a 4th DP or extra U22 precisely
//       because one is on a qualifying season-ending unavailability). This is expressed per-resource
//       so a future non-qualifying case can be encoded via `consumes` without touching the engine.
//
// Canadian international exemption is PER PLAYER (`intl_exempt`), not an automatic minus-three.
// Canadian clubs may designate up to three qualifying players who do not charge a slot.

export const LEAGUE_YEAR = 2026;
export const SECONDARY_WINDOW_OPEN = "2026-07-13";
export const clone = (x) => JSON.parse(JSON.stringify(x));

// ---- availability class (explicit, derived once) ----
export function availability(p) {
  const s = (p.status || "").toLowerCase();
  const cat = p.roster_category || "";
  if (cat.startsWith("Off-Roster")) return "off_roster";
  if (p.pending_effective || s.includes("pending")) return "pending";
  if (s.includes("season ending") || s.includes("season-ending")) return "sei";
  if (s.includes("injur")) return "injured";
  if (s.includes("loaned out")) return "loaned_out";
  if (s.includes("loaned in")) return "loaned_in";
  return "active";
}

// per-resource consumption by class. 1 = consumes/charges, 0 = relieved.
export const CONSUMES = {
  active:     { senior: 1, dp: 1, u22: 1, intl: 1 },
  loaned_in:  { senior: 1, dp: 1, u22: 1, intl: 0 }, // occupies senior/designation; intl stays with parent club
  loaned_out: { senior: 0, dp: 0, u22: 0, intl: 0 }, // qualifying season loan: full relief
  sei:        { senior: 0, dp: 0, u22: 0, intl: 0 }, // season-ending injury: full relief
  injured:    { senior: 0, dp: 0, u22: 0, intl: 0 }, // injured/unavailable list: full relief
  off_roster: { senior: 0, dp: 0, u22: 0, intl: 0 }, // not on the active roster
  pending:    { senior: 0, dp: 0, u22: 0, intl: 0 }, // future-effective entry
};

// resource in {senior, dp, u22, intl}. A player-level `consumes` override wins.
export function consumesResource(p, resource) {
  if (p.consumes && p.consumes[resource] != null) return !!p.consumes[resource];
  const row = CONSUMES[availability(p)] || CONSUMES.active;
  return !!row[resource];
}
export function onActiveRoster(p) {
  const a = availability(p);
  return a === "active" || a === "loaned_in";
}
// Back-compat alias used by trade evaluation (incoming budget loop).
export function consumesActiveSlot(p) { return onActiveRoster(p); }

export function countsSenior(p) { return p.roster_category === "Senior" && consumesResource(p, "senior"); }
export function countsDP(p)     { return !!p.is_dp  && consumesResource(p, "dp"); }
export function countsU22(p)    { return !!p.is_u22 && consumesResource(p, "u22"); }
// International charge: international, not Canadian-exempt, and consuming the intl resource.
export function chargesIntlSlot(p) { return !!p.is_intl && !p.intl_exempt && consumesResource(p, "intl"); }

export function leagueYearAge(p) {
  if (p.dob) { const y = parseInt(String(p.dob).slice(0, 4)); if (y) return LEAGUE_YEAR - y; }
  return p.age ?? null;
}
export function joinedAfterSecondaryWindow(p) {
  return p.date_joined && String(p.date_joined) >= SECONDARY_WINDOW_OPEN;
}

// Salary Budget Charge by designation + league-year age + join timing (Young-DP rule).
export function budgetCharge(p, C) {
  const age = leagueYearAge(p);
  if (p.is_dp) {
    if (joinedAfterSecondaryWindow(p)) return (age != null && age <= 23) ? C.ydp_20_charge : C.mid_season_dp_charge;
    if (age != null && age <= 20) return C.ydp_20_charge;
    if (age != null && age <= 23) return C.ydp_21_23_charge;
    return C.max_budget_charge;
  }
  if (p.is_u22) return (age != null && age <= 20) ? C.u22_20_charge : C.u22_21_25_charge;
  if (p.roster_category !== "Senior") return 0;
  if (p.salary_guar == null) return null;
  return Math.min(p.salary_guar, C.max_budget_charge);
}

export function clubLimits(club, C) {
  return {
    dpMax:  club.model === "U22" ? C.dp_max_u22model  : C.dp_max_dpmodel,
    u22Max: club.model === "U22" ? C.u22_max_u22model : C.u22_max_dpmodel,
    intlOwned: club.intl_owned,
  };
}

// THE ONE counting function.
export function rosterState(teamName, data) {
  const C = data.meta.constants;
  const club = data.clubs[teamName];
  const roster = data.players.filter((p) => p.team === teamName);
  const dpCount  = roster.filter(countsDP).length;
  const u22Count = roster.filter(countsU22).length;
  const tamCount = roster.filter((p) => p.is_tam && onActiveRoster(p)).length;
  const intlCharged = roster.filter(chargesIntlSlot).length; // excludes Canadian-exempt + relieved
  const intlExemptActive = roster.filter((p) => p.is_intl && p.intl_exempt && onActiveRoster(p)).length;
  const seniorCount = roster.filter(countsSenior).length;
  const { dpMax, u22Max, intlOwned } = clubLimits(club, C);
  return {
    team: teamName, model: club.model, gam: club.gam,
    dpCount, dpMax, u22Count, u22Max, tamCount,
    intlCharged, intlExemption: intlExemptActive, intlEffective: intlCharged, intlOwned,
    seniorCount, seniorMax: C.senior_roster_max, budgetCap: C.salary_budget,
  };
}

export function validateRoster(teamName, data) {
  const s = rosterState(teamName, data);
  const violations = [];
  if (s.dpCount > s.dpMax)            violations.push(`DP ${s.dpCount}/${s.dpMax}`);
  if (s.u22Count > s.u22Max)          violations.push(`U22 ${s.u22Count}/${s.u22Max}`);
  if (s.intlEffective > s.intlOwned)  violations.push(`Intl ${s.intlEffective}/${s.intlOwned}`);
  if (s.seniorCount > s.seniorMax)    violations.push(`Senior ${s.seniorCount}/${s.seniorMax}`);
  return { team: teamName, ok: violations.length === 0, violations, state: s };
}

export function maxGamBuydown(charge) { const floor = Math.min(0.5 * charge, 150000); return Math.max(0, charge - floor); }

// Tradability — the second-season restriction applies only to DP and U22 players.
export function playerTradable(player, sendingState = {}) {
  const blockers = [], unverified = [];
  if ((player.is_dp || player.is_u22) && player.first_year_mls)
    blockers.push(`${player.name} is a ${player.is_dp ? "DP" : "U22"} player in his first MLS season — DP and U22 players are only trade-eligible from their second MLS season.`);
  if (player.is_dp) {
    if (sendingState.dpTradesUsed != null) { if (sendingState.dpTradesUsed >= 1) blockers.push(`Sending club already used its 1 DP trade this year.`); }
    else unverified.push(`DP annual trade limit (1/club/year) — sending club's usage not supplied.`);
  }
  if (player.is_u22) {
    if (sendingState.u22TradesUsed != null) { if (sendingState.u22TradesUsed >= 1) blockers.push(`Sending club already used its 1 U22 trade this year.`); }
    else unverified.push(`U22 annual trade limit (1/club/year) — sending club's usage not supplied.`);
  }
  return { tradable: blockers.length === 0, blockers, unverified };
}

// Resolve a player reference. Prefers stable player_id; falls back to (name, team) for legacy deals.
export function findPlayer(data, ref, team) {
  if (ref && typeof ref === "object") {
    if (ref.player_id) return data.players.find((p) => p.player_id === ref.player_id);
    return data.players.find((p) => p.name === ref.name && p.team === team);
  }
  return data.players.find((p) => p.player_id === ref) || data.players.find((p) => p.name === ref && p.team === team);
}

// ---- ONE state transformation. Pure: deep-copies, never mutates input. ----
// Portable attributes travel with the player; club-specific budget treatment (is_tam) and the
// Canadian exemption (intl_exempt) do NOT — the acquiring club applies its own.
export function applyTradeToData(scenario, deal) {
  const next = clone(scenario);
  if (!next.tradeCounts) next.tradeCounts = {};
  if (!next.history) next.history = [];
  const move = (fromTeam, toTeam, refs) => {
    for (const ref of refs || []) {
      const p = findPlayer(next, ref, fromTeam);
      if (!p || p.team !== fromTeam) continue;
      p.team = toTeam;
      if (p.is_tam) { p.is_tam = false; p._tamCleared = true; }
      if (p.intl_exempt) { p.intl_exempt = false; } // Canadian exemption is club-specific
    }
  };
  move(deal.teamA, deal.teamB, deal.aSends.players);
  move(deal.teamB, deal.teamA, deal.bSends.players);
  next.clubs[deal.teamA].gam += (deal.bSends.gam || 0) - (deal.aSends.gam || 0);
  next.clubs[deal.teamB].gam += (deal.aSends.gam || 0) - (deal.bSends.gam || 0);
  next.clubs[deal.teamA].intl_owned += (deal.bSends.intlSlots || 0) - (deal.aSends.intlSlots || 0);
  next.clubs[deal.teamB].intl_owned += (deal.aSends.intlSlots || 0) - (deal.bSends.intlSlots || 0);
  const bump = (team, refs, srcTeam) => {
    const tc = next.tradeCounts[team]; if (!tc) return;
    for (const ref of refs || []) {
      const p = findPlayer(scenario, ref, srcTeam); if (!p) continue;
      if (p.is_dp  && tc.dpTradesUsed  != null) tc.dpTradesUsed  += 1;
      if (p.is_u22 && tc.u22TradesUsed != null) tc.u22TradesUsed += 1;
    }
  };
  bump(deal.teamA, deal.aSends.players, deal.teamA);
  bump(deal.teamB, deal.bSends.players, deal.teamB);
  return next;
}

// ---- evaluate a trade. After-state comes from applying to a TEMP copy and counting it,
// so it is byte-for-byte what commit will produce. ----
export function evaluateTrade(deal, data) {
  const C = data.meta.constants;
  const aSendP = (deal.aSends.players || []).map((r) => findPlayer(data, r, deal.teamA)).filter(Boolean);
  const bSendP = (deal.bSends.players || []).map((r) => findPlayer(data, r, deal.teamB)).filter(Boolean);
  const blockers = [], unverified = [], notes = [];

  if (deal.teamA === deal.teamB) blockers.push([null, "A club cannot trade with itself — pick two different clubs."]);
  if (deal.aSends.tam || deal.bSends.tam) blockers.push([null, "TAM cannot be traded (rulebook). Remove TAM from the deal."]);

  for (const p of aSendP) { const t = playerTradable(p, deal.aState || {});
    t.blockers.forEach((b) => blockers.push([deal.teamA, b])); t.unverified.forEach((u) => unverified.push([deal.teamA, u])); }
  for (const p of bSendP) { const t = playerTradable(p, deal.bState || {});
    t.blockers.forEach((b) => blockers.push([deal.teamB, b])); t.unverified.forEach((u) => unverified.push([deal.teamB, u])); }

  const before = { [deal.teamA]: rosterState(deal.teamA, data), [deal.teamB]: rosterState(deal.teamB, data) };
  const temp = applyTradeToData(data, deal);
  const after = { [deal.teamA]: rosterState(deal.teamA, temp), [deal.teamB]: rosterState(deal.teamB, temp) };

  if (deal.teamA !== deal.teamB) for (const team of [deal.teamA, deal.teamB]) {
    const a = after[team];
    if (a.dpCount > a.dpMax)           blockers.push([team, `DP would be ${a.dpCount}/${a.dpMax} (${a.model} model) — needs an open DP slot or a buy-down.`]);
    if (a.u22Count > a.u22Max)         blockers.push([team, `U22 would be ${a.u22Count}/${a.u22Max} (${a.model} model).`]);
    if (a.intlEffective > a.intlOwned) blockers.push([team, `International would be ${a.intlEffective}/${a.intlOwned} — deal must include ${a.intlEffective - a.intlOwned} more international slot(s) or free one.`]);
    if (a.seniorCount > a.seniorMax)   blockers.push([team, `Senior roster would be ${a.seniorCount}/${a.seniorMax} — must open a senior slot.`]);
    if (a.gam < 0)                     blockers.push([team, `Would have negative GAM ($${a.gam.toLocaleString()}).`]);
  }

  const incoming = { [deal.teamA]: bSendP, [deal.teamB]: aSendP };
  for (const team of [deal.teamA, deal.teamB]) {
    for (const p0 of incoming[team]) {
      if (!consumesActiveSlot(p0)) continue;
      const p = { ...p0, is_tam: false };
      const onBudget = p.roster_category === "Senior" || p.is_dp;
      if (!onBudget) continue;
      const charge = budgetCharge(p, C);
      if (charge == null) { unverified.push([team, `${p.name}: no April salary on file — budget impact can't be verified.`]); continue; }
      if (p.is_dp) {
        const label = charge < C.max_budget_charge ? "Young DP" : "DP";
        notes.push([team, `${p.name} (${label}): budget charge $${charge.toLocaleString()}${label === "DP" ? " (comp above that is out-of-pocket)" : ""}.`]);
      } else if (p0.is_tam || (p.salary_guar != null && p.salary_guar > C.max_budget_charge)) {
        notes.push([team, `${p.name}: charge $${charge.toLocaleString()} (over the max; prior club used TAM — acquiring club must apply its own TAM/GAM).`]);
      } else {
        const bd = maxGamBuydown(charge);
        notes.push([team, `${p.name} (budget): charge $${charge.toLocaleString()}, buyable down to $${(charge - bd).toLocaleString()} with GAM.`]);
      }
    }
  }

  const status = blockers.length ? "blocked" : unverified.length ? "unverified" : "legal";
  return {
    status, legal: status === "legal", blockers, unverified, notes, before, after,
    gam: { [deal.teamA]: { before: before[deal.teamA].gam, after: after[deal.teamA].gam },
           [deal.teamB]: { before: before[deal.teamB].gam, after: after[deal.teamB].gam } },
    windowNote: data.meta.transfer_windows_2026?.note,
  };
}

// ---- Layer 2 scenario state ----
export function newScenario(data, tradeCounts = {}) {
  const s = clone(data);
  s.tradeCounts = {};
  for (const t of Object.keys(s.clubs)) s.tradeCounts[t] = tradeCounts[t] ? { ...tradeCounts[t] } : { dpTradesUsed: null, u22TradesUsed: null };
  s.history = [];
  s.base_version = data.meta?.state_version || data.meta?.data_through || null;
  return s;
}
export function evaluateInScenario(scenario, deal) {
  return evaluateTrade({ ...deal, aState: scenario.tradeCounts[deal.teamA], bState: scenario.tradeCounts[deal.teamB] }, scenario);
}
export function applyTrade(scenario, deal, { force = false } = {}) {
  const res = evaluateInScenario(scenario, deal);
  if (res.status === "blocked") return { ok: false, reason: "blocked", result: res, scenario };
  if (res.status === "unverified" && !force) return { ok: false, reason: "unverified", result: res, scenario };
  const next = applyTradeToData(scenario, deal);
  next.history.push({ deal, resultStatus: res.status });
  return { ok: true, result: res, scenario: next };
}

// ---- Scenario replay / revalidation against an advanced current state ----
// Re-applies a saved scenario's committed moves onto fresh data, flagging any move whose
// players are no longer where the scenario expected (instead of silently skipping them).
export function replayScenario(freshData, savedHistory) {
  let state = newScenario(freshData);
  const conflicts = [];
  for (let i = 0; i < (savedHistory || []).length; i++) {
    const { deal } = savedHistory[i];
    const check = (refs, team) => (refs || []).filter((ref) => {
      const p = findPlayer(state, ref, team);
      return !p || p.team !== team;
    });
    const missA = check(deal.aSends?.players, deal.teamA);
    const missB = check(deal.bSends?.players, deal.teamB);
    if (missA.length || missB.length) {
      conflicts.push({ step: i, deal, missing: { [deal.teamA]: missA, [deal.teamB]: missB } });
      continue; // do not apply a move whose premises no longer hold
    }
    const out = applyTrade(state, deal, { force: true });
    state = out.scenario;
  }
  return { state, conflicts, ok: conflicts.length === 0 };
}

// MLS Trade Simulator — compliance engine
// Extracted VERBATIM from public/index.html (the running app). Pure functions, no DOM.
// The regression test (tests/engine.test.mjs) proves this module reproduces the app's
// verdicts exactly, which is the guard against this copy drifting from the app.

export const CANADIAN = new Set(["Toronto FC", "CF Montréal", "Vancouver Whitecaps FC"]);
export const CANADIAN_EXEMPTION = 3;
export const LEAGUE_YEAR = 2026;

export function isUnavailable(p) {
  const s = (p.status || "").toLowerCase();
  return s.includes("loaned out") || s.includes("loaned in") ||
         s.includes("season ending") || s.includes("injur") || s.includes("unavailable");
}
export function consumesActiveSlot(p) { return !isUnavailable(p); }
export function chargesIntlSlot(p)   { return p.is_intl && !isUnavailable(p); }
export function clubLimits(club, C) {
  return {
    dpMax:  club.model === "U22" ? C.dp_max_u22model  : C.dp_max_dpmodel,
    u22Max: club.model === "U22" ? C.u22_max_u22model : C.u22_max_dpmodel,
    intlOwned: club.intl_owned,
  };
}
export function rosterState(teamName, data) {
  const C = data.meta.constants;
  const club = data.clubs[teamName];
  const roster = data.players.filter(p => p.team === teamName);
  const active = roster.filter(consumesActiveSlot);
  const dpCount  = active.filter(p => p.is_dp).length;
  const u22Count = active.filter(p => p.is_u22).length;
  const tamCount = active.filter(p => p.is_tam).length;
  const intlCharged = roster.filter(chargesIntlSlot).length;
  const exemption = CANADIAN.has(teamName) ? CANADIAN_EXEMPTION : 0;
  const intlEffective = Math.max(0, intlCharged - exemption);
  const seniorCount = active.filter(p => p.roster_category === "Senior").length;
  const { dpMax, u22Max, intlOwned } = clubLimits(club, C);
  return { team: teamName, model: club.model, gam: club.gam,
    dpCount, dpMax, u22Count, u22Max, tamCount,
    intlCharged, intlExemption: exemption, intlEffective, intlOwned,
    seniorCount, seniorMax: C.senior_roster_max, budgetCap: C.salary_budget };
}
export function validateRoster(teamName, data) {
  const s = rosterState(teamName, data);
  const violations = [];
  if (s.dpCount > s.dpMax)   violations.push(`DP ${s.dpCount}/${s.dpMax}`);
  if (s.u22Count > s.u22Max) violations.push(`U22 ${s.u22Count}/${s.u22Max}`);
  if (s.intlEffective > s.intlOwned) violations.push(`Intl ${s.intlEffective}/${s.intlOwned}`);
  if (s.seniorCount > s.seniorMax)   violations.push(`Senior ${s.seniorCount}/${s.seniorMax}`);
  return { team: teamName, ok: violations.length === 0, violations, state: s };
}

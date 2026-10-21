// MLS Trade Simulator — data integrity guardrail (read-only reconciliation)
// Extracted VERBATIM from public/index.html. Compares player-derived consumption against
// the club summary and watches owned international slots for unexplained drift. Never rewrites.

import { rosterState, chargesIntlSlot } from './engine.mjs';

export function isPending(p){ return !!p.pending_effective; }
export function reconcile(data){
  const C = data.meta.constants;
  const baseline = data.meta.intl_owned_baseline || {};
  const flags = [];
  const intlTable = [];
  Object.keys(data.clubs).forEach(team=>{
    const club = data.clubs[team];
    const roster = data.players.filter(p=>p.team===team && !isPending(p));
    const dpTagged  = roster.filter(p=>p.is_dp).map(p=>p.name);
    const u22Tagged = roster.filter(p=>p.is_u22).map(p=>p.name);
    const s = rosterState(team, data);
    if(dpTagged.length !== club.dp_listed)
      flags.push({team, kind:"DP designation", sev:"review",
        detail:`Player list tags ${dpTagged.length} DP; club summary lists ${club.dp_listed}.`, players:dpTagged});
    if(u22Tagged.length !== club.u22_listed)
      flags.push({team, kind:"U22 designation", sev:"review",
        detail:`Player list tags ${u22Tagged.length} U22; club summary lists ${club.u22_listed}.`, players:u22Tagged});
    if(s.intlEffective > s.intlOwned)
      flags.push({team, kind:"Intl capacity", sev:"breach",
        detail:`Consumes ${s.intlEffective} international slots; owns ${s.intlOwned}.`, players:roster.filter(chargesIntlSlot).map(p=>p.name)});
    if(s.seniorCount > C.senior_roster_max)
      flags.push({team, kind:"Senior roster", sev:"breach",
        detail:`${s.seniorCount} active senior players; max ${C.senior_roster_max}.`, players:[]});
    const base = baseline[team];
    const hasBase = (base !== undefined);
    const drift = hasBase && (club.intl_owned !== base);
    if(drift)
      flags.push({team, kind:"Intl slots owned", sev:"review",
        detail:`intl_owned is ${club.intl_owned}; baseline of record is ${base}. A change must be backed by a logged slot transaction.`, players:[]});
    intlTable.push({team, owned:club.intl_owned, base: hasBase?base:"—", consumed:s.intlEffective, drift});
  });
  intlTable.sort((a,b)=> a.team<b.team?-1:1);
  return { flags, intlTable, asof:data.meta.intl_owned_baseline_asof||"", through:data.meta.data_through_display||"" };
}

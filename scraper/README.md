# Assisted transaction-ingestion pipeline (planned, not built)

An assisted pipeline, not a bot that writes directly into the roster dataset.

## Flow

```
discover candidates -> dedupe -> pick strongest source -> extract to strict event schema
  -> assign verdict {verified | needs_review | non_state_event}
  -> state-consistency pre-check -> append verified events to transactions.json
  -> replay onto base-snapshot -> current-state.json  (advances the data-through date)
```

## Sources (discovery)

- Spotrac (broad discovery)
- MLS Transfer Tracker / All Transfers
- Official club announcements
- Relevant MLS NEXT Pro sources
- Official social announcements

## Rules

- Never guess missing state. Unknown GAM, international-slot terms, roster designation,
  loan duration, or effective date stays unknown and routes to `needs_review`.
- Dedup the same move across sources; keep the strongest official source.
- `non_state_event` for MLS NEXT Pro-only moves, short-term agreements, and anything
  that does not change first-team roster construction.
- State-consistency pre-check: if an event says a player is leaving club X but current
  state has them at club Y, flag a probable missing earlier event rather than applying.
- Human review only for the small set of ambiguous events.

## Cadence (target)

- Discovery several times per day.
- Broader nightly reconciliation against the major transaction sources.
- Periodic comparison of computed rosters against official MLS club rosters.

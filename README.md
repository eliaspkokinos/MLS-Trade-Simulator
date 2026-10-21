# MLS Trade Simulator

A roster compliance and trade simulator for MLS 2026 roster rules. Private tool.
The running app is the single self-contained page in `public/index.html`.

## Repository layout

```
public/index.html         Deployable app (self-contained). Netlify serves this.
data/
  base-snapshot.json      Immutable base snapshot (genesis, 2026-10-20). Frozen.
  transactions.json       Append-only log of real transactions (the provenance record).
  current-state.json      Canonical current state = base + replay(post-genesis events).
  crest-manifest.json     30-club crest URL mapping (presentation assets).
engine/
  engine.mjs              Compliance rules engine (pure). Extracted verbatim from the app.
  reconcile.mjs           Data-integrity guardrail (read-only reconciliation).
tests/
  engine.test.mjs         Regression test: proves the modules reproduce the app's results.
scraper/
  README.md               Plan for the assisted transaction-ingestion pipeline (not built yet).
docs/
  changelog-2026-10-20-sweep.md   Provenance for the Sept 21 to Oct 20 sweep.
```

User scenarios (Layer 2) are per-viewer state held in the browser. They are deliberately
NOT versioned here.

## Data architecture

```
immutable base snapshot  ->  discovered candidates  ->  verified transaction events
   ->  append-only real transaction log  ->  canonical current state
   ->  (Layer 2) hypothetical scenario transactions, never written to Git
```

At genesis the base snapshot and the current state are identical; every transaction
through 2026-10-20 is already applied in the base, with `transactions.json` as the
provenance record. From here, base stays frozen and new verified events append to the
log and are replayed onto the base to produce the current state.

Today `public/index.html` embeds its own copy of the dataset and engine. The `data/`
and `engine/` files are the extracted canonical sources; the ingestion pipeline will
make them authoritative and rebuild `index.html` from them. The regression test guards
against the embedded copy and the extracted modules drifting apart.

## Compliance and integrity

- The engine validates DP, U22, senior-roster and international consumption against each
  club's model, with relief for loaned and injured players.
- The integrity guardrail recomputes consumption from player-level state and compares it
  to the club summary, and it watches owned international slots for unexplained change.
  It flags; it never rewrites either side.
- `intl_owned` is a club asset balance, not derived from the player list. The check is
  `consumed <= owned` plus drift detection against the baseline of record.

### Provisional values

Colorado Rapids (11) and St. Louis CITY SC (7) owned-slot values are marked
`needs_verification` in `base-snapshot.json`. They are used provisionally so development
can continue, and must be reconciled against actual slot-trade history before being
treated as hardened truth.

## Develop

```
npm test        # runs the engine/reconcile regression test (no deps)
```

## Deploy (Netlify)

Static site, no build. Netlify publishes `public/`. Connect this repository to the
Netlify site and every push to `main` auto-deploys. Crests load from absolute CDN URLs,
so there is no post-deploy asset step; anything that fails to load falls back to the
club's initials.

## Data vintage

The app shows "Data through <date>" driven by `meta.data_through_display` /
`meta.transactions_through` in the dataset. When the ingestion pipeline applies newer
verified transactions, that date advances from the metadata automatically.

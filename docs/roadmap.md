# Build roadmap

This roadmap starts after the local VS Code debug-log import and `state.vscdb` enrichment are in place.

## Current foundation

The ledger now has three separate responsibilities:

- Debug logs are the pricing source because `llm_request` rows carry model ids and token totals.
- `state.vscdb` is the metadata enrichment source because it carries stable VS Code titles, labels, location, permission level, pending-edit state, and read state.
- The Angular app renders `public/data/sessions.json` and does not parse VS Code internals directly.

Why: keeping these concerns separate makes each number explainable. The app can show friendly titles from VS Code state without accidentally trusting UI state as a billing source.

## Next phase: tokenizer adapter

The next implementation step should be a tokenizer adapter interface for fallback imports.

Build:

- `scripts/token-estimator.mjs` or equivalent module used by the scanner
- a default heuristic adapter matching the current `max(words * 1.35, characters / 4)` behavior
- a contract that allows replacing the heuristic with a model-aware tokenizer later
- verifier checks that estimated sessions declare which adapter produced their numbers

Why this is next: debug-log sessions are already strong, but chat snapshot fallbacks still rely on a rough heuristic. Before importing more data sources, the estimate path needs to say exactly which estimator produced the tokens and how much confidence the UI should assign to it.

## Then: billing reconciliation import

After fallback token estimation is explicit, add GitHub billing report import.

Build:

- importer for exported Copilot usage/billing rows
- daily/provider/model aggregation
- reconciliation fields beside local estimates, not overwriting them
- UI that shows local estimate, billed value, delta, and unmatched rows

Why: local debug logs explain what happened in a session; billing reports explain what GitHub charged. They are related but not identical because cache accounting and provider-side adjustments are not present in the local debug logs.

## Then: experiment labels and run pairing

Once local estimates and billed rows can coexist, add explicit experiment grouping.

Build:

- labels like `mcp-on`, `mcp-off`, `baseline`, `retry`, and `model-swap`
- run-pair metadata stored outside the generated VS Code import
- comparison views grouped by label and workspace
- filters for model, time window, confidence, and billing reconciliation status

Why: comparison only becomes trustworthy when the app knows which sessions are intended to be compared. Manual labels keep this practical without pretending the app can infer experiment intent from prompts alone.

## Then: app-owned SQLite

Add an app-owned database after the import contract is stable.

Build:

- immutable scan records
- user labels and comparison groups
- billing reconciliation imports
- notes and decisions tied to session ids

Why this is intentionally later: VS Code `state.vscdb` is external editor state, not application storage. The app should not write to it. An app-owned SQLite database becomes useful once there is state worth preserving across scans, especially labels, billing imports, and comparisons.

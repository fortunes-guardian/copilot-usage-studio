# Build Roadmap

This roadmap follows `docs/intent.md`: the product is a local developer cost debugger, not a generic billing clone.

## Current Foundation

The app has three core inputs:

- VS Code Copilot debug logs for session token totals and model ids.
- VS Code `state.vscdb` for friendlier titles, labels, restored-session metadata, and UI state.
- GitHub's published Copilot model pricing table for per-token price rows.

Why: those sources answer different questions. Debug logs explain what happened in a local agent run. `state.vscdb` makes sessions recognizable to a human. GitHub pricing explains the rate card used to turn tokens into money.

## Phase 1: Explainable Session Cost

Status: in progress.

Build:

- Show the selected session's token totals, model breakdown, and estimated cost.
- Show the exact GitHub price row used for each model.
- Store structured model, pricing row, token total, and estimated cost on each token-bearing trace event.
- Add selected-run cost driver diagnosis: input context burn, largest model call, context growth, model mix, and tool activity.
- Add source-confidence tooltips for ingestion, source, confidence, cache, and cost terms.
- Mark whether a pricing row is actually used by the imported ledger.
- Keep local estimates separate from final GitHub billing.

Why: the first valuable workflow is "why did this run cost what it cost?" The user should be able to inspect the rate card, token totals, and session metadata in one place.

## Phase 2: Better Comparison

Build:

- Side-by-side session comparison with input/output/cached/cache-write token deltas.
- Highlight model switches and price-row changes.
- Add simple size categories for sessions: small, medium, large, and very large.
- Add filters for model, workspace, source quality, and time window.

Why: cost debugging becomes useful when a developer can test whether a prompt, model, MCP setup, or workflow change increased or reduced token burn.

## Phase 3: Source Confidence And Limitations

Build:

- Make unsupported or lower-confidence sources obvious in the UI.
- Prefer debug-log sessions for cost-grade estimates.
- Keep chat snapshots visible only when they help explain session context.
- Add warnings when imported data lacks model ids or token totals.

Why: a polished cost debugger must not blur strong local token totals with weaker visible-text estimates. Transparency matters more than making every possible source look equally valid.

## Phase 4: App-Owned SQLite

Build:

- Immutable scan history.
- User labels and comparison groups.
- Notes tied to session ids.
- Stored pricing table snapshots.
- Optional future price scenarios.

Why: VS Code `state.vscdb` is external editor state and should stay read-only enrichment. App-owned SQLite becomes useful once the app has its own durable state: labels, chosen comparisons, historical scans, notes, and editable future pricing scenarios.

## Phase 5: Billing Reconciliation

Build:

- Import GitHub billing or usage exports.
- Match billed rows to local sessions where possible.
- Show local estimate, billed amount, and delta without overwriting either source.
- Explain unmatched rows.

Why: local debug logs estimate a session from local token totals. GitHub billing is the authority for what was charged. Reconciliation is valuable, but it should come after local estimates are explainable.

## Later Style Rework

The UI should stay dense and operational, closer to a debugger than a marketing dashboard. A later style pass should improve hierarchy, spacing, and empty states without hiding the raw facts.

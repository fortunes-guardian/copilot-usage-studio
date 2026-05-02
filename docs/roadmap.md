# Roadmap

First make one selected run excellent, then make comparisons useful.

## Phase 1: Selected Run Cost Debugger

Status: mostly built.

Done:

- Import VS Code Copilot debug logs.
- Enrich session labels from `state.vscdb`.
- Show GitHub price rows used by the estimator.
- Store structured model, pricing row, token total, and estimated cost on token-bearing trace events.
- Show cost drivers: input burn, largest model call, context growth, model mix, and tool activity.
- Add source-confidence help for ingest, source, confidence, cache, and cost terms.
- Show logs and agent flow chart with token/cost detail.
- Add session size and cost-signal labels.
- Add session filters for size, source quality, and cost signal.

Next:

- Replace native title tooltips with a small custom help popover if the native behavior feels too hidden.

Why: the core workflow is “I ran an agent, why was this expensive?” The selected run has to be readable before comparison gets deeper.

## Phase 2: Session Labels And Triage

Status: started.

Done:

- Session size labels: `Small`, `Medium`, `Large`, `Very large`.
- Cost-signal labels: `High input context`, `Context growth`, `Mixed models`, `Cache unknown`, `State enriched`.
- Filters for size, cost signal, and source quality.
- Better session-list scanning: cost, model, size, source quality, and tokens.

Build:

- Filters for workspace, model, and time window.

Why: a developer should spot suspicious runs before opening each one.

## Phase 3: Better Comparison

Build:

- Side-by-side selected-run comparison.
- Explain what changed: cost, input tokens, output tokens, model mix, tool count, context growth.
- Highlight model switches and price-row changes.
- Show “winner/loser” language carefully: cheaper is not always better if the run failed.

Why: comparison is useful when testing prompts, models, MCP setup, or workflow changes.

## Phase 4: UX And Style Rework

Build:

- Cleaner visual hierarchy.
- More compact data ingest section.
- Better responsive tables.
- Proper help popovers.
- More debugger-like polish.

Why: the app has complex information. Better style should reduce cognitive load, not hide details.

## Phase 5: App-Owned SQLite

Build:

- Immutable scan history.
- User labels and comparison groups.
- Notes tied to session ids.
- Stored pricing table snapshots.
- Optional future price scenarios.

Why: VS Code `state.vscdb` is external editor state and should stay read-only enrichment. App-owned SQLite becomes useful once the app has durable user state.

## Phase 6: Billing Reconciliation

Status: later, not the current focus.

Build:

- Import GitHub billing or usage exports.
- Match billed rows to local sessions where possible.
- Show local estimate, billed amount, and delta without overwriting either source.
- Explain unmatched rows.

Why: GitHub billing is authoritative for what was charged, but reconciliation should come after local session estimates are easy to understand.

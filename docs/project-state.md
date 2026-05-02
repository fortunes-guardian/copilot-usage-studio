# Project State

Start here when resuming the project.

## What We Are Building

A local-first cost debugger for VS Code GitHub Copilot chat and agent sessions.

The app should help a developer answer:

- Which run was expensive?
- Which model, token category, or model call caused the cost?
- Can I compare two runs and see whether a prompt/workflow change helped?
- What is normal across all imported runs, and which sessions are outliers?

This is not trying to be a full billing dashboard yet. Billing reconciliation can come later. The first product should make one selected run excellent and understandable.

Principles:

- One run excellent first.
- Transparency over magic.
- Local-first data.
- Debug logs are preferred for cost.
- VS Code SQLite is enrichment, not pricing.
- Human labels beat raw internal strings in the UI.

## What Works Now

- Scans local VS Code Copilot debug logs.
- Enriches sessions from VS Code `state.vscdb` for better titles and metadata.
- Generates `public/data/sessions.json` as the app contract.
- Shows sessions, source metadata, summary metrics, and trace logs.
- Filters sessions by size, source quality, and cost-debugging signal.
- Shows a GitHub prices page with the pricing rows used by estimates.
- Calculates cost from imported token counts and GitHub model prices.
- Shows a selected-run Cost debugger with:
  - source/confidence explanation
  - estimate-scope note for missing cache billing fields
  - run size and cost-signal labels
  - cost driver cards
  - token category totals
  - per-model pricing rows
  - largest model calls
- Shows an agent flow chart with token/cost detail.
- Compares two runs with metric deltas, cost-driver explanation, context-growth change, and model/pricing-row movement.
- Shows a separate Analytics view for multi-session questions across the current filter set:
  - time range, workspace, model, and day/week/month grouping controls
  - totals and averages
  - highest-token and most expensive sessions
  - model breakdown
  - trend rows
  - size distribution
  - clearer empty states when cohort controls exclude all sessions
  - outlier signals with first-pass "why high cost?" explanations

## Important Design Decisions

- Debug logs are the preferred cost source because they include model ids plus input/output token counts.
- Chat snapshots are weaker and should not be treated as equal to debug logs for cost.
- `state.vscdb` is metadata enrichment only. It improves labels and restored-session details; it does not drive pricing.
- Cache billing is not visible in the local debug logs observed so far. Do not present zero cache fields as proof of zero provider-side cache billing.
- The UI should explain local estimates clearly instead of pretending they are GitHub invoice numbers.
- The generated ledger should carry structured cost facts. The UI should not parse model/cost data out of display strings.
- Run size and cost-signal labels are derived UI triage. They should help scanning, but they should not silently become billing facts.
- Multi-session analytics are deliberately separate from the selected-run debugger. The analytics view answers "what is normal across included sessions?" while the Sessions view answers "why did this one run cost what it cost?"
- Analytics start from the current sidebar filters, then apply Analytics-specific cohort controls. This keeps global search/source/quality filtering consistent while making time range, workspace, model, and trend grouping visible on the dashboard itself.

## Current Rough Edges

- The UI is functional but visually busy.
- Tooltips are better, but still use native browser title behavior.
- Aggregated analytics are useful but still early. Outlier detection is a simple statistical signal with driver hints; it now separates a few obvious cases such as long agent runs and suspicious low-activity spikes, but it should become more nuanced as more real sessions are imported.
- Advanced evidence is imported but mostly hidden from the primary UI. Reasoning text presence and request-cap comparison were too technical to be useful as top-level cards. Compaction is shown only as a concise run-triage marker when there is countable evidence.
- No app-owned database yet. Scans overwrite `public/data/sessions.json`.
- Pricing tables are duplicated across UI/scanner/verifier and should eventually have one source of truth.

## Latest Implemented Step

Pruned weak advanced evidence from the primary selected-run view:

- Removed the Advanced Evidence card section from the UI.
- Removed `Reasoning visible`, `Reasoning evidence`, `Reasoning level`, and `Request cap pressure` from visible triage.
- Kept compaction only as `Compacted 1 time` / `Compacted N times` when the scanner has explicit marker or strong token-reset evidence.
- Kept the raw `advancedSignals` data contract so future sessions can still be investigated without showing weak signals prematurely.

Why: the selected-run debugger should answer "why was this expensive?" directly. Reasoning-text counts and request-cap percentages were technically careful, but not useful enough for the main product surface.

`Context growth` is expected in many agent runs. It is shown because accumulated context can explain rising token cost, not because growth is automatically a bug.

Current size thresholds:

- `Small`: under `50k` imported tokens
- `Medium`: `50k` to under `200k`
- `Large`: `200k` to under `600k`
- `Very large`: `600k` or more

## Next Best Step

Build a proper per-turn cost breakdown.

Build:

- Replace or expand `Largest model calls` with an ordered model-call ledger.
- Show turn index, timestamp, model, pricing row, input tokens, output tokens, estimated cost, and share of session cost.
- Keep the largest-call sort as a toggle or secondary view.
- Add enough nearby event detail to explain what each expensive call was doing without dumping raw logs.

Why this next: session totals say a run was expensive. Per-turn costs show where it became expensive, which is the sharper debugging answer for "what burned the tokens?"

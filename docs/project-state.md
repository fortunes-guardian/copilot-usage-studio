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
- Uses one shared GitHub pricing JSON file for the scanner, verifier, and UI.
- Shows a visible loading/error state if the generated ledger data cannot be loaded.
- Shows a selected-run Cost debugger with:
  - source/confidence explanation
  - estimate-scope note for missing cache billing fields
  - a primary-driver answer for the current estimate
  - run size and cost-signal labels
  - cost driver cards
  - token category totals
  - per-model pricing rows
- Splits the selected run into subviews:
  - `Overview`: summary, details, and triage
  - `Cost`: estimate scope, drivers, token categories, and per-model price rows
  - `Turns`: per-turn model-call insights plus timeline/largest-first ledger modes
  - `Trace`: filterable raw logs, clickable event inspector, and agent flow
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
- Started the Midnight Ledger UI overhaul:
  - top-level app bar with Sessions, Compare, Analytics, and Prices
  - Compare promoted out of the selected-session stack
  - selected-run content stays primary on narrow screens, with the session rail moving below it
  - dark diagnostic design tokens for panels, tables, badges, and cost signals
  - selected-run hierarchy now uses Overview, Cost, Turns, and Trace instead of one stacked report
  - fallback pricing assumptions are now visible in the selected-run header, Cost table, Turns ledger, Compare, Analytics, and Prices page
  - sidebar filters now show a clear state when the open run is outside the visible filtered rail

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
- The UI overhaul is starting with custom Angular/CSS rather than a component library. The app needs tight control over dense diagnostic layout, tables, and cost explanations before it needs generic widgets.
- The selected run remains the primary object on narrow screens. The session rail is useful navigation, but it should not hide the current debugging surface.

## Current Rough Edges

- The UI is functional but visually busy.
- Tooltips are better, but still use native browser title behavior.
- The Trace inspector now shows normalized event fields, but it is still limited by the bounded payload summaries the scanner imports. It is good for event-level evidence, not full raw JSONL replacement.
- VS Code transcript files under `GitHub.copilot-chat/transcripts/<session-id>.jsonl` can contain richer Chat Debug timeline events, but they are inconsistent. In the current workspace, some sessions have rich transcripts and weak debug logs, while another has useful debug logs and only a `session.start` transcript. The scanner does not import transcripts yet, and core cost features should not depend on them.
- The app can count tool/MCP activity and place it near model calls, but it does not yet attribute model input tokens to specific request sections such as instructions, MCP tool results, or workspace context.
- Aggregated analytics are useful but still early. Outlier detection is a simple statistical signal with driver hints; it now separates a few obvious cases such as long agent runs and suspicious low-activity spikes, but it should become more nuanced as more real sessions are imported.
- Advanced evidence is imported but mostly hidden from the primary UI. Reasoning text presence and request-cap comparison were too technical to be useful as top-level cards.
- No app-owned database yet. Scans overwrite `public/data/sessions.json`.
- `app.ts`, `app.html`, and `app.css` are very large for one Angular component. That was fine during product discovery, but it now slows safe UI work and makes regressions easier.

## Review Notes

Latest review: May 2, 2026.

Verified:

- `npm run verify:data` passes for the current generated ledger.
- The live app has no browser console warnings/errors from the Angular page during the review.
- Current generated data has `5` imported debug-log sessions, all with trace event counts matching `traceSummary.totalEvents`.
- Two current sessions use `gpt-4o` as the raw/display model but fall back to the `GPT-5.4` pricing row.

Code improvements to schedule:

- Move ledger loading/filtering/analytics/comparison logic out of the root component into focused services or helper modules.
- Centralize model normalization and pricing fallback rules. Pricing rows now have one shared source, but matching/fallback behavior still exists in both the scanner/verifier and UI.
- Add ingestion fixtures for debug logs, weak chat snapshots, unknown models, mixed models, and fragile transcript availability.
- Add UI tests for the selected-run tabs, source/size filters, pricing fallback display, Analytics empty states, and Compare deltas.

## Latest Implemented Step

Hardened pricing and local deployment basics.

What changed:

- Moved the GitHub Copilot rate card into `data/github-copilot-pricing.json`.
- Updated the scanner, verifier, and Angular UI to read that same source.
- Kept `src/app/pricing.ts` as a typed UI adapter rather than the pricing source of truth.
- Added a visible app loading/error panel for `/data/sessions.json`.
- Added `docs/local-deployment.md` to capture dev mode, local production build, and future packaging choices.

Why: cost debugging depends on trust. A single shared rate card prevents scanner/UI drift, and a local deployment note keeps the project aligned with the local-first product direction.

## Previous Implemented Step

Built the first Trace Event Inspector pass.

What changed:

- Trace log rows are clickable.
- Trace has filters for all events, model calls, tools, discovery, user messages, agent responses, and errors.
- The selected event opens in a right-side inspector with raw index, timestamp, type, name, status, model, token totals, pricing row, estimated event cost, latency/cap fields, imported detail, and bounded payload summary when available.
- Rows in the Turns ledger now link directly to the matching raw Trace event.
- The scanner now preserves a small bounded `attributes` summary for future imports, instead of forcing the UI to parse raw VS Code JSONL or storing full payloads in `sessions.json`.

Why: the app is most useful when a developer can move from "this turn was expensive" to "this exact debug-log event is the evidence" without leaving the UI.

Recently removed an unsupported session-summary signal after testing real VS Code agent sessions. The observed local signals were not strong enough to distinguish manual summary actions, automatic summary actions, repeated summaries, or ordinary context selection changes.

`Context growth` is expected in many agent runs. It is shown because accumulated context can explain rising token cost, not because growth is automatically a bug.

Current size thresholds:

- `Small`: under `50k` imported tokens
- `Medium`: `50k` to under `200k`
- `Large`: `200k` to under `600k`
- `Very large`: `600k` or more

## Next Best Step

Keep tightening reliability and the UI/code structure before attempting evidence-limited attribution.

Build:

- Split the large root component into smaller services/components, starting with pricing/data loading or selected-run helpers.
- Add fixture-based scanner/verifier tests for mixed models, unknown model fallback, and missing/malformed generated data.
- Centralize model normalization and pricing fallback rules so model matching cannot drift between scanner and UI.
- Treat Chat Debug transcripts as optional enrichment only. If imported later, show transcript availability and source labels clearly, and never require transcripts for cost totals.
- Consider a mobile/narrow layout where filters and session list become a top drawer or compact selector instead of sitting below content.
- Replace native title tooltips with a small custom help popover for important cost terms.
- Continue visual polish of Sessions: tune table density, tighten the run tabs, and keep making each subview feel intentionally composed.
- Park Input/MCP attribution until the imported source fields prove exactly what can be shown. Nearby activity counts may still be useful later, but they should not become a cost-allocation feature by implication.

Why this next: the core debugger is now useful enough that correctness and maintainability matter more than speculative signals. The app should be boringly trustworthy before it gets clever.

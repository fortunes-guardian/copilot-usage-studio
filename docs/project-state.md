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

## Important Design Decisions

- Debug logs are the preferred cost source because they include model ids plus input/output token counts.
- Chat snapshots are weaker and should not be treated as equal to debug logs for cost.
- `state.vscdb` is metadata enrichment only. It improves labels and restored-session details; it does not drive pricing.
- Cache billing is not visible in the local debug logs observed so far. Do not present zero cache fields as proof of zero provider-side cache billing.
- The UI should explain local estimates clearly instead of pretending they are GitHub invoice numbers.
- The generated ledger should carry structured cost facts. The UI should not parse model/cost data out of display strings.
- Run size and cost-signal labels are derived UI triage. They should help scanning, but they should not silently become billing facts.

## Current Rough Edges

- The UI is functional but visually busy.
- Tooltips are better, but still use native browser title behavior.
- No aggregated analytics dashboard yet.
- Advanced signals such as reasoning level, compaction, and context-window pressure need stronger log/model evidence before becoming UI facts.
- No app-owned database yet. Scans overwrite `public/data/sessions.json`.
- Pricing tables are duplicated across UI/scanner/verifier and should eventually have one source of truth.

## Latest Implemented Step

Replaced the old basic comparison section with an advanced run comparison:

- headline explanation of how run B differs from run A
- deltas for cost, input tokens, output tokens, model turns, tool calls, and context growth
- driver cards for cost movement, priced token driver, model pricing, context shape, and agent activity
- model/pricing-row movement table

Why: this makes comparison useful for testing prompt, workflow, MCP setup, or model changes. It also keeps the important caveat visible: cheaper is only better if the run still succeeded.

`Context growth` is expected in many agent runs. It is shown because accumulated context can explain rising token cost, not because growth is automatically a bug.

Current size thresholds:

- `Small`: under `50k` imported tokens
- `Medium`: `50k` to under `200k`
- `Large`: `200k` to under `600k`
- `Very large`: `600k` or more

## Next Best Step

Build the multi-session analytics dashboard.

Build:

- Average token usage and average cost per relevant session.
- Highest-token and most expensive sessions.
- Total tokens and total estimated cost across the ledger.
- Model breakdowns.
- Cost-efficiency and anomaly signals, such as cost per 1k tokens and outlier runs.

Why this next: one-run debugging and two-run comparison are now covered. The next product question is “what is normal across my sessions, and what deserves attention?”

# Project State

Start here when resuming the project.

## What We Are Building

A local-first cost debugger for VS Code GitHub Copilot chat and agent sessions.

The app should help a developer answer:

- Which run was expensive?
- Which model, token category, or model call caused the cost?
- Can I compare two runs and see whether a prompt/workflow change helped?

This is not trying to be a full billing dashboard yet. Billing reconciliation can come later. The first product should make one selected run excellent and understandable.

## What Works Now

- Scans local VS Code Copilot debug logs.
- Enriches sessions from VS Code `state.vscdb` for better titles and metadata.
- Generates `public/data/sessions.json` as the app contract.
- Shows sessions, source metadata, summary metrics, and trace logs.
- Shows a GitHub prices page with the pricing rows used by estimates.
- Calculates cost from imported token counts and GitHub model prices.
- Shows a selected-run Cost debugger with:
  - source/confidence explanation
  - estimate-scope note for missing cache billing fields
  - run size and warning labels
  - cost driver cards
  - token category totals
  - per-model pricing rows
  - largest model calls
- Shows an agent flow chart with token/cost detail.
- Compares two runs at a basic level.

## Important Design Decisions

- Debug logs are the preferred cost source because they include model ids plus input/output token counts.
- Chat snapshots are weaker and should not be treated as equal to debug logs for cost.
- `state.vscdb` is metadata enrichment only. It improves labels and restored-session details; it does not drive pricing.
- Cache billing is not visible in the local debug logs observed so far. Do not present zero cache fields as proof of zero provider-side cache billing.
- The UI should explain local estimates clearly instead of pretending they are GitHub invoice numbers.
- The generated ledger should carry structured cost facts. The UI should not parse model/cost data out of display strings.
- Run size and warning labels are derived UI triage. They should help scanning, but they should not silently become billing facts.

## Current Rough Edges

- The UI is functional but visually busy.
- Tooltips are better, but still use native browser title behavior.
- The comparison section is still shallow compared with the selected-run debugger.
- No app-owned database yet. Scans overwrite `public/data/sessions.json`.
- Pricing tables are duplicated across UI/scanner/verifier and should eventually have one source of truth.

## Latest Implemented Step

Built session size and warning labels for the selected run:

- `Small`, `Medium`, `Large`, `Very large`
- `High input context`
- `Context grew`
- `Mixed models`
- `Cache unknown`
- `State enriched`

Why: it turns the current facts into quick, scannable judgment without starting the larger style overhaul.

Current size thresholds:

- `Small`: under `50k` imported tokens
- `Medium`: `50k` to under `200k`
- `Large`: `200k` to under `600k`
- `Very large`: `600k` or more

## Next Best Step

Improve the selected-run header and session list scanning.

Build:

- Cleaner selected-run header wording and layout.
- Better placement for run size, source quality, model, and estimate.
- A first pass at filters for size/warnings/source quality.

Why this next: the app now has enough judgement signals. The next improvement is making them easier to scan without making the page busier.

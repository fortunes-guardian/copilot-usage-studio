# Copilot Cost Ledger

Local-first cost debugger for VS Code GitHub Copilot chat and agent sessions.

The app helps answer one practical question:

> Why did this Copilot run cost what it cost?

It scans local VS Code data, estimates cost from GitHub published model prices, and shows which models, token categories, and model calls drove the estimate.

## Start Here

- [docs/project-state.md](docs/project-state.md): current state, what works, what is next.
- [docs/how-to-read-the-app.md](docs/how-to-read-the-app.md): plain-English guide to the UI.
- [docs/roadmap.md](docs/roadmap.md): planned build order.
- [docs/data-ingestion.md](docs/data-ingestion.md): where the data comes from and what it means.
- [docs/pricing.md](docs/pricing.md): GitHub price source, calculation rules, AI-credit allowances, and real-world estimate caveats.
- [docs/local-deployment.md](docs/local-deployment.md): local run, build, and future packaging options.

## What Works Now

- Imports VS Code Copilot debug-log sessions.
- Enriches titles and metadata from VS Code `state.vscdb`.
- Filters sessions by size, cost signal, and source quality.
- Shows a selected-run Cost debugger:
  - run size and cost-signal labels
  - a primary-driver answer for the current estimate
  - cost drivers
  - input/output token categories
  - per-model pricing rows
  - source-confidence explanations
- Splits each selected run into debugger subviews:
  - `Overview` for summary, metadata, and triage
  - `Cost` for estimate explanation, drivers, and price rows
  - `Turns` for per-turn model-call insights and the detailed ledger
  - `Trace` for filterable raw logs, clickable event inspection, and agent flow
- Shows a Billing Reality Check in the Cost view so cache-token visibility and invoice risk are explicit instead of hidden in pricing footnotes.
- Shows the GitHub pricing table used by the app and a toggleable Copilot Business/Enterprise AI-credit allowance view.
- Shows trace logs, a clickable event inspector, and an agent flow chart.
- Compares two runs with cost/token deltas, driver explanations, context-growth movement, and model/pricing-row changes.
- Shows a multi-session Analytics view for filtered sessions:
  - visible cohort controls for time range, workspace, model, and day/week/month grouping
  - Analytics-only reset and no-data messaging when controls exclude every session
  - total and average cost/tokens
  - highest-token and most expensive runs
  - model breakdowns
  - trend rows, size distribution, and clearer outlier signals
- Started the Midnight Ledger UI overhaul:
  - top-level navigation for Sessions, Compare, Analytics, and Prices
  - Compare separated from the selected-run stack and no longer rendered inside Sessions
  - selected-run pages now use Overview, Cost, Turns, and Trace subviews instead of one stacked report
  - Cost and Turns now lead with debugger-style answer panels before the detailed tables
  - narrow screens keep selected content primary while the session rail moves below it

## Run The App

```bash
npm install
npm run scan
npm run verify:data
npm start
```

Then open the Angular dev server URL.

This is the recommended mode while the project is still changing quickly.

For a local production build:

```bash
npm run scan
npm run verify:data
npm run build
```

See [docs/local-deployment.md](docs/local-deployment.md) for packaging options and why the app stays local-first.

## Refresh Local Session Data

```bash
npm run scan
npm run verify:data
```

The app reads `public/data/sessions.json`. Running `npm run scan` regenerates that file from local VS Code data.

## Preferred Data Source

Best source:

```text
%APPDATA%\Code\User\workspaceStorage\<workspace-id>\GitHub.copilot-chat\debug-logs\<session-id>\main.jsonl
```

Why: these debug logs include model ids plus input and output token counts for each model call. That is the strongest local signal for estimating a run.

Secondary source:

```text
%APPDATA%\Code\User\workspaceStorage\<workspace-id>\chatSessions\<session-id>.jsonl
```

These chat snapshots can explain conversation context, but they are weaker for cost because they do not reliably include the full request token count.

Observed but not trusted for core cost:

```text
%APPDATA%\Code\User\workspaceStorage\<workspace-id>\GitHub.copilot-chat\transcripts\<session-id>.jsonl
```

These Chat Debug transcript files can contain richer tool/chat timeline details, but they are inconsistent across sessions and may not match what VS Code shows after restart. They should only be optional inspection enrichment, not the pricing or token source.

## Pricing

Prices are copied from GitHub's published Copilot usage-based pricing table:

https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing

Current pricing version:

```text
github-copilot-usage-pricing-2026-06-01
```

Rates are USD per 1 million tokens. The scanner converts USD estimates to EUR using `USD_TO_EUR`, defaulting to `0.93`.

The versioned pricing data lives in `data/github-copilot-pricing.json`. The scanner, verifier, and UI all read from that same file.

The UI also converts local USD estimates into GitHub AI credits using GitHub's fixed conversion of `1 AI credit = $0.01 USD`. The Prices page and selected-run header can compare estimates against Copilot Business and Enterprise included monthly AI-credit allowances.

Important: this app shows a local estimate, not a GitHub invoice. Local VS Code logs currently expose input/output tokens, but not provider cache read/write billing fields. Output-heavy runs are still useful to debug from local logs; input/context-heavy runs may differ more from billing if provider-side cached input is significant.

## Useful Commands

```bash
npm run scan
npm run verify:data
npm test -- --watch=false
npm run build
```

You can scan a custom VS Code user directory or workspace storage folder:

```bash
node scripts/scan-vscode-sessions.mjs public/data/sessions.json "C:\Users\you\AppData\Roaming\Code\User"
node scripts/scan-vscode-sessions.mjs public/data/sessions.json "C:\Users\you\AppData\Roaming\Code\User\workspaceStorage\<workspace-id>"
```

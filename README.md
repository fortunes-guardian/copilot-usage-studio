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
- [docs/pricing.md](docs/pricing.md): GitHub price source and calculation rules.

## What Works Now

- Imports VS Code Copilot debug-log sessions.
- Enriches titles and metadata from VS Code `state.vscdb`.
- Filters sessions by size, cost signal, and source quality.
- Shows a selected-run Cost debugger:
  - run size and cost-signal labels
  - cost drivers
  - input/output token categories
  - per-model pricing rows
  - largest model calls
  - source-confidence explanations
- Shows the GitHub pricing table used by the app.
- Shows trace logs and an agent flow chart.
- Compares two runs with cost/token deltas, driver explanations, context-growth movement, and model/pricing-row changes.
- Shows a multi-session Analytics view for filtered sessions:
  - visible cohort controls for time range, workspace, model, and day/week/month grouping
  - total and average cost/tokens
  - highest-token and most expensive runs
  - model breakdowns
  - trend rows, size distribution, and clearer outlier signals

## Run The App

```bash
npm start
```

Then open the Angular dev server URL.

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

## Pricing

Prices are copied from GitHub's published Copilot usage-based pricing table:

https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing

Current pricing version:

```text
github-copilot-usage-pricing-2026-06-01
```

Rates are USD per 1 million tokens. The scanner converts USD estimates to EUR using `USD_TO_EUR`, defaulting to `0.93`.

Important: this app shows a local estimate, not a GitHub invoice. Local VS Code logs currently expose input/output tokens, but not provider cache read/write billing fields.

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

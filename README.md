# Copilot Cost Ledger

Local-first developer cost debugger for VS Code GitHub Copilot chat and agent sessions.

The goal is to answer practical questions:

- Which Copilot sessions were small, medium, or expensive?
- Which model and token category drove the estimate?
- Which GitHub-published price rows were used for the calculation?
- Did one run cost more or less than another run?

## Current Product Shape

- Scans local VS Code Copilot Agent Debug Log files.
- Enriches imported sessions from VS Code `state.vscdb` when available.
- Generates `public/data/sessions.json` as the app-facing ledger contract.
- Shows session details, model turns, tool calls, token totals, and estimated EUR cost.
- Provides a GitHub prices view listing the model pricing rows used by the estimator.
- Compares two sessions for token and estimated cost delta.

## Run

```bash
npm start
```

Then open the Angular dev server URL.

## Import Local VS Code Sessions

```bash
npm run scan
npm run verify:data
```

The preferred source is:

```text
%APPDATA%\Code\User\workspaceStorage\<workspace-id>\GitHub.copilot-chat\debug-logs\<session-id>\main.jsonl
```

Why: debug logs include `llm_request` rows with model ids plus `inputTokens` and `outputTokens`. Those are the best local session-level inputs this app has found so far.

The scanner can also read:

```text
%APPDATA%\Code\User\workspaceStorage\<workspace-id>\chatSessions\<session-id>.jsonl
```

Those chat snapshots are useful for context, but they are not as strong for cost estimation because they do not reliably include full request token totals.

You can pass a custom output file and one or more VS Code `User` directories or workspace storage directories:

```bash
node scripts/scan-vscode-sessions.mjs public/data/sessions.json "C:\Users\you\AppData\Roaming\Code\User"
node scripts/scan-vscode-sessions.mjs public/data/sessions.json "C:\Users\you\AppData\Roaming\Code\User\workspaceStorage\<workspace-id>"
```

## Pricing

Pricing is stored in `src/app/pricing.ts` and mirrored in the scanner/verifier scripts. The rows are copied from GitHub's published Copilot usage-based pricing table:

https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing

The current app pricing version is `github-copilot-usage-pricing-2026-06-01`. GitHub states those usage-based billing prices take effect on June 1, 2026. All rates are USD per 1 million tokens. The scanner converts USD estimates to EUR using `USD_TO_EUR`, defaulting to `0.93`.

The app now has a `GitHub prices` view so the user can inspect the exact table driving session estimates.

## Data Boundary

The Angular UI does not parse VS Code internals directly. It renders `public/data/sessions.json`.

That boundary matters because the scanner is where local files, SQLite enrichment, model normalization, token semantics, and cost calculation are verified. The UI should explain the ledger; it should not silently reinterpret source files.

## Docs

- `docs/intent.md` is the product north star.
- `docs/data-ingestion.md` documents where data comes from and what each field means.
- `docs/pricing.md` documents the price source, calculation rules, and current limitations.
- `docs/roadmap.md` tracks the next implementation steps.

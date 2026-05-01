# Copilot Cost Ledger

Local-first MVP for inspecting GitHub Copilot chat/agent session cost estimates.

## What it does now

- Scans local VS Code Copilot agent debug logs and chat session JSONL files.
- Enriches imported sessions from VS Code `state.vscdb` when available.
- Generates `public/data/sessions.json`.
- Shows sessions by first prompt, model, workspace, tokens, and estimated EUR cost.
- Compares two sessions to estimate token and cost deltas.

## Run

```bash
npm start
```

Then open the Angular dev server URL.

## Import local VS Code sessions

```bash
npm run scan
npm run verify:data
```

The scanner checks standard VS Code Stable and Insiders user-storage locations. For VS Code only, the strongest source is:

```text
%APPDATA%\Code\User\workspaceStorage\<workspace-id>\GitHub.copilot-chat\debug-logs\<session-id>\main.jsonl
```

That file is produced when Agent Debug Log file logging is enabled. It includes model name, user messages, LLM request token totals, tool events, and timestamps. The fallback source is:

```text
%APPDATA%\Code\User\workspaceStorage\<workspace-id>\chatSessions\<session-id>.jsonl
```

The scanner also reads workspace `state.vscdb` files with Node's built-in SQLite support. That pass enriches sessions with VS Code's stable title, location, permission level, pending-edit flag, read state, and Agent Debug Log label/status when those keys exist.

You can also pass a custom output file and one or more VS Code `User` directories or concrete workspace storage directories:

```bash
node scripts/scan-vscode-sessions.mjs public/data/sessions.json "C:\Users\you\AppData\Roaming\Code\User"
node scripts/scan-vscode-sessions.mjs public/data/sessions.json "C:\Users\you\AppData\Roaming\Code\User\workspaceStorage\<workspace-id>"
```

## Token estimator

This MVP now uses two token paths:

- if `GitHub.copilot-chat/debug-logs/<session-id>/main.jsonl` has `llm_request` events, it uses VS Code's `inputTokens` and `outputTokens`
- debug-log model ids are preserved in `modelBreakdown.rawModels`, normalized for display, and priced per model before session totals are summed
- otherwise, it falls back to a visible-text heuristic

The fallback heuristic is:

- user turns and tool turns count as input tokens
- assistant turns count as output tokens
- token estimate is roughly `max(words * 1.35, characters / 4)`
- cached input and cache write are set to `0` unless imported from a future billing/reconciliation source

This is intentionally conservative engineering: even with debug logs, cached input/cache write and final GitHub billable reconciliation may differ from local visible token totals.

See `docs/data-ingestion.md` for the ingestion contract, source priority, token semantics, and why empty debug-log folders are skipped.

## Pricing

Pricing is stored in `src/app/pricing.ts` and mirrored in the scanner script. Rates are per 1M tokens from GitHub's published Copilot usage-based pricing table for June 1, 2026. USD is converted to EUR with `USD_TO_EUR`, defaulting to `0.93`.

## Next build steps

1. Add a real tokenizer adapter interface for fallback imports.
2. Add GitHub billing report import and daily reconciliation.
3. Add experiment pairing with labels like `mcp-on` and `mcp-off`.
4. Add app-owned SQLite storage for historical scans, labels, and comparisons.

See `docs/roadmap.md` for the computed build path and design rationale after the current SQLite enrichment phase.

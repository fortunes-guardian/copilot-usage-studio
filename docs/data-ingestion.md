# Data ingestion design decisions

This ledger is intentionally local-first. The scanner reads VS Code user-storage files, normalizes them into one JSON contract, and the Angular app only renders that generated contract.

## Contract location

- Runtime app data lives at `public/data/sessions.json`.
- The scanner is `scripts/scan-vscode-sessions.mjs`.
- The repeatable verifier is `scripts/verify-ledger-data.mjs`.
- The UI types are in `src/app/ledger.model.ts`.

`public/data/sessions.json` is the boundary between ingestion and display. The UI should not parse VS Code JSONL directly because those files are editor internals and can change independently from the app.

## Preferred source

The strongest current source is:

```text
%APPDATA%\Code\User\workspaceStorage\<workspace-id>\GitHub.copilot-chat\debug-logs\<session-id>\main.jsonl
```

Why: `llm_request` events contain the model id plus `inputTokens` and `outputTokens` for each model call. Those totals are better than estimating from visible chat text because they include the request payload assembled by Copilot, including context and tool-related material that may not appear in the final chat transcript.

The fallback source is:

```text
%APPDATA%\Code\User\workspaceStorage\<workspace-id>\chatSessions\<session-id>.jsonl
```

Why it is fallback only: chat snapshots preserve conversation state, but they do not reliably expose full request input tokens. The scanner estimates user-visible input and uses any available completion token fields.

Chat snapshot files without a `requests` array are skipped and counted in `ingestion.skippedChatSnapshotsWithoutRequests`.

## What counts as an imported session

Debug-log folders are imported only when they contain at least one meaningful chat signal:

- `user_message`
- `llm_request`
- `agent_response`
- `assistant.message`

Folders containing only `session_start` are skipped and counted in `ingestion.skippedEmptyDebugLogs`.

Why: VS Code can create debug-log folders before a useful agent turn exists. Showing those as zero-cost sessions pollutes comparisons and makes the summary count misleading.

## Token semantics

For debug logs with `llm_request` events:

- `tokens.input` is the sum of `attrs.inputTokens`.
- `tokens.output` is the sum of `attrs.outputTokens`.
- `tokens.cachedInput` is `0`.
- `tokens.cacheWrite` is `0`.
- `tokenSource` is `llm_request_token_totals`.
- `confidence` is `exact`.

The word `exact` means exact for the local VS Code debug-log token fields that were imported. It does not mean exact final billing. GitHub billing reconciliation can still differ because cache accounting and provider-side billing adjustments are not present in the local log.

For chat snapshots:

- visible user messages are estimated with `max(words * 1.35, characters / 4)`.
- assistant output uses `completionTokens` when present.
- `tokenSource` is `chat-snapshot-output-plus-visible-input-estimate`.
- `confidence` is `estimated`.

## Cost semantics

Costs are estimates calculated from token totals and the local pricing table. The scanner writes:

- `pricingVersion`
- `usdToEur`
- `cost.usd`
- `cost.eur`

The current pricing version is `github-copilot-usage-pricing-2026-06-01`. `USD_TO_EUR` defaults to `0.93` unless overridden for a scan.

## Display semantics

The app displays:

- first prompt, workspace, model, timestamps, tags, source kind, token source
- VS Code Agent Debug Log style session details: session type, location, status, created time, and last activity
- trace summary cards: model turns, tool calls, total tokens, errors, total events, and estimated cost
- token totals and estimated cost
- a capped turn preview for human inspection
- a capped trace event preview for logs and flow-chart views
- comparison deltas between two imported sessions

The turn preview is not the pricing source when `tokenSource` is `llm_request_token_totals`; it is there to explain the session to a human. The cost comes from imported token totals.

## SQLite workspace state

Each VS Code workspace storage folder can contain `state.vscdb`. That database is useful for metadata that is not always present in debug JSONL:

- stable chat titles and current session labels
- chat location and session registry state
- workspace-scoped UI/session metadata
- possible links between chat sessions, edit sessions, and restored historical sessions

It does not replace debug logs for pricing. The debug log remains the pricing source because it carries `llm_request` token totals. SQLite should be added as an enrichment pass that joins metadata onto sessions by id or workspace, not as the primary cost source.

## Verification

Run:

```bash
npm run scan
npm run verify:data
```

The verifier checks the generated ledger shape, duplicate ids, required source metadata, valid timestamps, non-negative token fields, and guards against importing sessions with neither token totals nor turns.

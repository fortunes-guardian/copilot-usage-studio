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
- `modelBreakdown` groups `llm_request` rows by normalized model id and stores raw model ids, turn count, token totals, estimated cost, and the pricing model used.
- each token-bearing `traceEvents` row stores structured `model`, `rawModel`, `pricingModel`, `totalTokens`, and `estimatedCost` fields.

The word `exact` means exact for the local VS Code debug-log token fields that were imported. It does not mean exact final billing. GitHub billing reconciliation can still differ because cache accounting and provider-side billing adjustments are not present in the local log.

`cachedInput` and `cacheWrite` are currently zero for debug-log sessions because the local `llm_request` events observed so far expose `inputTokens` and `outputTokens`, not provider billing cache read/write fields. The UI should describe those cache fields as unavailable from this local source, not as proof that GitHub billed no cache activity.

Model names are normalized for display without discarding the raw id. For example, `claude-sonnet-4.6` becomes `Claude Sonnet 4.6`, but the raw id remains in `modelBreakdown.rawModels`. Why: VS Code logs provider ids, while users expect readable model names and pricing needs a canonical key. Unknown models are not relabeled as a known model; they keep their raw label and use `pricingModel` to show any fallback pricing assumption.

For chat snapshots:

- visible user messages are estimated with `max(words * 1.35, characters / 4)`.
- assistant output uses `completionTokens` when present.
- `tokenSource` is `chat-snapshot-output-plus-visible-input-estimate`.
- `confidence` is `estimated`.

## Cost semantics

Costs are estimates calculated from token totals and the local pricing table. The scanner writes:

- `pricingVersion`
- `pricingSourceUrl`
- `usdToEur`
- `cost.usd`
- `cost.eur`

The current pricing version is `github-copilot-usage-pricing-2026-06-01`. `USD_TO_EUR` defaults to `0.93` unless overridden for a scan.

When a debug-log session uses more than one model, cost is calculated per `modelBreakdown` entry and then summed into `cost.usd` and `cost.eur`. Why: applying one session-level model price to all tokens is wrong for mixed runs and hides model-switching behavior.

The price table is copied from GitHub's public Copilot model pricing documentation, then exposed in the UI as a first-class `GitHub prices` view. Why: cost estimates should be inspectable from their inputs. A user should not have to trust a hidden rate card.

Token-bearing trace rows repeat the pricing decision at the event level. Why: the UI should not parse cost-critical facts back out of human display text such as `detail`. The generated ledger is the contract, so the ledger carries the exact model and price row used for each model call.

## Display semantics

The app displays:

- first prompt, workspace, model, timestamps, tags, source kind, token source
- VS Code Agent Debug Log style session details: session type, location, status, created time, and last activity
- trace summary cards: model turns, tool calls, total tokens, errors, and total events
- a cost debugger with cost drivers, token categories, per-model pricing rows, and the largest model calls
- a capped trace event preview for logs and flow-chart views
- comparison deltas between two imported sessions

The flow chart uses structured trace event pricing fields for model-call costs. The cost debugger uses the session and model-level token totals; both are generated during ingestion from the same `llm_request` source.

Cost drivers are UI-level diagnosis, not new billing facts. They summarize the generated ledger into practical signals: input cost share, the largest model call, context growth across model calls, model mix, and tool-call density. Why: developers need a quick answer to "what made this run expensive?" before they dig into raw logs.

## SQLite workspace state

Each VS Code workspace storage folder can contain `state.vscdb`. That database is useful for metadata that is not always present in debug JSONL:

- stable chat titles and current session labels
- chat location and session registry state
- workspace-scoped UI/session metadata
- possible links between chat sessions, edit sessions, and restored historical sessions

The scanner reads `state.vscdb` as an enrichment pass using Node's built-in `node:sqlite` module. It currently probes these keys:

- `chat.ChatSessionStore.index`
- `agentSessions.model.cache`
- `agentSessions.state.cache`

The join key is the VS Code chat session id. `chat.ChatSessionStore.index` stores plain session ids. `agentSessions.*` stores a `vscode-chat-session://local/<base64-session-id>` resource, so the scanner decodes the final path segment before joining.

When a match exists, the generated session gets:

- `title` from the stable VS Code session title or agent label
- `location` from `initialLocation`
- `sessionType` from the agent provider label
- `status` from the agent/session response state
- `vscodeState` with the exact keys and state DB path used for the enrichment
- a `state-vscdb-enriched` tag

It does not replace debug logs for pricing. The debug log remains the pricing source because it carries `llm_request` token totals. SQLite is metadata only unless a future VS Code version starts storing billing-grade token rows there.

Why this is the right boundary: `state.vscdb` gives better human labels and restored-session state, but it is workspace UI state. It is not the billing ledger, and it can be compacted or changed by VS Code. Keeping it as an optional enrichment means the scanner remains correct when SQLite is missing, locked, or has a changed key layout.

## Verification

Run:

```bash
npm run scan
npm run verify:data
```

The verifier checks the generated ledger shape, duplicate ids, required source metadata, valid timestamps, non-negative token fields, model breakdown pricing, token-bearing trace event pricing, optional VS Code state metadata, and guards against importing sessions with neither token totals nor turns.

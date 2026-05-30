# Data ingestion design decisions

This generated session-data contract is intentionally local-first. The scanner reads VS Code user-storage files, normalizes them into one JSON contract, and the Angular app only renders that generated contract.

## Contract location

- Runtime app data lives at `public/data/sessions.json`.
- The scanner is `scripts/scan-vscode-sessions.mjs`.
- The repeatable verifier is `scripts/verify-session-data.mjs`.
- The UI types are in `src/app/session-data.model.ts`.

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

There is also a useful but fragile adjacent source:

```text
%APPDATA%\Code\User\workspaceStorage\<workspace-id>\GitHub.copilot-chat\transcripts\<session-id>.jsonl
```

Observed transcript ids can match debug-log session ids. These transcript files can preserve a richer Chat Debug timeline with events such as `assistant.message`, `assistant.turn_start`, `assistant.turn_end`, `tool.execution_start`, and `tool.execution_complete`. They can include tool request names, arguments, completion success, assistant reasoning text, and user messages.

Important boundary: these files are not consistently complete. In the current workspace, one session has rich transcript events while its debug log only contains `session_start`; another session has dozens of debug-log events while its transcript contains only `session.start`. After a VS Code restart, the Chat Debug view may no longer show the same visible log tree even though some old transcript files still exist on disk. That makes transcripts useful for optional inspection, but too fragile to become the cost source or a required ingestion dependency.

Why this matters: VS Code has at least two adjacent debug surfaces:

- Agent Debug Logs: better source for model ids, token totals, pricing estimates, discovery/customization events, and the selected-run cost spine.
- Chat Debug transcripts: sometimes better source for readable step-level chat/tool detail, but not reliable enough to drive core cost facts.

Design decision: the scanner may eventually import transcript details only as optional enrichment with clear source labels and availability counts. Missing transcript detail must not downgrade or invalidate a debug-log session.

Current implementation: for each Agent Debug Log session, the scanner checks for a matching transcript file and records only whether it exists, its path, and its row count. That availability signal does not affect tokens, costs, model rows, or confidence. It is a future inspection hook, not a pricing source.

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

- `tokens.input` is the sum of normal, non-cached input tokens. For Agent Debug Logs this is `attrs.inputTokens - attrs.cachedTokens` when `cachedTokens` is present, otherwise it is `attrs.inputTokens`.
- `tokens.output` is the sum of `attrs.outputTokens`.
- `tokens.cachedInput` is the sum of `attrs.cachedTokens` from `llm_request` events when present.
- `tokens.cacheWrite` is imported only when the scanner sees a clear numeric cache-write field such as `cacheWriteTokens` or `cachedWriteTokens`.
- `tokenSource` is `llm_request_token_totals`.
- `confidence` is `exact`.
- `modelBreakdown` groups `llm_request` rows by normalized model id and stores raw model ids, turn count, token totals, estimated cost, and the pricing model used.
- each token-bearing `traceEvents` row stores structured `model`, `rawModel`, `pricingModel`, `totalTokens`, and `estimatedCost` fields.
- each `llm_request` trace row also preserves `ttftMs`, `maxTokens`, and request `reasoningEffort` when VS Code logged them.
- current VS Code Agent Debug Logs can also expose `session_start.attrs.vscodeVersion`, `session_start.attrs.copilotVersion`, `llm_request.attrs.requestShape`, and `requestOptions.text.verbosity`; these are preserved as runtime/request metadata rather than cost fields.
- each `agent_response` trace row records whether a reasoning text field was present.
- future scans preserve a small bounded `attributes` summary for common fields such as model, token counts, tool name, details, user content preview, or response preview. This is for the Trace inspector only; it is not a raw JSONL dump.

The word `exact` means exact for the local VS Code debug-log token fields that were imported. It does not mean exact final billing. GitHub billing reconciliation can still differ because GitHub may apply account policy, billing adjustments, or cache-write details that are not present in the local log. When `attrs.cachedTokens` is present, that cached-input field is imported and priced.

`cachedInput` is imported from Agent Debug Log `cachedTokens` when present. This is treated as cached input, not as output and not as a discount against output. `inputTokens` remains useful as the raw prompt/context size, but pricing separates the normal input portion from the cached portion to avoid double-counting.

`cacheWrite` remains zero unless the log exposes a clear numeric cache-write field such as `cacheWriteTokens` or `cachedWriteTokens`. Do not infer billable cached-token totals from `cache_control` hints or prompt-cache metadata alone.

Cached input should be treated as a separate billing bucket, not as a subtraction from output. If a run has large output tokens, missing cache fields may not change the main cost story because output is still billed as output. If a run is input/context-heavy, missing cached-input visibility can materially change how close the local estimate is to a GitHub invoice.

Model names are normalized for display without discarding the raw id. For example, `claude-sonnet-4.6` becomes `Claude Sonnet 4.6`, but the raw id remains in `modelBreakdown.rawModels`. Why: VS Code logs provider ids, while users expect readable model names and pricing needs a canonical key. Unknown models are not relabeled as a known model; they keep their raw label and use `pricingModel` to show any fallback pricing assumption.

## Request payload evidence

Agent Debug Logs can include more than token totals. The scanner now preserves bounded request-payload evidence when present:

- `llm_request.attrs.requestOptions.reasoning.effort`
- `llm_request.attrs.systemPromptFile`
- `llm_request.attrs.toolsFile`
- `system_prompt_*.json` side-file character totals
- `tools_*.json` side-file character totals, tool count, MCP tool count, MCP tool names, and largest tool schemas
- grouped `tool_call` argument/result character counts
- nested `runSubagent-*.jsonl` file count

Why: this explains what kind of setup payload was available to the model request. Large instruction payloads, large tool schemas, many MCP tools, and large tool results can all be practical optimization targets.

Important boundary: these are source-backed size and presence signals. They are not exact per-section billing rows. Exact local cost is still calculated at the `llm_request` model-call level from logged token totals. Only show exact instruction/MCP cost if a future source exposes token counts for those specific sections.

See [debug-log-schema.md](debug-log-schema.md) for the observed VS Code Agent Debug Log fields and the generated app schema. That document exists so new features start from the real data model rather than from assumptions about what the logs probably contain.

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

The current pricing version is `github-copilot-usage-pricing-2026-06-01`. The app displays `cost.usd` and treats USD as the canonical estimate because GitHub prices and AI credits are USD-native. The `cost.eur` and `usdToEur` fields remain only as legacy schema compatibility fields; new scans default `usdToEur` to `1`.

The GitHub rate card lives in `data/github-copilot-pricing.json`. The scanner, verifier, and UI all read this same file. Why: pricing is part of the data contract. If the app calculates cost with one table and explains it with another, the debugger becomes untrustworthy.

When a debug-log session uses more than one model, cost is calculated per `modelBreakdown` entry and then summed into `cost.usd`. Why: applying one session-level model price to all tokens is wrong for mixed runs and hides model-switching behavior.

The price table is copied from GitHub's public Copilot model pricing documentation, then exposed in the UI as a first-class `GitHub prices` view. Why: cost estimates should be inspectable from their inputs. A user should not have to trust a hidden rate card.

Token-bearing trace rows repeat the pricing decision at the event level. Why: the UI should not parse cost-critical facts back out of human display text such as `detail`. The generated session data is the contract, so it carries the exact model and price row used for each model call.

## Display semantics

The app displays:

- first prompt, workspace, model, timestamps, tags, source kind, token source
- VS Code Agent Debug Log style session details: session type, location, status, created time, and last activity
- session size and cost-signal labels for fast triage
- Cost-view token categories that keep normal input, cached input, cache write, and output visibly separate
- trace summary cards: model turns, tool calls, total tokens, errors, and total events
- a cost debugger with cost drivers, token categories, per-model pricing rows, and the largest model calls
- a capped trace event preview for logs, a clickable Trace inspector, and flow-chart views
- comparison deltas between two imported sessions
- multi-session analytics across the current UI filter set

The flow chart and Trace inspector use structured trace event pricing fields for model-call costs. The cost debugger uses the session and model-level token totals; both are generated during ingestion from the same `llm_request` source.

The trace event preview cap is intentionally high enough for normal debug sessions (`1000` events). Why: compacted or long-running sessions can append important activity late in the same debug log. Keeping only the first slice hides exactly the recent events a developer is trying to inspect. The session summary still records the raw `traceSummary.totalEvents`, so any future truncation should be visible rather than silently changing totals.

Cost drivers are UI-level diagnosis, not new billing facts. They summarize the generated session data into practical signals: input cost share, the largest model call, context growth across model calls, model mix, and tool-call density. Why: developers need a quick answer to "what made this run expensive?" before they dig into raw logs.

Comparison is also UI-level diagnosis. It compares two generated sessions without mutating the session data: cost, token categories, model turns, tool calls, context growth, and model/pricing rows. Why: the practical developer workflow is often "I changed the prompt/workflow/model; did that make the run cheaper, and what moved?"

Analytics is UI-level aggregation over generated sessions. It does not create new ingestion facts. It starts from the sidebar-filtered sessions, then applies UI cohort controls for time range, workspace, model, and day/week/month trend grouping. It sums cost/tokens, groups model breakdown rows, computes cost per 1k tokens, buckets sessions by size, and flags simple statistical outliers with driver hints. Empty states and reset controls are also UI-only; they do not change the generated session data. Why: this answers "what is normal for the sessions I am looking at?" without mixing cohort-level signals into the selected-run debugger.

Source-confidence terms in the UI should carry inline help only when they help a user make a decision. Prefer plain labels such as debug logs, chat snapshots, token totals, cached input, and cache write. Avoid making users care about implementation terms such as state enrichment unless they are reading ingestion docs.

Run triage labels are derived in the UI from the generated session data. They are intentionally not stored as scanner output yet because the thresholds are product decisions that may change as more sessions are reviewed.

Current size thresholds:

- `Small`: fewer than `100,000` imported tokens.
- `Medium`: `100,000` to `499,999` imported tokens.
- `Large`: `500,000` to `1,499,999` imported tokens.
- `Very large`: `1,500,000` or more imported tokens.

Current cost-signal labels:

- `High input context`: total input tokens are at least `150,000`, or one model call has at least `100,000` input tokens.
- `Mixed models`: more than one model appears in `modelBreakdown`.
- `vscodeState` metadata may improve titles and labels, but it should not be promoted as a primary user-facing badge.

Why these labels exist: the cost debugger has enough detail to explain a run, but a developer needs quick visual judgement before reading every table. The labels should stay explainable and tuneable.

Advanced evidence is imported under `advancedSignals`, but most of it is not shown directly in the primary UI.

- `advancedSignals.reasoning.visible` means the raw log included `agent_response.attrs.reasoning`.
- `advancedSignals.reasoning.level` is populated from `llm_request.attrs.requestOptions.reasoning.effort` when present.
- `advancedSignals.context.maxInputTokens` is the largest imported `llm_request.attrs.inputTokens`.
- `advancedSignals.context.maxRequestTokens` comes from `llm_request.attrs.maxTokens` when present.
- `advancedSignals.context.requestCapShare` compares max input tokens with that observed request cap.

Why: reasoning and context pressure are potentially valuable cost-debugging signals, but weak or overly technical evidence should not clutter the main debugger. Reasoning effort is now preserved when it is source-backed; request-cap comparison and raw token movement stay as investigation context rather than primary product claims.

## Calls cost breakdown

The selected-run debugger now expands the older largest-model-calls view into an ordered table of token-bearing model calls. Each row shows the call index, raw event number, timestamp, model, pricing row, input tokens, output tokens, estimated cost, input/output cost split, share of session cost, and nearby prior context.

The UI supports two reads:

- `Timeline`: best for understanding where the session became expensive.
- `Largest first`: best for quickly finding the biggest token/cost burn.

Why: session totals answer "how expensive was this run?" Calls answer "where did the cost happen?" That is the sharper debugging tool when a developer wants to know whether cost came from the first prompt, accumulated context, repo/tool output, a model switch, or a late-session spike.

## Request-payload attribution roadmap

Observed VS Code debug-log `llm_request` events can include large request payload fields such as `attrs.userRequest`, `attrs.inputMessages`, `attrs.systemPromptFile`, and `attrs.toolsFile`. The scanner now preserves side-file summaries and payload sizes, but it still does not fully bucket every request section.

Future instruction, MCP, and context attribution should use structured payload extraction from those fields instead of parsing the rendered row text. The scanner should normalize request sections into explicit buckets such as user prompt, workspace context, instructions, tool references, tool results, MCP tool calls/results, prior conversation, and system/developer material.

Important boundary: current exact local token counts are exact at the `llm_request` level. Unless VS Code logs per-section token counts, any split across instructions, MCP servers, tool results, or workspace context is an attribution estimate calculated from available payload sections. Character counts, approximate token counts, and "present in this model call" indicators can still be useful for optimization, but the UI must label them differently from model-call token totals.

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

Why this is the right boundary: `state.vscdb` gives better human labels and restored-session state, but it is workspace UI state. It is not the pricing source, and it can be compacted or changed by VS Code. Keeping it as an optional enrichment means the scanner remains correct when SQLite is missing, locked, or has a changed key layout.

## Verification

Run:

```bash
npm run scan
npm run verify:data
```

The verifier checks the generated session-data shape, duplicate ids, required source metadata, valid timestamps, non-negative token fields, model breakdown pricing, token-bearing trace event pricing, optional VS Code state metadata, and guards against importing sessions with neither token totals nor turns.

It also recomputes the cache split audit. This is the guardrail for the observed VS Code mapping:

```text
normal_input_tokens = max(0, inputTokens - cachedTokens)
cached_input_tokens = cachedTokens
```

The audit proves, for the generated data, how many model calls exposed `cachedTokens`, whether any impossible `cachedTokens > inputTokens` splits were found, and whether normal plus cached input reconciles back to raw `inputTokens`.

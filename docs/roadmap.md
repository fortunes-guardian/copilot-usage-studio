# Roadmap

First make one selected run excellent, then make comparisons useful, then aggregate across sessions.

## Phase 1: Selected Run Cost Debugger

Status: built, still needs polish.

Done:

- Import VS Code Copilot debug logs.
- Enrich session labels from `state.vscdb`.
- Show GitHub price rows used by the estimator.
- Store structured model, pricing row, token total, and estimated cost on token-bearing trace events.
- Convert estimates into GitHub AI credits and show Business/Enterprise allowance context.
- Show cost drivers: input/cache cost, largest model call, model mix, and tool activity.
- Clarified the input-side cost driver so it leads with estimated USD spend and treats the percentage as supporting context, not the main fact.
- Keep source-confidence language in docs and ingestion diagnostics rather than primary selected-run chips.
- Show logs and agent flow chart with token/cost detail.
- Add session size and cost-signal labels.
- Add session filters for size and cost signal. Source-quality filters were removed from the main Sessions rail because they were implementation jargon.
- Add a per-turn model-call cost breakdown with timeline and largest-first modes.
- Split selected-run debugging into `Overview`, `Cost`, `Calls`, and `Trace` subviews.
- Add Cost and Calls answer panels so the user sees the likely driver before reading detailed tables.
- Added a compact request-payload evidence section in Cost for source-backed system prompt size, tool schema size, MCP tool count, and largest tool payloads.
- Keep `Normal input`, `Cached input`, `Cache write`, and `Output` visibly separate in cost views and comparisons.
- Added regression tests for the shared cache-aware pricing buckets, including normal input, cached input, cache write, and output.
- Added scanner fixture tests for raw Agent Debug Log `cachedTokens`, invalid cached-token splits, cache-write pricing, and merged cache audits.
- Added Trace inspector coverage for cached model-call details, fallback pricing labels, and tool events that are not directly priced.
- Preserved raw VS Code `llm_request.attrs.estimatedCost` separately on trace events when present, without mixing it into the app-calculated estimate.
- Recorded optional matching Chat Debug transcript availability for debug-log sessions without using transcripts for pricing.

Next:

- Keep user-facing source language minimal. Show debug-log/source details in docs or ingest diagnostics, not as primary selected-run chips.
- Remove low-value banners and technical caveats from the main Cost view unless they change a decision.
- Compare raw VS Code `estimatedCost` with the app-calculated estimate only after enough real sessions show this field consistently.

Why: the core workflow is “I ran an agent, why was this expensive?” The selected run has to be readable before comparison gets deeper.

## Phase 2: Session Labels And Triage

Status: started.

Done:

- Session size labels: `Small`, `Medium`, `Large`, `Very large`.
- Cost-signal labels now focus on actionable signals such as `High input context` and `Mixed models`.
- Filters for size and cost signal.
- Filters for workspace, model, and anchored time windows.
- Better session-list scanning: cost, model, size, and tokens.

Build:

- Recalibrate size thresholds from real usage as more sessions are imported. Current `Very large` starts at 1.5M imported tokens.
- Continue recalibrating labels from real usage and avoid reintroducing source/status jargon that does not help the developer decide what to optimize.

Why: a developer should spot suspicious runs before opening each one.

## Phase 3: Better Comparison

Status: built, prompt-testing ergonomics started.

Done:

- Side-by-side selected-run comparison.
- Explain what changed: cost, input tokens, output tokens, model mix, and tool count.
- Highlight model switches and price-row changes.
- Show “winner/loser” language carefully: cheaper is not always better if the run failed.
- Extracted Compare into its own top-level Angular component so it is no longer embedded in the root shell template.
- Detect repeated normalized first prompts and label whether the current comparison is same-prompt or manual.
- Add a `Prompt testing` panel with same-prompt empty state and quick pair actions when repeated prompts exist.
- Improve A/B selector labels with timestamp and estimated USD cost.
- Replaced native Compare dropdowns with app-owned searchable run pickers.
- Added same-prompt spread explanations for repeated prompt groups.
- Added Compare component tests for repeated-prompt spread explanation and A/B swap behavior.
- Added Compare fixture coverage for cached-token movement rows.
- Added Compare headline delta/caveat test coverage.

Next:

- Add an explicit same-prompt group drawer once there are enough repeated-prompt sessions to validate the flow.
- Add side-by-side output/detail comparison only after the app has a reliable readable output source for both runs. Do not imply quality comparison when only cost/debug facts are available.

Why: comparison is useful when testing prompts, models, MCP setup, or workflow changes.

## Phase 4: Multi-Session Analytics Dashboard

Status: built, first pass.

Done:

- Added a separate `Analytics` top-level view between `Sessions` and `Prices`.
- Starts from the current sidebar filters as the analytics universe.
- Adds Analytics-specific controls for time range, workspace, model, and day/week/month grouping.
- Shows session count, total tokens, total estimated cost, average tokens, average cost, and cost per 1k tokens.
- Shows AI credits used for the current Analytics cohort and converts key cost displays into USD plus credits.
- Added Analytics credit windows for current month, previous month, and rolling ranges, anchored to the latest imported session date.
- Added plan and seat controls so the current Analytics cohort can be compared against Copilot Business/Enterprise monthly included AI credits.
- Highlights highest-token and most expensive sessions.
- Shows model/pricing-row breakdowns.
- Shows grouped trend rows, size distribution, and outlier signals.
- Explains likely outlier drivers such as input/context dominance, expensive model share, context growth, and high tool-call count.
- Includes a reset for Analytics-only filters and a clear empty state when the current cohort has no sessions.
- Separates a few obvious outlier cases, including plausible long agent runs and suspicious low-activity spikes.
- Extracted Analytics into its own Angular component so the dashboard no longer lives inside the root shell template.
- Added explicit `Open run` cues and test coverage for Analytics action cards that open selected sessions.
- Extracted Analytics calculation logic into `session-analytics.ts` and covered filters, cached token model rows, trend grouping, distribution, and outlier reasons with tests.
- Added Analytics empty-state/reset test coverage.

Next:

- Keep clarifying the difference between `Credit window` as the included-session filter and `Group trend by` as the trend bucket display.
- Improve outlier explanation with more real imported sessions.
- Add saved comparison/cohort concepts later if app-owned SQLite becomes the right durable state layer.
- Consider calendar-month AI-credit usage windows if billing-cycle style comparison becomes important.

Why: after one run and two-run comparison are understandable, the next developer question is “what is my normal usage pattern, and which runs are outliers?”

## Phase 5: Advanced Session Signals

Status: pruned back, with stronger source-backed fields now available.

Done:

- Import `ttft`, `maxTokens`, reasoning-text presence, request reasoning effort when `llm_request.attrs.requestOptions.reasoning.effort` is present, and max observed input tokens from VS Code debug logs.
- Removed weak advanced evidence cards from the primary UI.
- Keep reasoning text presence, request reasoning effort, and request-cap comparison in the generated data contract for future investigation.

Build:

- Reasoning/thinking level display now has a source-backed path from Agent Debug Logs. Keep it secondary unless it clearly helps explain a specific run.
- Context-window usage only after the app stores reliable model context-window sizes and can compare max observed input tokens against that window.

Why: these may become useful cost-debugging signals, but they must earn their place in the UI. The app should not turn weak or overly technical clues into top-level product concepts.

## Phase 6: Per-Turn Cost Breakdown

Status: built.

Done:

- Replaced the current `Largest model calls` section with an ordered model-call table.
- Shows each token-bearing model call with index, timestamp, model, pricing row, input tokens, output tokens, estimated cost, input/output cost split, and share of session cost.
- Kept a sorted `Largest first` mode so high-cost calls remain easy to find.
- Adds nearby prior-event context so a developer can tell what kind of activity preceded the expensive call.
- Moved the model-call table into the selected-run `Calls` subview so Cost explains the estimate and Calls explains where it happened.
- Added a Turn insights strip: model-call count, most expensive call, largest input, largest output, and average cost per call.
- Made row highlighting explicit with `High share` and `Medium share` labels.

Next:

- Keep checking row density with real imported sessions as the Calls table grows.

Why: session totals explain that a run was expensive. Calls explain where it became expensive.

## Phase 7: UX And Style Rework

Status: started.

Direction:

- Midnight debugger theme.
- Custom Angular/CSS first, no component library yet.
- Top-level navigation for Sessions, Compare, Analytics, and Prices.
- Selected-run content stays primary on narrow screens.

Done:

- Added the new app shell foundation.
- Promoted Compare into the top navigation.
- Removed the old hidden Compare copy from the Sessions view.
- Reordered the selected-run view so the run hero, summary, and Cost debugger come before supporting metadata.
- Compacted Data provenance into the top Sessions workspace overview.
- Added selected-run subviews for Overview, Cost, Calls, and Trace.
- Made Cost and Calls lead with diagnostic answer panels before the detailed tables.
- Reworked the selected-run navigation into an investigation map: Run facts, then Cost diagnose, Calls review, and Trace verify.
- Polished Trace rows and inspector grouping so Trace reads like the evidence step in the debugger flow.
- Extracted the selected-run Overview subview into its own Angular component.
- Extracted the selected-run Cost subview into its own Angular component.
- Extracted the selected-run Calls and Trace subviews into standalone Angular components.
- Added the first proper help popover component and started using it in the Cost debugger.
- Replaced native browser `title` tooltips with the shared help popover across the app UI.
- Reworked the help icon to a centered `i` mark and removed stale `.help-dot` styles.
- Improved Cost and Calls responsive tables so narrow screens show labeled card rows instead of relying only on horizontal scroll.
- Applied the first dark diagnostic design-token layer.
- Added the first density/typography polish pass: modern system font stack, quieter weights, smaller headings, tighter cards, smoother states, and clamped long session prompts.
- Pruned redundant Sessions/Overview facts so repeated model, token, source, run-size, provenance, and fallback-pricing details have clearer primary locations.
- Changed narrow layout behavior so the session rail moves below the content instead of replacing it.
- Made unknown-model pricing fallbacks visible across selected run, Cost, Calls, Compare, Analytics, and Prices.
- Added a selected-run AI-credit meter and Prices-page allowance selector for Copilot Business/Enterprise included credits.
- Added a visible "open run is outside current filters" state when sidebar filters hide the selected session.
- Restyled Overview Run Triage labels as compact chips.
- Fixed the top navigation grid for the four top-level views.
- Extracted the Prices page into a standalone component.
- Extracted the generated-data loading/error panel into a standalone component.
- Extracted the Compare page into a standalone component with its own template and styles.
- Extracted the Analytics page into a standalone component with its own template, styles, and cohort logic.
- Removed enough obsolete root CSS for production builds to pass without the component style budget warning.
- Removed the top-right app-bar `Estimate` pill so the selected-run estimate remains the only prominent run estimate in Sessions.
- Added app-shell test coverage for `Overview -> Cost -> Calls -> Trace` selected-run navigation.
- Added app-shell test coverage for opening a model call from Calls in the matching Trace event.
- Removed stale Cost view-model fields for old source/cache caveat panels that are no longer part of the Cost UI.
- Tightened Compare and Prices responsive CSS so repeated-prompt comparison and allowance cards collapse cleanly on narrower screens.
- Added source-backed reasoning effort to the selected-run Overview only when VS Code logs the request setting.

Build:

- Bring Compare, Analytics, and Prices up to the same visual polish level as the Sessions debugger.
- Continue browser-checking dense pages with real imported data as the UI changes.
- Tune help popover placement for tight table edges if real sessions expose clipped panels.
- More debugger-like polish.
- Keep selected-run Cost, Calls, and Trace explanation logic in focused helpers/services.
- Continue pruning terminology that leaks implementation details, including "state enriched", source jargon, and repeated debug-log caveats.

Why: the app has complex information. Better style should reduce cognitive load, not hide details.

## Phase 8: Code And Data Reliability

Status: proposed near-term hardening.

Done:

- Moved GitHub Copilot pricing into one shared JSON file used by the scanner, verifier, and UI.
- Added a visible app data loading/error state for `/data/sessions.json`.
- Moved generated session-data loading into `SessionDataService`.
- Added shared UI cost helpers for model-cost rows, token totals, percent deltas, and pricing fallback explanations.
- Added script-side tests for model normalization, unknown-model fallback, direct pricing matches, and fallback-row pricing.
- Extracted selected-run Cost, Calls, and Trace state into `SelectedRunExplanationService`.
- Extracted Analytics filtering, model rows, trend rows, distribution, and outlier logic into `session-analytics.ts`.
- Added UI/helper tests for Analytics calculations, Analytics open-run actions, Analytics empty states, session rail filters, selected-run navigation, Calls-to-Trace, Compare delta copy, and selected-run pricing fallback assumptions.
- Added Prices page tests for AI-credit usage windows and fallback pricing row labels.
- Added selected Trace inspector tests for cached model calls, fallback pricing, and tool-call detail boundaries.
- Added fixture-based scanner tests for exact Agent Debug Log token totals, mixed-model sessions, empty debug logs, and weak chat snapshots.
- Fixed chat snapshot parsing for `kind: 0` envelopes so valid snapshot payloads are not skipped.
- Added fixture-based scanner tests for optional transcript availability while keeping pricing driven by Agent Debug Log token fields.

Build:

- Continue moving page-level interpretation logic out of large components when it has stable behavior and useful test cases.

Why: the app is now past prototype shape. The risky parts are no longer just "can we show the data?" They are "can pricing, cache buckets, fallback assumptions, and filters stay correct as the UI grows?"

## Phase 8.5: Local Packaging

Status: documented.

Done:

- Added [local deployment notes](local-deployment.md) covering dev mode, static local builds, future desktop wrapper, and future CLI.
- Added `npm run refresh:data` as the one-command local scan plus verify flow.

Build:

- Decide whether the next practical distribution target is a static local build with a small serve command or a desktop wrapper.

Why: this project should stay local-first because the useful source data lives on the developer machine and may contain prompts, file paths, repo context, and tool results.

## Phase 9: Trace Event Inspector

Status: built first pass.

Done:

- Make Trace log rows clickable.
- Open a right-side detail drawer or inline inspector for the selected event.
- Show the full normalized event fields: raw index, timestamp, type, name, status, token totals, model, pricing row, estimated cost, latency fields, and source detail.
- Link model-call rows in `Calls` to the matching raw event in `Trace`.
- Add event filters for model calls, tool calls, discovery/customization events, user messages, and agent responses.
- Add UI tests around selected-event inspector details, including cached token splits and tool events.
- Preserve enough debug-log payload summary during ingestion to make this useful without forcing the UI to parse raw VS Code JSONL directly. Current `traceEvents.detail` strings are too short for a good inspector by themselves.

Still to improve:

- Tune inspector layout as more real logs are imported.
- Add more useful bounded summaries for common VS Code debug-log event shapes when the source payload exposes them.
- Consider optional enrichment from matching `GitHub.copilot-chat/transcripts/<session-id>.jsonl` only after the UI can show source availability and confidence. Transcripts can be rich, but they are not consistently complete across sessions or restarts.

Why: the Trace view is currently good for scanning, but debugging needs selection. VS Code's own Agent Debug Logs let a user click an event and inspect details. This app should do the same, with cost fields added.

## Phase 10: Input Attribution And MCP Impact

Status: started, needs careful evidence boundaries.

Debugger questions:

- What effect on token and cost did my GitHub/custom instructions have?
- What effect on token and cost did MCP servers, skills, slash commands, agents, hooks, or other customizations have?

Build:

- Preserve bounded, structured summaries of relevant Agent Debug Log fields:
  - `llm_request.attrs.cachedTokens`
  - `llm_request.attrs.requestOptions.reasoning.effort`
  - `llm_request.attrs.systemPromptFile`
  - `llm_request.attrs.toolsFile`
  - side files such as `system_prompt_*.json` and `tools_*.json`
  - `tool_call` argument/result payload sizes
  - nested `runSubagent-*.jsonl` presence
- Keep `cachedTokens` import covered in debug-log ingestion and add any future explicit numeric cache fields as they appear. Treat `cache_control` hints or prompt-cache metadata as evidence about cache behavior, but not as billable cached-token counts unless the event exposes numeric cached-token totals.
- Keep the observed Agent Debug Log schema documented in [debug-log-schema.md](debug-log-schema.md) and add fixture coverage before building new cost claims from newly discovered fields.
- Promote the compact Cost request-payload evidence into a deeper `Input attribution` panel only after the scanner preserves enough structured request sections.
- Break the request payload into visible buckets when the debug log exposes them: user prompt, environment/workspace context, custom instructions, tool references, tool results, MCP tool calls/results, prior conversation, and system/developer material.
- For instructions, tools, MCP schemas, and skills, start with source-backed counts: presence, character count, approximate token estimate, and the model calls where the payload appeared.
- Group tool and MCP activity by server/tool name, with counts and nearby model-call cost.
- Show "affected nearby cost" first, then only show token/cost allocation for a bucket when the app can calculate it from source-backed request payload sections.
- Add comparison support for MCP/tool setup changes: which servers/tools appeared, which disappeared, and how model-call input moved afterward.

Why: the practical optimization question is "what is making my developers' runs expensive?" If 20 developers have many MCP servers enabled, the app should help identify which servers and tool results are inflating request context. The app must avoid pretending it has exact per-section billing unless the source data supports it.

Evidence boundary:

- Exact local cost currently exists at the `llm_request` level.
- Cached input is exact only when the Agent Debug Log exposes numeric `cachedTokens`.
- Reasoning effort is source-backed when present under `requestOptions.reasoning.effort`.
- `systemPromptFile` and `toolsFile` side files can show setup payload size, tool count, MCP tool names, and large schema payloads.
- Tool/MCP/discovery events can be counted and placed near model calls.
- Character counts and approximate section sizes are useful for optimization, but they are not provider token bills.
- Per-section input attribution may be derived from raw request payload fields when available, but it is not the same as provider billing unless segment token counts are logged directly.

## Phase 11: App-Owned SQLite

Build:

- Immutable scan history.
- User labels and comparison groups.
- User-editable run tags such as `new instructions applied`, `MCP compression enabled`, or `baseline prompt`.
- Saved prompt-test groups so repeated runs of the same prompt can be reviewed later without relying only on automatic matching.
- Notes tied to session ids.
- Stored pricing table snapshots.
- Optional future price scenarios.

Why: VS Code `state.vscdb` is external editor state and should stay read-only enrichment. App-owned SQLite becomes useful once the app has durable user state.

## Phase 12: Billing Reconciliation

Status: later, not the current focus.

Build:

- Import GitHub billing or usage exports.
- Match billed rows to local sessions where possible.
- Show local estimate, billed amount, and delta without overwriting either source.
- Explain unmatched rows.

Why: GitHub billing is authoritative for what was charged, but reconciliation should come after local session estimates are easy to understand.

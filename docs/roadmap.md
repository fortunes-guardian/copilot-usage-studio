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
- Added a compact setup-clues section in Cost for system prompt size, tool schema size, MCP tool count, and largest tool text groups.
- Keep `Normal input`, `Cached input`, `Cache write`, and `Output` visibly separate in cost views and comparisons.
- Added regression tests for the shared cache-aware pricing buckets, including normal input, cached input, cache write, and output.
- Added scanner fixture tests for raw Agent Debug Log `cachedTokens`, invalid cached-token splits, cache-write pricing, and merged cache audits.
- Added Trace inspector coverage for cached model-call details, fallback pricing labels, and tool events that are not directly priced.
- Preserved raw VS Code `llm_request.attrs.estimatedCost` separately on trace events when present, without mixing it into the app-calculated estimate.
- Preserved VS Code `llm_request.attrs.copilotUsageNanoAiu` as source usage evidence, use it as the primary local usage total when present, and verify that it reconciles with app-calculated token pricing.
- Centralized source-first usage helpers so the selected-run header, Usage totals, Compare deltas, Insights breakdowns, sidebar costs, and model-call displays use GitHub source usage before token-estimate fallback.
- Centralized the information architecture: Usage is now the default home and owns calendar windows, workspace/model scope, and allowance context; selected-run Cost explains one run; Insights owns model mix, distribution, trends, and outliers.
- Replaced the cramped narrow-screen Sessions column with a dismissible session-browser drawer while retaining the full rail on desktop.
- Recorded optional matching Chat Debug transcript availability for debug-log sessions without using transcripts for pricing.
- After the 2026-05-30 VS Code/Copilot update, preserved debug-log runtime metadata (`vscodeVersion`, `copilotVersion`) plus request-shape and text-verbosity metadata from new Agent Debug Log fields.
- Added a compact selected-run Context Load card that compares largest raw input with `models.json` prompt/context limits and distinguishes near-limit runs from repeated-context runs without showing noisy model capability metadata.
- Added a Context Load timeline inside Calls: raw `inputTokens` per model call, prompt-limit percentage when model metadata is available, repeated-input summary, and click-through from each bar to Trace.
- Added a compact Setup Footprint panel in Calls that summarizes referenced instruction/tool/MCP side-file payload size and shows whether that setup changed across model calls.
- Audited VS Code 1.124.2 / Copilot Chat 0.52.0 Agent Debug Logs: preserved structured request-chain metadata and kept new generic `Resolve Customizations` events inside setup/discovery Trace grouping.
- Added a versioned, privacy-safe raw schema audit with newest-runtime cohort comparison, breaking/warning/info classification, regression tests, and an explicit weekly baseline acceptance workflow.

Next:

- Keep user-facing source language minimal. Show debug-log/source details in docs or ingest diagnostics, not as primary selected-run chips.
- Add a compact Calls cue for `Initial request` versus `Tool-result continuation` using structured `requestShape` evidence. Keep it secondary to tokens and usage, and do not present it as exact per-tool cost attribution.
- Remove low-value banners and technical caveats from the main Cost view unless they change a decision.
- Keep source usage visually primary. Use token-bucket pricing as explanation and fallback; keep reconciliation differences in diagnostics unless they materially change the displayed usage story.
- Continue tuning Context Load copy against larger real sessions. Keep it as capacity context, not billing prediction.
- Use the Context Load timeline with more real sessions to decide whether a deeper per-turn chart is useful, while keeping the current version grounded in `models.json` limits and observed `inputTokens`.
- Keep the Calls timeline focused on model input over time. Use the separate Setup Footprint panel for instruction/tool/MCP payload evidence so repeated setup payloads do not bloat the timeline.

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
- Removed the separate `Prompt testing` panel because it made Compare harder to understand. Same-prompt detection now appears inside the normal A/B run pickers.
- Improve A/B selector labels with timestamp and source-first USD usage.
- Replaced native Compare dropdowns with app-owned searchable run pickers.
- Removed same-prompt spread explanations for repeated prompt groups; the page now stays focused on one baseline and one candidate.
- Added Compare component tests for same-prompt picker cues and A/B swap behavior.
- Added Compare fixture coverage for cached-token movement rows.
- Added Compare headline delta/caveat test coverage.

Next:

- Keep Compare simple: one baseline picker, one candidate picker. Do not add a same-prompt group drawer unless real usage proves the picker cues are insufficient.
- Add side-by-side output/detail comparison only after the app has a reliable readable output source for both runs. Do not imply quality comparison when only cost/debug facts are available.

Why: comparison is useful when testing prompts, models, MCP setup, or workflow changes.

## Phase 4: Usage Home And Multi-Session Insights

Status: built and consolidated.

Done:

- Made `Usage` the default home and the single place for last-session, today, week, calendar-month, allowance, and selected-scope answers.
- Added independent Workspace and Model scope controls to Usage.
- Renamed the deeper multi-session page to `Insights`.
- Removed duplicated headline totals and allowance controls from Insights.
- Insights starts from all imported sessions and owns its Time range, Workspace, Model, and day/week/month grouping controls.
- Highlights highest-token and most expensive sessions.
- Shows model/pricing-row breakdowns.
- Shows grouped credit trend rows, run size mix, and outlier signals.
- Makes trend and size rows actionable by opening the highest-cost run in that bucket.
- Explains likely outlier drivers such as input/context dominance, expensive model share, and high tool-call count.
- Includes a reset for Insights-only filters and a clear empty state when the current cohort has no sessions.
- Separates a few obvious outlier cases, including plausible long agent runs and suspicious low-activity spikes.
- Extracted Analytics into its own Angular component so the dashboard no longer lives inside the root shell template.
- Added explicit `Open run` cues and test coverage for Insights action cards that open selected sessions.
- Extracted Analytics calculation logic into `session-analytics.ts` and covered filters, cached token model rows, trend grouping, distribution, and outlier reasons with tests.
- Added Insights empty-state/reset test coverage.

Next:

- Keep "How much did I use?" centralized on Usage. Do not reintroduce allowance/headline usage summaries into Insights or selected-run Cost.
- Add a small daily/monthly usage chart or calendar strip only if it helps answer the usage question faster than the current recent-days list.
- Consider local budget thresholds later: "warn me when my month-to-date local usage crosses X credits" without requiring SaaS billing import.
- Improve outlier explanation with more real imported sessions.
- Add saved comparison/cohort concepts later if app-owned SQLite becomes the right durable state layer.
- Consider org/team license-pool modelling later only if the app imports team-wide data. A local VS Code import should stay focused on one developer's runs.

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
- Simplified call-share display to a neutral percentage and meter, removing warning-style row edges and share labels.

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
- Renamed Cost request-payload copy to `Setup payload clues` so it reads as optimization evidence, not exact per-item billing.

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
- Refreshed the shared GitHub rate-card snapshot on June 14, 2026 and added per-call long-context tiers for GPT-5.4, GPT-5.5, and Gemini 3.1 Pro.
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

Status: started.

Done:

- Added [local deployment notes](local-deployment.md) covering dev mode, static local builds, future desktop wrapper, and future CLI.
- Added `npm run refresh:data` as the one-command local scan plus verify flow.
- Extracted a reusable, in-memory Node scanner API in `lib/scanner-api.mjs`.
- Kept the current scan command as a thin backward-compatible CLI host over the shared API.
- Added API contract tests for in-memory results, repeat-scan diagnostic isolation, explicit persistence, invalid options, and the positional CLI contract.
- Documented the API contract and host boundaries in [scanner-api.md](scanner-api.md).
- Added a local runtime with cached-first startup plus scan, status, normalized-session, and compatibility data endpoints.
- Kept the last valid snapshot available during scans and after failed refresh attempts.
- Changed `npm start` to launch the runtime and Angular dev server together through a local proxy.
- Added a compact global refresh action with scan progress, imported-session count, and last-generated timestamp.
- Added `npm run preview:local` to build and serve the production UI and scanner runtime together.
- Added runtime tests for refresh, status, persistence, failure retention, static SPA delivery, and CLI options.
- Added a zero-runtime-dependency `copilot-usage-studio` executable for `npx` and global npm use.
- Added cross-platform user-owned cache paths so disposable npm installations never own session data.
- Added `serve`, `scan`, `status`, help, version, custom root, host, and port CLI behavior.
- Excluded `public/data/sessions.json` from production assets and the npm package privacy boundary.
- Added npm publish metadata, explicit package file allowlisting, Node engine requirements, and a full `release:check` gate.
- Added CLI tests covering Windows/macOS/Linux paths, argument parsing, scanner output, runtime wiring, and status output.
- Renamed the product and distributable package to Copilot Usage Studio before the first public release.
- Replaced the Angular starter favicon and added the initial release changelog.
- Published `copilot-usage-studio@0.1.0` publicly on npm and verified the CLI from a clean installation directory.
- Added GitHub Actions CI for pull requests and `main`, using the same full package gate as a release.
- Added tag-driven npm Trusted Publishing and matching GitHub Release creation, with tag/package-version validation, conflict protection, and safe reruns for the same commit.

Build:

- Add debounced background rescans of relevant debug-log directories after observing the manual/startup workflow in real use.
- Use Electron as the first desktop wrapper unless scanner constraints materially change.
- Add a thin VS Code companion extension only after the local runtime/import workflow is stable.
- Investigate Visual Studio as a separate source adapter. Do not promise support until equivalent durable token and usage evidence is found.

Why: this project should stay local-first because the useful source data lives on the developer machine and may contain prompts, file paths, repo context, and tool results.

## Phase 9: Copilot Memory Library

Status: first read-only slice built.

Done:

- Scan workspace and global VS Code Copilot memory stores.
- Classify global, repository, workspace, and session-scoped memory.
- Distinguish saved plans from general memory files.
- Decode session memory folders and link them to imported Agent Debug Log sessions.
- Add a top-level Memory library with search, scope/type/workspace filters, readable Markdown source, and session links.
- Add local-runtime-only file open and reveal actions without exposing arbitrary filesystem access to the browser.
- Bound scanning to Markdown, 1 MiB per file, and 5,000 files per root.
- Add source-backed recall history from explicit Agent Debug Log `memory view` events: memory path, timestamp, session, returned content size, and the following model call.
- Show recall frequency and last observed use without claiming exact memory-only tokens or cost.

Next:

- Validate memory layouts across more VS Code/Copilot versions and macOS/Linux installations.
- Measure memory-inventory size separately from full-memory reads. Treat it as context footprint evidence, not a provider token bill.
- Investigate safe edit/delete behavior and any hidden VS Code index before enabling mutation.
- Consider a domain/code-area view when memory content or source evidence provides a reliable mapping.
- Consider an explicit "promote to instructions" workflow only as a reviewed transformation, never an automatic rewrite.

Why: Copilot can save useful repository knowledge and plans in local files with little cross-session visibility. A read-only library makes that knowledge discoverable without claiming that every saved memory is recalled or consumes tokens.

## Phase 10: Trace Event Inspector

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

## Phase 11: Input Attribution And MCP Impact

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
- Add per-model-call setup payload summaries from `systemPromptFile` and `toolsFile` references: system/custom instruction file size, tool schema file size, total tool count, MCP tool count, and largest schema descriptions. Show these as payload size evidence, not exact token bills.
- Add user-request grouped call summaries: for each user prompt boundary, show the following model calls, biggest input request, repeated input load, setup payload files referenced, tool/MCP schema size, and large tool results observed after the prompt.
- Add lightweight badges to the Calls timeline/table when reliable: `You` for a preceding user prompt and setup markers only when the referenced instructions/tools/MCP payload first appears or changes. Do not mark every call when the same setup payload is attached repeatedly.
- Break the request payload into visible buckets when the debug log exposes them: user prompt, environment/workspace context, custom instructions, tool references, tool results, MCP tool calls/results, prior conversation, and system/developer material.
- For instructions, tools, MCP schemas, and skills, start with source-backed counts: presence, character count, file references, and the model calls where the payload appeared. Avoid approximate token estimates in the primary UI unless the source exposes section token counts.
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
- The app can say "this model request referenced this large instructions/tools payload" when the side-file reference is present. It should not say "this instruction cost $X" unless the log exposes section-level token totals or billing fields.
- Per-section input attribution may be derived from raw request payload fields when available, but it is not the same as provider billing unless segment token counts are logged directly.

## Phase 12: App-Owned SQLite

Build:

- Immutable scan history.
- User labels and comparison groups.
- User-editable run tags such as `new instructions applied`, `MCP compression enabled`, or `baseline prompt`.
- Saved prompt-test groups so repeated runs of the same prompt can be reviewed later without relying only on automatic matching.
- Notes tied to session ids.
- Stored pricing table snapshots.
- Optional future price scenarios.

Why: VS Code `state.vscdb` is external editor state and should stay read-only enrichment. App-owned SQLite becomes useful once the app has durable user state.

## Phase 13: Billing Reconciliation

Status: later, not the current focus.

Build:

- Import GitHub billing or usage exports.
- Match billed rows to local sessions where possible.
- Show local estimate, billed amount, and delta without overwriting either source.
- Explain unmatched rows.

Why: GitHub billing is authoritative for what was charged, but reconciliation should come after local session estimates are easy to understand.

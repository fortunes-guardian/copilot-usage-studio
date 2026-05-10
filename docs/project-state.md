# Project State

Start here when resuming the project.

## What We Are Building

A local-first cost debugger for VS Code GitHub Copilot chat and agent sessions.

The app should help a developer answer:

- Which run was expensive?
- Which model, token category, or model call caused the cost?
- Can I compare two runs and see whether a prompt/workflow change helped?
- What is normal across all imported runs, and which sessions are outliers?

This is not trying to be a full billing dashboard yet. Billing reconciliation can come later. The first product should make one selected run excellent and understandable.

Principles:

- One run excellent first.
- Transparency over magic.
- Local-first data.
- Debug logs are preferred for cost.
- VS Code SQLite is enrichment, not pricing.
- Human labels beat raw internal strings in the UI.

## What Works Now

- Scans local VS Code Copilot debug logs.
- Enriches sessions from VS Code `state.vscdb` for better titles and metadata.
- Generates `public/data/sessions.json` as the app contract.
- Shows sessions, source metadata, summary metrics, and trace logs.
- Filters sessions by size, source quality, and cost-debugging signal.
- Shows a GitHub prices page with the pricing rows used by estimates.
- Calculates cost from imported token counts and GitHub model prices.
- Converts local USD estimates into GitHub AI credits and compares them with toggleable Copilot Business/Enterprise included allowances.
- Uses one shared GitHub pricing JSON file for the scanner, verifier, and UI.
- Shows a visible loading/error state if the generated ledger data cannot be loaded.
- Ledger loading now lives in `LedgerDataService` instead of the root component.
- The Prices page, Compare page, Analytics page, and ledger loading/error panel are standalone Angular components.
- The selected-run Overview, Cost, Turns, and Trace subviews are now standalone Angular components.
- Shared cost helpers now hold reusable model-cost, token-total, context-growth, percent-delta, and pricing-fallback utility logic.
- Shows a selected-run Cost debugger with:
  - source/confidence explanation
  - estimate-scope note for missing cache billing fields
  - Billing Reality Check for cache visibility and invoice-risk direction
  - a primary-driver answer for the current estimate
  - run size and cost-signal labels
  - cost driver cards
  - token category totals
  - per-model pricing rows
- Splits the selected run into subviews:
  - `Overview`: summary, details, and triage
  - `Cost`: estimate scope, drivers, token categories, and per-model price rows
  - `Turns`: per-turn model-call insights plus timeline/largest-first ledger modes
  - `Trace`: filterable raw logs, clickable event inspector, and agent flow
- Trace rows now visually distinguish model calls, tool calls, user messages, responses, discovery events, errors, and token-bearing events.
- Shows an agent flow chart with token/cost detail.
- Compares two runs with metric deltas, cost-driver explanation, context-growth change, and model/pricing-row movement.
- Shows a separate Analytics view for multi-session questions across the current filter set:
  - time range, workspace, model, and day/week/month grouping controls
  - totals and averages
  - highest-token and most expensive sessions
  - model breakdown
  - trend rows
  - size distribution
  - clearer empty states when cohort controls exclude all sessions
  - outlier signals with first-pass "why high cost?" explanations
- Started the Midnight Ledger UI overhaul:
  - top-level app bar with Sessions, Compare, Analytics, and Prices
  - Compare promoted out of the selected-session stack
  - selected-run content stays primary on narrow screens, with the session rail moving below it
  - dark diagnostic design tokens for panels, tables, badges, and cost signals
  - selected-run hierarchy now uses Overview, Cost, Turns, and Trace instead of one stacked report
  - Cost, Turns, and Trace now read as a guided investigation flow: diagnose the cost, locate the model call, then verify the raw trace event
  - first density/typography polish pass: calmer type scale, tighter cards, clamped session prompts, and smoother navigation states
  - native browser `title` tooltips have been replaced with the shared help popover in the app UI
  - redundant selected-run facts have been pruned so Overview no longer repeats model, token, source, run-size, or fallback facts already shown in the run hero
  - fallback pricing assumptions are now visible in the selected-run header, Cost table, Turns ledger, Compare, Analytics, and Prices page
  - sidebar filters now show a clear state when the open run is outside the visible filtered rail
  - Analytics now uses a quieter cohort header and compact controls so the model breakdown stays near the top of the dashboard
  - Trace keeps the selected event inspector visible while scrolling long event logs, with a stacked debugger layout on narrower content widths

## Important Design Decisions

- Debug logs are the preferred cost source because they include model ids plus input/output token counts.
- Chat snapshots are weaker and should not be treated as equal to debug logs for cost.
- `state.vscdb` is metadata enrichment only. It improves labels and restored-session details; it does not drive pricing.
- Cache billing is not visible in the local debug logs observed so far. Do not present zero cache fields as proof of zero provider-side cache billing.
- Cached input is a separate input/context billing bucket, not a discount against output. The UI should call this out because it is easy to misunderstand when reading large output/cached-token totals.
- The UI should explain local estimates clearly instead of pretending they are GitHub invoice numbers.
- AI-credit allowance percentages are context, not reconciliation. Business and Enterprise credits are pooled across the billing entity, while the selected-run meter shows a per-seat allowance comparison unless the app later adds seat counts.
- The generated ledger should carry structured cost facts. The UI should not parse model/cost data out of display strings.
- Run size and cost-signal labels are derived UI triage. They should help scanning, but they should not silently become billing facts.
- Multi-session analytics are deliberately separate from the selected-run debugger. The analytics view answers "what is normal across included sessions?" while the Sessions view answers "why did this one run cost what it cost?"
- Analytics start from the current sidebar filters, then apply Analytics-specific cohort controls. This keeps global search/source/quality filtering consistent while making time range, workspace, model, and trend grouping visible on the dashboard itself.
- The UI overhaul is starting with custom Angular/CSS rather than a component library. The app needs tight control over dense diagnostic layout, tables, and cost explanations before it needs generic widgets.
- The selected run remains the primary object on narrow screens. The session rail is useful navigation, but it should not hide the current debugging surface.
- Selected-run analysis should live outside the Angular shell. The root component should coordinate state and navigation; pure cost, trace, and triage interpretation belongs in focused helper modules that are easier to test.
- Sessions-page import totals are context only. They should be visually secondary and explicitly labelled as imported-session totals so users do not confuse them with the selected run.

## Current Rough Edges

- The UI is much calmer after the first polish pass. Compare and Prices have had a first audit pass, but the large root stylesheet still needs cleanup.
- Help popovers now use the shared UI component instead of native browser title behavior. Some lower-priority sidebar badge hints were intentionally removed rather than nesting interactive popovers inside session-card buttons.
- The Trace inspector now shows normalized event fields, but it is still limited by the bounded payload summaries the scanner imports. It is good for event-level evidence, not full raw JSONL replacement.
- VS Code transcript files under `GitHub.copilot-chat/transcripts/<session-id>.jsonl` can contain richer Chat Debug timeline events, but they are inconsistent. In the current workspace, some sessions have rich transcripts and weak debug logs, while another has useful debug logs and only a `session.start` transcript. The scanner does not import transcripts yet, and core cost features should not depend on them.
- The app can count tool/MCP activity and place it near model calls, but it does not yet attribute model input tokens to specific request sections such as instructions, MCP tool results, or workspace context.
- Aggregated analytics are useful but still early. Outlier detection is a simple statistical signal with driver hints; it now separates a few obvious cases such as long agent runs and suspicious low-activity spikes, but it should become more nuanced as more real sessions are imported.
- Advanced evidence is imported but mostly hidden from the primary UI. Reasoning text presence and request-cap comparison were too technical to be useful as top-level cards.
- No app-owned database yet. Scans overwrite `public/data/sessions.json`.
- `app.css` is still large and contains some older shell-era selectors. Keep shrinking it as page chrome and shared layout pieces move into focused components.
- Pricing/model normalization is now centralized in runtime-specific shared helpers: Angular uses `src/app/pricing.ts`, while scanner/verifier scripts use `scripts/pricing-utils.mjs`. Keep new model matching, fallback, and token-cost logic in those helpers.

## Review Notes

Latest review: May 3, 2026.

Verified:

- `npm run verify:data` passes for the current generated ledger.
- `npm test -- --watch=false` passes.
- `npm run build` passes without the previous component CSS budget warning.
- The live app has no browser console warnings/errors from the Angular page during the review, including the extracted Compare page.
- Current generated data has `5` imported debug-log sessions, all with trace event counts matching `traceSummary.totalEvents`.
- Two current sessions use `gpt-4o` as the raw/display model but fall back to the `GPT-5.4` pricing row.

Code improvements to schedule:

- Move selected-run explanation logic out of the root component into focused services or helper modules.
- Add ingestion fixtures for debug logs, weak chat snapshots, unknown models, mixed models, and fragile transcript availability.
- Add UI tests for the selected-run tabs, source/size filters, pricing fallback display, Analytics empty states, and Compare deltas.

## Latest Implemented Step

Switched visible estimates back to USD and tightened Analytics, Trace, and Cost UI defects from visual review.

What changed:

- Kept the top nav compact at desktop/tablet widths instead of stacking early and creating a large empty band.
- Removed the repeated Analytics scope-pill row; the cohort explanation now lives once in the header.
- Made Analytics filters shorter and less card-like so they do not compete with the dashboard content.
- Removed the selected-run detail overflow trap that could break sticky Trace behavior.
- Changed Trace to stack the selected-event inspector above the log on narrower content widths, keep it sticky while scrolling, and scroll internally when details are long.
- Fixed squeezed Trace event rows that could collapse detail text into one-character columns.
- Folded the Cost tab's separate billing caveat and estimate-scope callouts into one compact estimate strip.
- Removed duplicate helper captions from Cost drivers, Token categories, and Model price rows so the useful debugging rows dominate the page.
- Kept the GitHub price source visible as a compact link instead of another full-width callout.
- Changed selected-run, sidebar, Cost, Turns, Trace, Compare, Analytics, and imported-session totals to display USD instead of converted EUR.
- Stopped Angular cost analysis from using `usdToEur`; local estimates now use USD-native GitHub rates directly.
- Changed new scans to default the legacy `usdToEur` field to `1` so future generated compatibility fields do not apply a hidden conversion.

Why: GitHub's pricing table, AI-credit conversion, and additional-usage budgets are all USD-native. Showing EUR added a conversion assumption without helping the cost-debugging job.

Verification:

- `npm run build`
- `npm test -- --watch=false`
- Browser sanity check on Analytics, Trace, and Cost at `http://127.0.0.1:4301/`

## Previous Implemented Step

Centralized pricing and model normalization.

What changed:

- Added shared Angular pricing helpers in `src/app/pricing.ts` for model keying, model normalization, pricing-row selection, fallback detection, fallback explanation, and rate lookup.
- Added `scripts/pricing-utils.mjs` so the scanner and verifier use the same model normalization and token-cost rules instead of private copies.
- Updated selected-run analysis, Compare, Analytics, Prices, scanner, and verifier to call the shared helpers.
- Removed duplicated fallback-pricing checks from the Prices page and selected-run analysis.

Why: cost debugging depends on consistent model matching. A raw model id should be normalized, priced, explained, and verified the same way across ingestion, generated ledger verification, and UI display.

Verification:

- `npm run build`
- `npm test -- --watch=false`
- `npm run verify:data`
- `node --check scripts/scan-vscode-sessions.mjs`
- `node --check scripts/verify-ledger-data.mjs`
- `node --check scripts/pricing-utils.mjs`

## Previous Implemented Step

Audited and polished the Compare and Prices pages.

What changed:

- Compare now presents a clearer `Baseline A` versus `Candidate B` selector layout.
- Compare has a stronger top readout with the cost delta, A/B costs, token delta, and summary before the metric grid.
- Compare sections now explain their role: quick driver read first, model/price-row movement second.
- Prices now reads more like an evidence page: source facts, AI-credit context, calculation rule, then the rate-card table.
- Prices copy is tighter and less essay-like while preserving the GitHub source and cache-visibility caveats.
- Consolidated old "UI polish" overrides into the real component selectors for both pages.

Why: Compare should feel like a run-diff debugger, not a generic report. Prices should make the exact assumptions behind estimates visible without competing with the selected-run workflow.

Verification:

- `npm run build`
- `npm test -- --watch=false`
- Browser sanity check on Compare and Prices at `http://127.0.0.1:4301/`

## Previous Implemented Step

Continued decomposing the Sessions UI.

What changed:

- Added `SessionRailComponent` for search, filters, and the session-card rail.
- Added `SessionImportContextComponent` for the compact imported-data disclosure.
- Added `SelectedRunHeaderComponent` for the selected-run hero, AI-credit meter, filter-mismatch callout, and pricing-fallback callout.
- Reduced the root template to page orchestration plus the selected-run investigation tabs/subviews.
- Removed now-unused source-label and track-by helpers from the root component.

Why: the root app shell should coordinate state and routing between debugger surfaces, not own every piece of Sessions markup. These extracted components are stable UI blocks, so moving them lowers the risk of future polish and makes the remaining root template easier to read.

Verification:

- `npm run build`
- `npm test -- --watch=false`
- Browser sanity check on `http://127.0.0.1:4301/`

## Previous Implemented Step

Fixed the dev-server stale-style workflow.

What changed:

- Added `npm run clean:ng-cache`.
- Added `npm run start:clean`, which clears Angular's build cache before starting `ng serve`.
- Removed the temporary global Analytics CSS fallback from `src/styles.css`; Analytics layout now belongs only to the Analytics component stylesheet.
- Documented when to use the clean dev-server start in README and local deployment docs.

Why: the previous browser issue showed new Analytics markup with stale component styles on an older dev-server instance. The project should have a clear recovery command instead of duplicate global CSS that can mask component-style problems.

Verification:

- `npm run build`
- `npm test -- --watch=false`

## Previous Implemented Step

Reworked the Analytics page layout.

What changed:

- Moved Model breakdown up directly below the analytics summary metrics.
- Rebuilt the Analytics metrics as proper cards instead of a collapsed text stack.
- Tightened tooltip placement so help icons sit with labels rather than interrupting numeric values.
- Grouped Distribution and Recent trend beside/near the model breakdown, with Runs to inspect and Outlier signals below.
- Verified the Analytics layout on a fresh dev server after the existing dev-server instance showed stale component styles during verification.

Why: Analytics should answer cohort/model questions quickly. The old page pushed the model breakdown too far down and made several metric/tooltip areas look broken.

Verification:

- `npm run build`
- `npm test -- --watch=false`
- Browser sanity check on fresh dev server at `http://127.0.0.1:4301/`

## Previous Implemented Step

Reduced the Sessions page global import summary.

What changed:

- Removed the four prominent global cards for session count, total estimate, input tokens, and output tokens from the Sessions page.
- Replaced them with a compact `Import context` disclosure that states totals are across imported sessions, not the selected run.
- Kept data provenance available inside the disclosure for debugging imports without making it compete with the selected-run header.

Why: the Sessions view should focus on the currently selected run. Global totals are useful context, but they looked too much like the primary estimate and could mislead users.

Verification:

- `npm run build`
- `npm test -- --watch=false`
- Browser sanity check at `http://127.0.0.1:4300/`

## Previous Implemented Step

Extracted selected-run analysis out of the root Angular component.

What changed:

- Added `src/app/session-analysis.ts` for selected-run cost explanation, triage labels, trace filtering, flow events, per-turn model-call rows, and trace event detail enrichment.
- Reduced `src/app/app.ts` from the large mixed UI/analysis component into a smaller state and navigation shell.
- Kept behavior unchanged: the same Cost, Turns, Trace, filtering, fallback-pricing, and triage facts now come from pure helper functions.

Why: the app is becoming a debugger, not a demo page. Keeping the interpretation logic outside the component makes the next tests and UI changes less brittle.

Verification:

- `npm run build`
- `npm test -- --watch=false`
- `npm run verify:data`

## Previous Implemented Step

Added Copilot Business/Enterprise AI-credit allowance context.

What changed:

- Added shared allowance constants for Business, Enterprise, and GitHub's documented June 1-September 1, 2026 promotional amounts.
- Added a compact selected-run credit meter that converts the local USD estimate into AI credits and shows percent of the selected allowance.
- Added a Prices-page allowance panel with plan toggles, the fixed credit conversion, source link, and imported-session credit usage.
- Expanded [pricing.md](pricing.md) to explain how real-world billing, cache visibility, AI credits, and local estimates fit together.

Why: the app should help a developer understand whether a run is a small or large draw against the included Copilot allowance without pretending that local logs are GitHub's authoritative bill.

## Previous Implemented Step

Polished Trace into a stronger debugger workspace.

What changed:

- Trace rows now distinguish model calls, tool calls, user messages, responses, discovery events, errors, and token-bearing events.
- Token-bearing events show a compact token badge directly in the event row.
- The Trace inspector now starts with event cost, token total, and status.
- Inspector fields are grouped into Timing, Model, Tokens, Pricing, and Payload instead of one long normalized-field list.
- Clicking a model call from Turns now opens Trace with an `Opened from Turns` cue on the selected event.

Why: the Cost -> Turns -> Trace flow only works if Trace feels like evidence, not just a list of logs. The user should be able to land on the raw event and immediately see whether it explains the expensive turn.

## Previous Implemented Step

Made the selected-run debugger read as one investigation flow.

What changed:

- Replaced the plain selected-run tab strip with a compact investigation map.
- Kept `Overview` as `Run facts`, separate from the cost-debugging path.
- Labeled the main workflow as:
  - `1 · Diagnose`: Cost, with the primary cost driver and share.
  - `2 · Locate`: Turns, with the highest-cost call/share.
  - `3 · Verify`: Trace, with raw event count.
- Updated the Cost, Turns, and Trace panel headers so they reinforce the same workflow.

Why: the app should guide a developer from estimate, to expensive model call, to source evidence without making them infer the intended order from generic tabs.

## Previous Implemented Step

Compacted the Sessions view and removed nearby duplicate facts.

What changed:

- Changed Data provenance to a compact local-scan note plus source counters, instead of repeating the global session count.
- Removed the duplicate fallback-pricing chip from the selected-run hero and kept the richer Pricing assumption callout with the model mapping and Prices action.
- Renamed Overview `Summary` to `Evidence counts`.
- Removed Overview cards for model turns and total tokens because the run hero already shows those.
- Removed Overview detail rows for model, source, and run size because those are already in the selected-run hero chips/subtitle.
- Removed the duplicated size badge from Overview triage, leaving warning labels there.

Why: the UI should feel like a debugger, not a report where the same numbers echo in every panel. Each fact now has a clearer primary home.

## Previous Implemented Step

Replaced native browser tooltips with the shared help popover.

What changed:

- Converted remaining template `title` attributes and old `help-dot` markers to `HelpPopoverComponent`.
- Updated Overview, Sessions ingestion/source chips, Analytics metrics/highlights, Compare metrics/fallback rows, and Prices token/fallback labels to use real popovers.
- Added a non-interactive popover trigger mode for help icons rendered inside clickable cards/buttons, avoiding invalid nested buttons.
- Changed the help icon from `?` to a centered `i` mark with explicit sizing, font, hover, and focus styling.
- Removed stale `.help-dot` CSS so the native-tooltip pattern does not get reused by accident.

Why: important explanations should feel like part of the product, not browser defaults. The new popover is consistent, keyboard accessible where it is interactive, and visually aligned with the debugger UI.

## Older Implemented Step

Polished the current UI for density, typography, and scanability.

What changed:

- Switched the global font stack toward Windows-native modern UI fonts (`Aptos`, `Segoe UI Variable`, then fallbacks).
- Tightened the top bar, session rail, selected-run header, cards, tabs, tables, and buttons.
- Reduced heavy font weights and oversized numbers/headings across the shell and selected-run subviews.
- Shortened visible UI copy where the same meaning was clear from context.
- Clamped long prompt text in session cards so the rail stays navigational.
- Added smoother hover/focus states and more subtle scrollbar styling.
- Updated the app spec for the leaner UI labels.

Why: the app had the right information architecture, but the interface still felt loud and verbose. This pass makes the debugger easier to scan without removing evidence or hiding cost details.

## Older Implemented Step

Finished the selected-run subview extraction pass.

What changed:

- Added `SessionTurnsComponent` for the selected-run `Turns` subview.
- Added `SessionTraceComponent` for the selected-run `Trace` subview.
- Added `SessionCostComponent` for the selected-run `Cost` subview.
- Added `HelpPopoverComponent` and started using it in the Cost debugger instead of relying only on native `title` tooltips.
- Moved Cost, Turns, and Trace markup and scoped styles out of the root template/root stylesheet.
- Improved narrow layout for Cost and Turns tables so rows become labeled cards instead of unlabeled stacked values.
- Kept cost and trace explanation calculations in the root component for now, so the refactor changes structure without changing estimate behavior.

Why: the selected-run debugger is now a set of focused panels instead of one large root template. That makes the UI easier to polish and lowers the risk of changing pricing/debugging behavior while improving layout.

## Previous Implemented Step

Continued the selected-run split by extracting Cost.

What changed:

- Added `SessionCostComponent` for the selected-run `Cost` subview.
- Moved the Cost debugger markup and scoped styles out of the root template/root stylesheet.
- Kept cost explanation calculations in the root component for now, so the refactor changes structure without changing estimate behavior.
- Left shared table styles in the root for the `Turns` ledger until that subview is extracted.

Why: Cost is the core "why did this run cost this?" surface. Extracting it as a focused presentational component reduces root-template noise while keeping the pricing math stable.

## Older Implemented Step

Continued the monolith split by extracting Analytics.

What changed:

- Added `AnalyticsPageComponent` with its own template, styles, filters, cohort calculation, trend rows, distribution, model breakdown, and outlier hints.
- Replaced the large Analytics block in the root template with a single component call.
- Kept Analytics scoped to the sidebar-filtered session set, with an `openSession` event back to the root shell.
- Reused shared cost helpers for token totals, context growth, and pricing fallback detection.
- Verified the production build after extraction.

Why: Analytics is a top-level page now, not a nested root-template section. Pulling it out reduces root-component risk and makes future dashboard polish safer.

## Older Implemented Step

Added the Billing Reality Check to the Cost debugger.

What changed:

- Added a Cost-view panel that states local estimate, cache visibility, and invoice-risk direction.
- Labels output-dominant runs as likely lower cache impact, input/context-dominant runs as potentially materially affected by missing cache accounting, and ambiguous runs as directional estimates.
- Updated README and docs to explain that cached input is not subtracted from output tokens.

Why: the app can be excellent at cost debugging without pretending to be invoice-grade. Cache uncertainty needs to be visible at the moment a developer reads the estimate.

## Earlier Implemented Step

Continued the monolith split by extracting Compare.

What changed:

- Extracted `ComparePageComponent` from the root template and moved its comparison UI into standalone HTML/CSS.
- Removed Compare analysis methods from `app.ts`.
- Added `ledger-cost-utils.ts` for reusable pricing/token/context helpers used by the extracted Compare page.
- Removed obsolete Compare selectors from the root stylesheet.
- Verified Compare in the browser: heading, selectors, comparison summary, and clean console.

Why: Compare is a stable top-level view and no longer belongs inside the root shell. Pulling it out lowers root-template noise and gives the next UI polish pass a contained surface.

## Earlier Component Step

Started the monolith split.

What changed:

- Added `LedgerDataService` for `/data/sessions.json` loading, load state, and load errors.
- Extracted `PricingPageComponent` from the root template.
- Extracted `LedgerStatePanelComponent` for loading/error display.
- Removed obsolete pricing-page styles and unused token-burner styles from the root stylesheet.
- The production build passed without the previous `app.css` component style budget warning.

Why: the app is past throwaway prototype shape. Pulling stable surfaces into focused components makes future UI work safer, and it keeps Angular's style budget useful instead of training us to ignore it.

## Earlier Reliability Step

Hardened pricing and local deployment basics.

What changed:

- Moved the GitHub Copilot rate card into `data/github-copilot-pricing.json`.
- Updated the scanner, verifier, and Angular UI to read that same source.
- Kept `src/app/pricing.ts` as a typed UI adapter rather than the pricing source of truth.
- Added a visible app loading/error panel for `/data/sessions.json`.
- Added `docs/local-deployment.md` to capture dev mode, local production build, and future packaging choices.

Why: cost debugging depends on trust. A single shared rate card prevents scanner/UI drift, and a local deployment note keeps the project aligned with the local-first product direction.

## Initial Implemented Step

Built the first Trace Event Inspector pass.

What changed:

- Trace log rows are clickable.
- Trace has filters for all events, model calls, tools, discovery, user messages, agent responses, and errors.
- The selected event opens in a right-side inspector with raw index, timestamp, type, name, status, model, token totals, pricing row, estimated event cost, latency/cap fields, imported detail, and bounded payload summary when available.
- Rows in the Turns ledger now link directly to the matching raw Trace event.
- The scanner now preserves a small bounded `attributes` summary for future imports, instead of forcing the UI to parse raw VS Code JSONL or storing full payloads in `sessions.json`.

Why: the app is most useful when a developer can move from "this turn was expensive" to "this exact debug-log event is the evidence" without leaving the UI.

Recently removed an unsupported session-summary signal after testing real VS Code agent sessions. The observed local signals were not strong enough to distinguish manual summary actions, automatic summary actions, repeated summaries, or ordinary context selection changes.

`Context growth` is expected in many agent runs. It is shown because accumulated context can explain rising token cost, not because growth is automatically a bug.

Current size thresholds:

- `Small`: under `50k` imported tokens
- `Medium`: `50k` to under `200k`
- `Large`: `200k` to under `600k`
- `Very large`: `600k` or more

## Next Best Step

Keep tightening reliability and the UI/code structure before attempting evidence-limited attribution.

Build:

- Move selected-run explanation logic out of the root component into focused services/helpers, starting with Cost and Trace calculations.
- Continue replacing native title tooltips with `HelpPopoverComponent` where the explanation is important enough to be discoverable.
- Add fixture-based scanner/verifier tests for mixed models, unknown model fallback, and missing/malformed generated data.
- Centralize model normalization and pricing fallback rules so model matching cannot drift between scanner and UI.
- Treat Chat Debug transcripts as optional enrichment only. If imported later, show transcript availability and source labels clearly, and never require transcripts for cost totals.
- Consider a mobile/narrow layout where filters and session list become a top drawer or compact selector instead of sitting below content.
- Replace native title tooltips with a small custom help popover for important cost terms.
- Continue visual polish of Sessions: tune table density, tighten the run tabs, and keep making each subview feel intentionally composed.
- Park Input/MCP attribution until the imported source fields prove exactly what can be shown. Nearby activity counts may still be useful later, but they should not become a cost-allocation feature by implication.

Why this next: the core debugger is now useful enough that correctness and maintainability matter more than speculative signals. The app should be boringly trustworthy before it gets clever.

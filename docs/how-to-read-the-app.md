# How To Read The App

This is the plain-English guide for using the app.

## The Main Idea

The app estimates the cost of a local Copilot session by combining:

- what VS Code logged locally
- which model was used
- how many input/output tokens were used
- GitHub's published model prices

The estimate is for debugging. It is not a GitHub invoice.

## The Most Important Screen

Open one session and read the Cost debugger.

Start with the session list:

- Filter by size when you want only large runs.
- Filter by signal when you want runs with a particular cost pattern.
- Filter by source when you only want exact debug-log-backed sessions.

Then open one session and read the Cost debugger.

- **Run Triage**: quick labels for size and cost signals before reading the details.
- **Cost drivers**: quick diagnosis of what pushed the cost up.
- **Billing reality check**: whether missing cache-token fields are likely to change the billing interpretation.
- **Input**: usually the biggest cost source in agent runs because repo context and tool results get sent into the model.
- **Per-turn cost breakdown**: every token-bearing model call, either in timeline order or sorted by the biggest cost.
- **Model table**: which models were used and which GitHub price row applied.

## Comparing Two Runs

Use **Compare runs** when you made a change and want to know whether it helped.

The **Prompt testing** panel is the guardrail for clean A/B comparisons:

- **Same prompt selected** means both runs share the same normalized first prompt. This is the best mode for testing workflow, model, instruction, or MCP changes around the same task.
- **Manual comparison** means the first prompts differ. The cost and token deltas are still useful, but the app should not imply this is a clean prompt A/B test.
- When repeated prompt groups exist, Compare can quickly choose oldest-to-newest or cheapest-to-highest pairs for the same prompt.

Read it in this order:

- **Headline delta**: how run B changed versus run A.
- **Metric cards**: cost, input tokens, output tokens, model turns, tool calls, and context growth.
- **What changed**: the app's best explanation of the movement.
- **Model and price-row movement**: whether cost changed because the model/pricing mix changed.

Cheaper is not automatically better. A cheaper run that failed, skipped work, or produced a worse answer is not a win.

Compare currently explains cost/debug facts. It does not judge output quality unless a future source provides reliable comparable output detail.

## Reading Analytics

Use **Analytics** for questions about more than one session.

The Analytics view is intentionally separate from the selected-run debugger:

- **Sessions** explains one selected run.
- **Compare runs** explains how run B differs from run A.
- **Analytics** explains the current group of sessions.

The sidebar filters define the starting group. If you filter to exact debug-log sessions, Analytics only summarizes those sessions. The Analytics controls then narrow that group by time range, workspace, and model, and choose whether the trend is grouped by day, week, or month.

The Analytics reset button resets only the Analytics controls. It does not clear sidebar filters. This is intentional: sidebar filters define the global working set, while Analytics controls define the dashboard cohort inside that working set.

Read it in this order:

- **Top metrics**: total cost/tokens, average cost/tokens, and cost per 1k tokens.
- **Runs to inspect**: the highest-token and most expensive runs; click one to open the selected-run debugger.
- **Outlier signals**: sessions that are unusually high compared with the current cohort, with a first-pass explanation of the likely driver. Current explanations can call out input/context dominance, model price rows, context growth, tool activity, plausible long agent work, or suspicious low-activity spikes.
- **Model breakdown**: which model/pricing rows are contributing the cost.
- **Distribution and trend**: whether cost is spread across many runs or concentrated in a few periods.

## Run Triage Labels

The app now labels each selected run by size:

- **Small**: under `50k` imported tokens.
- **Medium**: `50k` to under `200k`.
- **Large**: `200k` to under `600k`.
- **Very large**: `600k` or more.

Signals are quick explanations, not separate billing rows:

- **High input context** means the run sent a lot of prompt/context tokens into the model.
- **Context growth** means later model calls received larger input payloads than early calls. This is expected in many agent runs; it matters because accumulated context can increase cost.
- **Mixed models** means more than one model contributed to the estimate.
- **Cache unknown** means no numeric cached-input or cache-write totals were imported for that run.
- **State enriched** means VS Code `state.vscdb` improved the label or metadata.

## Source Quality

Not all local data is equally strong.

**Debug logs** are best. They include model ids and token counts for each model call.

**Chat snapshots** are weaker. They can explain conversation context, but often do not include the full request token count.

**State DBs** are metadata only. They help with names, labels, location, and restored-session details. They do not drive cost.

## Model Versus Pricing Row

The app keeps two related fields:

- **Model**: what VS Code logged for the model call.
- **Pricing row**: the GitHub price row used for the estimate.

Usually they match after normalization. If they do not match, the app is using a fallback pricing row because the logged model is not in the local price table. That fallback should be treated as a visible estimate assumption, not a hidden fact.

Where fallback pricing appears:

- the selected-run header shows a `Fallback pricing` chip
- the selected run shows a `Pricing assumption` callout
- Cost, Turns, Compare, Analytics, and Prices mark the fallback row directly

Real-life meaning: the token totals can still be exact local debug-log totals, but the price applied to those tokens is an assumption until the local GitHub pricing table includes the logged model id.

## Cache Tokens

If the UI says cache-token totals were not imported, that does not mean cache billing was zero.

It means that specific run has input/output tokens, but no numeric cached-input or cache-write token fields.

When VS Code Agent Debug Logs expose `cachedTokens`, the app imports it as cached input and prices only the remaining `inputTokens - cachedTokens` as normal input.

Cached tokens are not subtracted from output tokens. They are normally a cheaper input/context billing bucket. Generated output remains generated output.

The Cost view therefore shows a **Billing reality check**:

- **Low cache impact likely** means output dominates the estimate, so missing cached input probably does not change the main cost story.
- **Cache could materially change estimate** means input/context dominates, so provider-side cached input could make the final bill lower than the local full-input estimate.
- **Directional billing estimate** means the local data is useful for debugging turns and model mix, but cache impact is not obvious from the token split.

## What To Trust Most

Trust, in order:

1. Debug-log input/output token totals.
2. Model breakdown and per-event pricing generated by the scanner.
3. State-enriched names and labels.
4. Chat snapshot estimates, only when debug logs are unavailable.

## When Something Looks Missing

Run:

```bash
npm run scan
npm run verify:data
```

Then refresh the app.

If a long or compacted session appears to stop early, check `traceSummary.totalEvents` against the visible log count. The scanner currently keeps up to `1000` trace events per session.

## Per-Turn Cost Breakdown

The **Per-turn cost breakdown** shows every token-bearing model call imported from the VS Code debug log.

Use **Timeline** when you want causality: what happened first, and where the cost started to climb.

Use **Largest first** when you want the fastest answer to "what burned the most money?"

Each row shows:

- call number and raw log event number
- timestamp
- model and GitHub pricing row
- input tokens, output tokens, and total tokens
- estimated cost with input/output cost split
- share of the session cost
- nearby prior context, such as a user prompt or tool event

Why this matters: total session cost tells you that a run was expensive, but per-turn cost tells you where it became expensive. It should make questions like "which step burned tokens?" and "did the cost spike after repo reads or tool results?" much easier to answer.

The app uses the debug log's zero-based raw event index. If the scanner reports marker `#183`, look for `raw index #183` in the per-turn table or `#183` in View Logs.

## Trace Inspector

Use **Trace** when you want evidence for a specific event.

The log can be filtered to:

- all events
- model calls
- tools
- discovery/customization events
- user messages
- agent responses
- errors

Clicking an event opens the inspector. For model calls, the inspector shows the raw event index, timestamp, model, pricing row, input/output tokens, estimated event cost, and latency/cap fields when VS Code logged them.

The **Turns** table links each model call back to Trace. Use that path when the question is: "this turn looks expensive; what exact log event produced that number?"

The inspector shows bounded summaries, not the full raw JSONL payload. That is intentional: the app should expose useful local evidence without turning `public/data/sessions.json` into a raw log dump.

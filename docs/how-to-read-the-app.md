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

Then open one session and read the Cost debugger.

- **Run Triage**: quick labels for size and cost signals before reading the details.
- **Cost drivers**: quick diagnosis of what pushed the cost up.
- **Token categories**: normal input, cached input, cache write, and output. These are separate because GitHub prices them separately.
- **Model table**: which models were used and which GitHub price row applied.
- **Calls**: every token-bearing model call, either in timeline order or sorted by the biggest cost.

## Comparing Two Runs

Use **Compare runs** when you made a change and want to know whether it helped.

The **Prompt testing** panel is the guardrail for clean A/B comparisons:

- **Same prompt selected** means both runs share the same normalized first prompt. This is the best mode for testing workflow, model, instruction, or MCP changes around the same task.
- **Manual comparison** means the first prompts differ. The cost and token deltas are still useful, but the app should not imply this is a clean prompt A/B test.
- When repeated prompt groups exist, Compare can quickly choose oldest-to-newest or cheapest-to-highest pairs for the same prompt.
- When enough repeated-prompt runs exist, Compare shows a same-prompt spread explanation: which priced bucket or activity signal moved most between cheapest and most expensive matching runs.

Read it in this order:

- **Headline delta**: how run B changed versus run A.
- **Metric cards**: cost, input tokens, output tokens, model turns, and tool calls.
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
- **Model breakdown**: which model/pricing rows are contributing the cost.
- **Runs to inspect**: the highest-token and most expensive runs; click one to open the selected-run debugger.
- **Outlier signals**: sessions that are unusually high compared with the current cohort, with a first-pass explanation of the likely driver. Current explanations can call out input/context dominance, model price rows, tool activity, plausible long agent work, or suspicious low-activity spikes.
- **Distribution and trend**: whether cost is spread across many runs or concentrated in a few periods.

## Run Triage Labels

The app now labels each selected run by size:

- **Small**: under `100k` imported tokens.
- **Medium**: `100k` to under `500k`.
- **Large**: `500k` to under `1.5M`.
- **Very large**: `1.5M` or more.

Signals are quick explanations, not separate billing rows:

- **High input context** means the run sent a lot of prompt/context tokens into the model.
- **Mixed models** means more than one model contributed to the estimate.

VS Code `state.vscdb` can improve titles and labels, but normal users should not need to care about that term while debugging cost.

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
- Cost, Calls, Compare, Analytics, and Prices mark the fallback row directly

Real-life meaning: the token totals can still be exact local debug-log totals, but the price applied to those tokens is an assumption until the local GitHub pricing table includes the logged model id.

## Cache Tokens

When VS Code Agent Debug Logs expose `cachedTokens`, the app imports it as cached input and prices only the remaining `inputTokens - cachedTokens` as normal input.

Cached tokens are not subtracted from output tokens. They are normally a cheaper input/context billing bucket. Generated output remains generated output.

If a run has no numeric cached-token fields, the app does not infer them. It prices the buckets that were imported and keeps cached input/cache write visibly separate in Cost, Calls, Compare, Analytics, and Prices.

## What To Trust Most

Trust, in order:

1. Debug-log input/output token totals.
2. Model breakdown and per-event pricing generated by the scanner.
3. State-derived names and labels.
4. Chat snapshot estimates, only when debug logs are unavailable.

## When Something Looks Missing

Run:

```bash
npm run scan
npm run verify:data
```

Then refresh the app.

If a long or compacted session appears to stop early, check `traceSummary.totalEvents` against the visible log count. The scanner currently keeps up to `1000` trace events per session.

## Calls

The **Calls** view shows every token-bearing model call imported from the VS Code debug log.

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

The **Calls** table links each model call back to Trace. Use that path when the question is: "this model call looks expensive; what exact log event produced that number?"

The inspector shows bounded summaries, not the full raw JSONL payload. That is intentional: the app should expose useful local evidence without turning `public/data/sessions.json` into a raw log dump.

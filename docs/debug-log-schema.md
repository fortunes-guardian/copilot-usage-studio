# VS Code Agent Debug Log Schema

This document captures the observed data model from VS Code GitHub Copilot Agent Debug Logs and how this app turns it into `public/data/sessions.json`.

Reference sample used for this pass:

```text
C:\Users\admin\AppData\Roaming\Code\User\workspaceStorage\6f54e795da760515cec9d7a9687568d8\GitHub.copilot-chat\debug-logs\29fa1393-f3da-41b0-80a6-f867d7a56a67
```

Latest schema drift check:

```text
2026-05-30
C:\Users\admin\AppData\Roaming\Code\User\workspaceStorage\6f54e795da760515cec9d7a9687568d8\GitHub.copilot-chat\debug-logs\01a0ce83-61cc-4ca8-838c-301994a14971
VS Code 1.122.1, GitHub Copilot Chat 0.50.1
```

The schema is observed, not guaranteed by a published VS Code API. Treat it as a local data contract that must be verified with fixtures as VS Code Copilot changes.

## Files In A Debug-Log Session

Observed files:

| File | Meaning | App use |
| --- | --- | --- |
| `main.jsonl` | Primary session event stream | Preferred source for sessions, model calls, tokens, tool events, reasoning effort, and trace rows |
| `runSubagent-*.jsonl` | Nested subagent event stream | Counted today; future work can import as child trace/session evidence |
| `title-*.jsonl` | Title-generation model call | Ignored for main run cost unless explicitly imported as a child/session metadata source |
| `system_prompt_*.json` | Request side file referenced by model calls | Used for system/developer payload character totals |
| `tools_*.json` | Request side file referenced by model calls | Used for tool schema size, tool count, MCP tool count, and largest tool schemas |
| `models.json` | Model metadata and capabilities | Grounded enrichment source for model picker state, endpoints, context-window limits, prompt limits, output limits, tokenizer, and supported reasoning effort values |

Related optional file:

| File | Meaning | App use |
| --- | --- | --- |
| `../transcripts/<session-id>.jsonl` | Chat Debug transcript rows that sometimes match an Agent Debug Log session | Recorded as optional availability metadata only; not used for pricing |

## Event Envelope

JSONL events use a common envelope:

| Field | Meaning | Notes |
| --- | --- | --- |
| `ts` | Timestamp-like numeric value | Scanner converts to ISO timestamp |
| `dur` | Duration in ms | Useful for latency/debugging |
| `sid` | Session id | Often the debug-log folder name |
| `type` | Event type | Drives trace grouping and filters |
| `name` | Event label | Human-readable VS Code log label |
| `spanId` | Trace span id | Future graph linkage |
| `parentSpanId` | Parent trace span id | Future graph linkage |
| `status` | Event status | Usually `ok`; non-ok feeds error counts |
| `attrs` | Event-specific payload | Main source of useful fields |
| `v` | Log envelope version | Observed as `1` on current `session_start` rows |

Current `session_start.attrs` can also expose:

| Field | Meaning | App use |
| --- | --- | --- |
| `vscodeVersion` | VS Code build that produced the log | Preserved as `session.debugLogRuntime.vscodeVersion` |
| `copilotVersion` | GitHub Copilot Chat extension version that produced the log | Preserved as `session.debugLogRuntime.copilotVersion` |

Observed event types in the reference session:

- `session_start`
- `user_message`
- `turn_start`
- `turn_end`
- `discovery`
- `generic`
- `tool_call`
- `llm_request`
- `agent_response`
- `subagent`
- `child_session_ref`

## Model Call Fields

`llm_request` is the cost-critical event type.

Observed `attrs` fields:

| Field | Meaning | App treatment |
| --- | --- | --- |
| `model` | Raw model id used by VS Code | Normalized for display, raw id preserved |
| `debugName` | VS Code call site, for example `panel/editAgent` | Preserved in trace detail |
| `inputTokens` | Raw input/context tokens sent to the model | Preserved on trace rows as raw local evidence |
| `cachedTokens` | Cached input tokens reported by VS Code | Imported as `cachedInput`; priced with GitHub cached-input rate |
| `outputTokens` | Generated output tokens | Imported as `output`; priced with GitHub output rate |
| `estimatedCost` | Possible VS Code/source estimate object | Preserved separately on trace events as `sourceEstimatedCost` when present. It does not replace the app-calculated estimate. |
| `ttft` | Time to first token in ms | Preserved on trace rows |
| `responseId` | Provider/VS Code response id | Preserved in bounded attributes |
| `userRequest` | Current request payload, often JSON string | Used for previews only; may be large |
| `inputMessages` | Request message payload, often JSON string | Observed but sometimes empty/redacted-like; do not rely on completeness |
| `maxTokens` | Request output cap | Preserved as request cap evidence |
| `requestOptions` | JSON string containing request options | Parsed for reasoning/thinking fields |
| `requestShape` | JSON string describing request API shape, for example `{"api":"responses","inputItemCount":3}` | Preserved as bounded trace metadata |
| `systemPromptFile` | Side-file name such as `system_prompt_0.json` | Used to measure setup payload size |
| `toolsFile` | Side-file name such as `tools_0.json` | Used to measure tool/MCP schema payload size |
| `temperature` | Sampling temperature | Observed on title calls |
| `topP` | Sampling top-p | Observed on title calls |

Pricing rule for a model call:

```text
normal_input_tokens = max(0, inputTokens - cachedTokens)
cached_input_tokens = cachedTokens
output_tokens = outputTokens

cost_usd =
  normal_input_tokens / 1,000,000 * input_rate +
  cached_input_tokens / 1,000,000 * cached_input_rate +
  cache_write_tokens / 1,000,000 * cache_write_rate +
  output_tokens / 1,000,000 * output_rate
```

`cachedTokens` is not a discount against output. It is cached input. Output remains output.

The scanner also writes a `cacheTokenAudit` object for each Agent Debug Log session and for the full ingestion result. This is a guardrail around the observed schema:

| Field | Meaning |
| --- | --- |
| `modelCalls` | Number of `llm_request` model calls audited |
| `callsWithCachedTokens` | Model calls where VS Code exposed a positive cached-token field |
| `invalidCachedTokenSplits` | Model calls where raw cached tokens exceeded raw input tokens before scanner safety clamping |
| `rawInputTokens` | Sum of raw `attrs.inputTokens` from audited model calls |
| `normalInputTokens` | Sum of `max(0, inputTokens - cachedTokens)` |
| `cachedInputTokens` | Sum of imported cached input tokens |
| `cacheWriteTokens` | Sum of imported cache-write tokens, when exposed |
| `outputTokens` | Sum of output tokens from audited model calls |
| `maxCachedInputShare` | Largest cached/input share seen on one model call |

The verifier recomputes this audit from generated trace rows. It fails if generated cache fields are invalid or if the audit does not reconcile. This is intentionally local evidence, not a claim that VS Code Agent Debug Logs are a stable public API.

## Request Options

Observed `requestOptions` shapes include:

```json
{
  "reasoning": {
    "effort": "high",
    "summary": "detailed"
  },
  "truncation": "disabled",
  "store": false,
  "stream": true,
  "include": ["reasoning.encrypted_content"]
}
```

The 2026-05-30 sample also included:

```json
{
  "reasoning": {
    "effort": "medium",
    "summary": "detailed"
  },
  "text": {
    "verbosity": "low"
  },
  "truncation": "disabled",
  "store": false,
  "stream": true,
  "include": ["reasoning.encrypted_content"]
}
```

Other observed model calls used:

```json
{
  "thinking": {
    "type": "enabled",
    "budget_tokens": 16000
  },
  "stream": true
}
```

App boundary:

- Reasoning effort is source-backed when `requestOptions.reasoning.effort` exists.
- Thinking budget is source-backed when `requestOptions.thinking.budget_tokens` exists, but it is not yet promoted to primary UI.
- Text verbosity is source-backed when `requestOptions.text.verbosity` exists. It is request configuration, not a cost bucket.
- `requestShape` helps explain which request API shape VS Code used, but it is not a billing field.
- These fields are request configuration, not direct cost totals.

## Model Capability Metadata

The 2026-05-30 sample includes a rich `models.json` file. It is an array of model metadata objects. Useful observed fields include:

| Field | Meaning | Potential app use |
| --- | --- | --- |
| `id`, `name`, `version`, `vendor` | Model identity | Stronger model display and raw-id normalization |
| `billing.is_premium`, `billing.multiplier`, `billing.restricted_to` | GitHub Copilot product metadata | Useful context, but not a replacement for the GitHub pricing table |
| `capabilities.limits.max_context_window_tokens` | Context-window size exposed by VS Code model metadata | Future source-backed context-window usage signal |
| `capabilities.limits.max_prompt_tokens` | Prompt/input limit exposed by VS Code model metadata | Future source-backed prompt pressure signal |
| `capabilities.limits.max_output_tokens` | Output-token limit exposed by VS Code model metadata | Future source-backed output cap signal |
| `capabilities.supports.reasoning_effort` | Allowed reasoning effort values | Explain why a run could use `low`, `medium`, or `high` |
| `capabilities.tokenizer` | Tokenizer name such as `o200k_base` | Metadata only unless the app later adds tokenizer-specific local estimates |
| `supported_endpoints` | Endpoint/API shapes such as `/chat/completions`, `/responses`, or `ws:/responses` | Helps interpret `requestShape.api` |
| `model_picker_enabled`, `is_chat_default`, `is_chat_fallback` | VS Code picker/default state | Useful for explaining which model is currently available/default locally |

Boundary: `models.json` is VS Code/Copilot model metadata, not the authoritative GitHub billing table. It can improve context-window and capability explanations, but pricing should continue to come from the app's imported GitHub pricing table.

## Tool And MCP Evidence

Observed `tool_call.attrs` fields:

| Field | Meaning | App treatment |
| --- | --- | --- |
| `args` | Tool argument payload as string | Counted by character length per tool name |
| `result` | Tool result payload as string | Counted by character length per tool name |

Observed `tools_0.json` shape:

| Field | Meaning |
| --- | --- |
| `type` | Tool definition type |
| `name` | Tool name |
| `description` | Tool description sent in tool schema payload |
| `parameters` | JSON schema for tool parameters |

The app can confidently show tool/MCP presence, schema size, argument/result size, and nearby model-call cost. It must not claim exact "MCP cost" unless a source exposes token counts for that specific request section.

## System Prompt Evidence

Observed `system_prompt_0.json` shape is an array of text parts with `type` and `content`.

The app counts characters for setup payload visibility. It does not turn character counts into exact billed tokens. Approximate token estimates may be useful later, but they must stay labelled as approximate.

## Generated App Schema

The scanner writes `public/data/sessions.json`.

Top-level fields:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Generated data contract version |
| `generatedAt` | Scan timestamp |
| `pricingVersion` | Version of `data/github-copilot-pricing.json` used |
| `pricingSourceUrl` | GitHub Docs pricing source |
| `usdToEur` | Legacy compatibility, currently `1` |
| `ingestion` | Scan counters, warnings, and the aggregate `cacheTokenAudit` |
| `sessions` | Imported sessions |

Session fields:

| Field | Meaning |
| --- | --- |
| `id` | Debug-log/session id |
| `sourceKind` | Source label, for example `vscode-copilot-debug-log` |
| `tokenSource` | Token source, usually `llm_request_token_totals` |
| `title`, `firstPrompt`, `workspace` | Human labels |
| `model` | Display model label |
| `modelBreakdown` | Per-model token/cost rows |
| `tokens.input` | Normal non-cached input tokens |
| `tokens.cachedInput` | Cached input tokens from `cachedTokens` |
| `tokens.cacheWrite` | Cache-write tokens when a numeric write field exists |
| `tokens.output` | Output tokens |
| `cost.usd` | Local USD estimate |
| `confidence` | Exact for imported debug-log token fields; estimated for weaker sources |
| `traceSummary` | Counts and headline trace signals |
| `cacheTokenAudit` | Local audit of raw input, normal input, cached input, and invalid cache splits for `llm_request` rows |
| `transcript` | Optional matching Chat Debug transcript availability: `available`, `sourcePath`, and `eventCount` |
| `debugLogRuntime` | Optional log runtime metadata: `logVersion`, `vscodeVersion`, and `copilotVersion` |
| `modelLimits` | Optional per-model limits from `models.json`: context window, prompt limit, output limit, and observed largest raw input |
| `requestPayload` | Bounded setup/tool payload evidence |
| `traceEvents` | Capped normalized trace rows |
| `vscodeState` | Optional `state.vscdb` metadata enrichment |

Token-bearing trace events preserve raw `inputTokens`, optional `cachedInputTokens`, optional `cacheWriteTokens`, `outputTokens`, `model`, `rawModel`, `pricingModel`, `totalTokens`, app-calculated `estimatedCost`, and optional source-provided `sourceEstimatedCost`.

When a model call references `systemPromptFile` or `toolsFile`, the scanner also preserves `traceEvents[].setupPayload`: system prompt side-file name and character count, tools side-file name and character count, total tool count, MCP tool count, MCP tool names, and the largest tool schemas by character size. This is setup-payload evidence for debugging. It is not a section-level token bill.

`modelLimits` answers a capacity question, not a billing question: did the run get expensive because a request was close to the model's prompt/context limit, or because many model calls repeatedly sent context? It compares observed raw `inputTokens` with `models.json` limits and keeps pricing separate. The app deliberately does not show model capability noise such as supported API endpoints in the main UI.

## Feature Boundaries

Build confidently from:

- `llm_request.attrs.inputTokens`
- `llm_request.attrs.cachedTokens`
- `llm_request.attrs.outputTokens`
- `llm_request.attrs.model`
- `llm_request.attrs.requestOptions.reasoning.effort`
- `llm_request.attrs.requestOptions.text.verbosity`
- `llm_request.attrs.requestShape`
- `session_start.attrs.vscodeVersion`
- `session_start.attrs.copilotVersion`
- `models.json` capability metadata for context-window, prompt-limit, output-limit, endpoint, tokenizer, and supported reasoning-effort enrichment
- `llm_request.attrs.systemPromptFile`
- `llm_request.attrs.toolsFile`
- `system_prompt_*.json` character size
- `tools_*.json` tool/MCP schema size
- `tool_call.attrs.args` and `tool_call.attrs.result` character size

Do not overclaim:

- `inputMessages` may be incomplete or redacted-like in some events.
- `cache_control` hints are not billable cached-token totals.
- Tool/MCP character counts are optimization evidence, not exact cost allocation.
- Chat Debug transcripts can be useful, but they are not the pricing source and can disappear or differ after restart.
- Transcript availability is recorded so future inspector features can be honest about source coverage. Missing transcripts do not weaken a debug-log session estimate.

# VS Code Agent Debug Log Schema

This document captures the observed data model from VS Code GitHub Copilot Agent Debug Logs and how this app turns it into `public/data/sessions.json`.

Reference sample used for this pass:

```text
C:\Users\admin\AppData\Roaming\Code\User\workspaceStorage\6f54e795da760515cec9d7a9687568d8\GitHub.copilot-chat\debug-logs\29fa1393-f3da-41b0-80a6-f867d7a56a67
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
| `models.json` | Model metadata and capabilities | Future enrichment source for context windows/model capabilities |

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
| `estimatedCost` | Possible future/alternate source cost field | Not observed in the checked `29fa1393-f3da-41b0-80a6-f867d7a56a67` Agent Debug Log folder on May 13, 2026; keep as a roadmap item and preserve separately if found |
| `ttft` | Time to first token in ms | Preserved on trace rows |
| `responseId` | Provider/VS Code response id | Preserved in bounded attributes |
| `userRequest` | Current request payload, often JSON string | Used for previews only; may be large |
| `inputMessages` | Request message payload, often JSON string | Observed but sometimes empty/redacted-like; do not rely on completeness |
| `maxTokens` | Request output cap | Preserved as request cap evidence |
| `requestOptions` | JSON string containing request options | Parsed for reasoning/thinking fields |
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
- These fields are request configuration, not direct cost totals.

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
| `requestPayload` | Bounded setup/tool payload evidence |
| `traceEvents` | Capped normalized trace rows |
| `vscodeState` | Optional `state.vscdb` metadata enrichment |

Token-bearing trace events preserve raw `inputTokens`, optional `cachedInputTokens`, optional `cacheWriteTokens`, `outputTokens`, `model`, `rawModel`, `pricingModel`, `totalTokens`, and `estimatedCost`.

## Feature Boundaries

Build confidently from:

- `llm_request.attrs.inputTokens`
- `llm_request.attrs.cachedTokens`
- `llm_request.attrs.outputTokens`
- `llm_request.attrs.model`
- `llm_request.attrs.requestOptions.reasoning.effort`
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

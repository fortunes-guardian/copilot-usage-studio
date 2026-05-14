# Pricing

This app is a local cost debugger. It uses GitHub's published Copilot usage-based model pricing to explain why a local Copilot run looks expensive, but it is not a GitHub invoice.

Primary source:

```text
https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing
```

AI credit and allowance source:

```text
https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-organizations-and-enterprises
```

Current version:

```text
github-copilot-usage-pricing-2026-06-01
```

The source table says prices are per 1 million tokens and take effect on June 1, 2026.

## Where Pricing Lives

- Shared rate-card data: `data/github-copilot-pricing.json`
- UI adapter: `src/app/pricing.ts`
- Scanner consumer: `scripts/scan-vscode-sessions.mjs`
- Verifier consumer: `scripts/verify-session-data.mjs`
- Generated session-data metadata: `public/data/sessions.json`

The rate card is a versioned JSON file so the scanner, verifier, and UI use the same pricing rows and fallback model. This avoids a quiet class of bugs where the UI explains one price table while the scanner calculated with another.

`src/app/pricing.ts` is intentionally just an Angular-facing adapter around the shared JSON. It adds TypeScript types and the `estimateCostUsd` helper, but it is not the source of truth.

## What The App Calculates

For each imported model call, the scanner reads local VS Code debug-log token totals when they are available:

- input tokens
- output tokens
- cached input tokens, only if the source exposes them
- cache-write tokens, only if the source exposes them
- model id and pricing row

## Calculation

For each model row:

```text
cost_usd =
  input_tokens / 1,000,000 * input_price +
  cached_input_tokens / 1,000,000 * cached_input_price +
  cache_write_tokens / 1,000,000 * cache_write_price +
  output_tokens / 1,000,000 * output_price
```

The app displays this estimate in USD. It does not convert to EUR because GitHub's published rate card, AI-credit conversion, and additional-usage budgets are USD-native.

GitHub AI credits are calculated from the USD estimate:

```text
ai_credits = cost_usd / 0.01
```

GitHub documents `1 AI credit = $0.01 USD`.

## Included AI Credit Allowances

The app also shows license allowance context for Copilot Business and Copilot Enterprise.

Standard included amounts:

| Plan | AI credits per user per month |
| --- | ---: |
| Copilot Business | 1,900 |
| Copilot Enterprise | 3,900 |

Temporary promotional amounts documented by GitHub for existing customers from June 1 to September 1, 2026:

| Plan | AI credits per user per month |
| --- | ---: |
| Copilot Business | 3,000 |
| Copilot Enterprise | 7,000 |

The UI treats these as allowance context, not as billing reconciliation. GitHub pools Business and Enterprise included credits at the billing entity level, so a run's percent-of-allowance is a per-seat mental model unless the app later adds organization seat counts.

For example, a 100-seat Copilot Business organization has a shared standard pool of 190,000 credits, not 100 isolated 1,900-credit buckets.

## What The UI Shows

The selected run header shows:

- estimated USD cost
- estimated AI credits
- selected allowance plan
- percent of that plan's per-user monthly allowance

The Prices page shows:

- the GitHub model price source used by the app
- the imported pricing version
- the Business and Enterprise allowance options
- the fixed AI credit conversion
- how the currently imported sessions compare with the selected allowance

This is useful for a quick mental model: "this single run would consume about X% of one Business user's monthly included credits."

## Why The GitHub Prices Page Exists

The user should be able to inspect the cost inputs directly. If a session looks expensive, the UI should make it clear whether that came from:

- high input tokens
- high output tokens
- a more expensive model
- cached input or cache-write accounting
- a model fallback because the raw model id was not in the known GitHub table

The `GitHub prices` view therefore shows every rate row the app knows about, where it came from, and whether any imported session currently uses it.

The same view also shows the selected Business/Enterprise AI-credit allowance and how the current imported sessions compare with it.

## How Realistic Is The Forecast?

Good for:

- finding which model calls drove a run's local cost estimate
- comparing two runs under the same local assumptions
- spotting whether cost came mostly from input/context or output
- estimating AI credit consumption from visible local token totals, including `cachedTokens` when Agent Debug Logs expose them
- understanding whether a run is tiny, normal, or a large share of a monthly allowance
- spotting source-backed request payload clues such as large system prompts, large tool schemas, MCP tool presence, tool-result payload size, cached input totals, and request reasoning effort

Not invoice-grade for:

- exact GitHub invoice reconciliation
- provider-side cached input or cache-write when the generated session data does not include numeric cache-token fields
- billing adjustments, promotions, policy effects, or later GitHub pricing changes
- exact attribution of input tokens to instructions, MCP servers, workspace context, or tool results unless the source logs expose those sections directly

## Cache Reality

The scanner imports input, output, and cached-input token totals from VS Code Agent Debug Log `llm_request` events when those fields are present. In the observed VS Code Agent Debug Log shape, `attrs.cachedTokens` is present on many model calls and is the key field for cached input.

## Evidence For The Token Buckets

GitHub's Copilot pricing docs describe three token categories for usage-based billing: input tokens, output tokens, and cached tokens. The same page defines input as what is sent to the model, output as what the model generates, and cached tokens as context the model reuses or stores.

The GitHub Copilot model pricing table is also bucketed by rate. For OpenAI, Google, xAI, and GitHub fine-tuned models, the table has separate `Input`, `Cached input`, and `Output` columns. For Anthropic models, GitHub documents an additional `Cache write` column.

Those docs support this pricing shape:

```text
cost =
  normal_input_tokens * input_rate +
  cached_input_tokens * cached_input_rate +
  cache_write_tokens * cache_write_rate +
  output_tokens * output_rate
```

The local VS Code Agent Debug Log field names are not a public GitHub billing API contract. They are observed local debug-log fields. In the sessions inspected so far, `attrs.inputTokens` is the raw input/context total sent to the model, `attrs.cachedTokens` is the cached portion of that input, and `attrs.outputTokens` is generated output.

Because GitHub prices cached input separately, the app treats the observed local fields like this:

```text
raw_input_tokens = attrs.inputTokens
cached_input_tokens = attrs.cachedTokens
normal_input_tokens = max(0, attrs.inputTokens - attrs.cachedTokens)
output_tokens = attrs.outputTokens
```

This avoids double-counting. If the app priced all `inputTokens` at the normal input rate and also priced `cachedTokens` at the cached-input rate, the cached portion would be counted twice.

Confidence level:

- High confidence that GitHub bills Copilot usage with distinct input, cached-input, cache-write, and output buckets where those rate columns exist.
- High confidence that the observed VS Code debug-log `cachedTokens` field should be treated as cached input, because the name and values match GitHub's cached-token billing category.
- Medium confidence that `cachedTokens` is always a subset of `inputTokens` for this local debug-log schema. The scanner preserves pricing safety by clamping impossible splits, emits a warning if it ever sees one, and the verifier fails generated data where `cachedInputTokens > inputTokens`. This remains an observed VS Code debug-log convention rather than a separately documented public API.
- Low confidence in any claim that a missing `cachedTokens` field means no provider-side caching occurred. Missing local fields mean "not visible locally", not "zero on GitHub's invoice".

The generated data now carries an ingestion-level cache audit. Run:

```text
npm run scan
npm run verify:data
```

The verifier prints a line like:

```text
Cache split audit: 23/116 model calls include cachedTokens; 0 invalid cached/input splits; 3,272,520 normal input + 713,970 cached input from 3,986,490 raw inputTokens.
```

This audit does not make VS Code's debug-log schema a public billing API, but it proves the local data imported into the app obeys the relationship the pricing math depends on:

```text
raw_input_tokens = normal_input_tokens + cached_input_tokens
```

That means:

- `attrs.cachedTokens` is treated as cached input and priced with GitHub's cached-input rate for the model. The normal input bucket is `inputTokens - cachedTokens`.
- The app keeps raw `inputTokens` on trace events so the original VS Code number remains visible, but session/model pricing uses `inputTokens - cachedTokens` for normal input to avoid double-counting.
- UI cost views must keep normal input, cached input, cache write, and output separate. Cached input is not merged back into normal input for pricing, even though raw `inputTokens` can be useful when debugging how much context was sent to the model.
- When `cachedInput` and `cacheWrite` are zero in a debug-log import, that means no numeric cache-token totals were imported for that run. It should not be presented as proof that provider-side cache billing was zero.
- If Agent Debug Logs expose additional numeric cached-token fields for a model call, ingestion should preserve those exact fields and the Cost view should price them separately.
- `cache_control` hints or prompt-cache metadata can explain that caching was requested or used, but they are not enough on their own to calculate billable cached-token totals.
- Cached input is not a discount against output. It is a separate input/context bucket when a billing source exposes it. Output tokens remain priced as output tokens.
- Input-heavy sessions may be overestimated if GitHub billed a large portion of input as cheaper cached input.
- Output-heavy sessions are usually easier to reason about because output remains priced as output.
- The Cost view keeps normal input, cached input, cache write, and output as separate priced categories. If cached-token fields are missing for a run, the app does not infer them.

## Current Limitations

- GitHub billing can still differ because GitHub may apply provider-side cache accounting or billing adjustments not present in local logs.
- Unknown model ids are preserved for display and priced with a visible fallback until the pricing table is updated.
- Request payload sizes are optimization evidence, not exact cost allocation. The app can show that a tools file was large or that MCP tools were present, but it should not say "this MCP server cost $X" unless source logs expose section-level token totals.
- The pricing table should be rechecked against GitHub Docs whenever GitHub changes model availability or usage-based rates.

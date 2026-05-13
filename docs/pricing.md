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
- The Cost view includes a Billing Reality Check that labels cache uncertainty as likely low impact, material, or directional based on the imported input/output cost split.

## Current Limitations

- GitHub billing can still differ because GitHub may apply provider-side cache accounting or billing adjustments not present in local logs.
- Unknown model ids are preserved for display and priced with a visible fallback until the pricing table is updated.
- Request payload sizes are optimization evidence, not exact cost allocation. The app can show that a tools file was large or that MCP tools were present, but it should not say "this MCP server cost $X" unless source logs expose section-level token totals.
- The pricing table should be rechecked against GitHub Docs whenever GitHub changes model availability or usage-based rates.

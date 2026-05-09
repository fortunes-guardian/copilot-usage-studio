# Pricing Reality Brief

This app is a local cost debugger. It helps explain why a Copilot run looks expensive, but it is not a GitHub invoice.

## What The App Calculates

For each imported model call, the scanner reads local VS Code debug-log token totals when they are available:

- input tokens
- output tokens
- cached input tokens, only if the source exposes them
- cache-write tokens, only if the source exposes them
- model id and pricing row

The app multiplies those token totals by GitHub's published Copilot model prices, which are stored in `data/github-copilot-pricing.json`.

Formula:

```text
cost_usd =
  input_tokens / 1,000,000 * input_price +
  cached_input_tokens / 1,000,000 * cached_input_price +
  cache_write_tokens / 1,000,000 * cache_write_price +
  output_tokens / 1,000,000 * output_price
```

Then:

```text
ai_credits = cost_usd / 0.01
cost_eur = cost_usd * usdToEur
```

GitHub documents `1 AI credit = $0.01 USD`.

## License Allowances

GitHub documents included monthly AI credits for Copilot Business and Enterprise:

| Plan | Standard credits per user per month |
| --- | ---: |
| Copilot Business | 1,900 |
| Copilot Enterprise | 3,900 |

GitHub also documents temporary promotional amounts for existing Business and Enterprise customers from June 1 to September 1, 2026:

| Plan | Promotional credits per user per month |
| --- | ---: |
| Copilot Business | 3,000 |
| Copilot Enterprise | 7,000 |

For organizations and enterprises, these credits are pooled at the billing entity level. A 100-seat Copilot Business organization has a shared standard pool of 190,000 credits, not 100 isolated 1,900-credit buckets.

## What The New UI Shows

The selected run header shows:

- estimated EUR cost
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

## How Realistic Is The Forecast?

Good for:

- finding which model calls drove a run's local cost estimate
- comparing two runs under the same local assumptions
- spotting whether cost came mostly from input/context or output
- estimating AI credit consumption from visible local token totals
- understanding whether a run is tiny, normal, or a large share of a monthly allowance

Not invoice-grade for:

- exact GitHub invoice reconciliation
- provider-side cached input when VS Code logs do not expose cached token fields
- billing adjustments, promotions, policy effects, or later GitHub pricing changes
- exact attribution of input tokens to instructions, MCP servers, workspace context, or tool results unless the source logs expose those sections directly

## Cache Reality

Local VS Code debug logs observed so far usually expose input and output token totals, but not complete provider cache billing fields.

That means:

- `cachedInput = 0` in the app often means "not visible locally", not "GitHub billed zero cached input".
- Cached input is not subtracted from output. It is a separate billing bucket for input/context reused from cache.
- Output tokens remain output tokens.
- Input-heavy sessions may be overestimated if GitHub billed a large portion of input as cheaper cached input.
- Output-heavy sessions are usually easier to reason about because output remains priced as output.

The Cost view keeps a Billing Reality Check near the estimate so this uncertainty is visible where the user needs it.

## Sources

- GitHub Docs: Models and pricing for GitHub Copilot: `https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing`
- GitHub Docs: Usage-based billing for organizations and enterprises: `https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-organizations-and-enterprises`


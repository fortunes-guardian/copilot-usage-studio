# Pricing Design

The app uses GitHub's published Copilot usage-based model pricing as the rate card for local session estimates.

Source:

```text
https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing
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
- Verifier consumer: `scripts/verify-ledger-data.mjs`
- Generated ledger metadata: `public/data/sessions.json`

The rate card is a versioned JSON file so the scanner, verifier, and UI use the same pricing rows and fallback model. This avoids a quiet class of bugs where the UI explains one price table while the scanner calculated with another.

`src/app/pricing.ts` is intentionally just an Angular-facing adapter around the shared JSON. It adds TypeScript types and the `estimateCostUsd` helper, but it is not the source of truth.

## Calculation

For each model row:

```text
cost_usd =
  input_tokens / 1,000,000 * input_price +
  cached_input_tokens / 1,000,000 * cached_input_price +
  cache_write_tokens / 1,000,000 * cache_write_price +
  output_tokens / 1,000,000 * output_price
```

Then:

```text
cost_eur = cost_usd * usdToEur
```

`usdToEur` is written into the generated ledger so the UI can show which conversion was used. The default is `0.93`, overridable during scan with `USD_TO_EUR`.

## Why The GitHub Prices Page Exists

The user should be able to inspect the cost inputs directly. If a session looks expensive, the UI should make it clear whether that came from:

- high input tokens
- high output tokens
- a more expensive model
- cached input or cache-write accounting
- a model fallback because the raw model id was not in the known GitHub table

The `GitHub prices` view therefore shows every rate row the app knows about, where it came from, and whether any imported session currently uses it.

## Current Limitations

- Local VS Code debug logs currently provide input and output token totals, but not complete billing-grade cache accounting.
- When `cachedInput` and `cacheWrite` are zero in a debug-log import, that currently means those cache fields were not present in the local log source. It should not be presented as proof that provider-side cache billing was zero.
- Cached input is not a discount against output. It is a separate input/context bucket when a billing source exposes it. Output tokens remain priced as output tokens.
- The Cost view includes a Billing Reality Check that labels cache uncertainty as likely low impact, material, or directional based on the imported input/output cost split.
- GitHub billing can still differ because GitHub may apply provider-side cache accounting or billing adjustments not present in local logs.
- Unknown model ids are preserved for display and priced with a visible fallback until the pricing table is updated.
- The pricing table should be rechecked against GitHub Docs whenever GitHub changes model availability or usage-based rates.

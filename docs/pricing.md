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

- UI pricing constants: `src/app/pricing.ts`
- Scanner pricing mirror: `scripts/scan-vscode-sessions.mjs`
- Verifier pricing mirror: `scripts/verify-ledger-data.mjs`
- Generated ledger metadata: `public/data/sessions.json`

The duplication is deliberate for the current MVP. The scanner must calculate costs without importing Angular code, and the verifier must independently check the generated ledger. A later cleanup can move the table into a shared JSON file consumed by all three.

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
- GitHub billing can still differ because GitHub may apply provider-side cache accounting or billing adjustments not present in local logs.
- Unknown model ids are preserved for display and priced with a visible fallback until the pricing table is updated.
- The pricing table should be rechecked against GitHub Docs whenever GitHub changes model availability or usage-based rates.

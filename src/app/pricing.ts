import { TokenBreakdown } from './ledger.model';

export interface ModelPrice {
  input: number;
  cachedInput: number;
  cacheWrite?: number;
  output: number;
}

export const PRICING_VERSION = 'github-copilot-usage-pricing-2026-06-01';

export const MODEL_PRICES_USD_PER_MILLION: Record<string, ModelPrice> = {
  'GPT-4.1': { input: 2, cachedInput: 0.5, output: 8 },
  'GPT-5 mini': { input: 0.25, cachedInput: 0.025, output: 2 },
  'GPT-5.2': { input: 1.75, cachedInput: 0.175, output: 14 },
  'GPT-5.2-Codex': { input: 1.75, cachedInput: 0.175, output: 14 },
  'GPT-5.3-Codex': { input: 1.75, cachedInput: 0.175, output: 14 },
  'GPT-5.4': { input: 2.5, cachedInput: 0.25, output: 15 },
  'GPT-5.4 mini': { input: 0.75, cachedInput: 0.075, output: 4.5 },
  'GPT-5.4 nano': { input: 0.2, cachedInput: 0.02, output: 1.25 },
  'GPT-5.5': { input: 5, cachedInput: 0.5, output: 30 },
  'Claude Haiku 4.5': { input: 1, cachedInput: 0.1, cacheWrite: 1.25, output: 5 },
  'Claude Sonnet 4': { input: 3, cachedInput: 0.3, cacheWrite: 3.75, output: 15 },
  'Claude Sonnet 4.5': { input: 3, cachedInput: 0.3, cacheWrite: 3.75, output: 15 },
  'Claude Sonnet 4.6': { input: 3, cachedInput: 0.3, cacheWrite: 3.75, output: 15 },
  'Claude Opus 4.5': { input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 25 },
  'Gemini 2.5 Pro': { input: 1.25, cachedInput: 0.125, output: 10 },
  'Gemini 3 Flash': { input: 0.5, cachedInput: 0.05, output: 3 },
  'Gemini 3.1 Pro': { input: 2, cachedInput: 0.2, output: 12 },
  'Grok Code Fast 1': { input: 0.2, cachedInput: 0.02, output: 1.5 },
  'Raptor mini': { input: 0.25, cachedInput: 0.025, output: 2 },
  Goldeneye: { input: 1.25, cachedInput: 0.125, output: 10 },
};

export function estimateCostUsd(model: string, tokens: TokenBreakdown): number {
  const price = MODEL_PRICES_USD_PER_MILLION[model] ?? MODEL_PRICES_USD_PER_MILLION['GPT-5.4'];

  return (
    (tokens.input / 1_000_000) * price.input +
    (tokens.cachedInput / 1_000_000) * price.cachedInput +
    (tokens.cacheWrite / 1_000_000) * (price.cacheWrite ?? 0) +
    (tokens.output / 1_000_000) * price.output
  );
}

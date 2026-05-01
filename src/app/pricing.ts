import { TokenBreakdown } from './ledger.model';

export interface ModelPrice {
  provider: 'OpenAI' | 'Anthropic' | 'Google' | 'xAI' | 'Fine-tuned (GitHub)';
  category: 'Lightweight' | 'Versatile' | 'Powerful';
  releaseStatus: 'GA' | 'Public preview';
  input: number;
  cachedInput: number;
  cacheWrite?: number;
  output: number;
  note?: string;
}

export const PRICING_VERSION = 'github-copilot-usage-pricing-2026-06-01';
export const PRICING_SOURCE_URL = 'https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing';
export const PRICING_SOURCE_LABEL = 'GitHub Docs: Models and pricing for GitHub Copilot';
export const PRICING_EFFECTIVE_DATE = '2026-06-01';
export const PRICING_IMPORTED_AT = '2026-05-01';

export const MODEL_PRICES_USD_PER_MILLION: Record<string, ModelPrice> = {
  'GPT-4.1': { provider: 'OpenAI', releaseStatus: 'GA', category: 'Versatile', input: 2, cachedInput: 0.5, output: 8, note: 'Included model' },
  'GPT-5 mini': { provider: 'OpenAI', releaseStatus: 'GA', category: 'Lightweight', input: 0.25, cachedInput: 0.025, output: 2, note: 'Included model' },
  'GPT-5.2': { provider: 'OpenAI', releaseStatus: 'GA', category: 'Versatile', input: 1.75, cachedInput: 0.175, output: 14 },
  'GPT-5.2-Codex': { provider: 'OpenAI', releaseStatus: 'GA', category: 'Powerful', input: 1.75, cachedInput: 0.175, output: 14 },
  'GPT-5.3-Codex': { provider: 'OpenAI', releaseStatus: 'GA', category: 'Powerful', input: 1.75, cachedInput: 0.175, output: 14 },
  'GPT-5.4': { provider: 'OpenAI', releaseStatus: 'GA', category: 'Versatile', input: 2.5, cachedInput: 0.25, output: 15, note: 'Pricing applies to prompts with 272K tokens or fewer' },
  'GPT-5.4 mini': { provider: 'OpenAI', releaseStatus: 'GA', category: 'Lightweight', input: 0.75, cachedInput: 0.075, output: 4.5 },
  'GPT-5.4 nano': { provider: 'OpenAI', releaseStatus: 'GA', category: 'Lightweight', input: 0.2, cachedInput: 0.02, output: 1.25 },
  'GPT-5.5': { provider: 'OpenAI', releaseStatus: 'GA', category: 'Powerful', input: 5, cachedInput: 0.5, output: 30 },
  'Claude Haiku 4.5': { provider: 'Anthropic', releaseStatus: 'GA', category: 'Versatile', input: 1, cachedInput: 0.1, cacheWrite: 1.25, output: 5 },
  'Claude Sonnet 4': { provider: 'Anthropic', releaseStatus: 'GA', category: 'Versatile', input: 3, cachedInput: 0.3, cacheWrite: 3.75, output: 15 },
  'Claude Sonnet 4.5': { provider: 'Anthropic', releaseStatus: 'GA', category: 'Versatile', input: 3, cachedInput: 0.3, cacheWrite: 3.75, output: 15 },
  'Claude Sonnet 4.6': { provider: 'Anthropic', releaseStatus: 'GA', category: 'Versatile', input: 3, cachedInput: 0.3, cacheWrite: 3.75, output: 15 },
  'Claude Opus 4.5': { provider: 'Anthropic', releaseStatus: 'GA', category: 'Powerful', input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 25 },
  'Claude Opus 4.6': { provider: 'Anthropic', releaseStatus: 'GA', category: 'Powerful', input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 25 },
  'Claude Opus 4.7': { provider: 'Anthropic', releaseStatus: 'GA', category: 'Powerful', input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 25 },
  'Gemini 2.5 Pro': { provider: 'Google', releaseStatus: 'GA', category: 'Powerful', input: 1.25, cachedInput: 0.125, output: 10, note: 'Pricing applies to prompts with 200K tokens or fewer' },
  'Gemini 3 Flash': { provider: 'Google', releaseStatus: 'Public preview', category: 'Lightweight', input: 0.5, cachedInput: 0.05, output: 3, note: 'No long-context surcharge' },
  'Gemini 3.1 Pro': { provider: 'Google', releaseStatus: 'Public preview', category: 'Powerful', input: 2, cachedInput: 0.2, output: 12, note: 'Pricing applies to prompts with 200K tokens or fewer' },
  'Grok Code Fast 1': { provider: 'xAI', releaseStatus: 'GA', category: 'Lightweight', input: 0.2, cachedInput: 0.02, output: 1.5 },
  'Raptor mini': { provider: 'Fine-tuned (GitHub)', releaseStatus: 'Public preview', category: 'Versatile', input: 0.25, cachedInput: 0.025, output: 2, note: 'Uses GPT-5 mini pricing' },
  Goldeneye: { provider: 'Fine-tuned (GitHub)', releaseStatus: 'Public preview', category: 'Powerful', input: 1.25, cachedInput: 0.125, output: 10, note: 'Uses GPT-5.1-Codex pricing' },
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

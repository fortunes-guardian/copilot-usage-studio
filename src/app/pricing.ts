import { TokenBreakdown } from './ledger.model';
import pricingData from '../../data/github-copilot-pricing.json';

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

export const PRICING_VERSION = pricingData.version;
export const PRICING_SOURCE_URL = pricingData.sourceUrl;
export const PRICING_SOURCE_LABEL = pricingData.sourceLabel;
export const PRICING_EFFECTIVE_DATE = pricingData.effectiveDate;
export const PRICING_IMPORTED_AT = pricingData.importedAt;
export const FALLBACK_PRICING_MODEL = pricingData.fallbackModel;

export const MODEL_PRICES_USD_PER_MILLION = pricingData.models as Record<string, ModelPrice>;

export function estimateCostUsd(model: string, tokens: TokenBreakdown): number {
  const price = MODEL_PRICES_USD_PER_MILLION[model] ?? MODEL_PRICES_USD_PER_MILLION[FALLBACK_PRICING_MODEL];

  return (
    (tokens.input / 1_000_000) * price.input +
    (tokens.cachedInput / 1_000_000) * price.cachedInput +
    (tokens.cacheWrite / 1_000_000) * (price.cacheWrite ?? 0) +
    (tokens.output / 1_000_000) * price.output
  );
}
